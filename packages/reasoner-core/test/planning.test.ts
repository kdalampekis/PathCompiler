import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import { type FormalProductModel, f } from "@pathcompiler/formal-model";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import type { WorkflowV1 } from "@pathcompiler/workflow-ir";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nextDemoFormalModel } from "../../formal-model/test/next-demo-model.js";
import {
  createProductReasoner,
  evaluatePlan,
  type Plan,
  type PlanResult,
  type ProductReasoner,
} from "../src/index.js";

let solver: SolverProvider;
let reasoner: ProductReasoner;
let hand: FormalProductModel;
let extracted: FormalProductModel;
let workflows: Map<string, WorkflowV1>;
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
  workflows = new Map(
    discoverWorkflows(
      capabilities.graph,
      capabilities.report,
      mined.report,
    ).report.candidates.map((item) => [item.workflow.id, item.workflow]),
  );
});
afterAll(async () => {
  await solver?.close();
});
function planOf(result: PlanResult): Plan {
  expect(result.status, "detail" in result ? result.detail : "").toBe("found");
  if (result.status !== "found") throw new Error(result.status);
  return result.plan;
}
const ids = (plan: Plan) => plan.steps.map((step) => step.actionId);
const editor = { role: "editor", plan_structure_enabled: true };

describe("planning", () => {
  it("produces canonical, valid plans that match the Create Client workflow", async () => {
    const own = planOf(
      await reasoner.findPlan(hand, {
        goal: "clients.created",
        context: editor,
      }),
    );
    expect(ids(own)).toEqual([
      "nav.open_clients",
      "clients.open_create_form",
      "clients.enter_email",
      "clients.enter_name",
      "clients.submit_create",
    ]);
    expect(own).toMatchObject({ length: 5, cost: 5 });
    const workflow = workflows.get("clients.create");
    expect(evaluatePlan(hand, own, workflow)).toEqual({
      goalReached: true,
      invalidActionCount: 0,
      majorSteps: {
        expected: [
          "clients.create",
          "client.form.email",
          "client.form.name",
          "client.form.submit",
        ],
        planned: [
          "clients.create",
          "client.form.email",
          "client.form.name",
          "client.form.submit",
        ],
        matched: 4,
        score: 1,
        missing: [],
        extra: [],
      },
    });
    const fromCode = planOf(
      await reasoner.findPlan(extracted, {
        goal: "clients.created",
        context: editor,
      }),
    );
    expect(ids(fromCode)).toEqual([
      "navigate.nav_clients",
      "clients.create.open",
      "clients.create.enter_email",
      "clients.create.enter_name",
      "clients.create.submit",
    ]);
    expect(evaluatePlan(extracted, fromCode, workflow).majorSteps?.score).toBe(
      1,
    );
  });

  it("matches the other fixture workflows, explaining the extracted model's shortcut", async () => {
    const own = planOf(
      await reasoner.findPlan(hand, {
        goal: "plans.structure_changed",
        context: editor,
      }),
    );
    expect(ids(own)).toEqual([
      "nav.open_plans",
      "plans.open_structure_editor",
      "plans.select_weekly",
      "plans.save_structure",
    ]);
    const structure = workflows.get("plans.change_structure");
    expect(evaluatePlan(hand, own, structure).majorSteps?.score).toBe(1);
    // The extracted model does not tie the selection to stored state
    // (value-not-persisted), so its shortest plan skips the selector.
    const fromCode = planOf(
      await reasoner.findPlan(extracted, {
        goal: "plans.structure_changed",
        context: editor,
      }),
    );
    expect(
      evaluatePlan(extracted, fromCode, structure).majorSteps,
    ).toMatchObject({
      matched: 2,
      missing: ["plan.structure.selector"],
      extra: [],
    });
    const created = planOf(
      await reasoner.findPlan(extracted, {
        goal: "plans.created",
        context: editor,
      }),
    );
    expect(ids(created)).toEqual([
      "navigate.nav_plans",
      "plans.create.open",
      "plans.create.enter_client",
      "plans.create.enter_title",
      "plans.create.submit",
    ]);
    expect(
      evaluatePlan(extracted, created, workflows.get("plans.create")),
    ).toMatchObject({
      goalReached: true,
      invalidActionCount: 0,
      majorSteps: { score: 1 },
    });
  });

  it("reports impossible plans with the reachability proof and keeps unknown", async () => {
    const viewer = await reasoner.findPlan(hand, {
      goal: "clients.created",
      context: { role: "viewer" },
    });
    expect(viewer).toMatchObject({
      status: "impossible",
      proof: { method: "k-induction" },
    });
    expect(
      await reasoner.findPlan(hand, {
        goal: "clients.created",
        context: editor,
        maxDepth: 2,
      }),
    ).toMatchObject({ status: "unknown", reason: "bound-insufficient" });
  });

  it("is length-optimal and flags cost optimality only for uniform costs", async () => {
    const evidence = hand.actions[0]?.evidence ?? [];
    const model: FormalProductModel = {
      schemaVersion: 1,
      id: "costs",
      metadata: {
        repositoryCommit: null,
        source: "hand-encoded",
        extractorVersion: "test",
      },
      variables: [{ id: "done", type: "boolean", scope: "state", evidence }],
      initial: f.not(f.var("done")),
      actions: [
        {
          id: "cheap",
          precondition: f.bool(true),
          effects: [f.set("done", true)],
          cost: 1,
          evidence,
        },
        {
          id: "dear",
          precondition: f.bool(true),
          effects: [f.set("done", true)],
          cost: 5,
          evidence,
        },
      ],
      invariants: [],
      goals: [
        {
          id: "done",
          condition: f.var("done"),
          businessMeaning: "Done",
          evidence,
          confidence: 1,
        },
      ],
    };
    const result = await reasoner.findPlan(model, { goal: "done" });
    expect(result).toMatchObject({
      status: "found",
      plan: { length: 1, cost: 1, steps: [{ actionId: "cheap", cost: 1 }] },
      optimality: { length: "optimal", cost: "not-guaranteed" },
    });
    const uniform = await reasoner.findPlan(hand, {
      goal: "clients.created",
      context: editor,
    });
    expect(uniform).toMatchObject({ optimality: { cost: "optimal" } });
  });

  it("detects plans that do not replay", async () => {
    const plan = planOf(
      await reasoner.findPlan(hand, {
        goal: "clients.created",
        context: editor,
      }),
    );
    const broken = {
      ...plan,
      steps: plan.steps.filter((step) => step.index !== 1),
    };
    expect(evaluatePlan(hand, broken)).toEqual({
      goalReached: false,
      invalidActionCount: 3,
    });
    expect(
      evaluatePlan(hand, {
        ...plan,
        steps: [
          ...plan.steps,
          { ...(plan.steps[0] as Plan["steps"][0]), actionId: "nope" },
        ],
      }),
    ).toEqual({ goalReached: true, invalidActionCount: 1 });
  });
});
