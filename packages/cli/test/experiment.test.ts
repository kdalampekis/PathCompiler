import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEventFactory } from "@pathcompiler/observability-core";
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

    // Measure: 60 sessions per release; r2 reaches the goal far more often.
    const project = path.basename(cwd);
    const events = path.join(cwd, "out", "events", encodeURIComponent(project));
    await mkdir(events, { recursive: true });
    const lines: string[] = [];
    for (const [release, reaching] of [
      ["r1", 20],
      ["r2", 50],
    ] as const)
      for (let index = 0; index < 60; index += 1) {
        let counter = 0;
        const id = `${release}-${index}`;
        const create = createEventFactory({
          projectId: project,
          sessionId: id,
          release,
          now: () => new Date(Date.UTC(2026, 9, 24, 10, 0, counter)),
          nextId: () => `${id}-${++counter}`,
        });
        lines.push(
          JSON.stringify(create("route.changed", { route: "/plans" })),
        );
        if (index < reaching)
          lines.push(
            JSON.stringify(create("goal.reached", { goalId: "plans.created" })),
          );
      }
    await writeFile(
      path.join(events, "2026-10-24.ndjson"),
      `${lines.join("\n")}\n`,
    );
    const [spec] = await readdir(path.join(cwd, "out", "experiments"));
    const measured = await run([
      "experiment",
      "measure",
      path.join("out", "experiments", spec as string),
      "evaluation.json",
    ]);
    expect(measured).toContain("IMPROVED");
    expect(measured).toContain(
      "Primary workflow_completion_rate on plans.created: 0.3333 (60 sessions) → 0.8333 (60)",
    );
    expect(measured).toContain("Formal (candidate evaluation): pass");
  });
});
