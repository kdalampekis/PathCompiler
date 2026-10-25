import type {
  DropOffReport,
  PathEfficiencyReport,
  ReconciliationReport,
} from "@pathcompiler/behavior-reconciliation";
import type { WorkflowImpactReport } from "@pathcompiler/impact-analysis";
import { describe, expect, it } from "vitest";
import { deriveFindings } from "../src/index.js";

const detectedAt = "2026-10-24T12:00:00.000Z";
const impact: WorkflowImpactReport = {
  schemaVersion: 1,
  base: { commit: "a".repeat(40) },
  head: { commit: "b".repeat(40) },
  method: "deterministic-rules",
  impacts: [
    {
      workflowId: "plans.change_structure",
      severity: "high",
      affectedSteps: ["step.1"],
      reasons: [
        {
          code: "target-removed",
          severity: "high",
          message: "Semantic target plans.change_structure was removed.",
          nodeId: "ui:plans.change_structure",
          stepIds: ["step.1"],
        },
        {
          code: "copy-changed",
          severity: "low",
          message: "Copy changed.",
          stepIds: [],
        },
      ],
    },
    {
      workflowId: "plans.archive",
      severity: "high",
      affectedSteps: [],
      reasons: [
        {
          code: "permission-changed",
          severity: "high",
          message: "Access condition flag:planArchive was removed.",
          nodeId: "flag:planArchive",
          stepIds: [],
        },
      ],
    },
  ],
};
const efficiency: PathEfficiencyReport = {
  schemaVersion: 1,
  meaning: "hypothesis",
  unit: "interactions",
  minCompletions: 30,
  items: [],
  friction: [{ goal: "clients.created", role: "editor", ratio: 3.5 }],
};
const dropOffs: DropOffReport = {
  schemaVersion: 1,
  meaning: "hypothesis",
  minAttempts: 30,
  frictionShare: 0.2,
  items: [
    {
      goal: "clients.created",
      capabilityId: "clients.create",
      role: "editor",
      attempts: 50,
      completions: 25,
      dropOffs: 25,
      dropOffRate: 0.5,
      points: [{ target: "client.form.submit", sessions: 20, share: 0.4 }],
      friction: [
        { target: "client.form.submit", share: 0.4, alternatives: [] },
      ],
    },
  ],
};
const reconciliation = {
  schemaVersion: 1,
  minSessions: 30,
  roles: [{ role: "editor", sessions: 40 }],
  items: [
    {
      kind: "goal",
      id: "plans.archived",
      role: "admin",
      formal: "possible",
      observed: { count: 0, sessions: 0 },
      roleSessions: 60,
      class: "possible-unobserved",
    },
  ],
  discrepancies: [
    {
      type: "unexpected_observed",
      priority: "high",
      kind: "goal",
      id: "plans.archived",
      role: "editor",
      observed: { count: 4, sessions: 3 },
      formalReason: ["plans.archive requires role = admin"],
      possibleCauses: [],
    },
  ],
} as unknown as ReconciliationReport;

describe("finding model", () => {
  it("classifies regressions, friction, low adoption and discrepancies with lineage", () => {
    const report = deriveFindings(
      { impact, efficiency, dropOffs, reconciliation },
      {
        detectedAt,
        goalCapabilities: {
          "clients.created": "clients.create",
          "plans.archived": "plans.archive",
        },
      },
    );
    expect(report.meaning).toBe("hypothesis");
    expect(report.findings.map((item) => [item.id, item.severity])).toEqual([
      ["finding:low_adoption:goal:plans.archived@admin", "low"],
      ["finding:permission_regression:workflow:plans.archive", "high"],
      ["finding:release_regression:workflow:plans.change_structure", "high"],
      ["finding:runtime_formal_discrepancy:goal:plans.archived@editor", "high"],
      ["finding:workflow_friction:goal:clients.created@editor", "high"],
    ]);
    const friction = report.findings.find(
      (item) => item.kind === "workflow_friction",
    );
    // Efficiency and drop-off evidence join one finding.
    expect(friction?.evidence.sources.map((item) => item.report)).toEqual([
      "path-efficiency",
      "drop-offs",
    ]);
    // Low-severity impact reasons are not findings.
    expect(JSON.stringify(report)).not.toContain("copy-changed");
    // Formal and observed evidence agree for low adoption.
    expect(
      report.findings
        .find((item) => item.kind === "low_adoption")
        ?.evidence.items.map((item) => item.class),
    ).toEqual(["observed", "formal"]);
    expect(
      report.findings.every((item) => item.detectedAt === detectedAt),
    ).toBe(true);
  });

  it("groups findings into opportunities with explained priority", () => {
    const report = deriveFindings(
      { impact, efficiency, dropOffs, reconciliation },
      {
        detectedAt,
        goalCapabilities: {
          "clients.created": "clients.create",
          "plans.archived": "plans.archive",
        },
      },
    );
    const archive = report.opportunities.find(
      (item) => item.subject === "plans.archive",
    );
    expect(archive?.kinds).toEqual([
      "low_adoption",
      "permission_regression",
      "runtime_formal_discrepancy",
    ]);
    expect(archive?.priority.components.map((item) => item.name)).toEqual([
      "severity",
      "confidence",
      "regression",
      "corroboration",
    ]);
    expect(archive?.priority.scoreMeaning).toBe("ordering-not-probability");
    // Three corroborating findings and a regression outrank friction alone.
    expect(report.opportunities[0]?.subject).toBe("plans.archive");
    expect(
      report.opportunities
        .find((item) => item.subject === "clients.create")
        ?.priority.components.find((item) => item.name === "regression")?.value,
    ).toBe(0.5);
  });

  it("is deterministic and empty without inputs", () => {
    const one = deriveFindings({ impact, dropOffs }, { detectedAt });
    const two = deriveFindings({ dropOffs, impact }, { detectedAt });
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    expect(deriveFindings({}, { detectedAt })).toMatchObject({
      findings: [],
      opportunities: [],
    });
  });
});
