import type { CandidateEvaluation } from "@pathcompiler/candidate-evaluator";
import { createExperimentSpec } from "@pathcompiler/experiment-core";
import {
  createEventFactory,
  type ProductRuntimeEvent,
} from "@pathcompiler/observability-core";
import type { ImprovementRecommendation } from "@pathcompiler/recommendation-engine";
import { describe, expect, it } from "vitest";
import {
  decideAdoption,
  measureOutcome,
  recordApproval,
} from "../src/index.js";

const recommendation = {
  id: "recommendation:plans.create:improve",
  findingIds: [],
  opportunityId: "opportunity:plans.create",
  category: "improve",
  target: { subject: "plans.create", goals: ["plans.created"] },
  problem: {
    summary: "Friction.",
    classification: ["workflow_friction"],
    evidence: [],
  },
  hypothesis: {
    statement: "Removing friction increases completion.",
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
    {
      metric: "path_efficiency_ratio",
      direction: "decrease",
      on: "plans.created",
    },
  ],
  protectedBehaviors: [
    { kind: "approved-workflow", workflowId: "clients.create", reason: "x" },
  ],
  acceptanceCriteria: { required: [], outcome: [] },
  harnessEligible: false,
  priority: {
    score: 0.1,
    scoreMeaning: "ordering-not-probability",
    components: [],
    rationale: "x",
  },
  findingConfidence: { band: "medium", score: 0.6 },
  generatedAt: "2026-10-24T12:00:00.000Z",
  sourceModelVersion: "unknown",
} as unknown as ImprovementRecommendation;
const spec = createExperimentSpec({
  recommendation,
  evaluation: {
    id: "eval:a..b",
    candidate: "b".repeat(40),
    status: "pass",
  } as CandidateEvaluation,
  controlRelease: "r1",
  treatmentRelease: "r2",
  frozenAt: "2026-10-24T12:00:00.000Z",
});
/** `count` sessions in a release; the first `reaching` reach the goal, the first `completing` complete Create Client. */
function arm(
  release: string,
  count: number,
  reaching: number,
  completing = count,
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
    const workflow = { workflowId: "clients.create", workflowVersion: 1 };
    return [
      create("workflow.started", { ...workflow, trigger: "guide" }),
      ...(index < completing ? [create("workflow.completed", workflow)] : []),
      create("route.changed", { route: "/plans" }),
      ...(index < reaching
        ? [create("goal.reached", { goalId: "plans.created" })]
        : []),
    ];
  }).flat();
}
const measure = (events: ProductRuntimeEvent[]) =>
  measureOutcome({ spec, events, evaluationStatus: "pass" });

describe("outcome measurement", () => {
  it("calls an improvement only beyond the intervals and the frozen criterion", () => {
    const outcome = measure([...arm("r1", 200, 100), ...arm("r2", 200, 150)]);
    expect(outcome).toMatchObject({
      outcome: "improved",
      primaryMetric: {
        method: "goal-reach-share",
        control: { sessions: 200, value: 0.5 },
        treatment: { sessions: 200, value: 0.75 },
        relativeChange: 0.5,
        significant: true,
        sufficient: true,
      },
      formal: { evaluationId: "eval:a..b", status: "pass" },
    });
    // Path efficiency needs the formal model; it is a gap, not a guess.
    expect(outcome.secondaryMetrics[0]?.method).toBe("not-measured");
    expect(outcome.evidenceGaps[0]).toContain("path_efficiency_ratio");
    expect(
      outcome.guardrails.find((item) => item.on === "clients.create"),
    ).toMatchObject({
      method: "guide-completion-rate",
      breached: false,
    });
  });

  it("reports worse when a guardrail breaks, even if the primary metric improves", () => {
    const outcome = measure([
      ...arm("r1", 200, 100, 190),
      ...arm("r2", 200, 150, 100),
    ]);
    expect(outcome.outcome).toBe("worse");
    expect(outcome.rationale).toContain(
      "workflow_completion_rate on clients.create",
    );
  });

  it("is neutral below the criterion and inconclusive on small samples", () => {
    expect(
      measure([...arm("r1", 400, 200), ...arm("r2", 400, 210)]).outcome,
    ).toBe("neutral");
    expect(measure([...arm("r1", 10, 5), ...arm("r2", 10, 9)]).outcome).toBe(
      "inconclusive",
    );
    expect(
      measure([...arm("r1", 200, 150), ...arm("r2", 200, 80)]).outcome,
    ).toBe("worse");
  });

  it("refuses a spec edited after freezing", () => {
    expect(() =>
      measureOutcome({
        spec: {
          ...spec,
          successCriteria: { ...spec.successCriteria, minSessionsPerArm: 1 },
        },
        events: [],
      }),
    ).toThrow("edited after its criteria were frozen");
  });
});

describe("adoption decision", () => {
  const decide = (events: ProductRuntimeEvent[], evaluationStatus?: string) =>
    decideAdoption(
      measureOutcome({
        spec,
        events,
        ...(evaluationStatus ? { evaluationStatus } : {}),
      }),
    );

  it("rejects its own recommendation when behavior gets worse (failed-hypothesis demo)", () => {
    // Formal candidate valid, but completion falls from 51% to 43%. With 400
    // sessions per arm the intervals still overlap (extend the experiment);
    // with 1000 the drop is beyond them.
    expect(
      decide([...arm("r1", 400, 204), ...arm("r2", 400, 172)], "pass").decision,
    ).toBe("extend_experiment");
    const decision = decide(
      [...arm("r1", 1000, 510), ...arm("r2", 1000, 430)],
      "pass",
    );
    expect(decision).toMatchObject({
      decision: "rollback",
      hypothesis: "rejected",
      alternatives: ["iterate"],
      humanApprovalRequired: true,
      approval: { status: "pending" },
    });
  });

  it("adopts only an improvement with a passing candidate, and iterates on a neutral one", () => {
    const improved = [...arm("r1", 200, 100), ...arm("r2", 200, 150)];
    expect(decide(improved, "pass")).toMatchObject({
      decision: "adopt",
      hypothesis: "supported",
    });
    expect(decide(improved)).toMatchObject({
      decision: "inconclusive",
      alternatives: ["adopt"],
    });
    expect(decide(improved, "fail").decision).toBe("reject");
    expect(
      decide([...arm("r1", 400, 200), ...arm("r2", 400, 210)], "pass"),
    ).toMatchObject({
      decision: "iterate",
      hypothesis: "not-supported",
    });
    expect(
      decide([...arm("r1", 10, 5), ...arm("r2", 10, 9)], "pass").decision,
    ).toBe("extend_experiment");
  });

  it("records a human approval once", () => {
    const decision = decide(
      [...arm("r1", 200, 100), ...arm("r2", 200, 150)],
      "pass",
    );
    const approved = recordApproval(decision, {
      approved: true,
      decidedBy: "reviewer",
      decidedAt: "2026-10-25T09:00:00.000Z",
    });
    expect(approved.approval).toEqual({
      status: "approved",
      decidedBy: "reviewer",
      decidedAt: "2026-10-25T09:00:00.000Z",
    });
    expect(() =>
      recordApproval(approved, {
        approved: false,
        decidedBy: "other",
        decidedAt: "2026-10-25T10:00:00.000Z",
      }),
    ).toThrow("already approved by reviewer");
  });
});
