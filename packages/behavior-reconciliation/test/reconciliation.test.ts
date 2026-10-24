import {
  createEventFactory,
  type ProductRuntimeEvent,
} from "@pathcompiler/observability-core";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nextDemoFormalModel } from "../../formal-model/test/next-demo-model.js";
import { type ReconciliationReport, reconcileBehavior } from "../src/index.js";

let solver: SolverProvider;
let report: ReconciliationReport;
function session(
  id: string,
  role: string,
  steps: ("open" | "created")[],
): ProductRuntimeEvent[] {
  let counter = 0;
  const create = createEventFactory({
    projectId: "demo",
    sessionId: id,
    now: () => new Date("2026-10-23T10:00:00.000Z"),
    nextId: () => `${id}-${++counter}`,
  });
  return [
    create("route.changed", { route: "/clients", role }),
    ...steps.map((step) =>
      step === "open"
        ? create("semantic_target.activated", {
            semanticTarget: "clients.create",
            interaction: "click",
            role,
          })
        : create("goal.reached", { goalId: "clients.created", role }),
    ),
  ];
}
const item = (kind: string, id: string, role: string) =>
  report.items.find(
    (entry) => entry.kind === kind && entry.id === id && entry.role === role,
  );

beforeAll(async () => {
  solver = await createZ3SolverProvider();
  const events = [
    ...Array.from({ length: 31 }, (_, index) =>
      session(`editor-${index}`, "editor", ["open", "created"]),
    ).flat(),
    ...session("viewer-1", "viewer", ["open", "created"]),
    ...session("admin-1", "admin", []),
  ];
  report = await reconcileBehavior(nextDemoFormalModel("abc"), events, solver);
}, 120_000);
afterAll(async () => {
  await solver?.close();
});

describe("possible-vs-observed reconciliation", () => {
  it("classifies goals and targets per observed role", () => {
    expect(report.roles).toEqual([
      { role: "admin", sessions: 1 },
      { role: "editor", sessions: 31 },
      { role: "viewer", sessions: 1 },
    ]);
    expect(item("goal", "clients.created", "editor")).toMatchObject({
      formal: "possible",
      observed: { count: 31, sessions: 31 },
      class: "possible-observed",
    });
    expect(item("goal", "plans.structure_changed", "editor")).toMatchObject({
      formal: "possible",
      class: "possible-unobserved",
    });
    // One viewer session is too few to call anything unobserved.
    expect(item("goal", "plans.structure_changed", "viewer")?.class).toBe(
      "impossible-unobserved",
    );
    expect(item("target", "plans.change_structure", "viewer")).toMatchObject({
      formal: "impossible",
      class: "impossible-unobserved",
    });
    // "admin" is not a model role and the hand model has no catch-all value,
    // so the role stays free: anything some role can do is possible.
    expect(item("goal", "clients.created", "admin")).toMatchObject({
      formal: "possible",
      class: "insufficient-data",
    });
  });

  it("reports observed-but-impossible behavior as a high-priority discrepancy, not a bug", () => {
    const unexpected = report.discrepancies.filter(
      (entry) => entry.type === "unexpected_observed",
    );
    expect(
      unexpected.map((entry) => `${entry.kind}:${entry.id}:${entry.role}`),
    ).toEqual(["goal:clients.created:viewer", "target:clients.create:viewer"]);
    const goal = unexpected[0];
    expect(goal).toMatchObject({
      priority: "high",
      observed: { count: 1, sessions: 1 },
      formalReason: expect.arrayContaining([
        "Context fixes role = viewer.",
        "clients.submit_create requires role = editor.",
      ]),
      possibleCauses: expect.arrayContaining([
        "authorization or business-rule bug",
        "formal-model extraction error (a missing transition)",
      ]),
    });
    expect(JSON.stringify(report.discrepancies)).not.toMatch(
      /"(bug|vulnerability)"/,
    );
  });

  it("lists reachable but unobserved behavior with a witness when the sample is large enough", () => {
    const unobserved = report.discrepancies.find(
      (entry) =>
        entry.type === "unobserved_reachable" &&
        entry.id === "plans.structure_changed" &&
        entry.role === "editor",
    );
    expect(unobserved).toMatchObject({
      priority: "low",
      roleSessions: 31,
      possibleExplanations: expect.arrayContaining(["instrumentation gap"]),
    });
    if (unobserved?.type === "unobserved_reachable")
      expect(unobserved.witness.at(-1)).toBe("plans.save_structure");
    expect(
      report.discrepancies.some(
        (entry) =>
          entry.type === "unobserved_reachable" && entry.role !== "editor",
      ),
    ).toBe(false);
  });
});
