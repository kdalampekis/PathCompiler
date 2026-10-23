import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import {
  collectFormalEvidence,
  type FormalExpr,
  type FormalProductModel,
  serializeFormalModel,
} from "@pathcompiler/formal-model";
import { ProductGraph } from "@pathcompiler/graph-core";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { beforeAll, describe, expect, it } from "vitest";
import { nextDemoFormalModel } from "../../formal-model/test/next-demo-model.js";
import { buildFormalModel, type FormalAbstraction } from "../src/index.js";

let mined: ReturnType<typeof minePlaywrightTests>;
let capabilities: ReturnType<typeof discoverCapabilities>;
let result: FormalAbstraction;
let commit: string;
beforeAll(async () => {
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  capabilities = discoverCapabilities(mined.graph);
  commit = project.repository.commit ?? "unbound";
  result = buildFormalModel(
    capabilities.graph,
    capabilities.report,
    mined.report,
    {
      id: "next_demo",
    },
  );
});
function variablesIn(expr: FormalExpr): string[] {
  switch (expr.type) {
    case "bool":
      return [];
    case "var":
      return [expr.id];
    case "not":
      return variablesIn(expr.expr);
    case "and":
    case "or":
      return expr.expressions.flatMap(variablesIn);
    default:
      return [expr.left, expr.right].flatMap((term) =>
        term.type === "var" ? [term.id] : [],
      );
  }
}
const contextIn = (model: FormalProductModel, expr: FormalExpr) => {
  const context = new Set(
    model.variables
      .filter((item) => item.scope === "context")
      .map((item) => item.id),
  );
  return [...new Set(variablesIn(expr).filter((id) => context.has(id)))].sort();
};
const uncertainty = (kind: string, subject: string) =>
  result.uncertainties.find(
    (item) => item.kind === kind && item.subject === subject,
  );

const TRUE: FormalExpr = { type: "bool", value: true };
// Hand-encoded R0 action → extracted action.
const MAPPING: Record<string, string> = {
  "nav.open_clients": "navigate.nav_clients",
  "nav.open_plans": "navigate.nav_plans",
  "clients.open_create_form": "clients.create.open",
  "clients.enter_name": "clients.create.enter_name",
  "clients.enter_email": "clients.create.enter_email",
  "clients.submit_create": "clients.create.submit",
  "plans.open_structure_editor": "plans.change_structure.open",
  "plans.select_weekly": "plans.change_structure.select_weekly",
  "plans.select_simple": "plans.change_structure.select_simple",
  "plans.save_structure": "plans.change_structure.submit",
  "plans.request_simplify": "plans.change_structure.submit_for_confirmation",
  "plans.confirm_simplify": "plans.change_structure.confirm",
};

describe("formal abstraction builder", () => {
  it("extracts a valid model bound to the scanned commit", () => {
    expect(result.model.metadata).toEqual({
      repositoryCommit: commit,
      source: "extracted",
      extractorVersion: "formal-abstraction-r1",
    });
    expect(
      result.model.variables
        .filter((item) => item.scope === "context")
        .map((item) => [item.id, "values" in item ? item.values : item.type]),
    ).toEqual([
      ["plan_structure_enabled", "boolean"],
      ["role", ["editor", "unlisted"]],
    ]);
    expect(
      result.model.variables.find((item) => item.id === "current_area"),
    ).toMatchObject({ values: ["CLIENTS", "OTHER", "PLANS"] });
  });

  it("reproduces every hand-model action and goal, explaining each difference", () => {
    const hand = nextDemoFormalModel(commit);
    const extracted = new Map(
      result.model.actions.map((item) => [item.id, item]),
    );
    expect(Object.keys(MAPPING).sort()).toEqual(
      hand.actions.map((item) => item.id).sort(),
    );
    for (const action of hand.actions) {
      const match = extracted.get(MAPPING[action.id] as string);
      expect(match, action.id).toBeDefined();
      expect(match?.semanticTarget, action.id).toBe(action.semanticTarget);
      expect(match?.capabilityId, action.id).toBe(action.capabilityId);
      const handGuards = contextIn(hand, action.precondition);
      const ownGuards = contextIn(
        result.model,
        match?.precondition ?? action.precondition,
      );
      // Only server-enforced guards are extracted; UI gating of entries is reported instead.
      if (handGuards.join() !== ownGuards.join())
        expect(
          uncertainty("ui-guard-not-modeled", match?.id ?? ""),
          `${action.id}: ${handGuards} vs ${ownGuards}`,
        ).toBeDefined();
    }
    // Required fields come from a test where the form rejected an empty submit.
    expect(
      variablesIn(extracted.get("clients.create.submit")?.precondition ?? TRUE),
    ).toEqual(
      expect.arrayContaining([
        "client_form_name_entered",
        "client_form_email_entered",
      ]),
    );
    expect(
      uncertainty("required-fields-from-tests", "clients.create"),
    ).toBeDefined();
    // The weekly → simple rule and stored structure are business logic not derivable yet.
    expect(
      uncertainty(
        "outcome-condition-unknown",
        "plans.change_structure.submit_for_confirmation",
      ),
    ).toBeDefined();
    expect(
      uncertainty("value-not-persisted", "plan_structure_selector"),
    ).toBeDefined();

    const goals = new Map(
      result.model.goals.map((item) => [item.capabilityId, item]),
    );
    for (const goal of hand.goals) {
      expect(goals.get(goal.capabilityId)?.id, goal.id).toBe(goal.id);
      expect(goals.get(goal.capabilityId)?.businessMeaning).toBeTruthy();
    }
    // Structural invariants are extracted; the security invariant needs UI gating (see above).
    const invariants = result.model.invariants.map((item) => item.id);
    expect(invariants).toEqual(
      expect.arrayContaining([
        "clients.create.open_only_in_area",
        "plans.change_structure.confirmation_inside_dialog",
      ]),
    );
    // Every extra action is a cancel/back path, another navigation link, or a capability
    // the hand model leaves out.
    const mapped = new Set(Object.values(MAPPING));
    const inScope = new Set(hand.goals.map((item) => item.capabilityId));
    for (const action of result.model.actions) {
      if (mapped.has(action.id)) continue;
      expect(
        action.id === "navigate.nav_home" ||
          /\.(back|cancel)$/.test(action.id) ||
          !inScope.has(action.capabilityId),
        action.id,
      ).toBe(true);
    }
  });

  it("cites only real graph nodes at the scanned commit", () => {
    const nodes = new Map(
      capabilities.graph.toJSON().nodes.map((node) => [node.id, node]),
    );
    for (const { owner, ref } of collectFormalEvidence(result.model)) {
      const node = nodes.get(ref.id);
      expect(node, `${owner} cites missing ${ref.id}`).toBeDefined();
      expect(ref.repositoryCommit).toBe(commit);
      const locators = (
        (node?.data?.evidence ?? []) as { locator: string }[]
      ).map((item) => item.locator);
      expect(locators, `${owner} → ${ref.id}`).toContain(ref.locator);
    }
    for (const item of result.uncertainties)
      for (const id of item.nodeIds) expect(nodes.has(id), id).toBe(true);
  });

  it("reports model coverage by evidence basis", () => {
    const { coverage } = result;
    expect(coverage.actions.map((item) => item.actionId)).toEqual(
      result.model.actions.map((item) => item.id),
    );
    expect(result.model.actions).toHaveLength(25);
    expect(coverage.transitions).toEqual({
      total: result.model.actions.length,
      deterministic: 3,
      tests: result.model.actions.length - 3,
      runtime: 0,
      semanticOnly: 0,
    });
    expect(coverage.capabilities).toEqual({
      total: 5,
      modeled: [
        "clients.create",
        "clients.deactivate",
        "clients.edit",
        "plans.change_structure",
        "plans.create",
      ],
      notModeled: [],
    });
    expect(coverage.testSessions.discarded).toBe(0);
    expect(coverage.testSessions.used).toBeGreaterThan(10);
    expect(
      coverage.actions.find(
        (item) => item.actionId === "plans.change_structure.submit",
      ),
    ).toEqual({
      actionId: "plans.change_structure.submit",
      basis: "tests",
      rules: ["api-handler-guard", "test-session-commit"],
    });
  });

  it("is deterministic regardless of graph, capability and trace order", () => {
    const snapshot = capabilities.graph.toJSON();
    const graph = ProductGraph.fromJSON({
      ...snapshot,
      nodes: [...snapshot.nodes].reverse(),
      edges: [...snapshot.edges].reverse(),
    });
    const again = buildFormalModel(
      graph,
      {
        ...capabilities.report,
        capabilities: [...capabilities.report.capabilities].reverse(),
      },
      { ...mined.report, traces: [...mined.report.traces].reverse() },
      { id: "next_demo" },
    );
    expect(serializeFormalModel(again.model)).toBe(
      serializeFormalModel(result.model),
    );
    expect(again.coverage).toEqual(result.coverage);
    expect(again.uncertainties).toEqual(result.uncertainties);
  });

  it("discards sessions with unresolved steps and reports capabilities it cannot model", () => {
    const traces = {
      ...mined.report,
      traces: mined.report.traces.map((trace) => ({
        ...trace,
        actions: trace.actions.map((action) =>
          action.target?.graphNodeIds.includes("ui:plan.form.submit")
            ? {
                ...action,
                target: {
                  ...action.target,
                  resolution: "unresolved" as const,
                  graphNodeIds: [],
                },
              }
            : action,
        ),
      })),
    };
    const partial = buildFormalModel(
      capabilities.graph,
      capabilities.report,
      traces,
    );
    expect(partial.coverage.capabilities.notModeled).toEqual(["plans.create"]);
    expect(partial.coverage.testSessions.discarded).toBeGreaterThan(0);
    expect(partial.model.goals.map((item) => item.capabilityId)).not.toContain(
      "plans.create",
    );
    expect(
      partial.uncertainties.map((item) => [item.kind, item.subject]),
    ).toEqual(
      expect.arrayContaining([
        ["capability-not-modeled", "plans.create"],
        ["unresolved-test-step", "plans.create"],
      ]),
    );
  });

  it("rejects unbound or mismatched scans with actionable errors", () => {
    const unbound = {
      ...mined.report,
      repository: { ...mined.report.repository, commit: null },
    };
    expect(() =>
      buildFormalModel(capabilities.graph, capabilities.report, unbound),
    ).toThrow(/committed scan/);
    const other = {
      ...mined.report,
      repository: { ...mined.report.repository, commit: "0".repeat(40) },
    };
    expect(() =>
      buildFormalModel(capabilities.graph, capabilities.report, other),
    ).toThrow(/different commits/);
  });
});
