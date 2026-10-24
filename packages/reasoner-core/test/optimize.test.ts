import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import {
  actionCategories,
  buildFormalModel,
  type FormalAbstraction,
} from "@pathcompiler/formal-abstraction";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  costsFromCategories,
  createProductReasoner,
  findCheapestPlan,
  type ProductReasoner,
  uxMetrics,
} from "../src/index.js";

let solver: SolverProvider;
let reasoner: ProductReasoner;
let abstraction: FormalAbstraction;
beforeAll(async () => {
  solver = await createZ3SolverProvider();
  reasoner = createProductReasoner(solver);
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  abstraction = buildFormalModel(
    capabilities.graph,
    capabilities.report,
    mined.report,
  );
}, 60_000);
afterAll(async () => {
  await solver?.close();
});
const ids = (plan: { steps: { actionId: string }[] }) =>
  plan.steps.map((step) => step.actionId);

describe("cost-optimal plans and UX metrics", () => {
  it("categorizes extracted actions from their coverage rules", () => {
    const categories = actionCategories(abstraction);
    expect(categories).toMatchObject({
      "navigate.nav_clients": "navigation",
      "clients.create.open": "entry",
      "clients.create.enter_name": "field",
      "clients.create.submit": "submit",
      "plans.archive.archive": "submit",
      "plans.change_structure.confirm": "submit",
      "plans.change_structure.submit_for_confirmation": "confirmation",
      "clients.deactivate.cancel": "cancel",
    });
    expect(() =>
      costsFromCategories(abstraction.model, categories, { navigation: 0 }),
    ).toThrow(/navigation must be a positive number/);
  });

  it("with unit costs, the cheapest plan is the shortest and provably optimal", async () => {
    const result = await findCheapestPlan(reasoner, abstraction.model, {
      goal: "clients.deactivated",
      context: { role: "editor" },
    });
    if (result.status !== "found") throw new Error(result.status);
    expect(ids(result.plan)).toEqual([
      "navigate.nav_clients",
      "clients.deactivate.open_clients_deactivate",
      "clients.deactivate.confirm",
    ]);
    expect(result).toMatchObject({ costOptimality: "optimal", lengthBound: 3 });
    expect(result.plan.cost).toBe(3);
  }, 120_000);

  it("finds a longer plan when it is cheaper, and proves it", async () => {
    // Make the row button expensive: the Edit Client path (4 steps) wins.
    const costs = {
      ...costsFromCategories(abstraction.model, actionCategories(abstraction)),
      "clients.deactivate.open_clients_deactivate": 10,
    };
    const result = await findCheapestPlan(reasoner, abstraction.model, {
      goal: "clients.deactivated",
      context: { role: "editor" },
      costs,
    });
    if (result.status !== "found") throw new Error(result.status);
    expect(ids(result.plan)).toEqual([
      "navigate.nav_clients",
      "clients.edit.open",
      "clients.deactivate.open_client_form_deactivate",
      "clients.deactivate.confirm",
    ]);
    expect(result.plan.cost).toBe(4);
    expect(result.costOptimality).toBe("optimal");
    expect(result.ranked.map((item) => item.cost)).toEqual(
      [...result.ranked.map((item) => item.cost)].sort((a, b) => a - b),
    );
    expect(result.ranked.at(-1)?.cost).toBeGreaterThanOrEqual(12);
  }, 300_000);

  it("reports UX metrics as hypotheses", async () => {
    const categories = actionCategories(abstraction);
    const create = await findCheapestPlan(reasoner, abstraction.model, {
      goal: "plans.created",
      context: { role: "editor" },
    });
    if (create.status !== "found") throw new Error(create.status);
    const metrics = uxMetrics(create.plan, categories, { variants: 1 });
    expect(metrics).toMatchObject({
      actions: 5,
      pageTransitions: 1,
      formFields: 2,
      dialogInteractions: 1,
      confirmations: 0,
      estimatedEffort: 5,
      meaning: "hypothesis",
      hypotheses: [],
    });
    const deactivate = await findCheapestPlan(reasoner, abstraction.model, {
      goal: "clients.deactivated",
      context: { role: "editor" },
    });
    if (deactivate.status !== "found") throw new Error(deactivate.status);
    expect(
      uxMetrics(deactivate.plan, categories, { variants: 2 }).hypotheses,
    ).toEqual([
      "2 distinct ways reach clients.deactivated; help and tests should cover each.",
    ]);
  }, 300_000);
});
