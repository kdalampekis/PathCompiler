import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { ProductGraph } from "@pathcompiler/graph-core";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import type { WorkflowV1 } from "@pathcompiler/workflow-ir";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type ValidationContext,
  ValidationReportSchema,
  validateWorkflow,
} from "../src/index.js";

let context: ValidationContext;
let workflows: WorkflowV1[];
function client() {
  const value = workflows.find((workflow) => workflow.id === "clients.create");
  if (!value) throw new Error("Missing fixture workflow");
  return structuredClone(value);
}
function changedGraph(
  change: (snapshot: ReturnType<ProductGraph["toJSON"]>) => void,
) {
  const snapshot = context.graph.toJSON();
  change(snapshot);
  return { ...context, graph: ProductGraph.fromJSON(snapshot) };
}
beforeAll(async () => {
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  workflows = discoverWorkflows(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).report.candidates.map((candidate) => candidate.workflow);
  context = { graph: mined.graph, traces: mined.report };
});

describe("workflow validation", () => {
  it("validates all fixture candidates with explicit static checks and no browser claim", () => {
    const before = context.graph.serialize();
    for (const workflow of workflows) {
      const report = validateWorkflow(workflow, context);
      expect(report.errors).toEqual([]);
      expect(report.valid).toBe(true);
      expect(report.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "testComparison", status: "passed" }),
          expect.objectContaining({ name: "browser", status: "not-run" }),
        ]),
      );
      expect(ValidationReportSchema.parse(report)).toEqual(report);
      expect(validateWorkflow(workflow, context)).toEqual(report);
    }
    const weak = workflows.find(
      (workflow) => workflow.id === "plans.change_structure",
    );
    expect(
      validateWorkflow(weak, context).warnings.map((issue) => issue.code),
    ).toContain("weak-terminal-evidence");
    expect(context.graph.serialize()).toBe(before);
  });

  it("reports schema failures without pretending later checks ran", () => {
    const workflow = client();
    const step = workflow.steps[0];
    if (!step) throw new Error("Missing step");
    step.next = "missing";
    const report = validateWorkflow(workflow, context);
    expect(report.valid).toBe(false);
    expect(report.errors[0]?.code).toBe("invalid-schema");
    expect(
      report.checks
        .filter((check) => check.name !== "schema")
        .every((check) => check.status === "not-run"),
    ).toBe(true);
    expect(validateWorkflow(null, context).valid).toBe(false);
    step.next = workflow.steps[1]?.id;
    step.evidence = [];
    expect(
      validateWorkflow(workflow, context).errors.some(
        (issue) => issue.code === "invalid-schema",
      ),
    ).toBe(true);
  });

  it("rejects unreachable steps, missing interactive targets and unbounded cycles", () => {
    const workflow = client();
    const first = workflow.steps[0];
    const last = workflow.steps.at(-1);
    if (!first || !last) throw new Error("Missing step");
    delete first.next;
    delete first.target;
    expect(
      validateWorkflow(workflow, context).errors.map((issue) => issue.code),
    ).toEqual(
      expect.arrayContaining(["unreachable-step", "missing-action-target"]),
    );
    const cyclic = client();
    const end = cyclic.steps.at(-1);
    if (!end) throw new Error("Missing step");
    end.next = cyclic.steps[0]?.id;
    expect(
      validateWorkflow(cyclic, context).errors.map((issue) => issue.code),
    ).toEqual(
      expect.arrayContaining(["unbounded-cycle", "terminal-unreachable"]),
    );
  });

  it("checks branch references and reports incomplete branch test coverage", () => {
    const workflow = client();
    const first = workflow.steps[0];
    const last = workflow.steps.at(-1);
    if (!first || !last) throw new Error("Missing step");
    first.branches = [
      {
        when: { type: "permission", permission: "clients.write" },
        next: last.id,
      },
    ];
    const report = validateWorkflow(workflow, context);
    expect(report.errors).toEqual([]);
    expect(
      report.checks.find((check) => check.name === "testComparison")?.status,
    ).toBe("not-run");
    first.branches.push(
      structuredClone(
        first.branches[0] ?? { when: { type: "explicit_next" }, next: last.id },
      ),
    );
    expect(
      validateWorkflow(workflow, context).errors.map((issue) => issue.code),
    ).toContain("shadowed-branch");
  });

  it("rejects stale commits, missing routes and missing condition targets", () => {
    const workflow = client();
    workflow.repository.commit = "b".repeat(40);
    workflow.entrypoints = [{ route: "/gone" }];
    workflow.terminal = { type: "target_appears", target: "gone.feedback" };
    expect(
      validateWorkflow(workflow, context).errors.map((issue) => issue.code),
    ).toEqual(
      expect.arrayContaining([
        "stale-workflow",
        "missing-route",
        "missing-target",
      ]),
    );
    const changed = changedGraph((snapshot) => {
      const node = snapshot.nodes.find(
        (node) => node.id === "ui:clients.create",
      );
      if (!node?.data) throw new Error("Missing node");
      node.data.evidence = [
        {
          file: "app/clients/page.tsx",
          locator: "stale",
          repositoryCommit: "b".repeat(40),
        },
      ];
    });
    expect(
      validateWorkflow(client(), changed).errors.map((issue) => issue.code),
    ).toContain("stale-target-evidence");
  });

  it("detects ambiguous source targets instead of choosing one", () => {
    const changed = changedGraph((snapshot) => {
      const node = snapshot.nodes.find(
        (node) => node.id === "ui:clients.create",
      );
      if (!node) throw new Error("Missing node");
      snapshot.nodes.push({ ...structuredClone(node), id: "ui:duplicate" });
    });
    expect(
      validateWorkflow(client(), changed).errors.map((issue) => issue.code),
    ).toContain("ambiguous-target");
  });

  it("checks evidence location/type/snapshot rather than accepting a nonempty array", () => {
    const workflow = client();
    const step = workflow.steps[0];
    if (!step) throw new Error("Missing step");
    step.evidence = [
      {
        id: "made-up",
        type: "symbol",
        locator: "file",
        repositoryCommit: workflow.repository.commit,
      },
    ];
    const report = validateWorkflow(workflow, context);
    expect(report.errors.map((issue) => issue.code)).toContain(
      "missing-evidence",
    );
    expect(report.warnings.map((issue) => issue.code)).toContain(
      "weak-step-evidence",
    );
    const original = client();
    const ref = original.provenance.evidence.find(
      (ref) => ref.type === "symbol",
    );
    if (!ref) throw new Error("Missing reference");
    ref.locator = "incorrect";
    expect(
      validateWorkflow(original, context).errors.map((issue) => issue.code),
    ).toContain("mismatched-evidence");
    const broken = client();
    const event = broken.provenance.evidence.find((ref) =>
      ref.id.includes("#event:"),
    );
    if (!event) throw new Error("Missing event");
    event.locator = "wrong:1:1";
    expect(
      validateWorkflow(broken, context).errors.map((issue) => issue.code),
    ).toContain("invalid-test-evidence");
  });

  it("reports weak/external evidence and absent test comparison explicitly", () => {
    const workflow = client();
    const step = workflow.steps[0];
    if (!step) throw new Error("Missing step");
    step.evidence = [
      {
        id: "manual-note",
        type: "documentation",
        locator: "docs/flow.md",
        repositoryCommit: workflow.repository.commit,
        confidence: 0.2,
      },
    ];
    const report = validateWorkflow(workflow, { graph: context.graph });
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "weak-step-evidence",
        "external-evidence-unverified",
        "low-confidence-evidence",
        "test-comparison-not-run",
      ]),
    );
    expect(
      report.checks.find((check) => check.name === "testComparison")?.status,
    ).toBe("not-run");
  });

  it("detects action, path order and completion disagreements with cited tests", () => {
    const action = client();
    const first = action.steps[0];
    if (!first) throw new Error("Missing step");
    first.action = { type: "input" };
    expect(
      validateWorkflow(action, context).errors.map((issue) => issue.code),
    ).toContain("test-step-mismatch");
    const order = client();
    const [a, b, c, d] = order.steps;
    if (!a || !b || !c || !d) throw new Error("Missing steps");
    a.next = c.id;
    c.next = b.id;
    b.next = d.id;
    expect(
      validateWorkflow(order, context).errors.map((issue) => issue.code),
    ).toContain("test-path-mismatch");
    const terminal = client();
    terminal.terminal = {
      type: "element_text",
      target: "clients.feedback",
      match: "exact",
      text: "Something else",
    };
    expect(
      validateWorkflow(terminal, context).errors.map((issue) => issue.code),
    ).toContain("test-path-mismatch");
  });

  it("rejects stale reports and does not count skipped or soft assertions as success", () => {
    const traces = structuredClone(context.traces);
    if (!traces) throw new Error("Missing traces");
    traces.repository.commit = "b".repeat(40);
    expect(
      validateWorkflow(client(), { ...context, traces }).errors.map(
        (issue) => issue.code,
      ),
    ).toContain("stale-test-report");
    const soft = structuredClone(context.traces);
    if (!soft) throw new Error("Missing traces");
    for (const trace of soft.traces)
      for (const assertion of trace.assertions) assertion.soft = true;
    expect(
      validateWorkflow(client(), { ...context, traces: soft }).errors.map(
        (issue) => issue.code,
      ),
    ).toContain("test-path-mismatch");
    const skipped = structuredClone(context.traces);
    if (!skipped) throw new Error("Missing traces");
    for (const trace of skipped.traces) trace.mode = "skip";
    expect(
      validateWorkflow(client(), { ...context, traces: skipped }).checks.find(
        (check) => check.name === "testComparison",
      )?.status,
    ).toBe("not-run");
  });
});
