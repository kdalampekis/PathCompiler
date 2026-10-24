import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import { type FormalProductModel, f } from "@pathcompiler/formal-model";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type CapabilityEvidence,
  createProductReasoner,
  detectDeadFeatures,
  type ProductReasoner,
} from "../src/index.js";

let solver: SolverProvider;
let reasoner: ProductReasoner;
let model: FormalProductModel;
let capabilities: CapabilityEvidence[];
beforeAll(async () => {
  solver = await createZ3SolverProvider();
  reasoner = createProductReasoner(solver);
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const discovered = discoverCapabilities(mined.graph);
  model = buildFormalModel(
    discovered.graph,
    discovered.report,
    mined.report,
  ).model;
  capabilities = discovered.report.capabilities.map((item) => ({
    id: item.id,
    uiEvidence: item.inferences.map((entry) => entry.nodeId),
    apiEvidence: item.apiEvidence.map((entry) => entry.nodeId),
  }));
}, 60_000);
afterAll(async () => {
  await solver?.close();
});

describe("dead features and missing transitions", () => {
  it("finds nothing on the fixture", async () => {
    const report = await detectDeadFeatures(reasoner, model, { capabilities });
    expect(report).toMatchObject({
      meaning: "candidate",
      checked: { goals: 6, capabilities: 6 },
      findings: [],
    });
    expect(report.checked.actions).toBeGreaterThan(20);
  }, 300_000);

  it("flags a capability whose guard no role can satisfy, and its dead action", async () => {
    const contradictory: FormalProductModel = {
      ...model,
      actions: model.actions.map((action) =>
        action.id === "plans.archive.archive"
          ? {
              ...action,
              precondition: f.and(action.precondition, f.is("role", "editor")),
            }
          : action,
      ),
    };
    const report = await detectDeadFeatures(reasoner, contradictory);
    expect(report.findings.map((item) => item.kind)).toEqual([
      "unreachable-capability",
      "dead-action",
    ]);
    const [goal, action] = report.findings;
    expect(goal).toMatchObject({
      capabilityId: "plans.archive",
      goal: "plans.archived",
      possibleCauses: expect.arrayContaining([
        "impossible permission combination",
        "incomplete model extraction",
      ]),
    });
    expect(action).toMatchObject({
      actionId: "plans.archive.archive",
      semanticTarget: "plans.archive",
    });
  }, 300_000);

  it("reports a capability with UI and API evidence but no transitions", async () => {
    const report = await detectDeadFeatures(
      reasoner,
      {
        ...model,
        goals: model.goals.filter(
          (goal) => goal.capabilityId !== "plans.archive",
        ),
      },
      { capabilities },
    );
    expect(report.findings).toEqual([
      {
        kind: "missing-transition",
        capabilityId: "plans.archive",
        uiEvidence: ["ui:plans.archive"],
        apiEvidence: ["api:POST:/api/plans/:id/archive"],
        possibleCauses: [
          "analysis missing an edge (a test or handler the extraction did not connect)",
          "product wiring bug (the control does not reach its handler)",
        ],
      },
    ]);
  }, 300_000);
});
