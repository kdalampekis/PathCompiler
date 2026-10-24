import { type ObservedGraph, SESSION_END, SESSION_START } from "./index.js";

/**
 * Probabilistic transition model (O11, reasoning spec §158–§159): empirical
 * transition probabilities of the observed graph as a discrete-time Markov
 * chain, with uncertainty and sample thresholds. Estimates describe observed
 * users, not what the product allows (that is the formal model).
 */
export type TransitionEstimate = {
  to: string;
  count: number;
  probability: number;
  /** 95% Wilson score interval. */
  interval: [number, number];
};
export type TransitionState = {
  id: string;
  /** Outgoing transitions observed from this state. */
  total: number;
  /** At least `minTransitions` outgoing transitions. */
  sufficient: boolean;
  absorbing: boolean;
  transitions: TransitionEstimate[];
};
export type GoalReachEstimate = {
  goal: string;
  /** Probability that a session starting at session:start eventually reaches the goal. */
  probability: number;
  /** False when a state on some path to the goal is below the sample threshold. */
  sufficient: boolean;
};
export type TransitionModel = {
  schemaVersion: 1;
  meaning: "estimate";
  minTransitions: number;
  sessions: number;
  states: TransitionState[];
  goals: GoalReachEstimate[];
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round = (value: number) => Math.round(value * 10_000) / 10_000;
/** Wilson score interval for k successes in n trials (z = 1.96). */
export function wilsonInterval(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [
    round(Math.max(0, (centre - spread) / denominator)),
    round(Math.min(1, (centre + spread) / denominator)),
  ];
}

export function buildTransitionModel(
  graph: ObservedGraph,
  options: { minTransitions?: number } = {},
): TransitionModel {
  const minTransitions = options.minTransitions ?? 30;
  const outgoing = new Map<string, { to: string; count: number }[]>();
  for (const edge of graph.edges)
    outgoing.set(edge.from, [
      ...(outgoing.get(edge.from) ?? []),
      { to: edge.to, count: edge.count },
    ]);
  const ids = [
    ...new Set([
      ...graph.nodes.map((node) => node.id),
      ...graph.edges.flatMap((edge) => [edge.from, edge.to]),
    ]),
  ].sort(compare);
  const states: TransitionState[] = ids.map((id) => {
    const edges = [...(outgoing.get(id) ?? [])].sort((a, b) =>
      compare(a.to, b.to),
    );
    const total = edges.reduce((sum, edge) => sum + edge.count, 0);
    return {
      id,
      total,
      sufficient: total >= minTransitions,
      absorbing: id === SESSION_END || total === 0,
      transitions: edges.map((edge) => ({
        to: edge.to,
        count: edge.count,
        probability: round(edge.count / total),
        interval: wilsonInterval(edge.count, total),
      })),
    };
  });
  const byId = new Map(states.map((state) => [state.id, state]));

  // P(eventually reach goal | state) by value iteration on the chain; states
  // that only lead to session end converge to 0.
  const goals = ids.filter((id) => id.startsWith("goal:"));
  const estimates: GoalReachEstimate[] = goals.map((goal) => {
    const value = new Map(ids.map((id) => [id, id === goal ? 1 : 0]));
    for (let iteration = 0; iteration < 10_000; iteration += 1) {
      let change = 0;
      for (const state of states) {
        if (state.id === goal || state.absorbing) continue;
        const next = state.transitions.reduce(
          (sum, edge) =>
            sum + (edge.count / state.total) * (value.get(edge.to) ?? 0),
          0,
        );
        change = Math.max(change, Math.abs(next - (value.get(state.id) ?? 0)));
        value.set(state.id, next);
      }
      if (change < 1e-12) break;
    }
    // States that can reach the goal: their samples decide sufficiency.
    const relevant = states.filter(
      (state) =>
        state.id !== goal && !state.absorbing && (value.get(state.id) ?? 0) > 0,
    );
    return {
      goal: goal.slice("goal:".length),
      probability: round(value.get(SESSION_START) ?? 0),
      sufficient: relevant.every((state) => byId.get(state.id)?.sufficient),
    };
  });
  return {
    schemaVersion: 1,
    meaning: "estimate",
    minTransitions,
    sessions: graph.sessions,
    states,
    goals: estimates,
  };
}
