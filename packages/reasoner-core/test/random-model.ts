import {
  type FormalExpr,
  type FormalProductModel,
  f,
} from "@pathcompiler/formal-model";
import {
  applyFormalAction,
  evaluateFormalExpr,
  type FormalStateSnapshot,
} from "../src/index.js";

// Explicit-state reference over random finite models: the SMT encoding must agree.
function prng(seed: number) {
  let state = seed;
  return (limit: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % limit;
  };
}
const evidence = [
  { id: "x", type: "symbol" as const, locator: "x", repositoryCommit: "c" },
];
export function randomModel(seed: number): FormalProductModel {
  const pick = prng(seed);
  const atom = (): FormalExpr => {
    switch (pick(6)) {
      case 0:
        return f.var("a");
      case 1:
        return f.not(f.var("a"));
      case 2:
        return f.var("b");
      case 3:
        return f.var("flag");
      case 4:
        return f.is("m", ["X", "Y", "Z"][pick(3)] as string);
      default:
        return { type: "lte", left: f.ref("n"), right: f.lit(pick(3)) };
    }
  };
  const effect = (id: string) =>
    id === "m"
      ? f.set("m", ["X", "Y", "Z"][pick(3)] as string)
      : id === "n"
        ? f.set("n", pick(3))
        : f.set(id, pick(2) === 0);
  return {
    schemaVersion: 1,
    id: `random_${seed}`,
    metadata: {
      repositoryCommit: null,
      source: "hand-encoded",
      extractorVersion: "test",
    },
    variables: [
      { id: "flag", type: "boolean", scope: "context", evidence },
      { id: "a", type: "boolean", scope: "state", evidence },
      { id: "b", type: "boolean", scope: "state", evidence },
      {
        id: "m",
        type: "enum",
        values: ["X", "Y", "Z"],
        scope: "state",
        evidence,
      },
      { id: "n", type: "integer", min: 0, max: 2, scope: "state", evidence },
    ],
    initial: f.and(f.not(f.var("a")), f.is("m", "X"), f.is("n", 0)),
    actions: Array.from({ length: 2 + pick(4) }, (_, index) => {
      const first = ["a", "b", "m", "n"][pick(4)] as string;
      const second = ["a", "b", "m", "n"][pick(4)] as string;
      return {
        id: `act_${index}`,
        precondition: pick(2) === 0 ? atom() : f.and(atom(), atom()),
        effects:
          first === second ? [effect(first)] : [effect(first), effect(second)],
        evidence,
      };
    }),
    invariants: [],
    goals: [
      {
        id: "goal",
        condition: pick(2) === 0 ? atom() : f.and(atom(), atom()),
        businessMeaning: "random goal",
        evidence,
        confidence: 1,
      },
    ],
  };
}
export function shortestPath(
  model: FormalProductModel,
  context: FormalStateSnapshot,
): number | undefined {
  const goal = model.goals[0]?.condition as FormalExpr;
  let frontier: FormalStateSnapshot[] = [];
  for (const flag of context.flag === undefined
    ? [false, true]
    : [context.flag])
    for (const b of [false, true]) {
      const state = { flag, a: false, b, m: "X", n: 0 };
      if (evaluateFormalExpr(model.initial, state)) frontier.push(state);
    }
  const seen = new Set(frontier.map((state) => JSON.stringify(state)));
  for (let depth = 0; frontier.length > 0; depth += 1) {
    if (frontier.some((state) => evaluateFormalExpr(goal, state))) return depth;
    const next: FormalStateSnapshot[] = [];
    for (const state of frontier)
      for (const action of model.actions)
        if (evaluateFormalExpr(action.precondition, state)) {
          const after = applyFormalAction(action, state);
          const key = JSON.stringify(after);
          if (!seen.has(key)) {
            seen.add(key);
            next.push(after);
          }
        }
    frontier = next;
  }
  return undefined;
}
