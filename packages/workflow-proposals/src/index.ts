import {
  ImpactReasonSchema,
  type WorkflowImpactReport,
  WorkflowImpactReportSchema,
} from "@pathcompiler/impact-analysis";
import { workflowRevision } from "@pathcompiler/workflow-compiler";
import {
  type WorkflowCandidate,
  WorkflowCandidateSchema,
} from "@pathcompiler/workflow-discovery";
import { type WorkflowV1, WorkflowV1Schema } from "@pathcompiler/workflow-ir";
import {
  type ApprovedWorkflow,
  ApprovedWorkflowSchema,
  approvalVersion,
  type DeprecatedWorkflow,
  DeprecatedWorkflowSchema,
  ReviewerSchema,
} from "@pathcompiler/workflow-review";
import {
  type ValidationReport,
  ValidationReportSchema,
} from "@pathcompiler/workflow-validator";
import { parseDocument, stringify } from "yaml";
import { z } from "zod";

export * from "./detect.js";

const sha = z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
const decided = {
  decidedBy: ReviewerSchema,
  decidedAt: z.iso.datetime(),
  note: z.string().min(1).max(500).optional(),
};
export const ProposalReviewSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("pending") }),
  z.strictObject({
    status: z.literal("accepted"),
    /** `edit` when the proposed workflow was changed by hand before acceptance. */
    mode: z.enum(["accept", "edit"]),
    ...decided,
  }),
  z.strictObject({ status: z.literal("rejected"), ...decided }),
  /** ignore-for-this-change: the approved workflow stays as is for this head. */
  z.strictObject({ status: z.literal("ignored"), ...decided }),
]);
export const WorkflowUpdateProposalSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("workflow-update-proposal"),
    workflowId: z.string().min(1),
    approved: z.strictObject({ commit: sha, revision: z.string() }),
    head: z.strictObject({ commit: sha }),
    impact: z.strictObject({
      severity: z.enum(["medium", "high"]),
      reasons: z.array(ImpactReasonSchema).min(1),
      affectedSteps: z.array(z.string()),
    }),
    match: z.strictObject({
      method: z.enum(["same-id", "same-intent", "step-overlap", "none"]),
      candidateId: z.string().optional(),
      overlap: z.number().min(0).max(1).optional(),
    }),
    /** Head-commit rediscovery with the approved ID, or null when no candidate matched. */
    proposed: WorkflowV1Schema.nullable(),
    generatedRevision: z.string().nullable(),
    validation: z
      .strictObject({
        valid: z.boolean(),
        errors: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative(),
      })
      .nullable(),
    evidence: z.strictObject({
      changedFiles: z.array(
        z.strictObject({
          path: z.string(),
          status: z.enum(["added", "removed", "modified"]),
        }),
      ),
      commits: z.array(
        z.strictObject({
          sha,
          authorDate: z.iso.datetime(),
          subject: z.string(),
        }),
      ),
    }),
    /** Human-readable diff of the approved and proposed workflow semantics. */
    diff: z.string(),
    review: ProposalReviewSchema,
  })
  .superRefine((proposal, context) => {
    if (proposal.proposed && proposal.proposed.id !== proposal.workflowId)
      context.addIssue({
        code: "custom",
        message: "A proposal must keep the approved workflow ID",
      });
    if (proposal.proposed && proposal.proposed.status !== "candidate")
      context.addIssue({
        code: "custom",
        message: "Proposed workflows stay candidates until accepted",
      });
    if (
      proposal.proposed &&
      proposal.proposed.repository.commit !== proposal.head.commit
    )
      context.addIssue({
        code: "custom",
        message: "Proposed workflows must be bound to the head commit",
      });
  });
export type WorkflowUpdateProposal = z.infer<
  typeof WorkflowUpdateProposalSchema
>;

/** Impact reasons meaning the workflow lost critical implementation support. */
export const SUPPORT_LOSS = [
  "target-removed",
  "condition-target-removed",
  "api-removed",
  "route-removed",
] as const;
export const WorkflowDeprecationProposalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("workflow-deprecation-proposal"),
  workflowId: z.string().min(1),
  approved: z.strictObject({ commit: sha, revision: z.string() }),
  head: z.strictObject({ commit: sha }),
  impact: z.strictObject({
    severity: z.literal("high"),
    reasons: z.array(ImpactReasonSchema).min(1),
    affectedSteps: z.array(z.string()),
  }),
  lostSupport: z.array(z.enum(SUPPORT_LOSS)).min(1),
  /** A capability new at head in the same domain and entity, if any. */
  replacement: z
    .strictObject({ capabilityId: z.string(), title: z.string() })
    .nullable(),
  evidence: WorkflowUpdateProposalSchema.shape.evidence,
  /** Human-readable explanation of why deprecation is proposed. */
  summary: z.string(),
  review: ProposalReviewSchema,
});
export type WorkflowDeprecationProposal = z.infer<
  typeof WorkflowDeprecationProposalSchema
>;
export const ProposalSchema = z.union([
  WorkflowUpdateProposalSchema,
  WorkflowDeprecationProposalSchema,
]);
export type Proposal = WorkflowUpdateProposal | WorkflowDeprecationProposal;

export type ProposalInput = {
  impact: WorkflowImpactReport;
  approved: readonly unknown[];
  /** Workflow candidates rediscovered at the head commit. */
  candidates: readonly unknown[];
  /** Validates a workflow against the head graph and traces. */
  validate: (workflow: WorkflowV1) => ValidationReport;
  changedFiles?: WorkflowUpdateProposal["evidence"]["changedFiles"];
  commits?: { sha: string; authorDate: string; message: string }[];
  /** Capabilities present at head but not base, for replacement suggestions. */
  newCapabilities?: {
    id: string;
    domain: string;
    entity: string;
    title: string;
  }[];
};

/** File name under `.pathcompiler/proposals/`. */
export function proposalFileName(workflowId: string, head: string): string {
  return `${workflowId}.${sha.parse(head)}.yaml`;
}

/**
 * Pure: builds pending proposals for medium/high impacts: an update when the
 * head commit still supports the workflow, a deprecation when critical support
 * was lost and no candidate matches. Never touches approved records.
 */
export function generateProposals(input: ProposalInput): Proposal[] {
  const impact = WorkflowImpactReportSchema.parse(input.impact);
  const approved = new Map(
    input.approved
      .map((record) => ApprovedWorkflowSchema.parse(record))
      .map((record) => [record.workflow.id, record]),
  );
  const candidates = input.candidates.map((item) =>
    WorkflowCandidateSchema.parse(item),
  );
  const commits = (input.commits ?? []).map((commit) => ({
    sha: sha.parse(commit.sha),
    authorDate: commit.authorDate,
    subject: commit.message.split("\n")[0]?.trim() || "(no subject)",
  }));
  return impact.impacts.flatMap((item): Proposal[] => {
    if (item.severity !== "medium" && item.severity !== "high") return [];
    const record = approved.get(item.workflowId);
    if (!record) return [];
    const match = matchCandidate(record.workflow, candidates);
    const lost = SUPPORT_LOSS.filter((code) =>
      item.reasons.some((reason) => reason.code === code),
    );
    if (!match.candidate && lost.length && item.severity === "high") {
      const replacement =
        (input.newCapabilities ?? [])
          .filter(
            (capability) =>
              capability.id !== record.workflow.id &&
              capability.domain === record.workflow.domain &&
              capability.entity === record.workflow.intent.entity,
          )
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ?? null;
      return [
        WorkflowDeprecationProposalSchema.parse({
          schemaVersion: 1,
          kind: "workflow-deprecation-proposal",
          workflowId: record.workflow.id,
          approved: {
            commit: record.approval.approvedCommit,
            revision: workflowRevision(record.workflow),
          },
          head: { commit: impact.head.commit },
          impact: {
            severity: "high",
            reasons: item.reasons,
            affectedSteps: item.affectedSteps,
          },
          lostSupport: lost,
          replacement: replacement
            ? { capabilityId: replacement.id, title: replacement.title }
            : null,
          evidence: { changedFiles: input.changedFiles ?? [], commits },
          summary: [
            `${record.workflow.title} (${record.workflow.id}) lost implementation support at ${impact.head.commit.slice(0, 12)}:`,
            ...item.reasons
              .filter((reason) =>
                (SUPPORT_LOSS as readonly string[]).includes(reason.code),
              )
              .map((reason) => `  - ${reason.message}`),
            "No workflow at the head commit matches it.",
            replacement
              ? `Possible replacement: ${replacement.title} (${replacement.id}).`
              : "No replacement capability was detected.",
            "Accepting deprecates the workflow; it is never deleted automatically.",
          ].join("\n"),
          review: { status: "pending" },
        }),
      ];
    }
    const proposed = match.candidate
      ? WorkflowV1Schema.parse({
          ...match.candidate.workflow,
          id: record.workflow.id,
          status: "candidate",
        })
      : null;
    const validation = proposed ? input.validate(proposed) : null;
    return [
      WorkflowUpdateProposalSchema.parse({
        schemaVersion: 1,
        kind: "workflow-update-proposal",
        workflowId: record.workflow.id,
        approved: {
          commit: record.approval.approvedCommit,
          revision: workflowRevision(record.workflow),
        },
        head: { commit: impact.head.commit },
        impact: {
          severity: item.severity,
          reasons: item.reasons,
          affectedSteps: item.affectedSteps,
        },
        match: {
          method: match.method,
          ...(match.candidate
            ? { candidateId: match.candidate.workflow.id }
            : {}),
          ...(match.overlap === undefined ? {} : { overlap: match.overlap }),
        },
        proposed,
        generatedRevision: proposed ? workflowRevision(proposed) : null,
        validation: validation
          ? {
              valid: ValidationReportSchema.parse(validation).valid,
              errors: validation.errors.length,
              warnings: validation.warnings.length,
            }
          : null,
        evidence: { changedFiles: input.changedFiles ?? [], commits },
        diff: workflowDiff(record.workflow, proposed, {
          approved: record.approval.approvedCommit,
          head: impact.head.commit,
        }),
        review: { status: "pending" },
      }),
    ];
  });
}

function matchCandidate(
  workflow: WorkflowV1,
  candidates: WorkflowCandidate[],
): {
  method: WorkflowUpdateProposal["match"]["method"];
  candidate?: WorkflowCandidate;
  overlap?: number;
} {
  const same = candidates.find((item) => item.workflow.id === workflow.id);
  if (same) return { method: "same-id", candidate: same };
  const intent = candidates.filter(
    (item) =>
      item.workflow.domain === workflow.domain &&
      item.workflow.intent.action === workflow.intent.action &&
      item.workflow.intent.entity === workflow.intent.entity,
  );
  if (intent.length === 1 && intent[0])
    return { method: "same-intent", candidate: intent[0] };
  const targets = new Set(
    workflow.steps.flatMap((step) => (step.target ? [step.target] : [])),
  );
  const scored = candidates
    .map((candidate) => {
      const other = new Set(
        candidate.workflow.steps.flatMap((step) =>
          step.target ? [step.target] : [],
        ),
      );
      const shared = [...targets].filter((target) => other.has(target)).length;
      return {
        candidate,
        overlap: shared / Math.max(targets.size, other.size, 1),
      };
    })
    .filter((item) => item.overlap >= 0.5)
    .sort((a, b) => b.overlap - a.overlap);
  const [best, next] = scored;
  if (best && (!next || next.overlap < best.overlap))
    return {
      method: "step-overlap",
      candidate: best.candidate,
      overlap: Math.round(best.overlap * 1000) / 1000,
    };
  return { method: "none" };
}

/** Review-oriented view: semantics, with evidence summarized as counts. */
function semantics(workflow: WorkflowV1) {
  return {
    title: workflow.title,
    ...(workflow.description ? { description: workflow.description } : {}),
    intent: workflow.intent,
    ...(workflow.roles ? { roles: workflow.roles } : {}),
    entrypoints: workflow.entrypoints,
    ...(workflow.preconditions
      ? { preconditions: workflow.preconditions }
      : {}),
    steps: workflow.steps.map(({ evidence, ...step }) => ({
      ...step,
      evidence: `${evidence.length} references`,
    })),
    terminal: workflow.terminal,
  };
}

/** Line diff with two lines of context around each change. */
export function workflowDiff(
  before: WorkflowV1,
  after: WorkflowV1 | null,
  commits: { approved: string; head: string },
): string {
  const a = stringify(semantics(before), { lineWidth: 0 }).split("\n");
  const b = after
    ? stringify(semantics(after), { lineWidth: 0 }).split("\n")
    : [];
  const header = [
    `--- approved ${before.id} @ ${commits.approved.slice(0, 12)}`,
    `+++ proposed ${after ? after.id : "(no matching candidate; edit `proposed` by hand)"} @ ${commits.head.slice(0, 12)}`,
  ];
  const lines = lineDiff(a, b);
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.startsWith("  ")) return;
    for (let near = index - 2; near <= index + 2; near += 1) keep.add(near);
  });
  const out: string[] = [];
  let skipped = false;
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      out.push(line);
      skipped = false;
    } else if (!skipped) {
      out.push("  …");
      skipped = true;
    }
  });
  return `${[...header, ...(keep.size ? out : ["  (no semantic differences)"])].join("\n")}\n`;
}

function lineDiff(a: string[], b: string[]): string[] {
  // lcs[i][j]: longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  const at = (i: number, j: number) => lcs[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      (lcs[i] as number[])[j] =
        a[i] === b[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i += 1;
      j += 1;
    } else if (
      i < a.length &&
      (j >= b.length || at(i + 1, j) >= at(i, j + 1))
    ) {
      // Removals before additions, as in conventional diffs.
      out.push(`- ${a[i]}`);
      i += 1;
    } else {
      out.push(`+ ${b[j]}`);
      j += 1;
    }
  }
  return out.filter((line) => line.trim() !== "");
}

export class ProposalError extends Error {
  constructor(
    readonly code:
      | "not-pending"
      | "no-proposed-workflow"
      | "stale-repository"
      | "dirty-repository"
      | "validation-failed"
      | "wrong-kind"
      | "approved-changed",
    message: string,
  ) {
    super(message);
    this.name = "ProposalError";
  }
}

function pending(proposal: Proposal) {
  if (proposal.review.status !== "pending")
    throw new ProposalError(
      "not-pending",
      `Proposal for ${proposal.workflowId} was already ${proposal.review.status}.`,
    );
}

/**
 * Pure: accepts a pending proposal against a fresh validation of the head
 * commit, returning the new approved record and the decided proposal.
 */
export function acceptProposal(
  input: unknown,
  decision: {
    decidedBy: string;
    decidedAt: string;
    note?: string;
    validation: unknown;
    repository: { commit: string | null; dirty: boolean | null };
    /** The approved record this proposal updates; its version is incremented. */
    current: unknown;
  },
): { approved: ApprovedWorkflow; proposal: WorkflowUpdateProposal } {
  const parsed = ProposalSchema.parse(input);
  if (parsed.kind !== "workflow-update-proposal")
    throw new ProposalError(
      "wrong-kind",
      "This is a deprecation proposal; accept it with acceptDeprecation.",
    );
  const proposal = parsed;
  pending(proposal);
  if (!proposal.proposed)
    throw new ProposalError(
      "no-proposed-workflow",
      "No candidate matched. Write the updated workflow under `proposed`, then accept.",
    );
  if (decision.repository.commit !== proposal.head.commit)
    throw new ProposalError(
      "stale-repository",
      `Check out ${proposal.head.commit.slice(0, 12)} before accepting; the proposal is bound to that commit.`,
    );
  if (decision.repository.dirty !== false)
    throw new ProposalError(
      "dirty-repository",
      "Commit or stash changes so the accepted workflow matches its commit.",
    );
  const current = ApprovedWorkflowSchema.parse(decision.current);
  if (
    current.workflow.id !== proposal.workflowId ||
    workflowRevision(current.workflow) !== proposal.approved.revision
  )
    throw new ProposalError(
      "approved-changed",
      `The approved ${proposal.workflowId} changed since this proposal was generated. Regenerate the proposal.`,
    );
  const validation = ValidationReportSchema.parse(decision.validation);
  if (
    validation.workflowId !== proposal.workflowId ||
    validation.repositoryCommit !== proposal.head.commit ||
    !validation.valid
  )
    throw new ProposalError(
      "validation-failed",
      `The proposed workflow failed validation at the head commit (${validation.errors.length} errors). Edit it and retry.`,
    );
  const review = {
    status: "accepted" as const,
    mode:
      workflowRevision(proposal.proposed) === proposal.generatedRevision
        ? ("accept" as const)
        : ("edit" as const),
    decidedBy: decision.decidedBy,
    decidedAt: decision.decidedAt,
    ...(decision.note === undefined ? {} : { note: decision.note }),
  };
  return {
    approved: ApprovedWorkflowSchema.parse({
      schemaVersion: 1,
      kind: "approved-workflow",
      approval: {
        approvedBy: decision.decidedBy,
        approvedAt: decision.decidedAt,
        approvedCommit: proposal.head.commit,
        version: approvalVersion(current) + 1,
      },
      workflow: { ...proposal.proposed, status: "approved" },
    }),
    proposal: WorkflowUpdateProposalSchema.parse({ ...proposal, review }),
  };
}

/** Pure: rejects, or ignores for this change; the approved workflow is untouched. */
export function decideProposal(
  input: unknown,
  status: "rejected" | "ignored",
  decision: { decidedBy: string; decidedAt: string; note?: string },
): Proposal {
  const proposal = ProposalSchema.parse(input);
  pending(proposal);
  return ProposalSchema.parse({
    ...proposal,
    review: {
      status,
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt,
      ...(decision.note === undefined ? {} : { note: decision.note }),
    },
  });
}

export function serializeProposalYaml(proposal: Proposal): string {
  return stringify(ProposalSchema.parse(proposal), {
    aliasDuplicateObjects: false,
    lineWidth: 0,
  });
}
export function parseProposalYaml(input: string): Proposal {
  if (Buffer.byteLength(input, "utf8") > 2 * 1024 * 1024)
    throw new Error("Proposal YAML exceeds the 2 MiB limit.");
  const document = parseDocument(input, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
    version: "1.2",
  });
  if (document.errors.length || document.warnings.length)
    throw new Error(
      "Invalid proposal YAML. Use one YAML 1.2 document with unique keys and standard scalar types.",
    );
  return ProposalSchema.parse(document.toJS({ maxAliasCount: 0 }));
}

/**
 * Pure: accepts a pending deprecation, returning a deprecated record built from
 * the still-unchanged approved workflow. The caller removes the approved file.
 */
export function acceptDeprecation(
  input: unknown,
  approvedRecord: unknown,
  decision: { decidedBy: string; decidedAt: string; note?: string },
): { deprecated: DeprecatedWorkflow; proposal: WorkflowDeprecationProposal } {
  const proposal = ProposalSchema.parse(input);
  if (proposal.kind !== "workflow-deprecation-proposal")
    throw new ProposalError(
      "wrong-kind",
      "This is an update proposal; accept it with acceptProposal.",
    );
  pending(proposal);
  const record = ApprovedWorkflowSchema.parse(approvedRecord);
  if (
    record.workflow.id !== proposal.workflowId ||
    workflowRevision(record.workflow) !== proposal.approved.revision
  )
    throw new ProposalError(
      "approved-changed",
      "The approved workflow changed after this proposal was generated. Regenerate proposals.",
    );
  const review = {
    status: "accepted" as const,
    mode: "accept" as const,
    decidedBy: decision.decidedBy,
    decidedAt: decision.decidedAt,
    ...(decision.note === undefined ? {} : { note: decision.note }),
  };
  return {
    deprecated: DeprecatedWorkflowSchema.parse({
      schemaVersion: 1,
      kind: "deprecated-workflow",
      deprecation: {
        deprecatedBy: decision.decidedBy,
        deprecatedAt: decision.decidedAt,
        deprecatedCommit: proposal.head.commit,
        reasons: proposal.lostSupport,
        ...(proposal.replacement
          ? { replacement: proposal.replacement.capabilityId }
          : {}),
        ...(decision.note === undefined ? {} : { note: decision.note }),
      },
      workflow: { ...record.workflow, status: "deprecated" },
    }),
    proposal: WorkflowDeprecationProposalSchema.parse({ ...proposal, review }),
  };
}
