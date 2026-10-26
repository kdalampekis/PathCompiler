import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { ProductGraph } from "@pathcompiler/graph-core";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { parseWorkflow } from "@pathcompiler/workflow-ir";
import { describe, expect, it } from "vitest";
import {
  discoverWorkflows,
  parseCandidateYaml,
  serializeCandidateYaml,
} from "../src/index.js";

const app = `export default function Page() { return <><button data-pathcompiler="clients.create">Create Client</button><input data-pathcompiler="client.form.name" /><button data-pathcompiler="client.form.submit">Save</button><p role="status" data-pathcompiler="clients.feedback" /></>; }`;
const body = `await page.goto('/clients');
await page.locator('[data-pathcompiler="clients.create"]').click();
await page.locator('[data-pathcompiler="client.form.name"]').fill('Private fixture value');
await page.locator('[data-pathcompiler="client.form.submit"]').click();
await expect(page.locator('[data-pathcompiler="clients.feedback"]')).toHaveText('Client created');`;
function input(test = `test('create', async ({page}) => {${body}});`) {
  const project = {
    repository: { commit: "a".repeat(40), dirty: false },
    files: [
      { path: "app/clients/page.tsx", content: app },
      {
        path: "tests/clients.spec.ts",
        content: `import { test, expect } from '@playwright/test'; ${test}`,
      },
    ],
  };
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  return {
    graph: capabilities.graph,
    capabilities: capabilities.report,
    traces: mined.report,
  };
}
function discover(value = input()) {
  return discoverWorkflows(value.graph, value.capabilities, value.traces);
}

describe("workflow candidate discovery", () => {
  it("compiles five fixture workflows with supported major steps and explicit limits", async () => {
    const project = await readSourceProject(
      fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
    );
    const mined = minePlaywrightTests(
      project,
      analyzeNextProject(project).graph,
    );
    const capabilities = discoverCapabilities(mined.graph);
    const before = capabilities.graph.serialize();
    const { graph, report } = discoverWorkflows(
      capabilities.graph,
      capabilities.report,
      mined.report,
    );
    expect(report.candidates.map((candidate) => candidate.workflow.id)).toEqual(
      [
        "clients.create",
        "clients.deactivate",
        "plans.archive",
        "plans.change_structure",
        "plans.create",
      ],
    );
    const workflows = Object.fromEntries(
      report.candidates.map((candidate) => [
        candidate.workflow.id,
        candidate.workflow,
      ]),
    );
    expect(
      workflows["clients.create"]?.steps.map((step) => step.target),
    ).toEqual([
      "clients.create",
      "client.form.name",
      "client.form.email",
      "client.form.submit",
    ]);
    expect(workflows["plans.create"]?.steps.map((step) => step.target)).toEqual(
      [
        "plans.create",
        "plan.form.title",
        "plan.form.client",
        "plan.form.submit",
      ],
    );
    expect(
      workflows["plans.change_structure"]?.steps.map((step) => step.target),
    ).toEqual([
      "plans.change_structure",
      "plan.structure.selector",
      "plan.structure.submit",
    ]);
    expect(workflows["clients.create"]?.terminal).toEqual({
      type: "element_text",
      target: "clients.feedback",
      text: "Client created",
      match: "exact",
    });
    // Deactivate Client is found through its alternative-path test; the
    // in-dialog button needs Edit Client's dialog, opened first.
    expect(
      workflows["clients.deactivate"]?.steps.map((step) => step.target),
    ).toEqual([
      "clients.edit",
      "client.form.deactivate",
      "client.deactivate.confirm",
    ]);
    expect(report.skipped.map((item) => item.capabilityId)).toEqual([
      "clients.edit",
    ]);
    for (const candidate of report.candidates) {
      expect(parseWorkflow(candidate.workflow)).toEqual(candidate.workflow);
      expect(candidate.validation).toEqual({
        schema: "passed",
        repository: "not-run",
        evidence: "not-run",
        testComparison: "not-run",
        browser: "not-run",
      });
      // Applicability (#21): roles from the endpoint's server guard, and the
      // feature flags the handler checks.
      expect(candidate.workflow.roles).toEqual(
        candidate.workflow.id === "plans.archive"
          ? ["admin"]
          : ["admin", "editor"],
      );
      expect(candidate.workflow.preconditions ?? []).toEqual(
        candidate.workflow.id === "plans.archive"
          ? [{ type: "feature_flag", flag: "planArchive", enabled: true }]
          : candidate.workflow.id === "plans.change_structure"
            ? [{ type: "feature_flag", flag: "planStructure", enabled: true }]
            : [],
      );
      expect(candidate.workflow.repository.commit).toBe(
        project.repository.commit,
      );
      expect(
        candidate.workflow.steps.every(
          (step) =>
            step.evidence.some((ref) => ref.type === "test") &&
            step.evidence.some((ref) => ref.type === "symbol"),
        ),
      ).toBe(true);
      // Only workflows that enter data need input bindings.
      expect(
        candidate.ambiguities.some(
          (issue) => issue.code === "input-binding-required",
        ),
      ).toBe(
        candidate.workflow.steps.some((step) =>
          ["input", "select"].includes(step.action.type),
        ),
      );
      expect(parseCandidateYaml(serializeCandidateYaml(candidate))).toEqual(
        candidate,
      );
    }
    expect(
      report.candidates
        .find((candidate) => candidate.workflow.id === "clients.create")
        ?.ambiguities.map((issue) => issue.code),
    ).toContain("validation-probe-excluded");
    expect(
      report.candidates
        .find((candidate) => candidate.workflow.id === "plans.change_structure")
        ?.ambiguities.map((issue) => issue.code),
    ).toContain("weak-terminal-signal");
    expect(graph.nodesByType("WorkflowCandidate")).toHaveLength(5);
    expect(capabilities.graph.serialize()).toBe(before);
    const reversed = capabilities.graph.toJSON();
    reversed.nodes.reverse();
    reversed.edges.reverse();
    expect(
      discoverWorkflows(ProductGraph.fromJSON(reversed), capabilities.report, {
        ...mined.report,
        traces: [...mined.report.traces].reverse(),
      }).report,
    ).toEqual(report);
  });

  it("merges identical observations without copying test input values or mutating evidence", () => {
    const value = input(
      `test('create', async ({page}) => {${body}}); test('repeat', async ({page}) => {${body}});`,
    );
    const before = JSON.stringify(value.traces);
    const report = discover(value).report;
    expect(report.candidates).toHaveLength(1);
    const candidate = report.candidates[0];
    expect(candidate?.observations).toHaveLength(2);
    expect(JSON.stringify(candidate)).not.toContain("Private fixture value");
    expect(JSON.stringify(value.traces)).toBe(before);
    expect(discover(value).report).toEqual(report);
  });

  it.each([
    body.replace("toHaveText", "not.toHaveText"),
    body.replace("expect(", "expect.soft("),
    body.replace("await expect", "if (unknown) await expect"),
    body.replace(".fill('Private fixture value')", ".press('Escape')"),
    body.replace(".click();", ".first().click();"),
  ])(
    "does not invent a path through unsupported or nonpositive evidence %#",
    (testBody) => {
      expect(
        discover(input(`test('create', async ({page}) => {${testBody}});`))
          .report.candidates,
      ).toEqual([]);
    },
  );

  it("ignores skipped tests and records distinct paths separately", () => {
    expect(
      discover(input(`test.skip('create', async ({page}) => {${body}});`))
        .report.candidates,
    ).toEqual([]);
    const report = discover(
      input(
        `test('first', async ({page}) => {${body}}); test('second', async ({page}) => {${body.replace("Client created", "Client saved")}});`,
      ),
    ).report;
    expect(report.candidates).toHaveLength(2);
    expect(
      new Set(report.candidates.map((candidate) => candidate.workflow.id)).size,
    ).toBe(2);
    expect(
      report.candidates.every((candidate) =>
        candidate.ambiguities.some(
          (issue) => issue.code === "alternative-test-path",
        ),
      ),
    ).toBe(true);
  });

  it("rejects stale or incomplete evidence snapshots and previously compiled graphs", () => {
    const value = input();
    const stale = structuredClone(value.traces);
    stale.repository.commit = "b".repeat(40);
    expect(() =>
      discoverWorkflows(value.graph, value.capabilities, stale),
    ).toThrow("snapshots differ");
    const event = value.traces.traces[0]?.actions[0];
    if (!event) throw new Error("Missing trace");
    event.evidence.repositoryCommit = "b".repeat(40);
    expect(() => discover(value)).toThrow();
    const fresh = input();
    expect(() =>
      discoverWorkflows(
        discover(fresh).graph,
        fresh.capabilities,
        fresh.traces,
      ),
    ).toThrow("already exist");
    const changed = fresh.graph.toJSON();
    const target = changed.nodes.find(
      (node) => node.id === "ui:clients.create",
    );
    if (!target?.data) throw new Error("Missing target");
    target.data.label = "Changed";
    expect(() =>
      discoverWorkflows(
        ProductGraph.fromJSON(changed),
        fresh.capabilities,
        fresh.traces,
      ),
    ).toThrow("does not match");
  });

  it("rejects ambiguous YAML, oversized files and approved artifacts", () => {
    const candidate = discover().report.candidates[0];
    if (!candidate) throw new Error("Missing candidate");
    const yaml = serializeCandidateYaml(candidate);
    expect(() => parseCandidateYaml(`${yaml}\nschemaVersion: 1`)).toThrow();
    expect(() => parseCandidateYaml(`${yaml}\n---\nfoo: bar`)).toThrow();
    expect(() =>
      parseCandidateYaml(yaml.replace("status: candidate", "status: approved")),
    ).toThrow("must remain candidates");
    expect(() => parseCandidateYaml("a: &a [x]\nb: *a")).toThrow();
    expect(() => parseCandidateYaml(" ".repeat(2 * 1024 * 1024 + 1))).toThrow(
      "2 MiB",
    );
  });
});
