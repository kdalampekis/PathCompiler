import { createHash } from "node:crypto";
import type { CandidateEvaluation } from "@pathcompiler/candidate-evaluator";
import type {
  ImprovementRecommendation,
  MetricGoal,
} from "@pathcompiler/recommendation-engine";
import { z } from "zod";

/**
 * Experiment specification, I5 (reasoning spec §200–§203, §246). An
 * experiment is specified, never deployed: PathCompiler states what to
 * compare, on whom, and what counts as success, and freezes those criteria
 * (with a hash) before any outcome is measured, so they cannot be chosen
 * after looking at the data (§201).
 */
const metric = z.strictObject({
  metric: z.string().min(1),
  direction: z.enum(["increase", "decrease", "hold"]),
  on: z.string().min(1),
});
export const ExperimentSpecSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("experiment-spec"),
  id: z.string().min(1),
  recommendationId: z.string().min(1),
  evaluationId: z.string().min(1),
  mutationId: z.string().min(1).optional(),
  hypothesis: z.string().min(1),
  control: z.strictObject({ release: z.string().min(1) }),
  treatment: z.strictObject({
    release: z.string().min(1),
    commit: z.string().min(1),
  }),
  population: z.strictObject({
    subject: z.string().min(1),
    goals: z.array(z.string().min(1)),
    roles: z.array(z.string().min(1)),
  }),
  allocation: z.strictObject({
    unit: z.literal("session"),
    control: z.number().min(0).max(1),
    treatment: z.number().min(0).max(1),
  }),
  primaryMetric: metric,
  secondaryMetrics: z.array(metric),
  /** Must not get worse beyond `maxDegradation` (absolute share). */
  guardrails: z.array(
    metric.extend({ maxDegradation: z.number().min(0).max(1) }),
  ),
  successCriteria: z.strictObject({
    /** Relative change of the primary metric the treatment must reach. */
    minimumRelativeImprovement: z.number().positive(),
    /** Sessions per arm before anything is concluded. */
    minSessionsPerArm: z.number().int().positive(),
    /** Intervals must not overlap at this level. */
    confidence: z.literal(0.95),
  }),
  stopConditions: z.array(z.string().min(1)),
  deployment: z.literal("not-automated"),
  frozenAt: z.iso.datetime(),
  /** sha256 of the criteria fields, so any later edit is detectable. */
  frozenHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ExperimentSpec = z.infer<typeof ExperimentSpecSchema>;

const CRITERIA = [
  "hypothesis",
  "control",
  "treatment",
  "population",
  "allocation",
  "primaryMetric",
  "secondaryMetrics",
  "guardrails",
  "successCriteria",
  "stopConditions",
] as const;
/** Canonical hash of the fields that must not change after freezing. */
export function criteriaHash(
  spec: Pick<ExperimentSpec, (typeof CRITERIA)[number]>,
): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : value;
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical(Object.fromEntries(CRITERIA.map((key) => [key, spec[key]]))),
      ),
    )
    .digest("hex");
}
/** Parses a spec and refuses one whose criteria changed after freezing. */
export function parseExperimentSpec(input: unknown): ExperimentSpec {
  const spec = ExperimentSpecSchema.parse(input);
  if (criteriaHash(spec) !== spec.frozenHash)
    throw new Error(
      `Experiment ${spec.id} was edited after its criteria were frozen; create a new experiment instead.`,
    );
  return spec;
}

export class ExperimentError extends Error {
  constructor(
    readonly code:
      | "not-behavioral"
      | "evaluation-not-passing"
      | "evaluation-mismatch"
      | "no-metric",
    message: string,
  ) {
    super(message);
  }
}

export function createExperimentSpec(input: {
  recommendation: ImprovementRecommendation;
  evaluation: CandidateEvaluation;
  controlRelease: string;
  treatmentRelease: string;
  roles?: readonly string[];
  minimumRelativeImprovement?: number;
  minSessionsPerArm?: number;
  /** Absolute share a guardrail may worsen. Default 0.02. */
  maxDegradation?: number;
  frozenAt?: string;
}): ExperimentSpec {
  const { recommendation, evaluation } = input;
  if (
    recommendation.category !== "improve" &&
    recommendation.category !== "promote"
  )
    throw new ExperimentError(
      "not-behavioral",
      `${recommendation.id} is a ${recommendation.category} recommendation; it is validated by its acceptance checks, not an experiment.`,
    );
  if (
    evaluation.status !== "pass" &&
    evaluation.status !== "pass_with_warnings"
  )
    throw new ExperimentError(
      "evaluation-not-passing",
      `Candidate ${evaluation.candidate.slice(0, 12)} evaluated ${evaluation.status}; only a passing candidate may be experimented on.`,
    );
  if (
    evaluation.recommendationId !== undefined &&
    evaluation.recommendationId !== recommendation.id
  )
    throw new ExperimentError(
      "evaluation-mismatch",
      `Evaluation ${evaluation.id} is for ${evaluation.recommendationId}, not ${recommendation.id}.`,
    );
  const [primary, ...secondary] = recommendation.desiredOutcomes.filter(
    (item) => item.direction !== "hold",
  );
  if (!primary)
    throw new ExperimentError(
      "no-metric",
      `${recommendation.id} has no desired outcome to measure.`,
    );
  const maxDegradation = input.maxDegradation ?? 0.02;
  const guardrails: (MetricGoal & { maxDegradation: number })[] = [
    // Held metrics from the hypothesis, then the protected workflows.
    ...recommendation.hypothesis.expectedEffect
      .filter((item) => item.direction === "hold")
      .map((item) => ({ ...item, maxDegradation })),
    ...recommendation.protectedBehaviors.flatMap((item) =>
      item.kind === "approved-workflow"
        ? [
            {
              metric: "workflow_completion_rate",
              direction: "hold" as const,
              on: item.workflowId,
              maxDegradation,
            },
          ]
        : [],
    ),
    {
      metric: "unexpected_observed_rate",
      direction: "hold" as const,
      on: recommendation.target.subject,
      maxDegradation: 0,
    },
  ];
  const criteria = {
    hypothesis: recommendation.hypothesis.statement,
    control: { release: input.controlRelease },
    treatment: {
      release: input.treatmentRelease,
      commit: evaluation.candidate,
    },
    population: {
      subject: recommendation.target.subject,
      goals: recommendation.target.goals,
      roles: [...(input.roles ?? [])].sort(),
    },
    allocation: { unit: "session" as const, control: 0.5, treatment: 0.5 },
    primaryMetric: primary,
    secondaryMetrics: secondary,
    guardrails,
    successCriteria: {
      minimumRelativeImprovement: input.minimumRelativeImprovement ?? 0.1,
      minSessionsPerArm: input.minSessionsPerArm ?? 30,
      confidence: 0.95 as const,
    },
    stopConditions: [
      "Any guardrail worsens beyond its maximum degradation.",
      "A formal/runtime discrepancy is observed in the treatment.",
    ],
  };
  return ExperimentSpecSchema.parse({
    schemaVersion: 1,
    kind: "experiment-spec",
    id: `experiment:${recommendation.id}:${evaluation.candidate.slice(0, 12)}`,
    recommendationId: recommendation.id,
    evaluationId: evaluation.id,
    ...(evaluation.mutationId ? { mutationId: evaluation.mutationId } : {}),
    ...criteria,
    deployment: "not-automated",
    frozenAt: input.frozenAt ?? new Date().toISOString(),
    frozenHash: criteriaHash(criteria),
  });
}
