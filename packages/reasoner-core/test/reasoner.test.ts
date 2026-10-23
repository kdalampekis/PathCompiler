import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import {
  type FormalExpr,
  type FormalProductModel,
  f,
} from "@pathcompiler/formal-model";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nextDemoFormalModel } from "../../formal-model/test/next-demo-model.js";
import {
  applyFormalAction,
  createProductReasoner,
  evaluateFormalExpr,
  type FormalStateSnapshot,
  type ProductReasoner,
  type ReachabilityResult,
  ReasoningQueryError,
  sliceFormalModel,
} from "../src/index.js";

let solver: SolverProvider;
let reasoner: ProductReasoner;
let hand: FormalProductModel;
let extracted: FormalProductModel;
beforeAll(async () => {
  solver = await createZ3SolverProvider();
  reasoner = createProductReasoner(solver);
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  hand = nextDemoFormalModel(project.repository.commit ?? "unbound");
  extracted = buildFormalModel(
    capabilities.graph,
    capabilities.report,
    mined.report,
    { id: "next_demo" },
  ).model;
});
afterAll(async () => {
  await solver?.close();
});
const actions = (result: ReachabilityResult) =>
  result.status === "reachable"
    ? result.trace.actions.map((item) => item.actionId)
    : [];

describe("bounded reachability on the next-demo models", () => {
  it("finds a shortest editor witness for creating a client in the hand model", async () => {
    const result = await reasoner.checkReachability(hand, {
      goal: "clients.created",
      context: { role: "editor" },
    });
    expect(result.status).toBe("reachable");
    if (result.status !== "reachable") return;
    expect(result.trace.actions).toHaveLength(5);
    expect(actions(result)[0]).toBe("nav.open_clients");
    expect(actions(result)[1]).toBe("clients.open_create_form");
    expect(actions(result).slice(2, 4).sort()).toEqual([
      "clients.enter_email",
      "clients.enter_name",
    ]);
    expect(actions(result)[4]).toBe("clients.submit_create");
    expect(result.trace.actions[4]).toMatchObject({
      semanticTarget: "client.form.submit",
      capabilityId: "clients.create",
      changes: { client_exists: true, client_form_open: false },
    });
    expect(result.trace.actions[4]?.evidence.length).toBeGreaterThan(0);
    expect(result.trace.context.role).toBe("editor");
    expect(result.model).toMatchObject({
      id: "next_demo",
      source: "hand-encoded",
    });
    expect(result.stats.slice.actions).toBeLessThan(
      result.stats.slice.totalActions,
    );
  });

  it("proves a viewer cannot create a client or change a plan structure", async () => {
    for (const model of [hand, extracted])
      for (const goal of ["clients.created", "plans.structure_changed"]) {
        const result = await reasoner.checkReachability(model, {
          goal,
          context: { role: "viewer" in roles(model) ? "viewer" : "unlisted" },
        });
        expect(result.status, `${model.metadata.source} ${goal}`).toBe(
          "unreachable",
        );
        if (result.status === "unreachable")
          expect(result.proof.method).toBe("k-induction");
      }
  });

  it("answers the same questions on the extracted model", async () => {
    const created = await reasoner.checkReachability(extracted, {
      goal: "clients.created",
      context: { role: "editor" },
    });
    expect(actions(created)).toHaveLength(5);
    expect(actions(created).at(-1)).toBe("clients.create.submit");
    expect(created.model.source).toBe("extracted");
    const changed = await reasoner.checkReachability(extracted, {
      goal: "plans.structure_changed",
      context: { role: "editor", plan_structure_enabled: true },
    });
    expect(changed.status).toBe("reachable");
    expect(actions(changed)).toEqual([
      "navigate.nav_plans",
      "plans.change_structure.open",
      "plans.change_structure.submit",
    ]);
    if (changed.status === "reachable")
      expect(changed.trace.initialState.plan_exists).toBe(true);
    const flagOff = await reasoner.checkReachability(extracted, {
      goal: "plans.structure_changed",
      context: { role: "editor", plan_structure_enabled: false },
    });
    expect(flagOff.status).toBe("unreachable");
  });

  it("returns unknown when the bound is too small, never unreachable", async () => {
    const result = await reasoner.checkReachability(hand, {
      goal: "clients.created",
      context: { role: "editor" },
      maxDepth: 3,
    });
    expect(result).toMatchObject({
      status: "unknown",
      reason: "bound-insufficient",
    });
    expect(result.stats.bound).toBe(3);
  });

  it("maps solver timeouts and unknown answers to unknown", async () => {
    const stub = (reason: string): SolverProvider => ({
      name: "stub",
      check: async () => ({ status: "unknown", reason }),
      close: async () => {},
    });
    const query = { goal: "clients.created", context: { role: "editor" } };
    expect(
      await createProductReasoner(stub("timeout")).checkReachability(
        hand,
        query,
      ),
    ).toMatchObject({ status: "unknown", reason: "timeout" });
    expect(
      await createProductReasoner(stub("incomplete")).checkReachability(
        hand,
        query,
      ),
    ).toMatchObject({ status: "unknown", reason: "solver-unknown" });
    const slow: SolverProvider = {
      name: "slow",
      check: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { status: "unsat" };
      },
      close: async () => {},
    };
    const result = await createProductReasoner(slow).checkReachability(hand, {
      ...query,
      timeoutMs: 20,
    });
    expect(result).toMatchObject({ status: "unknown", reason: "timeout" });
    expect(result.stats.solverCalls).toBe(1);
  });

  it("rejects malformed queries with actionable errors", async () => {
    await expect(
      reasoner.checkReachability(hand, { goal: "missing" }),
    ).rejects.toThrow(/Unknown goal missing\. Known goals: clients\.created/);
    await expect(
      reasoner.checkReachability(hand, {
        goal: "clients.created",
        context: { client_exists: true },
      }),
    ).rejects.toThrow(/client_exists is not a context variable/);
    await expect(
      reasoner.checkReachability(hand, {
        goal: "clients.created",
        context: { role: "admin" },
      }),
    ).rejects.toThrow(ReasoningQueryError);
    await expect(
      reasoner.checkReachability(hand, {
        goal: "clients.created",
        maxDepth: -1,
      }),
    ).rejects.toThrow(/maxDepth/);
  });

  it("slices to the cone of influence of the goal", () => {
    const slice = sliceFormalModel(hand, ["client_exists"]);
    const ids = slice.actions.map((item) => item.id);
    expect(ids).toContain("clients.submit_create");
    expect(ids).not.toContain("plans.select_weekly");
    expect(slice.variables.map((item) => item.id)).not.toContain(
      "selected_structure",
    );
  });
});

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
function randomModel(seed: number): FormalProductModel {
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
function shortestPath(
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

describe("SMT encoding agrees with explicit-state search", () => {
  it("never contradicts the reference and returns shortest witnesses", async () => {
    let unknown = 0;
    let total = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const model = randomModel(seed);
      for (const context of [{}, { flag: true }, { flag: false }]) {
        total += 1;
        const expected = shortestPath(model, context);
        const result = await reasoner.checkReachability(model, {
          goal: "goal",
          context,
          maxDepth: 8,
        });
        const label = `seed ${seed} ${JSON.stringify(context)}`;
        if (result.status === "reachable")
          expect(result.trace.actions.length, label).toBe(expected);
        else if (result.status === "unreachable")
          expect(expected, label).toBeUndefined();
        else unknown += 1;
      }
    }
    // Unknown is allowed but should be rare on these small models.
    expect(unknown / total).toBeLessThan(0.1);
  });
});

function roles(model: FormalProductModel): Record<string, true> {
  const role = model.variables.find((item) => item.id === "role");
  return Object.fromEntries(
    (role?.type === "enum" ? role.values : []).map((value) => [value, true]),
  );
}
