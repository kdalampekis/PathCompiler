import {
  type FormalProductModel,
  normalizeFormalModel,
} from "@pathcompiler/formal-model";
import type { ProductRuntimeEvent } from "@pathcompiler/observability-core";
import {
  createProductReasoner,
  findCheapestPlan,
} from "@pathcompiler/reasoner-core";
import type { SolverProvider } from "@pathcompiler/solver-provider";

/**
 * Path efficiency (O9, reasoning spec §158–§159): how much effort users
 * spend reaching a goal compared with the cheapest valid formal path.
 * Path Efficiency Ratio = median observed path cost ÷ minimum formal path
 * cost. A UX-friction signal, never proof that the shortest path is the
 * best experience.
 */
export type PathEfficiencyItem = {
  goal: string;
  /** Observed role, or `(none)` when events carry no role. */
  role: string;
  /** Goal completions observed for this role. */
  completions: number;
  sessions: number;
  /** Interactions (navigations and target activations) per completion. */
  observedCost: { median: number; min: number; max: number } | null;
  /** Cheapest formal plan under the role, in the same unit; null if none. */
  minimumFormalCost: number | null;
  /** Median observed ÷ minimum formal; null when either is missing. */
  ratio: number | null;
  /** Fewer completions than `minCompletions`: the ratio is not reported. */
  insufficientData: boolean;
  formalPath: string[];
};
export type PathEfficiencyReport = {
  schemaVersion: 1;
  meaning: "hypothesis";
  unit: "interactions";
  minCompletions: number;
  items: PathEfficiencyItem[];
  /** Goals with a ratio at or above `frictionRatio`, worst first. */
  friction: { goal: string; role: string; ratio: number }[];
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};

export async function computePathEfficiency(
  input: FormalProductModel,
  events: readonly ProductRuntimeEvent[],
  solver: SolverProvider,
  options: {
    /** Completions a goal and role need before a ratio is reported. Default 30. */
    minCompletions?: number;
    /** Ratio at which a goal is listed as friction. Default 1.5. */
    frictionRatio?: number;
    /** Role value used when an observed role is not in the model. Default `unlisted`. */
    otherRole?: string;
    timeoutMs?: number;
  } = {},
): Promise<PathEfficiencyReport> {
  const model = normalizeFormalModel(input);
  const minCompletions = options.minCompletions ?? 30;
  const frictionRatio = options.frictionRatio ?? 1.5;
  const otherRole = options.otherRole ?? "unlisted";
  const roleVariable = model.variables.find(
    (item) => item.id === "role" && item.scope === "context",
  );
  const contextFor = (role: string): Record<string, string> => {
    if (role === "(none)" || roleVariable?.type !== "enum") return {};
    if (roleVariable.values.includes(role)) return { role };
    return roleVariable.values.includes(otherRole) ? { role: otherRole } : {};
  };

  // Observed side: per session, interactions since the previous completion.
  const bySession = new Map<string, ProductRuntimeEvent[]>();
  for (const event of events) {
    const key = `${event.projectId}\u0000${event.sessionId}`;
    bySession.set(key, [...(bySession.get(key) ?? []), event]);
  }
  const costs = new Map<string, { costs: number[]; sessions: Set<string> }>();
  for (const [session, list] of bySession) {
    let interactions = 0;
    for (const event of [...list].sort(
      (a, b) =>
        compare(a.timestamp, b.timestamp) || compare(a.eventId, b.eventId),
    )) {
      if (
        event.type === "route.changed" ||
        event.type === "semantic_target.activated"
      )
        interactions += 1;
      if (event.type !== "goal.reached") continue;
      const key = `${event.goalId}\u0000${event.role ?? "(none)"}`;
      const entry = costs.get(key) ?? {
        costs: [],
        sessions: new Set<string>(),
      };
      entry.costs.push(interactions);
      entry.sessions.add(session);
      costs.set(key, entry);
      interactions = 0;
    }
  }

  // Formal side: the cheapest plan per goal and role (unit costs, R7).
  const reasoner = createProductReasoner(solver);
  const items: PathEfficiencyItem[] = [];
  for (const [key, observed] of [...costs].sort(([a], [b]) => compare(a, b))) {
    const [goal, role] = key.split("\u0000") as [string, string];
    if (!model.goals.some((item) => item.id === goal)) continue;
    const cheapest = await findCheapestPlan(reasoner, model, {
      goal,
      context: contextFor(role),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    });
    const minimum = cheapest.status === "found" ? cheapest.plan.cost : null;
    const insufficientData = observed.costs.length < minCompletions;
    const middle = median(observed.costs);
    items.push({
      goal,
      role,
      completions: observed.costs.length,
      sessions: observed.sessions.size,
      observedCost: {
        median: middle,
        min: Math.min(...observed.costs),
        max: Math.max(...observed.costs),
      },
      minimumFormalCost: minimum,
      ratio:
        insufficientData || minimum === null || minimum === 0
          ? null
          : Math.round((middle / minimum) * 100) / 100,
      insufficientData,
      formalPath:
        cheapest.status === "found"
          ? cheapest.plan.steps.map((step) => step.actionId)
          : [],
    });
  }
  return {
    schemaVersion: 1,
    meaning: "hypothesis",
    unit: "interactions",
    minCompletions,
    items,
    friction: items
      .flatMap((item) =>
        item.ratio !== null && item.ratio >= frictionRatio
          ? [{ goal: item.goal, role: item.role, ratio: item.ratio }]
          : [],
      )
      .sort((a, b) => b.ratio - a.ratio || compare(a.goal, b.goal)),
  };
}
