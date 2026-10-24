import {
  type FormalProductModel,
  parseFormalModel,
} from "@pathcompiler/formal-model";
import { compareText } from "@pathcompiler/source-model";
import type {
  Plan,
  PlanResult,
  ProductReasoner,
  ReachabilityQuery,
} from "./index.js";

/**
 * Cost-optimal plans and UX metrics (reasoning spec §29–§30). Plans are
 * ranked by explicit per-action costs; the optimum is exact within a length
 * bound that no cheaper plan can exceed. Metrics are hypotheses for a human
 * to judge, never redesign prescriptions.
 */
export type ActionCategory =
  | "navigation"
  | "entry"
  | "field"
  | "submit"
  | "confirmation"
  | "back"
  | "cancel"
  | "other";
export type CostWeights = Partial<Record<ActionCategory, number>>;
/** Every interaction costs 1 by default: total cost counts user actions. */
export const DEFAULT_COST_WEIGHTS: Required<CostWeights> = {
  navigation: 1,
  entry: 1,
  field: 1,
  submit: 1,
  confirmation: 1,
  back: 1,
  cancel: 1,
  other: 1,
};
export type CheapestPlanResult =
  | (Omit<Extract<PlanResult, { status: "found" }>, "optimality"> & {
      costs: Record<string, number>;
      /** Every enumerated plan with its cost, cheapest first. */
      ranked: { plan: Plan; cost: number }[];
      /** `optimal` when every plan that could be cheaper was enumerated. */
      costOptimality: "optimal" | "not-guaranteed";
      lengthBound: number;
      /** Why the search ended before proving optimality, when it did. */
      stopped?: string;
    })
  | Exclude<PlanResult, { status: "found" }>;

/** Per-action costs from categories and weights (unknown actions: `other`). */
export function costsFromCategories(
  model: FormalProductModel,
  categories: Record<string, ActionCategory>,
  weights: CostWeights = {},
): Record<string, number> {
  const merged = { ...DEFAULT_COST_WEIGHTS, ...weights };
  for (const [category, weight] of Object.entries(merged))
    if (!(Number.isFinite(weight) && weight > 0))
      throw new Error(
        `Cost weight ${category} must be a positive number; zero-cost actions would make cheaper plans unbounded.`,
      );
  return Object.fromEntries(
    parseFormalModel(model).actions.map((action) => [
      action.id,
      merged[categories[action.id] ?? "other"],
    ]),
  );
}

export async function findCheapestPlan(
  reasoner: ProductReasoner,
  input: FormalProductModel,
  query: ReachabilityQuery & {
    costs?: Record<string, number>;
    /** Longest extra length searched beyond the shortest plan. Default 2. */
    maxSlack?: number;
    limit?: number;
  },
): Promise<CheapestPlanResult> {
  const { costs: given, maxSlack = 2, limit = 200, ...reach } = query;
  const model = parseFormalModel(input);
  const costs = Object.fromEntries(
    model.actions.map((action) => [
      action.id,
      given?.[action.id] ?? action.cost ?? 1,
    ]),
  );
  for (const [id, cost] of Object.entries(costs))
    if (!(Number.isFinite(cost) && cost > 0))
      throw new Error(`Cost of ${id} must be a positive number.`);
  const first = await reasoner.findPlan(model, reach);
  if (first.status !== "found") return first;
  const costOf = (plan: Plan) =>
    plan.steps.reduce((total, step) => total + (costs[step.actionId] ?? 1), 0);
  const cheapest = Math.min(...Object.values(costs));
  // A plan of length L costs at least L × the cheapest action, so once the
  // best cost found is below (L + 1) × cheapest, no longer plan can win.
  const shortest = first.plan.length;
  const cap = shortest + maxSlack;
  const all: { plan: Plan; cost: number; index: number }[] = [];
  let complete = true;
  let stopped: string | undefined;
  let length = shortest;
  for (; length <= cap; length += 1) {
    const enumerated = await reasoner.enumeratePlans(model, {
      ...reach,
      slack: length - shortest,
      minLength: length,
      limit: Math.max(1, limit - all.length),
    });
    if (enumerated.status !== "found") {
      // Longer lengths ran out of budget: keep the best plan found so far,
      // without an optimality claim.
      if (all.length > 0 && enumerated.status === "unknown") {
        complete = false;
        stopped = `Enumerating ${length}-step plans stopped (${enumerated.reason}).`;
        break;
      }
      return enumerated;
    }
    for (const plan of enumerated.plans)
      all.push({ plan, cost: costOf(plan), index: all.length });
    if (!enumerated.complete) {
      complete = false;
      stopped = `Stopped at the ${limit}-plan limit.`;
      break;
    }
    const best = Math.min(...all.map((item) => item.cost));
    if (Math.floor(best / cheapest + 1e-9) <= length) break;
  }
  const bound = Math.min(length, cap);
  const ranked = all
    .sort(
      (a, b) =>
        a.cost - b.cost || a.plan.length - b.plan.length || a.index - b.index,
    )
    .map(({ plan, cost }) => ({
      plan: {
        ...plan,
        steps: plan.steps.map((step) => ({
          ...step,
          cost: costs[step.actionId] ?? 1,
        })),
        cost,
      },
      cost,
    }));
  const best = ranked[0] as { plan: Plan; cost: number };
  const { optimality: _shortest, ...found } = first;
  return {
    ...found,
    plan: best.plan,
    costs,
    ranked,
    // Optimal when every plan short enough to beat the best cost found was
    // enumerated.
    costOptimality:
      complete && Math.floor(best.cost / cheapest + 1e-9) <= bound
        ? "optimal"
        : "not-guaranteed",
    lengthBound: bound,
    ...(stopped ? { stopped } : {}),
  };
}

export type UxMetrics = {
  goal: string;
  actions: number;
  pageTransitions: number;
  formFields: number;
  dialogInteractions: number;
  confirmations: number;
  /** Context the plan runs under: fixed by the query or chosen by the solver. */
  witnessContext: Record<string, boolean | number | string>;
  /** Distinct business variants, when alternatives were clustered. */
  variants?: number;
  estimatedEffort: number;
  meaning: "hypothesis";
  /** Observations worth a look; none is a defect by itself. */
  hypotheses: string[];
};
/** UX metrics of a plan (spec §30). Thresholds are review prompts, not rules. */
export function uxMetrics(
  plan: Plan,
  categories: Record<string, ActionCategory>,
  options: { variants?: number; cost?: number } = {},
): UxMetrics {
  const count = (...wanted: ActionCategory[]) =>
    plan.steps.filter((step) =>
      wanted.includes(categories[step.actionId] ?? "other"),
    ).length;
  const metrics = {
    actions: plan.steps.length,
    pageTransitions: count("navigation"),
    formFields: count("field"),
    dialogInteractions: count("entry", "confirmation", "back", "cancel"),
    confirmations: count("confirmation"),
  };
  const hypotheses: string[] = [];
  if (metrics.pageTransitions > 1)
    hypotheses.push(
      `Reaching ${plan.goal} takes ${metrics.pageTransitions} page transitions; users may not find the starting page.`,
    );
  if (metrics.formFields >= 5)
    hypotheses.push(
      `The shortest path enters ${metrics.formFields} form fields; consider defaults or fewer required fields.`,
    );
  if (metrics.confirmations > 0)
    hypotheses.push(
      `The cheapest path includes ${metrics.confirmations} confirmation step(s); check they guard a consequential change.`,
    );
  const capabilities = new Set(
    plan.steps.flatMap((step) =>
      step.capabilityId ? [step.capabilityId] : [],
    ),
  );
  if (capabilities.size > 1)
    hypotheses.push(
      `The cheapest path spans ${[...capabilities].sort(compareText).join(", ")}; a direct entry point may be missing.`,
    );
  if ((options.variants ?? 1) > 1)
    hypotheses.push(
      `${options.variants} distinct ways reach ${plan.goal}; help and tests should cover each.`,
    );
  return {
    goal: plan.goal,
    ...metrics,
    witnessContext: { ...plan.context },
    ...(options.variants === undefined ? {} : { variants: options.variants }),
    estimatedEffort: options.cost ?? plan.cost,
    meaning: "hypothesis",
    hypotheses,
  };
}
