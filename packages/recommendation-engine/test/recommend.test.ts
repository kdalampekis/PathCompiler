import type {
  PathEfficiencyReport,
  ReconciliationReport,
} from "@pathcompiler/behavior-reconciliation";
import { parseConfig } from "@pathcompiler/config";
import { deriveFindings } from "@pathcompiler/findings";
import { gateFindings } from "@pathcompiler/improvement-gate";
import type { ReleaseBehaviorDiff } from "@pathcompiler/observed-graph";
import type { SemanticChangeReport } from "@pathcompiler/semantic-change";
import { describe, expect, it } from "vitest";
import { recommend } from "../src/index.js";

const policy = parseConfig("version: 1\n").improvement_policy;
const at = "2026-10-24T12:00:00.000Z";
const semantic = {
  type: "semantic_change_report",
  commitRange: { base: "a".repeat(40), head: "b".repeat(40) },
  removedReachability: [
    {
      goal: "clients.created",
      capabilityId: "clients.create",
      context: {},
      changedAt: [],
    },
  ],
  newReachability: [
    {
      goal: "plans.archived",
      capabilityId: "plans.archive",
      context: { role: "editor" },
    },
  ],
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
const efficiency = {
  friction: [{ goal: "plans.created", role: "editor", ratio: 4 }],
} as unknown as PathEfficiencyReport;
const reconciliation = {
  items: [
    {
      kind: "goal",
      id: "plans.structure_changed",
      role: "admin",
      formal: "possible",
      observed: { count: 0, sessions: 0 },
      roleSessions: 300,
      class: "possible-unobserved",
    },
  ],
  discrepancies: [],
} as unknown as ReconciliationReport;
const findings = deriveFindings(
  { semantic, releaseDiff, efficiency, reconciliation },
  {
    detectedAt: at,
    goalCapabilities: {
      "plans.created": "plans.create",
      "plans.structure_changed": "plans.change_structure",
    },
  },
);
const usage = {
  "clients.create": { affected: 400, eligible: 800 },
  "plans.archive": { affected: 200, eligible: 800 },
  "plans.create": { affected: 300, eligible: 800 },
  "plans.change_structure": {
    affected: 120,
    eligible: 800,
    completionRate: 0.4,
  },
};
// A lower confidence bar so single-class findings reach the templates.
const gate = gateFindings(
  findings,
  { ...policy, min_confidence: 0.5 },
  { usage },
);
const report = recommend({
  findings,
  gate,
  approvedWorkflows: ["clients.create", "plans.create"],
  properties: [
    {
      id: "viewer-never-creates",
      kind: "never",
      description: "Viewers never create clients",
    },
  ],
  generatedAt: at,
});
const byId = new Map(report.recommendations.map((item) => [item.id, item]));

describe("recommendation model", () => {
  it("turns a regression into a FIX with reachability checks and protected behaviors", () => {
    const fix = byId.get("recommendation:clients.create:fix");
    expect(fix).toMatchObject({
      category: "fix",
      target: { subject: "clients.create", goals: ["clients.created"] },
      hypothesis: {
        falsifiable: true,
        confidence: {
          band: "medium",
          meaning: "template-prior-not-probability",
        },
      },
      findingConfidence: { band: "high" },
      harnessEligible: false,
    });
    expect(fix?.acceptanceCriteria.required).toEqual([
      { kind: "formal-reachable", goal: "clients.created" },
      { kind: "property-holds", propertyId: "viewer-never-creates" },
      { kind: "workflow-valid", workflowId: "clients.create" },
      { kind: "workflow-valid", workflowId: "plans.create" },
      { kind: "browser-verified", workflowId: "clients.create" },
    ]);
    // Other approved workflows are protected; the target itself is the change.
    expect(
      fix?.protectedBehaviors.map((item) =>
        item.kind === "approved-workflow" ? item.workflowId : item.property.id,
      ),
    ).toEqual(["viewer-never-creates", "plans.create"]);
    expect(fix?.problem.evidence[0]?.sources.length).toBeGreaterThan(0);
  });

  it("asks to remove access a role newly gained", () => {
    expect(
      byId.get("recommendation:plans.archive:fix")?.acceptanceCriteria
        .required[0],
    ).toEqual({
      kind: "formal-unreachable",
      goal: "plans.archived",
      context: "role=editor",
    });
  });

  it("uses IMPROVE for friction and PROMOTE for low adoption, with outcome metrics", () => {
    const improve = byId.get("recommendation:plans.create:improve");
    expect(improve?.desiredOutcomes).toEqual([
      {
        metric: "workflow_completion_rate",
        direction: "increase",
        on: "plans.created",
      },
      {
        metric: "path_efficiency_ratio",
        direction: "decrease",
        on: "plans.created",
      },
    ]);
    expect(improve?.hypothesis.confidence.band).toBe("low");
    const promote = byId.get("recommendation:plans.change_structure:promote");
    expect(promote?.acceptanceCriteria.outcome[0]).toMatchObject({
      kind: "metric",
      method: expect.stringContaining("observe check plans.structure_changed"),
    });
  });

  it("only escalated decisions become recommendations", () => {
    const strict = recommend({
      findings,
      gate: gateFindings(findings, policy),
      generatedAt: at,
    });
    // Without usage only high-severity regressions pass; nothing else is recommended.
    expect(strict.recommendations.map((item) => item.category)).toEqual([
      "fix",
    ]);
    expect(strict.skipped.length).toBeGreaterThan(0);
  });
});
