import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseConfig } from "@pathcompiler/config";
import { deriveFindings } from "@pathcompiler/findings";
import { gateFindings } from "@pathcompiler/improvement-gate";
import { recommend } from "@pathcompiler/recommendation-engine";
import type { SemanticChangeReport } from "@pathcompiler/semantic-change";
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
const findings = deriveFindings(
  {
    semantic: {
      type: "semantic_change_report",
      commitRange: { base: "a".repeat(40), head: "b".repeat(40) },
      removedReachability: [
        {
          goal: "clients.created",
          capabilityId: "clients.create",
          context: { role: "editor" },
        },
      ],
      newReachability: [],
      affectedWorkflows: [],
    } as unknown as SemanticChangeReport,
  },
  { detectedAt: "2026-10-25T12:00:00.000Z" },
);

describe("harness task", () => {
  it("writes a task only when the gate made the recommendation eligible", async () => {
    const policy = parseConfig("version: 1\n").improvement_policy;
    for (const autonomous of [false, true]) {
      const cwd = await mkdtemp(
        path.join(os.tmpdir(), "pathcompiler-harness-"),
      );
      temporary.push(cwd);
      const gate = gateFindings(
        findings,
        {
          ...policy,
          min_confidence: 0.5,
          autonomous_mutation: autonomous,
          max_autonomous_mutations: 1,
        },
        { usage: { "clients.create": { affected: 400, eligible: 800 } } },
      );
      const recommendations = recommend({ findings, gate });
      await mkdir(path.join(cwd, "out", "reports"), { recursive: true });
      await writeFile(
        path.join(cwd, "out", "reports", "gate-decisions.json"),
        JSON.stringify(gate),
      );
      await writeFile(
        path.join(cwd, "out", "reports", "recommendations.json"),
        JSON.stringify(recommendations),
      );
      const id = recommendations.recommendations[0]?.id as string;
      const run = runCli(
        ["harness", "task", id, "a".repeat(40), "--out", "out"],
        cwd,
      );
      if (!autonomous) {
        await expect(run).rejects.toThrow(
          "harness tasks need eligible_for_harness",
        );
        continue;
      }
      expect(await run).toContain(
        "Intended: restore-reachability clients.created [role=editor]",
      );
      expect(
        await readdir(path.join(cwd, "out", "harness", "tasks")),
      ).toHaveLength(1);
    }
  });
});

describe("external harness integration (Integration V0)", () => {
  it("goes from recommendation to task to harness candidate to evaluation without manual conversion", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { cp, readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { runFixtureHarness, parseHarnessTask } = await import(
      "@pathcompiler/harness-contracts"
    );
    const exec = promisify(execFile);
    const fixture = fileURLToPath(
      new URL("../../../fixtures/next-demo", import.meta.url),
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-v0-"));
    temporary.push(cwd);
    const app = path.join(cwd, "app");
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.test",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.test",
    };
    const git = async (...args: string[]) =>
      (await exec("git", ["-C", app, ...args], { env })).stdout.trim();
    const tracked = (
      await exec("git", ["-C", fixture, "ls-files", "-z", "--", "."])
    ).stdout
      .split("\0")
      .filter(Boolean);
    for (const file of tracked) {
      await mkdir(path.dirname(path.join(app, file)), { recursive: true });
      await cp(path.join(fixture, file), path.join(app, file));
    }
    await git("init", "--quiet", "--initial-branch=main");
    await git("add", ".");
    await git("commit", "--quiet", "-m", "base");
    const base = await git("rev-parse", "HEAD");
    const route = path.join(app, "app/api/clients/route.ts");
    const original = await readFile(route, "utf8");
    // The regression: creating a client no longer checks the editor role.
    await writeFile(
      route,
      original.replace("    requireEditor(session);\n", ""),
    );
    await git("commit", "--quiet", "-am", "Simplify create");
    const regressed = await git("rev-parse", "HEAD");
    await writeFile(
      path.join(cwd, "pathcompiler.yaml"),
      [
        "version: 1",
        "modes:",
        "  recommend: true",
        "  self_improvement: true",
        "reasoning:",
        "  enabled: true",
        "  semantic_diff: true",
        "improvement_policy:",
        "  autonomous_mutation: true",
        "  max_autonomous_mutations: 1",
        "  min_confidence: 0.5",
        "",
      ].join("\n"),
    );
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    await run(["reason", "diff", base, regressed, "app"]);
    await run(["findings"]);
    const gate = JSON.parse(await run(["gate", "--json"]));
    expect(
      gate.decisions.find(
        (item: { subject: string }) => item.subject === "clients.create",
      )?.decision,
    ).toBe("eligible_for_harness");
    const recommendations = JSON.parse(await run(["recommend", "--json"]));
    const fix = recommendations.recommendations.find(
      (item: { id: string }) => item.id === "recommendation:clients.create:fix",
    );
    expect(fix?.harnessEligible).toBe(true);
    await run(["harness", "task", fix.id, regressed]);
    const [taskFile] = await readdir(path.join(cwd, "out", "harness", "tasks"));
    const task = parseHarnessTask(
      JSON.parse(
        await readFile(
          path.join(cwd, "out", "harness", "tasks", taskFile as string),
          "utf8",
        ),
      ),
    );
    expect(task.objective.desiredSemanticChange[0]).toMatchObject({
      kind: "remove-reachability",
      goal: "clients.created",
    });

    // The "harness": restore the guard on a branch, report the candidate.
    await git("checkout", "--quiet", "-b", "pathcompiler/fix");
    await writeFile(route, original);
    await git("commit", "--quiet", "-am", "Restore the editor check");
    const candidate = await git("rev-parse", "HEAD");
    await writeFile(
      path.join(cwd, "result.json"),
      JSON.stringify(
        runFixtureHarness(task, {
          outcome: "complete",
          candidateCommit: candidate,
        }),
      ),
    );
    const evaluation = await run(["harness", "import", "result.json", "app"]);
    expect(evaluation).toContain(
      `Candidate ${candidate.slice(0, 12)} against ${regressed.slice(0, 12)}: PASS`,
    );
    const report = JSON.parse(
      await readFile(
        path.join(cwd, "out", "reports", "evaluation", `${candidate}.json`),
        "utf8",
      ),
    );
    expect(report).toMatchObject({
      recommendationId: fix.id,
      mutationClaim: { claimedOutcome: "success", contradicted: false },
      intendedChange: { declared: true },
    });
    expect(
      report.intendedChange.expected.every(
        (item: { met: boolean }) => item.met,
      ),
    ).toBe(true);

    // A blocked harness is recorded with its question; nothing is evaluated.
    await writeFile(
      path.join(cwd, "blocked.json"),
      JSON.stringify(
        runFixtureHarness(
          task,
          { outcome: "block", reason: "Is open client creation intended?" },
          "run-2",
        ),
      ),
    );
    expect(await run(["harness", "import", "blocked.json", "app"])).toContain(
      "? Is open client creation intended?",
    );
    expect(
      await readdir(path.join(cwd, "out", "harness", "results")),
    ).toHaveLength(2);
  }, 300_000);

  it("covers a root cause shared by several capabilities with one task (#48)", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { cp, readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { runFixtureHarness, parseHarnessTask } = await import(
      "@pathcompiler/harness-contracts"
    );
    const exec = promisify(execFile);
    const fixture = fileURLToPath(
      new URL("../../../fixtures/next-demo", import.meta.url),
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-v0-role-"));
    temporary.push(cwd);
    const app = path.join(cwd, "app");
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.test",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.test",
    };
    const git = async (...args: string[]) =>
      (await exec("git", ["-C", app, ...args], { env })).stdout.trim();
    for (const file of (
      await exec("git", ["-C", fixture, "ls-files", "-z", "--", "."])
    ).stdout
      .split("\0")
      .filter(Boolean)) {
      await mkdir(path.dirname(path.join(app, file)), { recursive: true });
      await cp(path.join(fixture, file), path.join(app, file));
    }
    await git("init", "--quiet", "--initial-branch=main");
    await git("add", ".");
    await git("commit", "--quiet", "-m", "base");
    const base = await git("rev-parse", "HEAD");
    const session = path.join(app, "lib/session.ts");
    const original = await readFile(session, "utf8");
    // One edit removes editors from five capabilities and adds owners.
    await writeFile(
      session,
      original.replace('session.role !== "editor"', 'session.role !== "owner"'),
    );
    await git("commit", "--quiet", "-am", "Owner only");
    const regressed = await git("rev-parse", "HEAD");
    await writeFile(
      path.join(cwd, "pathcompiler.yaml"),
      "version: 1\nmodes:\n  recommend: true\n  self_improvement: true\nreasoning:\n  enabled: true\n  semantic_diff: true\nimprovement_policy:\n  autonomous_mutation: true\n  max_autonomous_mutations: 1\n  min_confidence: 0.5\n",
    );
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    await run(["reason", "diff", base, regressed, "app"]);
    const findings = JSON.parse(await run(["findings", "--json"]));
    expect(findings.opportunities).toHaveLength(1);
    expect(findings.opportunities[0].subjects.length).toBeGreaterThanOrEqual(5);
    await run(["gate"]);
    const [fix] = JSON.parse(
      await run(["recommend", "--json"]),
    ).recommendations;
    await run(["harness", "task", fix.id, regressed]);
    const [taskFile] = await readdir(path.join(cwd, "out", "harness", "tasks"));
    const task = parseHarnessTask(
      JSON.parse(
        await readFile(
          path.join(cwd, "out", "harness", "tasks", taskFile as string),
          "utf8",
        ),
      ),
    );
    expect(task.relevantContext.capabilityIds.length).toBeGreaterThanOrEqual(5);
    // The harness reverts the one cause; every affected capability is fixed.
    await git("checkout", "--quiet", "-b", "pathcompiler/fix");
    await writeFile(session, original);
    await git("commit", "--quiet", "-am", "Restore editors");
    const candidate = await git("rev-parse", "HEAD");
    await writeFile(
      path.join(cwd, "result.json"),
      JSON.stringify(
        runFixtureHarness(task, {
          outcome: "complete",
          candidateCommit: candidate,
        }),
      ),
    );
    expect(await run(["harness", "import", "result.json", "app"])).toContain(
      `Candidate ${candidate.slice(0, 12)} against ${regressed.slice(0, 12)}: PASS`,
    );
  }, 300_000);
});
