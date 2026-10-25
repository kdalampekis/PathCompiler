import { describe, expect, it } from "vitest";
import {
  type ImpactReason,
  scoreCommitRisk,
  type WorkflowImpactReport,
} from "../src/index.js";

const report = (
  impacts: [string, [ImpactReason["code"], ImpactReason["severity"]][]][],
): WorkflowImpactReport => ({
  schemaVersion: 1,
  base: { commit: "a".repeat(40) },
  head: { commit: "b".repeat(40) },
  method: "deterministic-rules+bounded-smt",
  impacts: impacts.map(([workflowId, reasons]) => ({
    workflowId,
    severity: "high",
    affectedSteps: [],
    reasons: reasons.map(([code, severity]) => ({
      code,
      severity,
      message: `${code} in ${workflowId}`,
      stepIds: [],
    })),
  })),
});

describe("commit risk scoring", () => {
  it("separates definite, probable and uncertain impacts", () => {
    const risk = scoreCommitRisk(
      report([
        [
          "plans.change_structure",
          [
            ["target-removed", "high"],
            ["reachability-removed", "high"],
            ["source-file-changed", "low"],
          ],
        ],
        ["clients.create", [["api-changed", "medium"]]],
        ["plans.create", [["copy-changed", "low"]]],
      ]),
      {
        uncertainty: [
          {
            kind: "unknown-result",
            goal: "plans.archived",
            message: "timeout",
          },
        ],
      },
    );
    expect(risk).toMatchObject({
      level: "high",
      levelMeaning: "rule-level-not-probability",
      counts: { definite: 2, probable: 1, uncertain: 3 },
      incidentProbability: { value: null },
    });
    expect(
      risk.items.map((item) => [item.class, item.source, item.code]),
    ).toEqual([
      ["definite", "formal", "reachability-removed"],
      ["definite", "static", "target-removed"],
      ["probable", "static", "api-changed"],
      // Within a class: severity, then workflow or goal, then code.
      ["uncertain", "formal", "unknown-result"],
      ["uncertain", "static", "source-file-changed"],
      ["uncertain", "static", "copy-changed"],
    ]);
  });

  it("sets the level by the strongest class", () => {
    expect(
      scoreCommitRisk(report([["w", [["api-changed", "medium"]]]])).level,
    ).toBe("medium");
    expect(
      scoreCommitRisk(report([["w", [["reachability-added", "medium"]]]]))
        .level,
    ).toBe("medium");
    expect(
      scoreCommitRisk(report([["w", [["target-moved", "low"]]]])).level,
    ).toBe("low");
    expect(scoreCommitRisk(report([["w", []]]))).toMatchObject({
      level: "none",
      counts: { definite: 0, probable: 0, uncertain: 0 },
    });
  });

  it("gives a probability only from a sufficient calibration", () => {
    const input = report([["w", [["api-changed", "medium"]]]]);
    const levels = [{ level: "medium" as const, samples: 40, incidents: 6 }];
    expect(
      scoreCommitRisk(input, {
        calibration: { id: "team", minSamples: 30, levels },
      }).incidentProbability,
    ).toEqual({ value: 0.15, calibration: "team", samples: 40 });
    expect(
      scoreCommitRisk(input, {
        calibration: { id: "team", minSamples: 50, levels },
      }).incidentProbability,
    ).toEqual({
      value: null,
      reason: "Calibration team has 40 reviewed medium changes; 50 are needed.",
    });
  });
});
