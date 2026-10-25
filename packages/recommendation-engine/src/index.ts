import type {
  FindingKind,
  FindingsReport,
  PriorityAssessment,
  ProductFinding,
  ProductTarget,
} from "@pathcompiler/findings";
import type { GateReport } from "@pathcompiler/improvement-gate";
import type { ProductPropertyRef } from "@pathcompiler/reasoner-core";

/**
 * Recommendation model, I1 (reasoning spec §178–§183, §242). Only gate
 * decisions `recommend` and `eligible_for_harness` become recommendations,
 * from deterministic templates per finding class. Finding confidence (the
 * problem is real) and intervention confidence (the change will help) are
 * kept apart. Every recommendation says what must not break and how
 * success will be checked.
 */
export type RecommendationCategory =
  | "fix"
  | "improve"
  | "promote"
  | "build"
  | "deprioritize"
  | "investigate";
export type MetricGoal = {
  metric: string;
  direction: "increase" | "decrease" | "hold";
  /** The subject the metric is measured on (goal, workflow or role context). */
  on: string;
};
export type ImprovementHypothesis = {
  statement: string;
  mechanism?: string;
  expectedEffect: MetricGoal[];
  /** Confidence that the intervention helps: a template prior, never measured. */
  confidence: {
    band: "high" | "medium" | "low";
    meaning: "template-prior-not-probability";
    reason: string;
  };
  falsifiable: boolean;
};
export type ProtectedBehavior =
  | { kind: "property"; property: ProductPropertyRef }
  | { kind: "approved-workflow"; workflowId: string; reason: string };
export type AcceptanceCheck =
  | { kind: "formal-reachable"; goal: string; context?: string }
  | { kind: "formal-unreachable"; goal: string; context?: string }
  | { kind: "property-holds"; propertyId: string }
  | { kind: "workflow-valid"; workflowId: string }
  | { kind: "browser-verified"; workflowId: string }
  | { kind: "metric"; goal: MetricGoal; method: string };
export type AcceptanceCriteria = {
  /** All must pass before a candidate change is considered successful. */
  required: AcceptanceCheck[];
  /** Measured after release (I5/I6); never a reason to skip the required checks. */
  outcome: AcceptanceCheck[];
};
export type ImprovementRecommendation = {
  id: string;
  findingIds: string[];
  opportunityId: string;
  category: RecommendationCategory;
  target: { subject: string; goals: string[] };
  problem: {
    summary: string;
    classification: FindingKind[];
    evidence: {
      findingId: string;
      sources: ProductFinding["evidence"]["sources"];
    }[];
  };
  hypothesis: ImprovementHypothesis;
  desiredOutcomes: MetricGoal[];
  protectedBehaviors: ProtectedBehavior[];
  acceptanceCriteria: AcceptanceCriteria;
  /** From the gate: escalation to a harness is allowed for this one. */
  harnessEligible: boolean;
  priority: PriorityAssessment;
  /** That the problem is real: the strongest finding confidence (rule strength). */
  findingConfidence: { band: string; score: number };
  generatedAt: string;
  sourceModelVersion: string;
};
export type RecommendationReport = {
  schemaVersion: 1;
  kind: "recommendations";
  recommendations: ImprovementRecommendation[];
  /** Opportunities the gate did not escalate, with its decision. */
  skipped: { opportunityId: string; decision: string }[];
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const goalOf = (target: ProductTarget) =>
  target.kind === "goal" ? [target.id] : [];

export function recommend(input: {
  findings: FindingsReport;
  gate: GateReport;
  /** Approved workflow IDs: each is protected unless it is the target. */
  approvedWorkflows?: readonly string[];
  /** R8 properties that must keep holding. */
  properties?: readonly ProductPropertyRef[];
  generatedAt?: string;
}): RecommendationReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const findings = new Map(
    input.findings.findings.map((item) => [item.id, item]),
  );
  const opportunities = new Map(
    input.findings.opportunities.map((item) => [item.id, item]),
  );
  const recommendations: ImprovementRecommendation[] = [];
  const skipped: RecommendationReport["skipped"] = [];
  for (const decision of input.gate.decisions) {
    const opportunity = opportunities.get(decision.opportunityId);
    if (
      !opportunity ||
      (decision.decision !== "recommend" &&
        decision.decision !== "eligible_for_harness")
    ) {
      skipped.push({
        opportunityId: decision.opportunityId,
        decision: decision.decision,
      });
      continue;
    }
    const members = opportunity.findingIds.flatMap((id) => {
      const finding = findings.get(id);
      return finding ? [finding] : [];
    });
    const kinds = new Set(members.map((item) => item.kind));
    const goals = [
      ...new Set(members.flatMap((item) => goalOf(item.target))),
    ].sort(compare);
    const subject = opportunity.subject;
    const regression =
      kinds.has("release_regression") || kinds.has("permission_regression");
    // Lost versus gained access: R11 evidence item IDs say which.
    const gained = members.filter(
      (item) =>
        item.kind === "permission_regression" &&
        item.evidence.items.some((evidence) =>
          evidence.id.startsWith("formal:new:"),
        ),
    );
    const lost = members.filter(
      (item) =>
        (item.kind === "release_regression" ||
          item.kind === "permission_regression") &&
        !gained.includes(item),
    );
    const category: RecommendationCategory = regression
      ? "fix"
      : kinds.has("workflow_friction")
        ? "improve"
        : kinds.has("low_adoption")
          ? "promote"
          : "investigate";
    const required: AcceptanceCheck[] = [];
    const outcome: AcceptanceCheck[] = [];
    let hypothesis: ImprovementHypothesis;
    let desired: MetricGoal[];
    if (category === "fix") {
      for (const item of lost)
        for (const goal of goalOf(item.target))
          required.push({
            kind: "formal-reachable",
            goal,
            ...(item.target.context ? { context: item.target.context } : {}),
          });
      for (const item of gained)
        for (const goal of goalOf(item.target))
          required.push({
            kind: "formal-unreachable",
            goal,
            ...(item.target.context ? { context: item.target.context } : {}),
          });
      desired = [
        ...lost.flatMap((item) =>
          goalOf(item.target).map((goal) => ({
            metric: "goal_reachable",
            direction: "increase" as const,
            on: item.target.context ? `${goal} [${item.target.context}]` : goal,
          })),
        ),
        ...gained.flatMap((item) =>
          goalOf(item.target).map((goal) => ({
            metric: "goal_reachable",
            direction: "decrease" as const,
            on: `${goal} [${item.target.context ?? "any context"}]`,
          })),
        ),
      ];
      hypothesis = {
        statement: `Restoring the behavior ${subject} had before the change resolves the regression${gained.length ? ", unless the new access was intended (confirm first)" : ""}.`,
        mechanism:
          "The regression traces to a specific change (R11 root cause or a removed element); reverting or correcting it restores the previous reachability.",
        expectedEffect: desired,
        confidence: {
          band: "medium",
          meaning: "template-prior-not-probability",
          reason:
            "A regression with a known cause is usually fixed by correcting that cause, but the intended product behavior needs confirmation.",
        },
        falsifiable: true,
      };
    } else if (category === "improve") {
      desired = goals.flatMap((goal) => [
        {
          metric: "workflow_completion_rate",
          direction: "increase" as const,
          on: goal,
        },
        {
          metric: "path_efficiency_ratio",
          direction: "decrease" as const,
          on: goal,
        },
      ]);
      hypothesis = {
        statement: `Removing unnecessary steps or friction points on the way to ${goals.join(", ") || subject} increases completion.`,
        mechanism:
          "Observed sessions take more interactions than the cheapest valid path, or abandon at specific points.",
        expectedEffect: desired,
        confidence: {
          band: "low",
          meaning: "template-prior-not-probability",
          reason:
            "Friction is measured; which change removes it is not, so the intervention needs an experiment.",
        },
        falsifiable: true,
      };
      for (const goal of goals)
        outcome.push({
          kind: "metric",
          goal: {
            metric: "goal_reach_probability",
            direction: "increase",
            on: goal,
          },
          method: `pathcompiler observe check ${goal} --baseline <release-before> --release <release-after>`,
        });
    } else {
      desired = goals.map((goal) => ({
        metric: "goal_reach_probability",
        direction: "increase" as const,
        on: goal,
      }));
      hypothesis = {
        statement: `Eligible users do not discover ${subject}; making it easier to find increases use without hurting completion.`,
        mechanism:
          "The capability is formally reachable for these users but no session reaches it.",
        expectedEffect: [
          ...desired,
          ...goals.map((goal) => ({
            metric: "workflow_completion_rate",
            direction: "hold" as const,
            on: goal,
          })),
        ],
        confidence: {
          band: "low",
          meaning: "template-prior-not-probability",
          reason:
            "Low adoption can also mean low demand; promotion is a hypothesis to test.",
        },
        falsifiable: true,
      };
      for (const goal of goals)
        outcome.push({
          kind: "metric",
          goal: {
            metric: "goal_reach_probability",
            direction: "increase",
            on: goal,
          },
          method: `pathcompiler observe check ${goal} --baseline <release-before> --release <release-after>`,
        });
    }
    const protectedBehaviors: ProtectedBehavior[] = [
      ...(input.properties ?? []).map((property) => ({
        kind: "property" as const,
        property,
      })),
      ...(input.approvedWorkflows ?? [])
        .filter((workflowId) => workflowId !== subject)
        .sort(compare)
        .map((workflowId) => ({
          kind: "approved-workflow" as const,
          workflowId,
          reason: "An approved workflow must keep working.",
        })),
    ];
    for (const property of input.properties ?? [])
      required.push({ kind: "property-holds", propertyId: property.id });
    for (const workflowId of input.approvedWorkflows ?? [])
      required.push({ kind: "workflow-valid", workflowId });
    if ((input.approvedWorkflows ?? []).includes(subject))
      required.push({ kind: "browser-verified", workflowId: subject });
    const strongest = members.reduce(
      (best, item) =>
        item.confidence.confidence.score > best.score
          ? {
              band: item.confidence.confidence.band,
              score: item.confidence.confidence.score,
            }
          : best,
      { band: "low", score: 0 },
    );
    recommendations.push({
      id: `recommendation:${subject}:${category}`,
      findingIds: members.map((item) => item.id),
      opportunityId: opportunity.id,
      category,
      target: { subject, goals },
      problem: {
        summary: members.map((item) => item.summary).join(" "),
        classification: [...kinds].sort(compare),
        evidence: members.map((item) => ({
          findingId: item.id,
          sources: item.evidence.sources,
        })),
      },
      hypothesis,
      desiredOutcomes: desired,
      protectedBehaviors,
      acceptanceCriteria: { required, outcome },
      harnessEligible: decision.decision === "eligible_for_harness",
      priority: opportunity.priority,
      findingConfidence: strongest,
      generatedAt,
      sourceModelVersion: members[0]?.modelVersion ?? "unknown",
    });
  }
  return {
    schemaVersion: 1,
    kind: "recommendations",
    recommendations,
    skipped,
  };
}
