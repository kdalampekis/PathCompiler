import { WorkflowCandidateSchema } from "@pathcompiler/workflow-discovery";
import { WorkflowV1Schema } from "@pathcompiler/workflow-ir";
import { ValidationReportSchema } from "@pathcompiler/workflow-validator";
import { parseDocument, stringify } from "yaml";
import { z } from "zod";

export const WorkflowIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*(?:--[a-f0-9]{12})?$/,
    "Workflow ID must be a discovered domain.action ID, optionally followed by its variant hash.",
  );
export const ReviewerSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[^\s\p{Cc}](?:[^\p{Cc}]*[^\s\p{Cc}])?$/u,
    "Reviewer must be one line without leading/trailing whitespace or control characters.",
  );
const CommitSchema = z
  .string()
  .regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/, "Expected a full Git commit SHA");

export const ApprovedWorkflowSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("approved-workflow"),
    approval: z.strictObject({
      approvedBy: ReviewerSchema,
      approvedAt: z.iso.datetime(),
      approvedCommit: CommitSchema,
    }),
    workflow: WorkflowV1Schema,
  })
  .superRefine((record, context) => {
    if (record.workflow.status !== "approved")
      context.addIssue({
        code: "custom",
        message: "Approved artifacts must contain an approved workflow",
      });
    if (record.approval.approvedCommit !== record.workflow.repository.commit)
      context.addIssue({
        code: "custom",
        message: "Approval commit must match the workflow's repository commit",
      });
  });
export type ApprovedWorkflow = z.infer<typeof ApprovedWorkflowSchema>;

export const RejectedWorkflowSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("rejected-workflow"),
    rejection: z.strictObject({
      rejectedBy: ReviewerSchema,
      rejectedAt: z.iso.datetime(),
      rejectedCommit: z.string().min(1),
      reason: z.string().min(1).max(500).optional(),
    }),
    workflow: WorkflowV1Schema,
  })
  .superRefine((record, context) => {
    if (record.workflow.status !== "rejected")
      context.addIssue({
        code: "custom",
        message: "Rejected artifacts must contain a rejected workflow",
      });
    if (record.rejection.rejectedCommit !== record.workflow.repository.commit)
      context.addIssue({
        code: "custom",
        message: "Rejection commit must match the workflow's repository commit",
      });
  });
export type RejectedWorkflow = z.infer<typeof RejectedWorkflowSchema>;

export class ReviewError extends Error {
  constructor(
    readonly code:
      | "validation-failed"
      | "validation-mismatch"
      | "stale-candidate"
      | "dirty-repository",
    message: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

/** Paths relative to the PathCompiler output directory (default `.pathcompiler`). */
export function reviewPaths(id: string) {
  WorkflowIdSchema.parse(id);
  return {
    candidate: `workflows/candidates/${id}.yaml`,
    approved: `workflows/${id}.yaml`,
    rejected: `workflows/rejected/${id}.yaml`,
  };
}

export type ApprovalInput = {
  approvedBy: string;
  approvedAt: string;
  /** A fresh static validation of this candidate against the current repository. */
  validation: unknown;
  /** The scanned repository snapshot the validation ran against. */
  repository: { commit: string | null; dirty: boolean | null };
};

/** Pure: never reads files, runs validation or mutates the candidate. */
export function approveCandidate(
  candidate: unknown,
  input: ApprovalInput,
): ApprovedWorkflow {
  const { workflow } = WorkflowCandidateSchema.parse(candidate);
  const validation = ValidationReportSchema.parse(input.validation);
  if (
    validation.workflowId !== workflow.id ||
    validation.repositoryCommit !== input.repository.commit
  )
    throw new ReviewError(
      "validation-mismatch",
      `The validation report does not describe ${workflow.id} at the scanned commit. Re-run validation.`,
    );
  if (input.repository.commit !== workflow.repository.commit)
    throw new ReviewError(
      "stale-candidate",
      `Candidate ${workflow.id} was discovered at a different commit. Rediscover it at the current commit before approval.`,
    );
  if (!validation.valid)
    throw new ReviewError(
      "validation-failed",
      `Candidate ${workflow.id} failed validation (${validation.errors.length} errors). Resolve the errors before approval.`,
    );
  if (input.repository.dirty !== false)
    throw new ReviewError(
      "dirty-repository",
      "The scanned directory has uncommitted or unknown changes, so the approval commit cannot reproduce it. Commit or stash changes, then approve.",
    );
  return ApprovedWorkflowSchema.parse({
    schemaVersion: 1,
    kind: "approved-workflow",
    approval: {
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt,
      approvedCommit: workflow.repository.commit,
    },
    workflow: { ...workflow, status: "approved" },
  });
}

export type RejectionInput = {
  rejectedBy: string;
  rejectedAt: string;
  reason?: string;
};

/** Pure: records the decision against the commit the candidate was discovered at. */
export function rejectCandidate(
  candidate: unknown,
  input: RejectionInput,
): RejectedWorkflow {
  const { workflow } = WorkflowCandidateSchema.parse(candidate);
  return RejectedWorkflowSchema.parse({
    schemaVersion: 1,
    kind: "rejected-workflow",
    rejection: {
      rejectedBy: input.rejectedBy,
      rejectedAt: input.rejectedAt,
      rejectedCommit: workflow.repository.commit,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    },
    workflow: { ...workflow, status: "rejected" },
  });
}

export function serializeReviewedYaml(
  record: ApprovedWorkflow | RejectedWorkflow,
): string {
  const parsed =
    record.kind === "approved-workflow"
      ? ApprovedWorkflowSchema.parse(record)
      : RejectedWorkflowSchema.parse(record);
  return stringify(parsed, { aliasDuplicateObjects: false, lineWidth: 0 });
}
export function parseApprovedWorkflowYaml(input: string): ApprovedWorkflow {
  return ApprovedWorkflowSchema.parse(loadYaml(input, "approved workflow"));
}
export function parseRejectedWorkflowYaml(input: string): RejectedWorkflow {
  return RejectedWorkflowSchema.parse(loadYaml(input, "rejected workflow"));
}

function loadYaml(input: string, label: string): unknown {
  if (Buffer.byteLength(input, "utf8") > 2 * 1024 * 1024)
    throw new Error(`${label} YAML exceeds the 2 MiB limit.`);
  const document = parseDocument(input, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
    version: "1.2",
  });
  if (document.errors.length || document.warnings.length)
    throw new Error(
      `Invalid ${label} YAML. Use one YAML 1.2 document with unique keys and standard scalar types.`,
    );
  return document.toJS({ maxAliasCount: 0 });
}
