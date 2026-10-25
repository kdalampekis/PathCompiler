import type { PathCompilerConfig } from "@pathcompiler/config";
import type {
  FindingKind,
  FindingsReport,
  ImprovementOpportunity,
} from "@pathcompiler/findings";

/**
 * Improvement gate, IG (ADR 0033 §4–§7). Each opportunity passes four
 * questions in order:
 * 1. Is the evidence sufficient? If not, collect more data.
 * 2. Is the impact meaningful? If not, log only, or no change.
 * 3. Is a recommendation actionable? If not, surface the finding.
 * 4. Is autonomous implementation enabled? If not, recommend to a human.
 *
 * Budgets cap the decisions per run. Every decision carries its Improvement
 * Value Assessment and the rationale of each step. With
 * `autonomous_mutation: false` nothing is ever eligible for the harness.
 */
export type ImprovementPolicy = PathCompilerConfig["improvement_policy"];
export type GateDecisionKind =
  | "collect_more_data"
  | "log_only"
  | "surface_finding"
  | "recommend"
  | "eligible_for_harness"
  | "no_change";
export type ValueComponent = {
  name:
    | "impact"
    | "affected_users"
    | "eligible_users"
    | "confidence"
    | "expected_gain"
    | "estimated_cost";
  /** Null when there is no data for it. */
  value: number | null;
  reason: string;
};
export type ImprovementValueAssessment = {
  components: ValueComponent[];
  /** Derived from the visible components; ordering only. */
  value: number | null;
  valueMeaning: "ordering-not-probability";
};
export type GateDecision = {
  opportunityId: string;
  subject: string;
  decision: GateDecisionKind;
  /** One line per question asked, in order, ending with the deciding one. */
  rationale: string[];
  assessment: ImprovementValueAssessment;
};
export type SubjectUsage = {
  /** Users (sessions) who used or attempted the subject. */
  affected?: number;
  /** Users (sessions) who could use it. */
  eligible?: number;
  /** Completion rate of those who started it (O7). */
  completionRate?: number | null;
};
export type GateReport = {
  schemaVersion: 1;
  kind: "gate-decisions";
  policy: ImprovementPolicy;
  decisions: GateDecision[];
  budgets: {
    recommendations: { used: number; max: number };
    autonomousMutations: { used: number; max: number };
  };
};

/** Kinds I1 has templates for; others are surfaced for investigation. */
const ACTIONABLE = new Set<FindingKind>([
  "release_regression",
  "permission_regression",
  "workflow_friction",
  "low_adoption",
]);
const REGRESSIONS = new Set<FindingKind>([
  "release_regression",
  "permission_regression",
]);
const SEVERITY = {
  info: 0.1,
  low: 0.3,
  medium: 0.5,
  high: 0.8,
  critical: 1,
} as const;

export function gateFindings(
  report: FindingsReport,
  policy: ImprovementPolicy,
  options: {
    usage?: Readonly<Record<string, SubjectUsage>>;
    /** Recommendations already made this period (counts against the budget). */
    recommendedThisPeriod?: number;
    autonomousMutationsThisPeriod?: number;
  } = {},
): GateReport {
  const findings = new Map(report.findings.map((item) => [item.id, item]));
  let recommended = options.recommendedThisPeriod ?? 0;
  let mutations = options.autonomousMutationsThisPeriod ?? 0;
  // Highest priority first, so budgets go to what matters most.
  const ordered = [...report.opportunities].sort(
    (a, b) => b.priority.score - a.priority.score || (a.id < b.id ? -1 : 1),
  );
  const decide = (opportunity: ImprovementOpportunity): GateDecision => {
    const members = opportunity.findingIds.flatMap((id) => {
      const finding = findings.get(id);
      return finding ? [finding] : [];
    });
    const usage = options.usage?.[opportunity.subject] ?? {};
    const severity = Math.max(
      0,
      ...members.map((item) => SEVERITY[item.severity] ?? 0),
    );
    const confidence = Math.max(
      0,
      ...members.map((item) => item.confidence.confidence.score),
    );
    const regression = members.some((item) => REGRESSIONS.has(item.kind));
    const share =
      usage.affected !== undefined && usage.eligible
        ? Math.min(1, usage.affected / usage.eligible)
        : null;
    // Expected gain: the share of eligible users a fix or improvement could
    // reach. Unknown without usage data.
    const gain = share;
    const components: ValueComponent[] = [
      {
        name: "impact",
        value: severity,
        reason: `Worst finding severity (${members.map((item) => item.severity).join(", ")}).`,
      },
      {
        name: "affected_users",
        value: usage.affected ?? null,
        reason:
          usage.affected === undefined
            ? "No usage telemetry for this subject."
            : "Observed sessions that used or attempted it.",
      },
      {
        name: "eligible_users",
        value: usage.eligible ?? null,
        reason:
          usage.eligible === undefined
            ? "No usage telemetry."
            : "Observed sessions overall.",
      },
      {
        name: "confidence",
        value: confidence,
        reason:
          "Strongest finding confidence (rule strength, not probability).",
      },
      {
        name: "expected_gain",
        value: gain,
        reason:
          gain === null
            ? "Unknown without usage data."
            : "Share of eligible users affected (an upper bound on the gain).",
      },
      {
        name: "estimated_cost",
        value: null,
        reason: "Not estimated before a recommendation exists (I1).",
      },
    ];
    const known = [severity, confidence, ...(gain === null ? [] : [gain])];
    const assessment: ImprovementValueAssessment = {
      components,
      value:
        Math.round(known.reduce((product, item) => product * item, 1) * 1000) /
        1000,
      valueMeaning: "ordering-not-probability",
    };
    const rationale: string[] = [];
    const result = (decision: GateDecisionKind): GateDecision => ({
      opportunityId: opportunity.id,
      subject: opportunity.subject,
      decision,
      rationale,
      assessment,
    });

    // 1. Evidence.
    if (confidence < policy.min_confidence) {
      rationale.push(
        `Evidence: confidence ${confidence} is below min_confidence ${policy.min_confidence}. Collect more data, for example browser verification or tests, which corroborate formal and static evidence.`,
      );
      return result("collect_more_data");
    }
    rationale.push(
      `Evidence: confidence ${confidence} meets min_confidence ${policy.min_confidence}.`,
    );

    // 2. Impact. A niche feature that works for those who use it is fine.
    const lowAdoptionOnly = members.every(
      (item) => item.kind === "low_adoption",
    );
    if (
      lowAdoptionOnly &&
      typeof usage.completionRate === "number" &&
      usage.completionRate >= 0.8
    ) {
      rationale.push(
        `Impact: low adoption, but ${Math.round(usage.completionRate * 100)}% of those who start it complete it; consistent with a niche feature. No change.`,
      );
      return result("no_change");
    }
    if (usage.affected === undefined) {
      if (!(regression && severity >= SEVERITY.high)) {
        rationale.push(
          "Impact: no usage telemetry, and not a high-severity regression; log only.",
        );
        return result("log_only");
      }
      rationale.push(
        "Impact: no usage telemetry, but a high-severity regression is meaningful by itself.",
      );
    } else if (
      usage.affected < policy.min_affected_users ||
      (gain !== null && gain < policy.min_expected_gain)
    ) {
      rationale.push(
        `Impact: ${usage.affected} affected users (min_affected_users ${policy.min_affected_users}), expected gain ${gain ?? "unknown"} (min_expected_gain ${policy.min_expected_gain}); log only.`,
      );
      return result("log_only");
    } else
      rationale.push(
        `Impact: ${usage.affected} affected users and expected gain ${gain ?? "unknown"} meet the policy.`,
      );

    // 3. Actionable.
    if (!members.some((item) => ACTIONABLE.has(item.kind))) {
      rationale.push(
        `Actionable: no recommendation template for ${opportunity.kinds.join(", ")}; surface the finding for investigation.`,
      );
      return result("surface_finding");
    }
    if (recommended >= policy.max_recommendations_per_period) {
      rationale.push(
        `Budget: ${recommended} of ${policy.max_recommendations_per_period} recommendations already used this period; surface the finding instead.`,
      );
      return result("surface_finding");
    }
    rationale.push("Actionable: a recommendation template applies.");

    // 4. Autonomy.
    if (
      policy.autonomous_mutation &&
      mutations < policy.max_autonomous_mutations
    ) {
      mutations += 1;
      recommended += 1;
      rationale.push(
        "Autonomy: autonomous_mutation is enabled and within budget; eligible for a harness task (still human-approved before adoption).",
      );
      return result("eligible_for_harness");
    }
    recommended += 1;
    rationale.push(
      policy.autonomous_mutation
        ? `Autonomy: the autonomous mutation budget (${policy.max_autonomous_mutations}) is used; recommend to a human.`
        : "Autonomy: autonomous_mutation is false; recommend to a human.",
    );
    return result("recommend");
  };
  const decisions = ordered.map(decide);
  return {
    schemaVersion: 1,
    kind: "gate-decisions",
    policy,
    decisions,
    budgets: {
      recommendations: {
        used: recommended,
        max: policy.max_recommendations_per_period,
      },
      autonomousMutations: {
        used: mutations,
        max: policy.max_autonomous_mutations,
      },
    },
  };
}
