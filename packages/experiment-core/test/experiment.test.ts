import type { PathEfficiencyReport } from "@pathcompiler/behavior-reconciliation";
import type { CandidateEvaluation } from "@pathcompiler/candidate-evaluator";
import { parseConfig } from "@pathcompiler/config";
import { deriveFindings } from "@pathcompiler/findings";
import { gateFindings } from "@pathcompiler/improvement-gate";
import { recommend } from "@pathcompiler/recommendation-engine";
import { describe, expect, it } from "vitest";
import {
  createExperimentSpec,
  ExperimentError,
  parseExperimentSpec,
} from "../src/index.js";

const at = "2026-10-24T12:00:00.000Z";
const findings = deriveFindings(
  {
    efficiency: {
      friction: [{ goal: "plans.created", role: "editor", ratio: 4 }],
    } as unknown as PathEfficiencyReport,
  },
  { detectedAt: at, goalCapabilities: { "plans.created": "plans.create" } },
);
const policy = parseConfig("version: 1\n").improvement_policy;
const recommendations = recommend({
  findings,
  gate: gateFindings(
    findings,
    { ...policy, min_confidence: 0.5 },
    {
      usage: { "plans.create": { affected: 300, eligible: 800 } },
    },
  ),
  approvedWorkflows: ["clients.create", "plans.create"],
  generatedAt: at,
});
const improve = recommendations.recommendations[0];
const evaluation = (status: CandidateEvaluation["status"]) =>
  ({
    id: "eval:aaa..bbb",
    candidate: "b".repeat(40),
    status,
  }) as CandidateEvaluation;

describe("experiment specification", () => {
  it("specifies metrics, guardrails and frozen success criteria from a recommendation", () => {
    if (!improve) throw new Error("expected an IMPROVE recommendation");
    const spec = createExperimentSpec({
      recommendation: improve,
      evaluation: evaluation("pass"),
      controlRelease: "r1",
      treatmentRelease: "r2",
      roles: ["editor"],
      frozenAt: at,
    });
    expect(spec).toMatchObject({
      id: `experiment:${improve.id}:${"b".repeat(12)}`,
      deployment: "not-automated",
      treatment: { release: "r2", commit: "b".repeat(40) },
      population: {
        subject: "plans.create",
        goals: ["plans.created"],
        roles: ["editor"],
      },
      primaryMetric: {
        metric: "workflow_completion_rate",
        direction: "increase",
        on: "plans.created",
      },
      secondaryMetrics: [
        {
          metric: "path_efficiency_ratio",
          direction: "decrease",
          on: "plans.created",
        },
      ],
      successCriteria: {
        minimumRelativeImprovement: 0.1,
        minSessionsPerArm: 30,
        confidence: 0.95,
      },
    });
    // Other approved workflows must keep completing.
    expect(spec.guardrails.map((item) => item.on)).toEqual([
      "clients.create",
      "plans.create",
    ]);
    expect(parseExperimentSpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
    // Moving the goalposts after the fact is detected.
    expect(() =>
      parseExperimentSpec({
        ...spec,
        successCriteria: {
          ...spec.successCriteria,
          minimumRelativeImprovement: 0.01,
        },
      }),
    ).toThrow("edited after its criteria were frozen");
  });

  it("refuses fixes, failing candidates and mismatched evaluations", () => {
    if (!improve) throw new Error("expected an IMPROVE recommendation");
    const base = { controlRelease: "r1", treatmentRelease: "r2" };
    const code = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof ExperimentError ? error.code : String(error);
      }
      return "no error";
    };
    expect(
      code(() =>
        createExperimentSpec({
          ...base,
          recommendation: { ...improve, category: "fix" },
          evaluation: evaluation("pass"),
        }),
      ),
    ).toBe("not-behavioral");
    expect(
      code(() =>
        createExperimentSpec({
          ...base,
          recommendation: improve,
          evaluation: evaluation("fail"),
        }),
      ),
    ).toBe("evaluation-not-passing");
    expect(
      code(() =>
        createExperimentSpec({
          ...base,
          recommendation: improve,
          evaluation: {
            ...evaluation("pass"),
            recommendationId: "recommendation:other:improve",
          },
        }),
      ),
    ).toBe("evaluation-mismatch");
  });
});
