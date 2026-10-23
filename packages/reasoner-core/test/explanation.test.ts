import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import {
  type FormalExpr,
  type FormalProductModel,
  normalizeFormalModel,
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
  describeFormalExpr,
  type ExplanationResult,
  evaluateFormalExpr,
  type FormalStateSnapshot,
  type ProductReasoner,
  type UnreachableExplanation,
} from "../src/index.js";
import { randomModel } from "./random-model.js";

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
  ).model;
});
afterAll(async () => {
  await solver?.close();
});
function explanationOf(result: ExplanationResult): UnreachableExplanation {
  expect(result.status).toBe("unreachable");
  if (result.status !== "unreachable") throw new Error(result.status);
  return result.explanation;
}
const REQUIRE_EDITOR = "symbol:lib/session.ts#requireEditor";

describe("unreachability explanations", () => {
  it("explains why a viewer cannot create a client, traced to requireEditor", async () => {
    const own = explanationOf(
      await reasoner.explainUnreachable(hand, {
        goal: "clients.created",
        context: { role: "viewer" },
      }),
    );
    expect(own.minimal).toBe(true);
    expect(own.summary).toEqual([
      "Only clients.submit_create can make clients.created true.",
      "Context fixes role = viewer.",
      "clients.submit_create requires role = editor.",
      "Initially not client_exists.",
    ]);
    expect(own.constraints.map((item) => [item.id, item.kind])).toEqual([
      ["context:role", "context"],
      ["precondition:clients.submit_create#4", "precondition"],
      ["initial#5", "initial"],
    ]);
    const permission = own.constraints[1];
    expect(permission).toMatchObject({
      actionId: "clients.submit_create",
      capabilityId: "clients.create",
      semanticTarget: "client.form.submit",
      variables: ["role"],
    });
    expect(permission?.evidence.map((ref) => ref.id)).toEqual(
      expect.arrayContaining([REQUIRE_EDITOR, "permission:role:editor"]),
    );
    expect(own.goalSetters).toEqual([
      { actionId: "clients.submit_create", capabilityId: "clients.create" },
    ]);

    const fromCode = explanationOf(
      await reasoner.explainUnreachable(extracted, {
        goal: "clients.created",
        context: { role: "unlisted" },
      }),
    );
    expect(fromCode.constraints.map((item) => item.description)).toEqual([
      "Context fixes role = unlisted",
      "clients.create.submit requires role = editor",
      "Initially not clients_created",
    ]);
    expect(fromCode.constraints[1]?.evidence.map((ref) => ref.id)).toEqual(
      expect.arrayContaining([
        REQUIRE_EDITOR,
        "api:POST:/api/clients",
        "permission:role:editor",
      ]),
    );
  });

  it("names every goal-setting action blocked by a disabled flag", async () => {
    const explanation = explanationOf(
      await reasoner.explainUnreachable(extracted, {
        goal: "plans.structure_changed",
        context: { role: "editor", plan_structure_enabled: false },
      }),
    );
    expect(explanation.constraints.map((item) => item.id)).toEqual([
      "context:plan_structure_enabled",
      "precondition:plans.change_structure.confirm#4",
      "precondition:plans.change_structure.submit#4",
      "initial#10",
    ]);
    expect(explanation.constraints[0]?.evidence.map((ref) => ref.id)).toEqual([
      "flag:planStructure",
    ]);
    expect(explanation.summary[0]).toBe(
      "Only plans.change_structure.confirm and plans.change_structure.submit can make plans.structure_changed true.",
    );
  });

  it("returns the witness instead when the goal is reachable", async () => {
    const result = await reasoner.explainUnreachable(hand, {
      goal: "clients.created",
      context: { role: "editor" },
    });
    expect(result.status).toBe("reachable");
    expect("explanation" in result).toBe(false);
  });

  it("renders expressions in product terms", () => {
    const action = hand.actions.find(
      (item) => item.id === "plans.save_structure",
    );
    expect(describeFormalExpr(action?.precondition as FormalExpr)).toBe(
      "structure_dialog_open and not confirmation_open and selected_structure ≠ plan_structure and not (plan_structure = WEEKLY and selected_structure = SIMPLE) and role = editor and plan_structure_enabled",
    );
  });
});

// Keeping only the explained constraints must still make the goal unreachable.
function relax(
  input: FormalProductModel,
  keep: Set<string>,
): { model: FormalProductModel; initial: FormalExpr[] } {
  const model = normalizeFormalModel(input);
  const flatten = (expr: FormalExpr): FormalExpr[] =>
    expr.type === "and" ? expr.expressions.flatMap(flatten) : [expr];
  return {
    model: {
      ...model,
      actions: model.actions.map((action) => {
        const kept = flatten(action.precondition).filter((_, index) =>
          keep.has(`precondition:${action.id}#${index + 1}`),
        );
        return {
          ...action,
          precondition:
            kept.length === 0
              ? { type: "bool", value: true }
              : { type: "and", expressions: kept },
        };
      }),
    },
    initial: flatten(model.initial).filter((_, index) =>
      keep.has(`initial#${index + 1}`),
    ),
  };
}
function reachable(
  model: FormalProductModel,
  initial: FormalExpr[],
  flags: boolean[],
): boolean {
  const goal = model.goals[0]?.condition as FormalExpr;
  let frontier: FormalStateSnapshot[] = [];
  for (const flag of flags)
    for (const a of [false, true])
      for (const b of [false, true])
        for (const m of ["X", "Y", "Z"])
          for (const n of [0, 1, 2]) {
            const state = { flag, a, b, m, n };
            if (initial.every((item) => evaluateFormalExpr(item, state)))
              frontier.push(state);
          }
  const seen = new Set(frontier.map((state) => JSON.stringify(state)));
  while (frontier.length > 0) {
    if (frontier.some((state) => evaluateFormalExpr(goal, state))) return true;
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
  return false;
}

describe("explanations are sufficient (explicit-state check)", () => {
  it("keeps the goal unreachable with only the explained constraints", async () => {
    let explained = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const model = randomModel(seed);
      for (const context of [{}, { flag: true }, { flag: false }]) {
        const result = await reasoner.explainUnreachable(model, {
          goal: "goal",
          context,
          maxDepth: 8,
        });
        if (result.status !== "unreachable") continue;
        explained += 1;
        const keep = new Set(
          result.explanation.constraints.map((item) => item.id),
        );
        const relaxed = relax(model, keep);
        const flags =
          "flag" in context && keep.has("context:flag")
            ? [context.flag as boolean]
            : [false, true];
        expect(
          reachable(relaxed.model, relaxed.initial, flags),
          `seed ${seed} ${JSON.stringify(context)}: ${[...keep].join(", ")}`,
        ).toBe(false);
        expect(result.explanation.minimal).toBe(true);
      }
    }
    expect(explained).toBeGreaterThan(30);
  });
});
