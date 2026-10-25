import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import type { WorkflowV1 } from "@pathcompiler/workflow-ir";
import type { Proposal } from "@pathcompiler/workflow-proposals";
import type {
  ApprovedWorkflow,
  RejectedWorkflow,
} from "@pathcompiler/workflow-review";
import { beforeAll, describe, expect, it } from "vitest";
import {
  calibrationFromReviews,
  collectReviewFeedback,
  prioritizeReviews,
} from "../src/index.js";

let candidates: WorkflowV1[];
beforeAll(async () => {
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  candidates = discoverWorkflows(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).report.candidates.map((candidate) => candidate.workflow);
});
const at = (id: string, confidence: number): WorkflowV1 => {
  const base = candidates.find((item) => item.id === id) as WorkflowV1;
  return { ...base, confidence: { overall: confidence } };
};
const review = {
  decidedBy: "reviewer",
  decidedAt: "2026-10-24T10:00:00.000Z",
};
const proposal = (
  workflowId: string,
  severity: "medium" | "high",
  status: Proposal["review"],
  proposed: WorkflowV1 | null,
): Proposal =>
  ({
    schemaVersion: 1,
    kind: "workflow-update-proposal",
    workflowId,
    approved: { commit: "a".repeat(40), revision: "r" },
    head: { commit: "b".repeat(40) },
    impact: {
      severity,
      reasons: [
        { code: "target-removed", severity, message: "x", stepIds: [] },
      ],
      affectedSteps: [],
    },
    match: { method: "same-id" },
    proposed,
    generatedRevision: null,
    validation: null,
    evidence: { changedFiles: [], commits: [] },
    diff: "",
    review: status,
  }) satisfies Proposal;

describe("review prioritization", () => {
  it("multiplies explained factors and ranks uncertain, impactful, used, severe items first", () => {
    const queue = prioritizeReviews({
      candidates: [at("clients.create", 0.9), at("plans.archive", 0.5)],
      proposals: [
        {
          name: "clients.edit-b.yaml",
          proposal: proposal(
            "clients.edit",
            "high",
            { status: "pending" },
            null,
          ),
        },
        {
          name: "old.yaml",
          proposal: proposal(
            "plans.create",
            "medium",
            {
              status: "rejected",
              ...review,
            },
            null,
          ),
        },
      ],
      usage: { "clients.create": 100, "plans.archive": 10, "clients.edit": 80 },
      businessImpact: { clients: 1 },
    });
    expect(queue.priorityMeaning).toBe("ordering-not-probability");
    // Decided proposals are not queued.
    expect(queue.items.map((item) => [item.id, item.priority])).toEqual([
      // 1 (no candidate) × 1 (domain) × 0.8 × 1 (high)
      ["clients.edit-b.yaml", 0.8],
      // 0.1 × 1 × 1 × 0.5
      ["clients.create", 0.05],
      // 0.5 × 0.5 (neutral) × 0.1 × 0.5
      ["plans.archive", 0.013],
    ]);
    expect(queue.items[2]?.factors.businessImpact.reason).toContain("neutral");
    expect(queue.items[0]?.factors.severity.reason).toContain(
      "no candidate matched",
    );
  });

  it("is neutral without telemetry and refuses out-of-range impact", () => {
    const queue = prioritizeReviews({
      candidates: [at("clients.create", 0.6)],
    });
    expect(queue.items[0]?.factors.usage).toEqual({
      value: 0.5,
      reason: "No usage telemetry; neutral.",
    });
    expect(() =>
      prioritizeReviews({ candidates: [], businessImpact: { clients: 3 } }),
    ).toThrow("must be in (0, 1]");
  });
});

describe("review feedback", () => {
  it("turns stored decisions into calibration data", () => {
    const approved = (id: string, confidence: number, version = 1) =>
      ({
        schemaVersion: 1,
        kind: "approved-workflow",
        approval: {
          approvedBy: "reviewer",
          approvedAt: "2026-10-24T09:00:00.000Z",
          approvedCommit: "a".repeat(40),
          version,
        },
        workflow: { ...at(id, confidence), status: "approved" },
      }) as ApprovedWorkflow;
    const rejected = {
      schemaVersion: 1,
      kind: "rejected-workflow",
      rejection: {
        rejectedBy: "reviewer",
        rejectedAt: "2026-10-24T11:00:00.000Z",
        rejectedCommit: "a".repeat(40),
      },
      workflow: { ...at("plans.archive", 0.6), status: "rejected" },
    } as RejectedWorkflow;
    const feedback = collectReviewFeedback({
      approved: [
        approved("clients.create", 0.9),
        // Version 2 came from a proposal; counted there, not here.
        approved("clients.edit", 0.9, 2),
      ],
      rejected: [rejected],
      proposals: [
        proposal(
          "clients.edit",
          "high",
          { status: "accepted", mode: "edit", ...review },
          at("clients.edit", 0.75),
        ),
        proposal(
          "plans.create",
          "medium",
          { status: "ignored", ...review },
          null,
        ),
        proposal("plans.change_structure", "high", { status: "pending" }, null),
      ],
    });
    expect(
      feedback.map((item) => [
        item.workflowId,
        item.subject,
        item.decision,
        item.band,
      ]),
    ).toEqual([
      ["clients.create", "candidate", "accepted", "high"],
      ["clients.edit", "update-proposal", "edited", "medium"],
      ["plans.create", "update-proposal", "ignored", "low"],
      ["plans.archive", "candidate", "rejected", "low"],
    ]);
    const table = calibrationFromReviews(feedback, { minSamples: 1 });
    expect(table.bands).toEqual([
      { band: "high", samples: 1, correct: 1 },
      { band: "medium", samples: 1, correct: 0 },
      // Ignored is left out.
      { band: "low", samples: 1, correct: 0 },
    ]);
  });
});
