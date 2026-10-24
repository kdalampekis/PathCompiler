import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  evaluateReasoningCases,
  loadReasoningCases,
  REASONING_CATEGORIES,
  type ReasoningCase,
} from "../src/index.js";

const root = fileURLToPath(
  new URL("../../../fixtures/reasoning", import.meta.url),
);
let solver: SolverProvider;
beforeAll(async () => {
  solver = await createZ3SolverProvider();
});
afterAll(async () => {
  await solver?.close();
});

describe("reasoning evaluation cases", () => {
  it("covers every category and passes on the fixture", async () => {
    const cases = await loadReasoningCases(root);
    expect(new Set(cases.map((item) => item.category))).toEqual(
      new Set(REASONING_CATEGORIES),
    );
    const report = await evaluateReasoningCases(root, cases, solver);
    await expect(`${JSON.stringify(report, null, 2)}\n`).toMatchFileSnapshot(
      "./golden/reasoning.report.json",
    );
    expect(
      report.cases.filter((item) => !item.passed).map((item) => item.detail),
    ).toEqual([]);
    expect(report.unknownRate).toBe(0);
  }, 300_000);

  it("reports a wrong expectation as a failure, not a pass", async () => {
    const wrong: ReasoningCase = {
      schemaVersion: 1,
      id: "reachable.viewer-creates-client",
      category: "reachable",
      fixture: "next-demo",
      description: "Deliberately wrong: viewers cannot create clients.",
      query: {
        kind: "reachability",
        goal: "clients.created",
        context: { role: "unlisted" },
        expected: "reachable",
      },
    };
    const report = await evaluateReasoningCases(root, [wrong], solver);
    expect(report.cases[0]).toMatchObject({
      passed: false,
      detail: "unreachable (expected reachable)",
    });
    expect(report.verdictAccuracy).toBe(0);
  }, 120_000);

  it("rejects cases in the wrong directory and edits that do not apply", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "pathcompiler-cases-"),
    );
    try {
      await cp(
        path.join(root, "reachable"),
        path.join(directory, "unreachable"),
        {
          recursive: true,
        },
      );
      await expect(loadReasoningCases(directory)).rejects.toThrow(
        /declares category reachable; move it to reachable\//,
      );
      await rm(path.join(directory, "unreachable"), { recursive: true });
      const [seeded] = (await loadReasoningCases(root)).filter(
        (item) => item.id === "counterexamples.seeded-missing-editor-check",
      );
      const stale = {
        ...(seeded as ReasoningCase),
        edits: [{ file: "lib/session.ts", from: "no such text", to: "" }],
      };
      await expect(
        evaluateReasoningCases(root, [stale], solver),
      ).rejects.toThrow(
        'Reasoning case counterexamples.seeded-missing-editor-check: lib/session.ts does not contain the edit\'s "from" text.',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
