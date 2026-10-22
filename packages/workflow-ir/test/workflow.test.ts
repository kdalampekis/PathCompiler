import { describe, expect, it } from "vitest";
import {
  parseWorkflow,
  WorkflowConditionSchema,
  WorkflowV1Schema,
} from "../src/index.js";

const evidence = {
  id: "test:clients.create",
  type: "test",
  locator: "tests/clients.spec.ts",
  repositoryCommit: "a".repeat(40),
  confidence: 0.95,
};

function workflow() {
  return {
    schemaVersion: 1,
    id: "clients.create",
    title: "Create Client",
    domain: "clients",
    intent: { action: "create", entity: "client" },
    entrypoints: [{ route: "/clients" }],
    steps: [
      {
        id: "open",
        target: "clients.create",
        action: { type: "click" },
        next: "save",
        evidence: [evidence],
      },
      {
        id: "save",
        target: "client.form.submit",
        action: { type: "click" },
        evidence: [evidence],
      },
    ],
    terminal: { any: [{ type: "event_emitted", event: "client.created" }] },
    provenance: { evidence: [evidence] },
    repository: { commit: "a".repeat(40) },
    confidence: { overall: 0.95, dimensions: { tests: 1 } },
    status: "candidate",
  };
}

describe("Workflow IR v1", () => {
  it("parses a versioned workflow with evidence", () => {
    expect(parseWorkflow(workflow())).toEqual(workflow());
  });

  it.each([
    ["invalid version", { schemaVersion: 2 }],
    ["missing terminal", { terminal: undefined }],
    ["empty terminal", { terminal: { any: [] } }],
    ["ambiguous terminal", { terminal: { any: [], all: [] } }],
    ["empty steps", { steps: [] }],
    ["empty entrypoints", { entrypoints: [{}] }],
    ["missing provenance", { provenance: { evidence: [] } }],
    ["missing commit", { repository: { commit: " " } }],
    ["unknown field", { approval: true }],
  ])("rejects %s", (_label, overrides) => {
    expect(
      WorkflowV1Schema.safeParse({ ...workflow(), ...overrides }).success,
    ).toBe(false);
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects confidence %s",
    (value) => {
      for (const confidence of [
        { overall: value },
        { overall: 0.8, dimensions: { tests: value } },
      ]) {
        expect(
          WorkflowV1Schema.safeParse({ ...workflow(), confidence }).success,
        ).toBe(false);
      }
    },
  );

  it("rejects duplicate step IDs and reports the offending path", () => {
    const input = workflow();
    const first = input.steps[0];
    expect(first).toBeDefined();
    const result = WorkflowV1Schema.safeParse({
      ...input,
      steps: [first, first],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["steps", 1, "id"],
          message: "Duplicate step ID: open",
        }),
      );
  });

  it("validates both ordinary and branching next references", () => {
    const input = workflow();
    const [open, save] = input.steps;
    expect(
      WorkflowV1Schema.safeParse({
        ...input,
        steps: [{ ...open, next: "missing" }, save],
      }).success,
    ).toBe(false);
    const branches = [{ when: { type: "explicit_next" }, next: "save" }];
    expect(
      WorkflowV1Schema.safeParse({
        ...input,
        steps: [{ ...open, branches }, save],
      }).success,
    ).toBe(true);
    expect(
      WorkflowV1Schema.safeParse({
        ...input,
        steps: [
          { ...open, branches: [{ ...branches[0], next: "missing" }] },
          save,
        ],
      }).success,
    ).toBe(false);
  });

  it("requires evidence on every step", () => {
    const input = workflow();
    expect(
      WorkflowV1Schema.safeParse({
        ...input,
        steps: input.steps.map((step) => ({ ...step, evidence: [] })),
      }).success,
    ).toBe(false);
  });

  it.each([
    { type: "route_matches", pattern: "^/clients/[^/]+$" },
    { type: "target_appears", target: "client.form" },
    {
      type: "element_text",
      target: "clients.feedback",
      text: "Client created",
      match: "exact",
    },
    { type: "element_count", target: "dialog.container", count: 0 },
    { type: "event_emitted", event: "client.created" },
    { type: "url_changed" },
    { type: "element_state", target: "client.form.submit", state: "enabled" },
    { type: "explicit_next" },
    { type: "permission", permission: "clients.write" },
    { type: "feature_flag", flag: "planStructure", enabled: true },
  ])("supports condition $type", (condition) => {
    expect(WorkflowConditionSchema.safeParse(condition).success).toBe(true);
  });

  it("rejects invalid patterns and empty instructions", () => {
    expect(
      WorkflowConditionSchema.safeParse({ type: "route_matches", pattern: "[" })
        .success,
    ).toBe(false);
    const input = workflow();
    expect(
      WorkflowV1Schema.safeParse({
        ...input,
        steps: input.steps.map((step) => ({ ...step, instruction: {} })),
      }).success,
    ).toBe(false);
  });
});
