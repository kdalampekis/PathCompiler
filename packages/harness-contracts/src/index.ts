import type { GateDecision } from "@pathcompiler/improvement-gate";
import type { ImprovementRecommendation } from "@pathcompiler/recommendation-engine";
import { z } from "zod";

/**
 * Harness contract, I2 (harness handoff §7–§16, §57–§59; mode 6 only). The
 * provider-neutral handoff between PathCompiler and an external coding
 * harness: a `HarnessTaskSpec` goes out, a `MutationResult` comes back.
 * Both are versioned (major.minor), validated strictly (unknown fields are
 * rejected, never interpreted) and keep lineage IDs. The harness never
 * grades itself: its claims are inputs to independent evaluation (I3).
 */
export const CONTRACT_VERSION = "1.0";
const SUPPORTED_MAJOR = 1;
const version = z
  .string()
  .regex(/^\d+\.\d+$/, "Expected a major.minor schema version")
  .refine(
    (value) => Number(value.split(".")[0]) === SUPPORTED_MAJOR,
    `Unsupported major version; this PathCompiler reads ${SUPPORTED_MAJOR}.x`,
  );
const text = z.string().min(1);
const sha = z.string().regex(/^[a-f0-9]{7,64}$/, "Expected a commit SHA");
export const SemanticChangeIntentSchema = z.strictObject({
  kind: z.enum([
    "restore-reachability",
    "remove-reachability",
    "reduce-workflow-cost",
    "increase-discoverability",
  ]),
  goal: text.optional(),
  workflow: text.optional(),
  /** e.g. "role=editor". */
  context: text.optional(),
});
const propertyRef = z.strictObject({
  id: text,
  kind: text,
  description: z.string().optional(),
});
const check = z.looseObject({ kind: text });
export const HarnessTaskSpecSchema = z.strictObject({
  schemaVersion: version,
  id: text,
  recommendationId: text,
  findingIds: z.array(text),
  repository: z.strictObject({
    projectId: text,
    baseCommit: sha,
    targetBranch: text.optional(),
  }),
  objective: z.strictObject({
    summary: text,
    target: z.strictObject({ subject: text, goals: z.array(text) }),
    desiredSemanticChange: z.array(SemanticChangeIntentSchema),
  }),
  rationale: z.strictObject({
    findingSummary: text,
    /** Where the evidence came from (report entries), never the reports themselves. */
    evidence: z.array(
      z.strictObject({
        findingId: text,
        sources: z.array(z.strictObject({ report: text, entry: text })),
      }),
    ),
    hypothesis: z.strictObject({
      statement: text,
      confidence: z.enum(["high", "medium", "low"]),
    }),
  }),
  constraints: z.strictObject({
    hard: z.array(text),
    protectedBehaviors: z.array(propertyRef),
    prohibitedSemanticChanges: z.array(SemanticChangeIntentSchema),
  }),
  acceptanceCriteria: z.strictObject({
    required: z.array(check),
    outcome: z.array(check),
  }),
  relevantContext: z.strictObject({
    workflowIds: z.array(text),
    capabilityIds: z.array(text),
    semanticTargets: z.array(text),
  }),
  requestedArtifacts: z.array(
    z.enum([
      "candidate_commit",
      "implementation_summary",
      "changed_files",
      "claimed_semantic_changes",
      "tests_added_or_changed",
      "assumptions",
      "unresolved_questions",
      "preview_instructions",
    ]),
  ),
  outputContract: z.strictObject({
    artifact: z.literal("MutationResult"),
    schemaVersion: version,
  }),
});
export type HarnessTaskSpec = z.infer<typeof HarnessTaskSpecSchema>;
export type SemanticChangeIntent = z.infer<typeof SemanticChangeIntentSchema>;

export const MutationResultSchema = z.strictObject({
  schemaVersion: version,
  id: text,
  harnessTaskId: text,
  recommendationId: text,
  repository: z.strictObject({
    baseCommit: sha,
    /** Absent when no candidate was produced (blocked or failed). */
    candidateCommit: sha.optional(),
    branch: text.optional(),
    pullRequest: text.optional(),
  }),
  status: z.enum(["completed", "partial", "blocked", "failed"]),
  changedFiles: z.array(text),
  implementationSummary: text,
  claimedSemanticChanges: z.array(
    z.strictObject({
      workflow: text.optional(),
      goal: text.optional(),
      kind: text.optional(),
      property: text.optional(),
      claimedStatus: z
        .enum(["preserved", "changed", "added", "removed"])
        .optional(),
    }),
  ),
  testsAddedOrChanged: z.array(text),
  assumptions: z.array(text),
  unresolvedQuestions: z.array(text),
  artifacts: z.array(
    z.strictObject({
      type: z.enum(["preview_instructions", "preview_url", "log"]),
      value: text,
    }),
  ),
  harnessMetadata: z.strictObject({
    provider: text.optional(),
    version: text.optional(),
    runId: text,
    startedAt: z.iso.datetime().optional(),
    finishedAt: z.iso.datetime().optional(),
  }),
});
export type MutationResult = z.infer<typeof MutationResultSchema>;

/** JSON Schemas for harness implementers (handoff §58). */
export function contractJsonSchemas(): Record<string, unknown> {
  return {
    HarnessTaskSpec: z.toJSONSchema(HarnessTaskSpecSchema, { io: "input" }),
    MutationResult: z.toJSONSchema(MutationResultSchema, { io: "input" }),
  };
}

export function parseHarnessTask(input: unknown): HarnessTaskSpec {
  return HarnessTaskSpecSchema.parse(input);
}
/** Parses a result and checks it answers `task` (lineage and base commit). */
export function parseMutationResult(
  input: unknown,
  task?: HarnessTaskSpec,
): MutationResult {
  const result = MutationResultSchema.parse(input);
  if (task) {
    if (
      result.harnessTaskId !== task.id ||
      result.recommendationId !== task.recommendationId
    )
      throw new Error(
        `Mutation ${result.id} answers ${result.harnessTaskId} (${result.recommendationId}), not ${task.id} (${task.recommendationId}).`,
      );
    if (result.repository.baseCommit !== task.repository.baseCommit)
      throw new Error(
        `Mutation ${result.id} started from ${result.repository.baseCommit}, not the task's base ${task.repository.baseCommit}.`,
      );
  }
  if (
    (result.status === "completed" || result.status === "partial") &&
    !result.repository.candidateCommit
  )
    throw new Error(
      `Mutation ${result.id} is ${result.status} but names no candidate commit.`,
    );
  return result;
}

export class HarnessContractError extends Error {
  override name = "HarnessContractError";
}

/** A task only for a gate decision that allows it (mode 6, ADR 0079). */
export function createHarnessTask(input: {
  recommendation: ImprovementRecommendation;
  gate: GateDecision;
  projectId: string;
  baseCommit: string;
}): HarnessTaskSpec {
  const { recommendation, gate } = input;
  if (
    gate.decision !== "eligible_for_harness" ||
    !recommendation.harnessEligible
  )
    throw new HarnessContractError(
      `The gate decided ${gate.decision} for ${gate.subject}; harness tasks need eligible_for_harness (improvement_policy.autonomous_mutation and modes.self_improvement).`,
    );
  if (gate.opportunityId !== recommendation.opportunityId)
    throw new HarnessContractError(
      `Gate decision ${gate.opportunityId} is not for ${recommendation.id}.`,
    );
  const intents: SemanticChangeIntent[] = [];
  for (const item of recommendation.acceptanceCriteria.required)
    if (item.kind === "formal-reachable" || item.kind === "formal-unreachable")
      intents.push({
        kind:
          item.kind === "formal-reachable"
            ? "restore-reachability"
            : "remove-reachability",
        goal: item.goal,
        ...(item.context ? { context: item.context } : {}),
      });
  if (recommendation.category === "improve")
    intents.push({
      kind: "reduce-workflow-cost",
      workflow: recommendation.target.subject,
    });
  if (recommendation.category === "promote")
    intents.push({
      kind: "increase-discoverability",
      workflow: recommendation.target.subject,
    });
  const protectedWorkflows = recommendation.protectedBehaviors.flatMap(
    (item) => (item.kind === "approved-workflow" ? [item.workflowId] : []),
  );
  const id = `task:${recommendation.id}:${input.baseCommit.slice(0, 12)}`;
  return parseHarnessTask({
    schemaVersion: CONTRACT_VERSION,
    id,
    recommendationId: recommendation.id,
    findingIds: recommendation.findingIds,
    repository: {
      projectId: input.projectId,
      baseCommit: input.baseCommit,
      targetBranch: `pathcompiler/${recommendation.target.subject}-${recommendation.category}`,
    },
    objective: {
      summary: recommendation.hypothesis.statement,
      target: {
        subject: recommendation.target.subject,
        goals: recommendation.target.goals,
      },
      desiredSemanticChange: intents,
    },
    rationale: {
      findingSummary: recommendation.problem.summary,
      evidence: recommendation.problem.evidence,
      hypothesis: {
        statement: recommendation.hypothesis.statement,
        confidence: recommendation.hypothesis.confidence.band,
      },
    },
    constraints: {
      hard: protectedWorkflows.map(
        (workflowId) => `approved workflow ${workflowId} must stay valid`,
      ),
      protectedBehaviors: recommendation.protectedBehaviors.flatMap((item) =>
        item.kind === "property" ? [item.property] : [],
      ),
      // Nothing else may change reachability: any unlisted change fails evaluation.
      prohibitedSemanticChanges: [],
    },
    acceptanceCriteria: recommendation.acceptanceCriteria,
    relevantContext: {
      workflowIds: [
        ...new Set([
          ...(recommendation.target.capabilities ?? [
            recommendation.target.subject,
          ]),
          ...protectedWorkflows,
        ]),
      ].sort(),
      capabilityIds: recommendation.target.capabilities ?? [
        recommendation.target.subject,
      ],
      semanticTargets: [],
    },
    requestedArtifacts: [
      "candidate_commit",
      "implementation_summary",
      "changed_files",
      "claimed_semantic_changes",
      "tests_added_or_changed",
      "assumptions",
      "unresolved_questions",
      "preview_instructions",
    ],
    outputContract: {
      artifact: "MutationResult",
      schemaVersion: CONTRACT_VERSION,
    },
  });
}

/**
 * Candidate-evaluation criteria (I3) frozen from the task, plus the
 * mutation's claim, which is recorded and never trusted.
 */
export function evaluationCriteria(
  task: HarnessTaskSpec,
  result?: MutationResult,
) {
  return {
    expectedChanges: task.objective.desiredSemanticChange.flatMap((intent) =>
      intent.goal &&
      (intent.kind === "restore-reachability" ||
        intent.kind === "remove-reachability")
        ? [
            {
              goal: intent.goal,
              change:
                intent.kind === "restore-reachability"
                  ? ("reachability-added" as const)
                  : ("reachability-removed" as const),
              ...(intent.context
                ? {
                    context: Object.fromEntries(
                      intent.context.split(", ").map((pair) => {
                        const [name, value] = pair.split("=");
                        return [name as string, value as string];
                      }),
                    ),
                  }
                : {}),
            },
          ]
        : [],
    ),
    recommendationId: task.recommendationId,
    ...(result
      ? {
          mutation: {
            id: result.id,
            claimedOutcome:
              result.status === "completed"
                ? ("success" as const)
                : result.status === "partial"
                  ? ("partial" as const)
                  : ("failed" as const),
            summary: result.implementationSummary,
          },
        }
      : {}),
  };
}

/**
 * A fixture harness for tests and examples (I2 acceptance): it changes no
 * code. `complete` claims success on a given candidate commit; `block`
 * refuses with an explanation, as a careful harness should (handoff §52).
 */
export function runFixtureHarness(
  task: HarnessTaskSpec,
  behavior:
    | { outcome: "complete"; candidateCommit: string }
    | { outcome: "block"; reason: string },
  runId = "fixture-run",
): MutationResult {
  const base = {
    schemaVersion: CONTRACT_VERSION,
    id: `mutation:${task.id}:${runId}`,
    harnessTaskId: task.id,
    recommendationId: task.recommendationId,
    testsAddedOrChanged: [],
    artifacts: [],
    harnessMetadata: {
      provider: "pathcompiler-fixture",
      version: "1.0.0",
      runId,
    },
  };
  return parseMutationResult(
    behavior.outcome === "complete"
      ? {
          ...base,
          repository: {
            baseCommit: task.repository.baseCommit,
            candidateCommit: behavior.candidateCommit,
          },
          status: "completed",
          changedFiles: [],
          implementationSummary: `Fixture candidate for: ${task.objective.summary}`,
          claimedSemanticChanges: task.objective.desiredSemanticChange.map(
            (intent) => ({
              ...(intent.goal ? { goal: intent.goal } : {}),
              ...(intent.workflow ? { workflow: intent.workflow } : {}),
              kind: intent.kind,
            }),
          ),
          assumptions: ["Fixture harness: no code was changed."],
          unresolvedQuestions: [],
        }
      : {
          ...base,
          repository: { baseCommit: task.repository.baseCommit },
          status: "blocked",
          changedFiles: [],
          implementationSummary: `Blocked: ${behavior.reason}`,
          claimedSemanticChanges: [],
          assumptions: [],
          unresolvedQuestions: [behavior.reason],
        },
    task,
  );
}
