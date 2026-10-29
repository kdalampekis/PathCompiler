import {
  type FormalProductModel,
  normalizeFormalModel,
} from "@pathcompiler/formal-model";
import type { ProductRuntimeEvent } from "@pathcompiler/observability-core";
import { createProductReasoner } from "@pathcompiler/reasoner-core";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { clusterTraces } from "@pathcompiler/trace-clustering";

/**
 * Drop-off and alternative paths (O10, reasoning spec §158): where sessions
 * that start a goal give up, and which valid formal routes avoid that point.
 * Suggestions are hypotheses for product review, never redesign orders.
 */
export type DropOffPoint = {
  /** Last semantic target a session activated before leaving. */
  target: string;
  sessions: number;
  /** Share of attempts that ended here. */
  share: number;
};
export type DropOffItem = {
  goal: string;
  capabilityId: string;
  role: string;
  attempts: number;
  completions: number;
  dropOffs: number;
  /** Null below `minAttempts`. */
  dropOffRate: number | null;
  points: DropOffPoint[];
  /** High-friction points (share ≥ `frictionShare`) and the routes around them. */
  friction: {
    target: string;
    share: number;
    /** Business variants (R6) whose major actions do not use the target. */
    alternatives: string[][];
  }[];
};
export type DropOffReport = {
  schemaVersion: 1;
  meaning: "hypothesis";
  minAttempts: number;
  frictionShare: number;
  items: DropOffItem[];
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round = (value: number) => Math.round(value * 1000) / 1000;

export async function analyzeDropOffs(
  input: FormalProductModel,
  events: readonly ProductRuntimeEvent[],
  solver: SolverProvider,
  options: {
    /** Attempts a goal and role need before rates are reported. Default 30. */
    minAttempts?: number;
    /** Share of attempts at one point that counts as friction. Default 0.2. */
    frictionShare?: number;
    /** Extra plan length searched for alternatives (R6 slack). Default 1. */
    slack?: number;
    otherRole?: string;
  } = {},
): Promise<DropOffReport> {
  const model = normalizeFormalModel(input);
  const minAttempts = options.minAttempts ?? 30;
  const frictionShare = options.frictionShare ?? 0.2;
  const otherRole = options.otherRole ?? "unlisted";
  const roleVariable = model.variables.find(
    (item) => item.id === "role" && item.scope === "context",
  );
  const contextFor = (role: string): Record<string, string> => {
    if (role === "(none)" || roleVariable?.type !== "enum") return {};
    if (roleVariable.values.includes(role)) return { role };
    return roleVariable.values.includes(otherRole) ? { role: otherRole } : {};
  };
  // Targets each capability's actions use.
  const targetsOf = new Map<string, Set<string>>();
  for (const action of model.actions)
    if (action.capabilityId && action.semanticTarget)
      targetsOf.set(
        action.capabilityId,
        new Set([
          ...(targetsOf.get(action.capabilityId) ?? []),
          action.semanticTarget,
        ]),
      );
  const goals = model.goals.filter((goal) => goal.capabilityId);
  // A target used by several capabilities (a shared form's submit button)
  // cannot tell which one the user is attempting, so it never starts an
  // attempt; the capability's own entry targets do (ISSUES_LOG #32).
  const owners = new Map<string, number>();
  for (const targets of targetsOf.values())
    for (const target of targets)
      owners.set(target, (owners.get(target) ?? 0) + 1);
  const startersOf = (capabilityId: string) => {
    const all = targetsOf.get(capabilityId) ?? new Set<string>();
    const own = new Set([...all].filter((target) => owners.get(target) === 1));
    return own.size > 0 ? own : all;
  };

  type Tally = {
    attempts: number;
    completions: number;
    points: Map<string, number>;
  };
  const tallies = new Map<string, Tally>();
  const bySession = new Map<string, ProductRuntimeEvent[]>();
  for (const event of events) {
    const key = `${event.projectId}\u0000${event.sessionId}`;
    bySession.set(key, [...(bySession.get(key) ?? []), event]);
  }
  for (const list of bySession.values()) {
    const ordered = [...list].sort(
      (a, b) =>
        compare(a.timestamp, b.timestamp) || compare(a.eventId, b.eventId),
    );
    for (const goal of goals) {
      const targets = targetsOf.get(goal.capabilityId as string) ?? new Set();
      const starters = startersOf(goal.capabilityId as string);
      // An attempt starts at the first activation of one of the goal's targets.
      let open: { role: string; last: string } | undefined;
      const close = (completed: boolean) => {
        if (!open) return;
        const key = `${goal.id}\u0000${open.role}`;
        const tally = tallies.get(key) ?? {
          attempts: 0,
          completions: 0,
          points: new Map(),
        };
        tally.attempts += 1;
        if (completed) tally.completions += 1;
        else
          tally.points.set(open.last, (tally.points.get(open.last) ?? 0) + 1);
        tallies.set(key, tally);
        open = undefined;
      };
      for (const event of ordered) {
        if (
          event.type === "semantic_target.activated" &&
          starters.has(event.semanticTarget)
        )
          open = { role: event.role ?? "(none)", last: event.semanticTarget };
        else if (
          event.type === "semantic_target.activated" &&
          open &&
          targets.has(event.semanticTarget)
        )
          open = { ...open, last: event.semanticTarget };
        else if (event.type === "goal.reached" && event.goalId === goal.id)
          close(true);
      }
      close(false);
    }
  }

  const reasoner = createProductReasoner(solver);
  const items: DropOffItem[] = [];
  for (const [key, tally] of [...tallies].sort(([a], [b]) => compare(a, b))) {
    const [goalId, role] = key.split("\u0000") as [string, string];
    const goal = goals.find((item) => item.id === goalId);
    if (!goal) continue;
    const dropOffs = tally.attempts - tally.completions;
    const enough = tally.attempts >= minAttempts;
    const points = [...tally.points]
      .map(([target, sessions]) => ({
        target,
        sessions,
        share: round(sessions / tally.attempts),
      }))
      .sort((a, b) => b.sessions - a.sessions || compare(a.target, b.target));
    const high = enough
      ? points.filter((point) => point.share >= frictionShare)
      : [];
    let variants: string[][] = [];
    if (high.length > 0) {
      const enumerated = await reasoner.enumeratePlans(model, {
        goal: goal.id,
        context: contextFor(role),
        slack: options.slack ?? 1,
      });
      if (enumerated.status === "found")
        variants = clusterTraces(enumerated.plans).variants.map(
          (variant) => variant.signature.majorActions,
        );
    }
    items.push({
      goal: goal.id,
      capabilityId: goal.capabilityId as string,
      role,
      attempts: tally.attempts,
      completions: tally.completions,
      dropOffs,
      dropOffRate: enough ? round(dropOffs / tally.attempts) : null,
      points,
      friction: high.map((point) => ({
        target: point.target,
        share: point.share,
        alternatives: variants.filter(
          (actions) => !actions.includes(point.target),
        ),
      })),
    });
  }
  return {
    schemaVersion: 1,
    meaning: "hypothesis",
    minAttempts,
    frictionShare,
    items,
  };
}
