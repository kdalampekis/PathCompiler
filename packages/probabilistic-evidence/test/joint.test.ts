import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  candidateWeight,
  type EvidenceItem,
  interpretCandidates,
  selectInterpretations,
} from "../src/index.js";

let solver: SolverProvider;
beforeAll(async () => {
  solver = await createZ3SolverProvider();
});
afterAll(async () => {
  await solver?.close();
});
const item = (id: string, evidenceClass: EvidenceItem["class"]) => ({
  id,
  class: evidenceClass,
  current: true,
  summary: id,
});
const outcome = (
  subject: string,
  candidates: [string, number, EvidenceItem["class"]][],
) =>
  interpretCandidates(
    {
      id: `naming:${subject}`,
      type: "naming",
      subject,
      statement: subject,
      categorical: true,
    },
    candidates.map(([value, prior, evidenceClass]) => ({
      value,
      prior,
      items: [item(`${subject}:${value}`, evidenceClass)],
      violations: [],
    })),
  );

describe("joint interpretation (weighted soft constraints)", () => {
  const a = () => outcome("a", [["edit", 0.8, "model"]]);
  const b = () =>
    outcome("b", [
      ["edit", 0.7, "model"],
      ["archive", 0.6, "model"],
    ]);

  it("keeps exclusive subjects apart and maximizes the supported weight", async () => {
    const selection = await selectInterpretations({
      outcomes: [a(), b()],
      exclusive: [["a", "b"]],
      solver,
    });
    expect(selection.status).toBe("optimal");
    expect(selection.assignments).toEqual([
      expect.objectContaining({
        subject: "a",
        value: "edit",
        localBest: "edit",
        joint: false,
      }),
      // b alone is contested; the joint optimum gives it archive.
      expect.objectContaining({
        subject: "b",
        value: "archive",
        localBest: null,
        joint: true,
      }),
    ]);
    expect(selection.satisfiedWeight).toBeLessThan(
      selection.unconstrainedWeight,
    );
  });

  it("lets subjects that are not exclusive share a meaning (a merge)", async () => {
    const selection = await selectInterpretations({
      outcomes: [a(), b()],
      solver,
    });
    expect(selection.assignments.map((item) => item.value)).toEqual([
      "edit",
      "edit",
    ]);
  });

  it("ranks code above models, then by relative weight", () => {
    expect(candidateWeight({ tier: 5, weight: 0.1 })).toBeGreaterThan(
      candidateWeight({ tier: 1, weight: 1 }),
    );
    expect(candidateWeight({ tier: 1, weight: 0.6 })).toBeGreaterThan(
      candidateWeight({ tier: 1, weight: 0.4 }),
    );
  });

  it("is optimal with nothing to choose and reports unknown solver answers", async () => {
    const impossible = interpretCandidates(
      {
        id: "n",
        type: "naming",
        subject: "c",
        statement: "c",
        categorical: true,
      },
      [{ value: "x", prior: 1, items: [], violations: ["hard"] }],
    );
    expect(
      await selectInterpretations({ outcomes: [impossible], solver }),
    ).toMatchObject({
      status: "optimal",
      assignments: [{ subject: "c", value: null }],
    });
    const stub: SolverProvider = {
      name: "stub",
      check: async () => ({ status: "unknown", reason: "timeout" }),
      optimize: async () => ({ status: "unknown", reason: "timeout" }),
      close: async () => {},
    };
    expect(
      await selectInterpretations({ outcomes: [a()], solver: stub }),
    ).toMatchObject({
      status: "unknown",
      reason: "timeout",
      assignments: [{ subject: "a", value: null, joint: true }],
    });
  });
});
