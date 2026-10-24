import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import {
  readSourceProject,
  type SourceProject,
} from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import {
  discoverWorkflows,
  type WorkflowCandidate,
} from "@pathcompiler/workflow-discovery";
import {
  type ValidationReport,
  validateWorkflow,
} from "@pathcompiler/workflow-validator";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ApprovedWorkflowSchema,
  approvalVersion,
  approveCandidate,
  parseApprovedWorkflowYaml,
  parseRejectedWorkflowYaml,
  ReviewError,
  rejectCandidate,
  reviewPaths,
  serializeReviewedYaml,
} from "../src/index.js";

let candidate: WorkflowCandidate;
let validation: ValidationReport;
let repository: SourceProject["repository"];
const approvedAt = "2026-10-22T10:00:00.000Z";
beforeAll(async () => {
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  const found = discoverWorkflows(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).report.candidates.find((item) => item.workflow.id === "clients.create");
  if (!found) throw new Error("Missing fixture candidate");
  candidate = found;
  validation = validateWorkflow(found.workflow, {
    graph: mined.graph,
    traces: mined.report,
  });
  // The fixture directory is committed; a clean snapshot is what approval needs.
  repository = { ...project.repository, dirty: false };
});
function approve(overrides: Partial<Parameters<typeof approveCandidate>[1]>) {
  return approveCandidate(candidate, {
    approvedBy: "Test Reviewer",
    approvedAt,
    validation,
    repository,
    ...overrides,
  });
}
function reviewError(run: () => unknown): ReviewError {
  try {
    run();
  } catch (error) {
    if (error instanceof ReviewError) return error;
    throw error;
  }
  throw new Error("Expected a ReviewError");
}

describe("workflow review", () => {
  it("approves a validated candidate with reviewer, time and commit binding", () => {
    const before = structuredClone(candidate);
    const record = approve({});
    expect(record.approval).toEqual({
      approvedBy: "Test Reviewer",
      approvedAt,
      approvedCommit: candidate.workflow.repository.commit,
      version: 1,
    });
    // Records approved before versioning have no version and count as 1.
    const { version: _version, ...legacy } = record.approval;
    expect(
      approvalVersion(
        ApprovedWorkflowSchema.parse({ ...record, approval: legacy }),
      ),
    ).toBe(1);
    expect(record.workflow).toEqual({
      ...candidate.workflow,
      status: "approved",
    });
    expect(candidate).toEqual(before);
    const yaml = serializeReviewedYaml(record);
    expect(parseApprovedWorkflowYaml(yaml)).toEqual(record);
    expect(serializeReviewedYaml(parseApprovedWorkflowYaml(yaml))).toBe(yaml);
  });

  it("refuses failed, mismatched, stale and dirty approvals with specific codes", () => {
    const failed = structuredClone(validation);
    failed.valid = false;
    failed.errors.push({ code: "x", message: "broken" });
    const structure = failed.checks.find((check) => check.name === "structure");
    if (structure) structure.status = "failed";
    expect(reviewError(() => approve({ validation: failed })).code).toBe(
      "validation-failed",
    );
    expect(
      reviewError(() =>
        approve({ validation: { ...validation, workflowId: "plans.create" } }),
      ).code,
    ).toBe("validation-mismatch");
    const moved = "f".repeat(40);
    expect(
      reviewError(() =>
        approve({
          repository: { commit: moved, dirty: false },
          validation: { ...validation, repositoryCommit: moved },
        }),
      ).code,
    ).toBe("stale-candidate");
    for (const dirty of [true, null])
      expect(
        reviewError(() => approve({ repository: { ...repository, dirty } }))
          .code,
      ).toBe("dirty-repository");
  });

  it("validates reviewer identity and refuses non-candidate input", () => {
    for (const approvedBy of ["", " padded", "two\nlines", "x".repeat(121)])
      expect(() => approve({ approvedBy })).toThrow();
    expect(() => approve({ approvedAt: "yesterday" })).toThrow();
    const record = approve({});
    expect(() =>
      approveCandidate(
        { ...candidate, workflow: record.workflow },
        { approvedBy: "a", approvedAt, validation, repository },
      ),
    ).toThrow();
    expect(() =>
      ApprovedWorkflowSchema.parse({
        ...record,
        workflow: { ...record.workflow, status: "candidate" },
      }),
    ).toThrow();
    expect(() =>
      ApprovedWorkflowSchema.parse({
        ...record,
        approval: { ...record.approval, approvedCommit: "a".repeat(40) },
      }),
    ).toThrow();
  });

  it("records rejections with optional reasons and round-trips them", () => {
    const record = rejectCandidate(candidate, {
      rejectedBy: "Test Reviewer",
      rejectedAt: approvedAt,
      reason: "Duplicates an existing guide",
    });
    expect(record.workflow.status).toBe("rejected");
    expect(record.rejection.rejectedCommit).toBe(
      candidate.workflow.repository.commit,
    );
    expect(parseRejectedWorkflowYaml(serializeReviewedYaml(record))).toEqual(
      record,
    );
    expect(
      rejectCandidate(candidate, {
        rejectedBy: "Test Reviewer",
        rejectedAt: approvedAt,
      }).rejection,
    ).not.toHaveProperty("reason");
  });

  it("rejects malformed YAML and unsafe IDs", () => {
    const yaml = serializeReviewedYaml(approve({}));
    expect(() => parseApprovedWorkflowYaml(`${yaml}\nkind: other\n`)).toThrow();
    expect(() => parseApprovedWorkflowYaml("a: &x 1\nb: *x\n")).toThrow();
    expect(() => parseRejectedWorkflowYaml(yaml)).toThrow();
    expect(reviewPaths("clients.create")).toEqual({
      candidate: "workflows/candidates/clients.create.yaml",
      approved: "workflows/clients.create.yaml",
      rejected: "workflows/rejected/clients.create.yaml",
      deprecated: "workflows/deprecated/clients.create.yaml",
    });
    for (const id of ["../secret", "clients", "Clients.create"])
      expect(() => reviewPaths(id)).toThrow();
  });
});
