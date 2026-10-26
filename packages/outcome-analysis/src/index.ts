import {
  type ExperimentSpec,
  parseExperimentSpec,
} from "@pathcompiler/experiment-core";
import type { ProductRuntimeEvent } from "@pathcompiler/observability-core";
import { wilsonInterval } from "@pathcompiler/observed-graph";

/**
 * Outcome measurement, I6 (reasoning spec §206–§210, §247). A frozen
 * experiment spec is measured on stored events: the control release against
 * the treatment release (concurrent arms or before/after, which events do
 * not distinguish). Success follows the frozen criteria only, and formal
 * success (the candidate evaluation) is reported apart from behavioral
 * success: a formally simpler workflow that users complete less often is
 * not an improvement (§210).
 */
export type ArmMeasurement = {
  sessions: number;
  successes: number;
  value: number;
  interval: [number, number];
};
export type MetricComparison = {
  metric: string;
  on: string;
  direction: "increase" | "decrease" | "hold";
  /** How it was measured, or why not. */
  method: "goal-reach-share" | "guide-completion-rate" | "not-measured";
  control: ArmMeasurement | null;
  treatment: ArmMeasurement | null;
  /** (treatment − control) ÷ control; null when either is missing or zero. */
  relativeChange: number | null;
  /** The 95% intervals do not overlap. */
  significant: boolean;
  /** Both arms reached `minSessionsPerArm`. */
  sufficient: boolean;
};
export type GuardrailAssessment = MetricComparison & {
  maxDegradation: number;
  /** Worse by more than `maxDegradation`, beyond the intervals. */
  breached: boolean;
};
export type OutcomeAssessment = {
  schemaVersion: 1;
  kind: "outcome-assessment";
  id: string;
  experimentId: string;
  recommendationId: string;
  mutationId?: string;
  design: "release-comparison";
  primaryMetric: MetricComparison;
  secondaryMetrics: MetricComparison[];
  guardrails: GuardrailAssessment[];
  outcome: "improved" | "neutral" | "worse" | "inconclusive";
  rationale: string;
  /** The candidate evaluation (formal), kept apart from behavior. */
  formal: { evaluationId: string; status: string | null };
  evidenceGaps: string[];
};

const round = (value: number) => Math.round(value * 10_000) / 10_000;

export function measureOutcome(input: {
  spec: unknown;
  events: readonly ProductRuntimeEvent[];
  /** Status of the candidate evaluation the spec references, if known. */
  evaluationStatus?: string;
}): OutcomeAssessment {
  const spec: ExperimentSpec = parseExperimentSpec(input.spec);
  const roles = new Set(spec.population.roles);
  // One record per session in each arm, with the goals it reached and the
  // guided workflows it started and completed.
  type Session = {
    release?: string | undefined;
    role?: string | undefined;
    goals: Set<string>;
    started: Set<string>;
    completed: Set<string>;
  };
  const sessions = new Map<string, Session>();
  for (const event of input.events) {
    const key = `${event.projectId}\u0000${event.sessionId}`;
    const entry = sessions.get(key) ?? {
      goals: new Set<string>(),
      started: new Set<string>(),
      completed: new Set<string>(),
    };
    entry.release ??= event.release;
    entry.role ??= event.role;
    if (event.type === "goal.reached") entry.goals.add(event.goalId);
    if (event.type === "workflow.started") entry.started.add(event.workflowId);
    if (event.type === "workflow.completed")
      entry.completed.add(event.workflowId);
    sessions.set(key, entry);
  }
  const arm = (release: string) =>
    [...sessions.values()].filter(
      (entry) =>
        entry.release === release &&
        (roles.size === 0 ||
          (entry.role !== undefined && roles.has(entry.role))),
    );
  const control = arm(spec.control.release);
  const treatment = arm(spec.treatment.release);
  const minimum = spec.successCriteria.minSessionsPerArm;
  const gaps: string[] = [];

  const measure = (goal: {
    metric: string;
    on: string;
    direction: MetricComparison["direction"];
  }): MetricComparison => {
    const goalObserved = [...control, ...treatment].some((entry) =>
      entry.goals.has(goal.on),
    );
    const guided = [...control, ...treatment].some((entry) =>
      entry.started.has(goal.on),
    );
    const supported = [
      "workflow_completion_rate",
      "goal_reach_probability",
      "goal_reach_share",
    ].includes(goal.metric);
    const method: MetricComparison["method"] = !supported
      ? "not-measured"
      : guided
        ? "guide-completion-rate"
        : goalObserved
          ? "goal-reach-share"
          : "not-measured";
    if (method === "not-measured") {
      gaps.push(
        supported
          ? `${goal.metric} on ${goal.on}: no session in either arm started or reached it.`
          : `${goal.metric} on ${goal.on} is not measurable from events alone.`,
      );
      return {
        ...goal,
        method,
        control: null,
        treatment: null,
        relativeChange: null,
        significant: false,
        sufficient: false,
      };
    }
    const of = (list: Session[]): ArmMeasurement => {
      const population =
        method === "guide-completion-rate"
          ? list.filter((entry) => entry.started.has(goal.on))
          : list;
      const successes = population.filter((entry) =>
        method === "guide-completion-rate"
          ? entry.completed.has(goal.on)
          : entry.goals.has(goal.on),
      ).length;
      return {
        sessions: population.length,
        successes,
        value: population.length ? round(successes / population.length) : 0,
        interval: wilsonInterval(successes, population.length),
      };
    };
    const before = of(control);
    const after = of(treatment);
    return {
      ...goal,
      method,
      control: before,
      treatment: after,
      relativeChange:
        before.value === 0
          ? null
          : round((after.value - before.value) / before.value),
      significant:
        after.interval[0] > before.interval[1] ||
        after.interval[1] < before.interval[0],
      sufficient: before.sessions >= minimum && after.sessions >= minimum,
    };
  };

  const primary = measure(spec.primaryMetric);
  const secondary = spec.secondaryMetrics.map(measure);
  const guardrails: GuardrailAssessment[] = spec.guardrails.map((item) => {
    const comparison = measure(item);
    const worse =
      comparison.control && comparison.treatment
        ? comparison.control.value - comparison.treatment.value
        : 0;
    return {
      ...comparison,
      maxDegradation: item.maxDegradation,
      breached:
        comparison.sufficient &&
        comparison.significant &&
        worse > item.maxDegradation,
    };
  });

  const better =
    primary.direction === "decrease"
      ? (primary.relativeChange ?? 0) < 0
      : (primary.relativeChange ?? 0) > 0;
  const magnitude = Math.abs(primary.relativeChange ?? 0);
  const breached = guardrails.filter((item) => item.breached);
  const [outcome, rationale]: [OutcomeAssessment["outcome"], string] =
    breached.length > 0
      ? [
          "worse",
          `Guardrails breached: ${breached.map((item) => `${item.metric} on ${item.on}`).join(", ")}.`,
        ]
      : primary.method === "not-measured"
        ? ["inconclusive", "The primary metric could not be measured."]
        : !primary.sufficient
          ? [
              "inconclusive",
              `Fewer than ${minimum} sessions in an arm (control ${primary.control?.sessions ?? 0}, treatment ${primary.treatment?.sessions ?? 0}).`,
            ]
          : primary.significant && !better
            ? [
                "worse",
                "The primary metric moved significantly in the wrong direction.",
              ]
            : primary.significant &&
                magnitude >= spec.successCriteria.minimumRelativeImprovement
              ? [
                  "improved",
                  `The primary metric improved by ${round(magnitude * 100)}% relative (criterion ${spec.successCriteria.minimumRelativeImprovement * 100}%), beyond the intervals, and no guardrail was breached.`,
                ]
              : magnitude < spec.successCriteria.minimumRelativeImprovement
                ? [
                    "neutral",
                    `The change (${round(magnitude * 100)}% relative) is below the frozen criterion of ${spec.successCriteria.minimumRelativeImprovement * 100}%.`,
                  ]
                : [
                    "inconclusive",
                    "The point change is large, but the intervals overlap; collect more sessions.",
                  ];
  if (input.evaluationStatus === undefined)
    gaps.push("The candidate evaluation status was not supplied.");
  return {
    schemaVersion: 1,
    kind: "outcome-assessment",
    id: `outcome:${spec.id}`,
    experimentId: spec.id,
    recommendationId: spec.recommendationId,
    ...(spec.mutationId ? { mutationId: spec.mutationId } : {}),
    design: "release-comparison",
    primaryMetric: primary,
    secondaryMetrics: secondary,
    guardrails,
    outcome,
    rationale,
    formal: {
      evaluationId: spec.evaluationId,
      status: input.evaluationStatus ?? null,
    },
    evidenceGaps: gaps,
  };
}

/**
 * Adoption decision, I7 (reasoning spec §211–§213, §248, §253). The
 * decision is a recommendation to a human, never an action: it stays
 * `pending` until someone approves or declines it.
 */
export type AdoptionChoice =
  | "adopt"
  | "reject"
  | "rollback"
  | "iterate"
  | "extend_experiment"
  | "inconclusive";
export type AdoptionDecision = {
  schemaVersion: 1;
  kind: "adoption-decision";
  id: string;
  recommendationId: string;
  experimentId: string;
  evaluationId: string;
  outcomeId: string;
  mutationId?: string;
  decision: AdoptionChoice;
  /** What the evidence says about the recommendation's hypothesis. */
  hypothesis: "supported" | "rejected" | "not-supported" | "untested";
  /** Other reasonable choices a reviewer may prefer. */
  alternatives: AdoptionChoice[];
  reasons: string[];
  humanApprovalRequired: true;
  approval:
    | { status: "pending" }
    | {
        status: "approved" | "declined";
        decidedBy: string;
        decidedAt: string;
        note?: string;
      };
};

export function decideAdoption(outcome: OutcomeAssessment): AdoptionDecision {
  const formal = outcome.formal.status;
  const breached = outcome.guardrails.filter((item) => item.breached);
  const reasons: string[] = [];
  let decision: AdoptionChoice;
  let hypothesis: AdoptionDecision["hypothesis"];
  let alternatives: AdoptionChoice[] = [];
  if (formal === "fail") {
    decision = "reject";
    hypothesis = "untested";
    reasons.push(
      "The candidate failed its independent evaluation; behavior does not matter for an invalid candidate.",
    );
  } else if (outcome.outcome === "worse") {
    // The treatment was exposed to users and made things worse (§253).
    decision = "rollback";
    hypothesis = "rejected";
    alternatives = ["iterate"];
    reasons.push(
      breached.length
        ? `Guardrails breached: ${breached.map((item) => `${item.metric} on ${item.on}`).join(", ")}.`
        : `${outcome.primaryMetric.metric} on ${outcome.primaryMetric.on} got worse beyond the intervals.`,
      "The hypothesis is rejected by observed behavior, whatever the formal result.",
    );
  } else if (outcome.outcome === "improved") {
    if (formal === "pass" || formal === "pass_with_warnings") {
      decision = "adopt";
      hypothesis = "supported";
      reasons.push(
        outcome.rationale,
        `The candidate evaluation passed${formal === "pass_with_warnings" ? " with warnings; review them before adopting" : ""}.`,
      );
    } else {
      decision = "inconclusive";
      hypothesis = "supported";
      alternatives = ["adopt"];
      reasons.push(
        outcome.rationale,
        "The candidate evaluation is missing or not passing; adopt only after it passes.",
      );
    }
  } else if (outcome.outcome === "neutral") {
    decision = "iterate";
    hypothesis = "not-supported";
    alternatives = ["reject"];
    reasons.push(
      outcome.rationale,
      "The change does not help enough; try a different intervention or drop it.",
    );
  } else if (
    outcome.primaryMetric.method !== "not-measured" &&
    !outcome.primaryMetric.sufficient
  ) {
    decision = "extend_experiment";
    hypothesis = "untested";
    reasons.push(
      outcome.rationale,
      "Keep the experiment running until both arms have enough sessions.",
    );
  } else if (outcome.primaryMetric.method !== "not-measured") {
    decision = "extend_experiment";
    hypothesis = "untested";
    alternatives = ["inconclusive"];
    reasons.push(outcome.rationale);
  } else {
    decision = "inconclusive";
    hypothesis = "untested";
    reasons.push(outcome.rationale, ...outcome.evidenceGaps);
  }
  return {
    schemaVersion: 1,
    kind: "adoption-decision",
    id: `decision:${outcome.experimentId}`,
    recommendationId: outcome.recommendationId,
    experimentId: outcome.experimentId,
    evaluationId: outcome.formal.evaluationId,
    outcomeId: outcome.id,
    ...(outcome.mutationId ? { mutationId: outcome.mutationId } : {}),
    decision,
    hypothesis,
    alternatives,
    reasons,
    humanApprovalRequired: true,
    approval: { status: "pending" },
  };
}

/** Records a human's approval or refusal; a decided record is never re-decided. */
export function recordApproval(
  decision: AdoptionDecision,
  input: {
    approved: boolean;
    decidedBy: string;
    decidedAt: string;
    note?: string;
  },
): AdoptionDecision {
  if (decision.approval.status !== "pending")
    throw new Error(
      `${decision.id} was already ${decision.approval.status} by ${decision.approval.decidedBy}.`,
    );
  return {
    ...decision,
    approval: {
      status: input.approved ? "approved" : "declined",
      decidedBy: input.decidedBy,
      decidedAt: input.decidedAt,
      ...(input.note ? { note: input.note } : {}),
    },
  };
}
