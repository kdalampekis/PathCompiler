import type { ExperimentSpec } from "@pathcompiler/experiment-core";
import type {
  AdoptionDecision,
  OutcomeAssessment,
} from "@pathcompiler/outcome-analysis";
import type {
  ImprovementRecommendation,
  RecommendationCategory,
} from "@pathcompiler/recommendation-engine";
import { z } from "zod";

/**
 * Improvement memory, I8 (reasoning spec §214–§216, §249). Each improvement
 * lifecycle is one record linking finding → recommendation → evaluation →
 * experiment → outcome → decision, with deterministic lessons. Past records
 * inform the ranking of new recommendations for the same subject and
 * category, as one observation each: never a universal law, and nothing is
 * trained or fine-tuned.
 */
export const ImprovementLessonSchema = z.strictObject({
  subject: z.string().min(1),
  category: z.string().min(1),
  verdict: z.enum(["supported", "rejected", "not-supported"]),
  statement: z.string().min(1),
  /** Lessons generalize only to this subject and category, from one observation. */
  scope: z.literal("same-subject-and-category"),
});
export const ImprovementMemoryRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("improvement-memory"),
  id: z.string().min(1),
  target: z.strictObject({
    subject: z.string().min(1),
    goals: z.array(z.string()),
  }),
  category: z.string().min(1),
  findingIds: z.array(z.string()),
  recommendationId: z.string().min(1),
  mutationId: z.string().optional(),
  evaluationId: z.string().optional(),
  experimentId: z.string().optional(),
  outcomeId: z.string().optional(),
  decisionId: z.string().optional(),
  hypothesisSummary: z.string().min(1),
  interventionSummary: z.string().optional(),
  outcomeSummary: z.string().optional(),
  decision: z.string().optional(),
  approval: z.enum(["pending", "approved", "declined"]).optional(),
  reusableLessons: z.array(ImprovementLessonSchema),
  createdAt: z.iso.datetime(),
  /** Set once a human approved or declined the decision. */
  closedAt: z.iso.datetime().optional(),
});
export type ImprovementLesson = z.infer<typeof ImprovementLessonSchema>;
export type ImprovementMemoryRecord = z.infer<
  typeof ImprovementMemoryRecordSchema
>;

export function buildMemoryRecord(input: {
  recommendation: ImprovementRecommendation;
  experiment?: ExperimentSpec;
  outcome?: OutcomeAssessment;
  decision?: AdoptionDecision;
  createdAt?: string;
}): ImprovementMemoryRecord {
  const { recommendation, experiment, outcome, decision } = input;
  for (const [name, id] of [
    ["experiment", experiment?.recommendationId],
    ["outcome", outcome?.recommendationId],
    ["decision", decision?.recommendationId],
  ] as const)
    if (id !== undefined && id !== recommendation.id)
      throw new Error(
        `The ${name} belongs to ${id}, not ${recommendation.id}; records link one lifecycle only.`,
      );
  const lessons: ImprovementLesson[] = [];
  const verdict =
    decision?.hypothesis === "supported" ||
    decision?.hypothesis === "rejected" ||
    decision?.hypothesis === "not-supported"
      ? decision.hypothesis
      : undefined;
  // Only a human-confirmed decision teaches anything.
  if (verdict && decision?.approval.status === "approved")
    lessons.push({
      subject: recommendation.target.subject,
      category: recommendation.category,
      verdict,
      statement:
        verdict === "supported"
          ? `"${recommendation.hypothesis.statement}" was supported: ${outcome?.rationale ?? "the outcome improved"}`
          : verdict === "rejected"
            ? `"${recommendation.hypothesis.statement}" was rejected: ${outcome?.rationale ?? "the outcome got worse"} The intervention may remove something users rely on here.`
            : `"${recommendation.hypothesis.statement}" was not supported: ${outcome?.rationale ?? "no meaningful change"}`,
      scope: "same-subject-and-category",
    });
  const closed =
    decision && decision.approval.status !== "pending"
      ? decision.approval.decidedAt
      : undefined;
  return ImprovementMemoryRecordSchema.parse({
    schemaVersion: 1,
    kind: "improvement-memory",
    id: `memory:${recommendation.id}`,
    target: recommendation.target,
    category: recommendation.category,
    findingIds: recommendation.findingIds,
    recommendationId: recommendation.id,
    ...(experiment?.mutationId ? { mutationId: experiment.mutationId } : {}),
    ...(experiment
      ? { evaluationId: experiment.evaluationId, experimentId: experiment.id }
      : {}),
    ...(outcome
      ? {
          outcomeId: outcome.id,
          outcomeSummary: `${outcome.outcome}: ${outcome.rationale}`,
        }
      : {}),
    ...(decision
      ? {
          decisionId: decision.id,
          decision: decision.decision,
          approval: decision.approval.status,
        }
      : {}),
    hypothesisSummary: recommendation.hypothesis.statement,
    ...(experiment
      ? {
          interventionSummary: `Treatment ${experiment.treatment.release} (${experiment.treatment.commit.slice(0, 12)}) against ${experiment.control.release}.`,
        }
      : {}),
    reusableLessons: lessons,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(closed ? { closedAt: closed } : {}),
  });
}

export type HistoryFactor = {
  value: number;
  reason: string;
  /** Memory records the factor is based on. */
  basedOn: string[];
};
/**
 * How past lessons for the same subject and category weigh on a new
 * recommendation: a rejected hypothesis halves its priority, a supported one
 * keeps it, and no history is neutral. Several observations do not compound
 * beyond that, since each is one experiment.
 */
export function historyFactor(
  recommendation: {
    target: { subject: string };
    category: RecommendationCategory;
  },
  records: readonly ImprovementMemoryRecord[],
): HistoryFactor {
  const relevant = records.filter((record) =>
    record.reusableLessons.some(
      (lesson) =>
        lesson.subject === recommendation.target.subject &&
        lesson.category === recommendation.category,
    ),
  );
  const lessons = relevant.flatMap((record) =>
    record.reusableLessons.filter(
      (lesson) =>
        lesson.subject === recommendation.target.subject &&
        lesson.category === recommendation.category,
    ),
  );
  const basedOn = relevant.map((record) => record.id).sort();
  const rejected = lessons.filter(
    (lesson) => lesson.verdict === "rejected",
  ).length;
  const supported = lessons.filter(
    (lesson) => lesson.verdict === "supported",
  ).length;
  if (lessons.length === 0)
    return {
      value: 1,
      reason: "No earlier experiment for this subject and category.",
      basedOn,
    };
  if (rejected > supported)
    return {
      value: 0.5,
      reason: `${rejected} earlier ${recommendation.category} experiment(s) for ${recommendation.target.subject} rejected the hypothesis; review that history before repeating it (one observation each, not a rule).`,
      basedOn,
    };
  return {
    value: 1,
    reason: `Earlier ${recommendation.category} experiments for ${recommendation.target.subject}: ${supported} supported, ${rejected} rejected.`,
    basedOn,
  };
}

/** Adds the history factor to each recommendation's priority and re-sorts. */
export function rankWithMemory<T extends ImprovementRecommendation>(
  recommendations: readonly T[],
  records: readonly ImprovementMemoryRecord[],
): (T & { history: HistoryFactor })[] {
  return recommendations
    .map((item) => {
      const history = historyFactor(item, records);
      const score =
        Math.round(item.priority.score * history.value * 1000) / 1000;
      return {
        ...item,
        history,
        priority: {
          ...item.priority,
          score,
          components: [
            ...item.priority.components,
            { name: "history", value: history.value, reason: history.reason },
          ],
        },
      };
    })
    .sort(
      (a, b) => b.priority.score - a.priority.score || (a.id < b.id ? -1 : 1),
    );
}
