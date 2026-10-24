import { describe, expect, it } from "vitest";
import { type EvidenceItem, interpretCandidates } from "../src/index.js";

const claim = {
  id: "naming:s",
  type: "naming" as const,
  subject: "s",
  statement: "What s implements",
  categorical: true as const,
};
const item = (id: string, evidenceClass: EvidenceItem["class"]) => ({
  id,
  class: evidenceClass,
  current: true,
  summary: id,
});

describe("probabilistic semantic interpretation", () => {
  it("removes impossible candidates, re-scores the rest and fuses their evidence", () => {
    const outcome = interpretCandidates(claim, [
      {
        value: "create",
        prior: 0.72,
        items: [item("rule", "static")],
        violations: [],
      },
      {
        value: "update",
        prior: 0.21,
        items: [item("m1", "model")],
        violations: [],
      },
      {
        value: "invite",
        prior: 0.07,
        items: [item("m2", "model")],
        violations: ["api-verb-mismatch"],
      },
    ]);
    expect(outcome.candidates).toEqual([
      expect.objectContaining({
        value: "create",
        status: "consistent",
        weight: 0.774,
        tier: 5,
      }),
      expect.objectContaining({
        value: "update",
        status: "consistent",
        weight: 0.226,
        tier: 1,
      }),
      expect.objectContaining({
        value: "invite",
        status: "impossible",
        weight: 0,
        violations: ["api-verb-mismatch"],
      }),
    ]);
    expect(outcome.best).toBe("create");
    // The surviving model hypothesis disagrees with code: not adopted.
    expect(outcome.assessment.conflicts.map((item) => item.kind)).toEqual([
      "unsupported-hypothesis",
    ]);
  });

  it("never keeps an impossible candidate, however strong its soft evidence", () => {
    const outcome = interpretCandidates(claim, [
      {
        value: "create",
        prior: 0.95,
        items: [item("browser", "browser"), item("test", "test")],
        violations: ["api-verb-mismatch"],
      },
      {
        value: "edit",
        prior: 0.4,
        items: [item("m", "model")],
        violations: [],
      },
    ]);
    expect(outcome.best).toBe("edit");
    expect(outcome.assessment.supporting).toEqual(["m"]);
    expect(outcome.assessment.confidence.band).toBe("low");
    expect(outcome.candidates[1]).toMatchObject({ value: "create", weight: 0 });
  });

  it("pools agreeing sources, reports contests and empty results", () => {
    const pooled = interpretCandidates(claim, [
      {
        value: "edit",
        prior: 0.5,
        items: [item("rule", "static")],
        violations: [],
      },
      {
        value: "edit",
        prior: 0.8,
        items: [item("m", "model")],
        violations: [],
      },
    ]);
    expect(pooled.candidates).toEqual([
      expect.objectContaining({
        value: "edit",
        prior: 0.8,
        weight: 1,
        evidenceIds: ["m", "rule"],
      }),
    ]);
    const contested = interpretCandidates(claim, [
      {
        value: "edit",
        prior: 0.5,
        items: [item("m1", "model")],
        violations: [],
      },
      {
        value: "invite",
        prior: 0.6,
        items: [item("m2", "model")],
        violations: [],
      },
    ]);
    expect(contested.best).toBeNull();
    expect(contested.assessment.status).toBe("contested");
    const none = interpretCandidates(claim, [
      {
        value: "edit",
        prior: 0.5,
        items: [item("m", "model")],
        violations: ["x"],
      },
    ]);
    expect(none.best).toBeNull();
    expect(none.assessment.status).toBe("insufficient");
    expect(() =>
      interpretCandidates(claim, [
        { value: "edit", prior: 2, items: [], violations: [] },
      ]),
    ).toThrow("needs a prior in [0, 1]");
  });
});
