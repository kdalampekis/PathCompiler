import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  discoverWorkflowsByReasoning,
  type ReasoningDiscoveryReport,
} from "../src/index.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo/", import.meta.url),
);
let solver: SolverProvider;
type Input = Parameters<typeof discoverWorkflowsByReasoning>;
let input: [Input[0], Input[1], Input[2], Input[3]];
let report: ReasoningDiscoveryReport;
beforeAll(async () => {
  solver = await createZ3SolverProvider();
  const project = await readSourceProject(fixture);
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  input = [capabilities.graph, capabilities.report, mined.report, solver];
  report = await discoverWorkflowsByReasoning(...input);
}, 120_000);
afterAll(async () => {
  await solver?.close();
});
const candidate = (id: string) =>
  report.candidates.find((item) => item.capabilityId === id);

describe("reasoning-assisted workflow discovery", () => {
  it("plans a candidate for every modeled capability, including untraced ones", () => {
    expect(report.strategy).toBe("reasoning");
    expect(report.candidates.map((item) => item.capabilityId)).toEqual([
      "clients.create",
      "clients.deactivate",
      "clients.edit",
      "plans.change_structure",
      "plans.create",
    ]);
    expect(report.skipped).toEqual([]);
    expect(candidate("clients.deactivate")?.workflow).toMatchObject({
      status: "candidate",
      entrypoints: [{ route: "/clients" }],
      steps: [
        { target: "clients.deactivate", action: { type: "click" } },
        { target: "client.deactivate.confirm", action: { type: "click" } },
      ],
    });
    // Navigation becomes the entrypoint, not a step.
    expect(candidate("clients.create")?.plan.actions[0]).toBe(
      "navigate.nav_clients",
    );
    for (const item of report.candidates) {
      expect(item.reviewRequired).toBe(true);
      for (const step of item.workflow.steps)
        expect(step.evidence.length).toBeGreaterThan(0);
    }
  });

  it("derives applicability from reachability per role and flag", () => {
    for (const item of report.candidates)
      expect(item.workflow.roles).toEqual(["editor"]);
    expect(candidate("plans.change_structure")?.workflow.preconditions).toEqual(
      [{ type: "feature_flag", flag: "planStructure", enabled: true }],
    );
    expect(candidate("plans.create")?.workflow.preconditions).toBeUndefined();
  });

  it("takes terminals from test assertions after the path, or says it could not", () => {
    expect(candidate("plans.create")?.workflow.terminal).toEqual({
      type: "element_text",
      target: "plans.feedback",
      text: "Plan created",
      match: "exact",
    });
    expect(candidate("clients.edit")?.workflow.terminal).toEqual({
      type: "explicit_next",
    });
    expect(
      candidate("clients.edit")?.ambiguities.map((item) => item.code),
    ).toEqual(["terminal-not-derived"]);
  });

  it("is deterministic and reports inconclusive planning as skipped, not impossible", async () => {
    expect(await discoverWorkflowsByReasoning(...input)).toEqual(report);
    const shallow = await discoverWorkflowsByReasoning(...input, {
      maxDepth: 1,
    });
    expect(shallow.candidates).toEqual([]);
    expect(shallow.skipped).toHaveLength(5);
    for (const item of shallow.skipped)
      expect(item.reason).toMatch(
        /^Planning was inconclusive \(bound-insufficient\)/,
      );
  }, 120_000);
});
