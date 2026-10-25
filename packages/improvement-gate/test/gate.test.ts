import type { ReconciliationReport } from "@pathcompiler/behavior-reconciliation";
import { parseConfig } from "@pathcompiler/config";
import { deriveFindings } from "@pathcompiler/findings";
import type { ReleaseBehaviorDiff } from "@pathcompiler/observed-graph";
import type { SemanticChangeReport } from "@pathcompiler/semantic-change";
import { describe, expect, it } from "vitest";
import { gateFindings } from "../src/index.js";

const policy = parseConfig("version: 1\n").improvement_policy;
const detectedAt = "2026-10-24T12:00:00.000Z";
const goalCapabilities = {
  "clients.created": "clients.create",
  "plans.archived": "plans.archive",
  "plans.created": "plans.create",
};
// A regression seen both formally (R11) and in observed sessions (O12): high confidence.
const semantic = {
  type: "semantic_change_report",
  commitRange: { base: "a".repeat(40), head: "b".repeat(40) },
  removedReachability: [
    {
      goal: "clients.created",
      context: {},
      before: "reachable",
      after: "unreachable",
      changedAt: [],
    },
  ],
  newReachability: [],
  affectedWorkflows: [],
} as unknown as SemanticChangeReport;
const releaseDiff = {
  baseRelease: "r1",
  headRelease: "r2",
  goals: [
    {
      goal: "clients.created",
      base: {
        sessions: 400,
        reaching: 360,
        share: 0.9,
        interval: [0.87, 0.92],
      },
      head: { sessions: 400, reaching: 80, share: 0.2, interval: [0.16, 0.24] },
      observed: "down",
      formal: "removed",
      class: "expected-change",
    },
  ],
} as unknown as ReleaseBehaviorDiff;
// Low adoption (observed + formal: high confidence) and a discrepancy.
const reconciliation = {
  items: [
    {
      kind: "goal",
      id: "plans.archived",
      role: "admin",
      formal: "possible",
      observed: { count: 0, sessions: 0 },
      roleSessions: 300,
      class: "possible-unobserved",
    },
  ],
  discrepancies: [
    {
      type: "unexpected_observed",
      priority: "high",
      kind: "goal",
      id: "plans.created",
      role: "editor",
      observed: { count: 3, sessions: 3 },
      formalReason: [],
      possibleCauses: [],
    },
  ],
} as unknown as ReconciliationReport;
const findings = deriveFindings(
  { semantic, releaseDiff, reconciliation },
  { detectedAt, goalCapabilities },
);
const decision = (report: ReturnType<typeof gateFindings>, subject: string) =>
  report.decisions.find((item) => item.subject === subject)?.decision;

describe("improvement gate", () => {
  it("recommends a large, high-confidence regression and never offers it to a harness by default", () => {
    const report = gateFindings(findings, policy, {
      usage: { "clients.create": { affected: 400, eligible: 800 } },
    });
    const create = report.decisions.find(
      (item) => item.subject === "clients.create",
    );
    expect(create?.decision).toBe("recommend");
    expect(create?.rationale.at(-1)).toBe(
      "Autonomy: autonomous_mutation is false; recommend to a human.",
    );
    expect(create?.assessment.components.map((item) => item.name)).toEqual([
      "impact",
      "affected_users",
      "eligible_users",
      "confidence",
      "expected_gain",
      "estimated_cost",
    ]);
    expect(
      report.decisions.some((item) => item.decision === "eligible_for_harness"),
    ).toBe(false);
  });

  it("logs or collects data for weak or small findings", () => {
    const small = gateFindings(findings, policy, {
      usage: { "clients.create": { affected: 20, eligible: 800 } },
    });
    expect(decision(small, "clients.create")).toBe("log_only");
    // Observed-only discrepancy evidence is medium confidence.
    expect(decision(small, "plans.create")).toBe("collect_more_data");
  });

  it("gives no change for a niche feature that works for those who use it", () => {
    const report = gateFindings(findings, policy, {
      usage: {
        "plans.archive": { affected: 150, eligible: 800, completionRate: 0.95 },
      },
    });
    const archive = report.decisions.find(
      (item) => item.subject === "plans.archive",
    );
    expect(archive?.decision).toBe("no_change");
    expect(archive?.rationale.at(-1)).toContain("niche feature");
  });

  it("caps recommendations by budget and allows the harness only when enabled", () => {
    const usage = {
      "clients.create": { affected: 400, eligible: 800 },
      "plans.archive": { affected: 300, eligible: 800, completionRate: 0.3 },
    };
    const capped = gateFindings(
      findings,
      { ...policy, max_recommendations_per_period: 1 },
      { usage },
    );
    expect(
      capped.decisions.filter((item) => item.decision === "recommend"),
    ).toHaveLength(1);
    expect(
      capped.decisions.some((item) =>
        item.rationale.some((line) => line.startsWith("Budget:")),
      ),
    ).toBe(true);
    expect(capped.budgets.recommendations).toEqual({ used: 1, max: 1 });
    const autonomous = gateFindings(
      findings,
      { ...policy, autonomous_mutation: true, max_autonomous_mutations: 1 },
      { usage },
    );
    expect(
      autonomous.decisions
        .map((item) => item.decision)
        .filter((item) => item !== "collect_more_data"),
    ).toEqual(["eligible_for_harness", "recommend"]);
  });
});
