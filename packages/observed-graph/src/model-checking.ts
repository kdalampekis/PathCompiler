import { SESSION_START } from "./index.js";
import {
  type TransitionModel,
  type TransitionState,
  wilsonInterval,
} from "./transition-model.js";

/**
 * Probabilistic model checking, P5 (reasoning spec §58–§59) on the observed
 * Markov chain (O11). Point estimates use the empirical probabilities. Bounds
 * treat every state's 95% Wilson intervals as an interval Markov chain and
 * take the least and greatest reach probability any distribution inside them
 * allows (robust value iteration), so small samples give wide bounds and an
 * honest "inconclusive". A transition never observed from a state may still
 * exist: its probability is bounded by the Wilson upper bound for zero
 * observations, and it may lead anywhere (0 for the lower bound, 1 for the
 * upper). Point estimates use observed transitions only. These are statements about observed users, not about what the product
 * allows (the formal model answers that).
 */
/**
 * Bounds from per-transition 95% intervals: conservative, but not a joint
 * 95% confidence level over the whole chain (ISSUES_LOG #41).
 */
export type ProbabilityBounds = {
  point: number;
  lower: number;
  upper: number;
};
export type GoalCheck = {
  goal: string;
  meaning: "estimate";
  /** P(eventually reach the goal) from session start. */
  reach: ProbabilityBounds;
  /** P(the session ends without reaching the goal). */
  abandonment: ProbabilityBounds;
  /** Expected transitions from session start to the goal, given it is reached; null if never reached. */
  expectedTransitions: number | null;
  /** Every state that can reach the goal has enough outgoing transitions. */
  sufficient: boolean;
};
export type PropertyVerdict = {
  goal: string;
  property: { op: "at-least" | "at-most"; bound: number };
  /** Decided only when the whole interval is on one side of the bound. */
  verdict: "satisfied" | "violated" | "inconclusive";
  reach: ProbabilityBounds;
};
export type ReachComparison = {
  goal: string;
  base: ProbabilityBounds;
  head: ProbabilityBounds;
  /** A direction only when the bounds do not overlap. */
  direction: "increased" | "decreased" | "no-detectable-change";
};

const round = (value: number) => Math.round(value * 10_000) / 10_000;
const ITERATIONS = 100_000;
const EPSILON = 1e-12;

/**
 * Least fixed point of `value(s) = choose(s, value)` with value(goal) = 1,
 * where `choose` picks the successor distribution (empirical, minimizing or
 * maximizing within the intervals).
 */
function reachValues(
  model: TransitionModel,
  goal: string,
  pick: "point" | "lower" | "upper",
): Map<string, number> {
  const value = new Map(
    model.states.map((state) => [state.id, state.id === goal ? 1 : 0]),
  );
  const step = (state: TransitionState) => {
    if (pick === "point")
      return state.transitions.reduce(
        (sum, edge) =>
          sum + (edge.count / state.total) * (value.get(edge.to) ?? 0),
        0,
      );
    // Start from the lower bounds, then give the remaining mass to the
    // successors that help (upper) or hurt (lower) most, up to their upper bounds.
    const unobserved = pick === "upper" ? 1 : 0;
    const worth = (to: string | null) =>
      to === null ? unobserved : (value.get(to) ?? 0);
    const edges = [
      ...state.transitions,
      { to: null, interval: [0, wilsonInterval(0, state.total)[1]] as const },
    ].sort((a, b) => {
      const difference = worth(b.to) - worth(a.to);
      return pick === "upper" ? difference : -difference;
    });
    let remaining = 1 - edges.reduce((sum, edge) => sum + edge.interval[0], 0);
    let total = 0;
    for (const edge of edges) {
      const extra = Math.max(
        0,
        Math.min(edge.interval[1] - edge.interval[0], remaining),
      );
      remaining -= extra;
      total += (edge.interval[0] + extra) * worth(edge.to);
    }
    return total;
  };
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    let change = 0;
    for (const state of model.states) {
      if (state.id === goal || state.absorbing) continue;
      const next = Math.min(1, Math.max(0, step(state)));
      change = Math.max(change, Math.abs(next - (value.get(state.id) ?? 0)));
      value.set(state.id, next);
    }
    if (change < EPSILON) break;
  }
  return value;
}

function bounds(model: TransitionModel, goal: string): ProbabilityBounds {
  const at = (pick: "point" | "lower" | "upper") =>
    reachValues(model, goal, pick).get(SESSION_START) ?? 0;
  const point = at("point");
  return {
    point: round(point),
    lower: round(Math.min(point, at("lower"))),
    upper: round(Math.max(point, at("upper"))),
  };
}

export function checkGoal(model: TransitionModel, goal: string): GoalCheck {
  const goalState = `goal:${goal}`;
  if (!model.states.some((state) => state.id === goalState))
    throw new Error(
      `No observed session reached ${goal}; observed goals: ${model.goals.map((item) => item.goal).join(", ") || "none"}.`,
    );
  const reach = bounds(model, goalState);
  const point = reachValues(model, goalState, "point");
  // Expected transitions to the goal in the chain conditioned on reaching it.
  const expected = new Map(model.states.map((state) => [state.id, 0]));
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    let change = 0;
    for (const state of model.states) {
      const here = point.get(state.id) ?? 0;
      if (state.id === goalState || state.absorbing || here === 0) continue;
      const next =
        1 +
        state.transitions.reduce(
          (sum, edge) =>
            sum +
            ((edge.count / state.total) *
              (point.get(edge.to) ?? 0) *
              (expected.get(edge.to) ?? 0)) /
              here,
          0,
        );
      change = Math.max(change, Math.abs(next - (expected.get(state.id) ?? 0)));
      expected.set(state.id, next);
    }
    if (change < 1e-9) break;
  }
  return {
    goal,
    meaning: "estimate",
    reach,
    abandonment: {
      point: round(1 - reach.point),
      lower: round(1 - reach.upper),
      upper: round(1 - reach.lower),
    },
    expectedTransitions:
      reach.point === 0
        ? null
        : Math.round((expected.get(SESSION_START) ?? 0) * 100) / 100,
    sufficient:
      model.goals.find((item) => item.goal === goal)?.sufficient ?? false,
  };
}

export function checkReachProperty(
  model: TransitionModel,
  property: { goal: string; op: "at-least" | "at-most"; bound: number },
): PropertyVerdict {
  if (!(property.bound >= 0 && property.bound <= 1))
    throw new Error("A probability bound must be between 0 and 1.");
  const { reach } = checkGoal(model, property.goal);
  const verdict =
    property.op === "at-least"
      ? reach.lower >= property.bound
        ? "satisfied"
        : reach.upper < property.bound
          ? "violated"
          : "inconclusive"
      : reach.upper <= property.bound
        ? "satisfied"
        : reach.lower > property.bound
          ? "violated"
          : "inconclusive";
  return {
    goal: property.goal,
    property: { op: property.op, bound: property.bound },
    verdict,
    reach,
  };
}

/** "Did the redesign increase completion probability?" with sample uncertainty. */
export function compareReach(
  base: TransitionModel,
  head: TransitionModel,
  goal: string,
): ReachComparison {
  const before = checkGoal(base, goal).reach;
  const after = checkGoal(head, goal).reach;
  return {
    goal,
    base: before,
    head: after,
    direction:
      after.lower > before.upper
        ? "increased"
        : after.upper < before.lower
          ? "decreased"
          : "no-detectable-change",
  };
}
