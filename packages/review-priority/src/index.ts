import {
  type CalibrationTable,
  type ConfidenceBand,
  calibrate,
} from "@pathcompiler/probabilistic-evidence";
import type { WorkflowV1 } from "@pathcompiler/workflow-ir";
import type { Proposal } from "@pathcompiler/workflow-proposals";
import type {
  ApprovedWorkflow,
  RejectedWorkflow,
} from "@pathcompiler/workflow-review";

/**
 * Review prioritization and feedback, P-RV (reasoning spec §52–§53).
 * Priority = uncertainty × business impact × usage × change severity. Each
 * factor is in (0, 1] and explained, and a missing input is neutral rather
 * than guessed. Review decisions already stored in approved, rejected and
 * proposal records become labeled calibration data.
 */
export type PriorityFactor = { value: number; reason: string };
export type ReviewQueueItem = {
  kind: "candidate" | "update-proposal" | "deprecation-proposal";
  /** The candidate's workflow ID, or the proposal's file name. */
  id: string;
  workflowId: string;
  title: string;
  priority: number;
  factors: {
    uncertainty: PriorityFactor;
    businessImpact: PriorityFactor;
    usage: PriorityFactor;
    severity: PriorityFactor;
  };
};
export type ReviewQueue = {
  schemaVersion: 1;
  kind: "review-queue";
  priorityMeaning: "ordering-not-probability";
  items: ReviewQueueItem[];
};
export type ReviewDecision =
  | "accepted"
  | "edited"
  | "rejected"
  | "ignored"
  | "merged"
  | "renamed";
export type ReviewFeedback = {
  workflowId: string;
  subject: "candidate" | "update-proposal" | "deprecation-proposal";
  decision: ReviewDecision;
  /** Confidence of what was reviewed, when it was reviewed. */
  confidence: number;
  band: ConfidenceBand;
  decidedBy: string;
  decidedAt: string;
};

const NEUTRAL = 0.5;
const round = (value: number) => Math.round(value * 1000) / 1000;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Same thresholds as capability confidence bands. */
export function confidenceBand(confidence: number): ConfidenceBand {
  return confidence < 0.7 ? "low" : confidence < 0.85 ? "medium" : "high";
}

export function prioritizeReviews(input: {
  candidates: readonly WorkflowV1[];
  /** Proposals with their file names; only pending ones are queued. */
  proposals?: readonly { name: string; proposal: Proposal }[];
  /** Observed sessions or runs per workflow ID (O7); omit when there is no telemetry. */
  usage?: Readonly<Record<string, number>>;
  /** Business impact in (0, 1] per workflow ID or capability domain. */
  businessImpact?: Readonly<Record<string, number>>;
}): ReviewQueue {
  for (const [key, value] of Object.entries(input.businessImpact ?? {}))
    if (!(value > 0 && value <= 1))
      throw new Error(
        `Business impact for ${key} must be in (0, 1], got ${value}.`,
      );
  const busiest = Math.max(0, ...Object.values(input.usage ?? {}));
  const factors = (workflowId: string, confidence: number) => {
    const domain = workflowId.split(".")[0] ?? workflowId;
    const impact =
      input.businessImpact?.[workflowId] ?? input.businessImpact?.[domain];
    const sessions = input.usage?.[workflowId];
    return {
      // Never 0: a confident item still needs review eventually.
      uncertainty: {
        value: round(Math.max(0.05, 1 - confidence)),
        reason: `Confidence ${confidence} (${confidenceBand(confidence)}); rule strength, not probability.`,
      },
      businessImpact:
        impact === undefined
          ? { value: NEUTRAL, reason: "No business impact given; neutral." }
          : {
              value: impact,
              reason: `Configured for ${input.businessImpact?.[workflowId] === undefined ? `domain ${domain}` : workflowId}.`,
            },
      usage:
        input.usage === undefined || busiest === 0
          ? { value: NEUTRAL, reason: "No usage telemetry; neutral." }
          : {
              // Relative to the busiest workflow; unobserved ones keep a floor.
              value: round(Math.max(0.1, (sessions ?? 0) / busiest)),
              reason: `${sessions ?? 0} observed runs (busiest: ${busiest}).`,
            },
    };
  };
  const items: ReviewQueueItem[] = [];
  for (const workflow of input.candidates)
    items.push({
      kind: "candidate",
      id: workflow.id,
      workflowId: workflow.id,
      title: workflow.title,
      priority: 0,
      factors: {
        ...factors(workflow.id, workflow.confidence.overall),
        severity: {
          value: NEUTRAL,
          reason: "New candidate; no approved behavior changes.",
        },
      },
    });
  for (const { name, proposal } of input.proposals ?? []) {
    if (proposal.review.status !== "pending") continue;
    const update = proposal.kind === "workflow-update-proposal";
    const proposed = update ? proposal.proposed : null;
    // No matched candidate (or a deprecation): nothing vouches for the change.
    const confidence = proposed?.confidence.overall ?? 0;
    items.push({
      kind: update ? "update-proposal" : "deprecation-proposal",
      id: name,
      workflowId: proposal.workflowId,
      title: proposed?.title ?? proposal.workflowId,
      priority: 0,
      factors: {
        ...factors(proposal.workflowId, confidence),
        severity: {
          value: proposal.impact.severity === "high" ? 1 : 0.6,
          reason: `${proposal.impact.severity} impact: ${proposal.impact.reasons.map((reason) => reason.code).join(", ")}${update && !proposed ? "; no candidate matched" : ""}.`,
        },
      },
    });
  }
  for (const item of items)
    item.priority = round(
      item.factors.uncertainty.value *
        item.factors.businessImpact.value *
        item.factors.usage.value *
        item.factors.severity.value,
    );
  items.sort((a, b) => b.priority - a.priority || compare(a.id, b.id));
  return {
    schemaVersion: 1,
    kind: "review-queue",
    priorityMeaning: "ordering-not-probability",
    items,
  };
}

/** Review decisions already recorded in stored artifacts, as feedback (§53). */
export function collectReviewFeedback(input: {
  approved?: readonly ApprovedWorkflow[];
  rejected?: readonly RejectedWorkflow[];
  proposals?: readonly Proposal[];
}): ReviewFeedback[] {
  const feedback: ReviewFeedback[] = [];
  const entry = (item: Omit<ReviewFeedback, "band">): ReviewFeedback => ({
    ...item,
    band: confidenceBand(item.confidence),
  });
  // A first approval is a candidate decision; later versions came from proposals.
  for (const record of input.approved ?? [])
    if ((record.approval.version ?? 1) === 1)
      feedback.push(
        entry({
          workflowId: record.workflow.id,
          subject: "candidate",
          decision: "accepted",
          confidence: record.workflow.confidence.overall,
          decidedBy: record.approval.approvedBy,
          decidedAt: record.approval.approvedAt,
        }),
      );
  for (const record of input.rejected ?? [])
    feedback.push(
      entry({
        workflowId: record.workflow.id,
        subject: "candidate",
        decision: "rejected",
        confidence: record.workflow.confidence.overall,
        decidedBy: record.rejection.rejectedBy,
        decidedAt: record.rejection.rejectedAt,
      }),
    );
  for (const proposal of input.proposals ?? []) {
    const { review } = proposal;
    if (review.status === "pending") continue;
    const update = proposal.kind === "workflow-update-proposal";
    feedback.push(
      entry({
        workflowId: proposal.workflowId,
        subject: update ? "update-proposal" : "deprecation-proposal",
        decision:
          review.status === "accepted"
            ? review.mode === "edit"
              ? "edited"
              : "accepted"
            : review.status,
        confidence:
          proposal.kind === "workflow-update-proposal"
            ? (proposal.proposed?.confidence.overall ?? 0)
            : 0,
        decidedBy: review.decidedBy,
        decidedAt: review.decidedAt,
      }),
    );
  }
  return feedback.sort(
    (a, b) =>
      compare(a.decidedAt, b.decidedAt) || compare(a.workflowId, b.workflowId),
  );
}

/**
 * Calibration of candidate confidence from review outcomes: accepted as
 * proposed counts as correct; edited, merged, renamed or rejected as not.
 * Ignored decisions say nothing about correctness and are left out.
 */
export function calibrationFromReviews(
  feedback: readonly ReviewFeedback[],
  options: { id?: string; minSamples?: number } = {},
): CalibrationTable {
  return calibrate(
    options.id ?? "review-decisions",
    feedback
      .filter((item) => item.decision !== "ignored")
      .map((item) => ({
        band: item.band,
        correct: item.decision === "accepted",
      })),
    options.minSamples,
  );
}
