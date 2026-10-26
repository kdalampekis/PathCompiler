import type { CandidateEvaluation } from "@pathcompiler/candidate-evaluator";
import { createExperimentSpec } from "@pathcompiler/experiment-core";
import {
  createEventFactory,
  type ProductRuntimeEvent,
} from "@pathcompiler/observability-core";
import {
  decideAdoption,
  measureOutcome,
  recordApproval,
} from "@pathcompiler/outcome-analysis";
import type { ImprovementRecommendation } from "@pathcompiler/recommendation-engine";
import { describe, expect, it } from "vitest";
import {
  buildMemoryRecord,
  historyFactor,
  ImprovementMemoryRecordSchema,
  rankWithMemory,
} from "../src/index.js";

const recommendation = (id = "recommendation:plans.create:improve") =>
  ({
    id,
    findingIds: ["finding:workflow_friction:goal:plans.created@editor"],
    opportunityId: "opportunity:plans.create",
    category: "improve",
    target: { subject: "plans.create", goals: ["plans.created"] },
    problem: {
      summary: "Friction.",
      classification: ["workflow_friction"],
      evidence: [],
    },
    hypothesis: {
      statement: "Removing the confirmation step increases completion.",
      expectedEffect: [],
      confidence: {
        band: "low",
        meaning: "template-prior-not-probability",
        reason: "x",
      },
      falsifiable: true,
    },
    desiredOutcomes: [
      {
        metric: "workflow_completion_rate",
        direction: "increase",
        on: "plans.created",
      },
    ],
    protectedBehaviors: [],
    acceptanceCriteria: { required: [], outcome: [] },
    harnessEligible: false,
    priority: {
      score: 0.4,
      scoreMeaning: "ordering-not-probability",
      components: [],
      rationale: "x",
    },
    findingConfidence: { band: "medium", score: 0.6 },
    generatedAt: "2026-10-24T12:00:00.000Z",
    sourceModelVersion: "unknown",
  }) as unknown as ImprovementRecommendation;
function arm(
  release: string,
  count: number,
  reaching: number,
): ProductRuntimeEvent[] {
  return Array.from({ length: count }, (_, index) => {
    let counter = 0;
    const id = `${release}-${index}`;
    const create = createEventFactory({
      projectId: "demo",
      sessionId: id,
      release,
      now: () => new Date(Date.UTC(2026, 9, 24, 10, 0, counter)),
      nextId: () => `${id}-${++counter}`,
    });
    return [
      create("route.changed", { route: "/plans" }),
      ...(index < reaching
        ? [create("goal.reached", { goalId: "plans.created" })]
        : []),
    ];
  }).flat();
}
/** The failed-hypothesis lifecycle: completion falls, rollback, approved. */
function lifecycle() {
  const spec = createExperimentSpec({
    recommendation: recommendation(),
    evaluation: {
      id: "eval:a..b",
      candidate: "b".repeat(40),
      status: "pass",
    } as CandidateEvaluation,
    controlRelease: "r1",
    treatmentRelease: "r2",
    frozenAt: "2026-10-24T12:00:00.000Z",
  });
  const outcome = measureOutcome({
    spec,
    events: [...arm("r1", 1000, 510), ...arm("r2", 1000, 430)],
    evaluationStatus: "pass",
  });
  const decision = decideAdoption(outcome);
  return { spec, outcome, decision };
}

describe("improvement memory", () => {
  it("links the whole lifecycle and learns only from approved decisions", () => {
    const { spec, outcome, decision } = lifecycle();
    const pending = buildMemoryRecord({
      recommendation: recommendation(),
      experiment: spec,
      outcome,
      decision,
      createdAt: "2026-10-25T09:00:00.000Z",
    });
    expect(pending).toMatchObject({
      recommendationId: "recommendation:plans.create:improve",
      experimentId: spec.id,
      evaluationId: "eval:a..b",
      outcomeId: outcome.id,
      decisionId: decision.id,
      decision: "rollback",
      approval: "pending",
      reusableLessons: [],
    });
    expect(pending.closedAt).toBeUndefined();
    const approved = buildMemoryRecord({
      recommendation: recommendation(),
      experiment: spec,
      outcome,
      decision: recordApproval(decision, {
        approved: true,
        decidedBy: "reviewer",
        decidedAt: "2026-10-25T10:00:00.000Z",
      }),
      createdAt: "2026-10-25T09:00:00.000Z",
    });
    expect(approved.closedAt).toBe("2026-10-25T10:00:00.000Z");
    expect(approved.reusableLessons).toEqual([
      expect.objectContaining({
        subject: "plans.create",
        category: "improve",
        verdict: "rejected",
        scope: "same-subject-and-category",
      }),
    ]);
    expect(
      ImprovementMemoryRecordSchema.parse(JSON.parse(JSON.stringify(approved))),
    ).toEqual(approved);
  });

  it("weighs past rejections in new recommendations for the same subject and category only", () => {
    const { spec, outcome, decision } = lifecycle();
    const memory = [
      buildMemoryRecord({
        recommendation: recommendation(),
        experiment: spec,
        outcome,
        decision: recordApproval(decision, {
          approved: true,
          decidedBy: "reviewer",
          decidedAt: "2026-10-25T10:00:00.000Z",
        }),
      }),
    ];
    const next = recommendation("recommendation:plans.create:improve");
    expect(historyFactor(next, memory)).toMatchObject({
      value: 0.5,
      basedOn: [memory[0]?.id],
    });
    expect(historyFactor({ ...next, category: "promote" }, memory).value).toBe(
      1,
    );
    const other = {
      ...next,
      id: "recommendation:clients.create:improve",
      target: {
        subject: "clients.create",
        goals: [],
        capabilities: ["clients.create"],
      },
    };
    const ranked = rankWithMemory([next, other], memory);
    expect(ranked.map((item) => [item.id, item.priority.score])).toEqual([
      ["recommendation:clients.create:improve", 0.4],
      ["recommendation:plans.create:improve", 0.2],
    ]);
    expect(ranked[1]?.priority.components.at(-1)).toMatchObject({
      name: "history",
      value: 0.5,
    });
  });

  it("refuses to mix lifecycles", () => {
    const { spec } = lifecycle();
    expect(() =>
      buildMemoryRecord({
        recommendation: recommendation("recommendation:x:improve"),
        experiment: spec,
      }),
    ).toThrow("records link one lifecycle only");
  });
});
