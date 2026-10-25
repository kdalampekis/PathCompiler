import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => rm(item, { recursive: true, force: true })),
  );
});
const recommendation = (category: string) => ({
  id: `recommendation:plans.create:${category}`,
  findingIds: ["finding:workflow_friction:goal:plans.created@editor"],
  opportunityId: "opportunity:plans.create",
  category,
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
  ],
  protectedBehaviors: [],
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
});

describe("experiment create", () => {
  it("specifies a frozen experiment for a passing candidate and refuses fixes", async () => {
    const cwd = await mkdtemp(
      path.join(os.tmpdir(), "pathcompiler-experiment-"),
    );
    temporary.push(cwd);
    await mkdir(path.join(cwd, "out", "reports"), { recursive: true });
    await writeFile(
      path.join(cwd, "out", "reports", "recommendations.json"),
      JSON.stringify({
        schemaVersion: 1,
        kind: "recommendations",
        recommendations: [recommendation("improve"), recommendation("fix")],
        skipped: [],
      }),
    );
    await writeFile(
      path.join(cwd, "evaluation.json"),
      JSON.stringify({
        type: "candidate_evaluation",
        id: "eval:aaa..bbb",
        candidate: "b".repeat(40),
        status: "pass",
      }),
    );
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    const output = await run([
      "experiment",
      "create",
      "recommendation:plans.create:improve",
      "evaluation.json",
      "r1",
      "r2",
    ]);
    expect(output).toContain(
      "specified (not deployed): r1 (control) vs r2 (treatment, bbbbbbbbbbbb).",
    );
    expect(output).toContain(
      "Primary: workflow_completion_rate increase on plans.created, by at least 10% relative, 30+ sessions per arm.",
    );
    expect(await readdir(path.join(cwd, "out", "experiments"))).toHaveLength(1);
    await expect(
      run([
        "experiment",
        "create",
        "recommendation:plans.create:fix",
        "evaluation.json",
        "r1",
        "r2",
      ]),
    ).rejects.toThrow("validated by its acceptance checks, not an experiment");
    await expect(
      run(["experiment", "create", "missing", "evaluation.json", "r1", "r2"]),
    ).rejects.toThrow("No recommendation missing");
  });
});
