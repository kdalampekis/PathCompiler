import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseConfig } from "@pathcompiler/config";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Assessment,
  approveRun,
  type BehaviorSummary,
  type CodingAgent,
  decideNext,
  type EvaluationSummary,
  gitPublisher,
  listRuns,
  loadRun,
  mergeAssessment,
  type PipelineDeps,
  type Publisher,
  type PublishInput,
  rejectRun,
  scriptedAgent,
  startRun,
} from "../src/index.js";
import { cleanup, repository, taskFor } from "./helpers.js";

afterEach(cleanup);

const config = (harness = "", improvement = "") =>
  parseConfig(
    `version: 1\nmodes:\n  self_improvement: true\nimprovement_policy:\n  autonomous_mutation: ${improvement ? "true" : "false"}\n${improvement}harness:\n${harness || "  mode: approval\n"}`,
  );
const AUTOMATIC = (extra = "") =>
  config(`  mode: automatic\n${extra}`, "  max_autonomous_mutations: 2\n");

const passEvaluation: EvaluationSummary = {
  applied: true,
  status: "pass",
  risks: [],
  warnings: [],
};
const passBehavior: BehaviorSummary = {
  applied: true,
  verdict: "pass",
  findings: [],
  markdown:
    "### PathCompiler behavior check: No encoded rule is newly violated\n",
  report: {} as never,
};

async function setup(
  options: {
    cfg?: ReturnType<typeof config>;
    agent?: CodingAgent;
    evaluation?: EvaluationSummary | undefined;
    behavior?: BehaviorSummary | undefined;
    noChecks?: boolean;
    publishFails?: boolean;
  } = {},
) {
  const r = await repository();
  const cfg = options.cfg ?? config();
  const published: PublishInput[] = [];
  const started: string[] = [];
  const publisher: Publisher = {
    async publish(input) {
      if (options.publishFails) throw new Error("remote rejected the push");
      published.push(input);
      return {
        target: input.target,
        remote: input.remote,
        branch: input.branch,
        ...(input.target === "pull_request"
          ? { url: "https://example.test/pr/1" }
          : {}),
      };
    },
  };
  const agent =
    options.agent ??
    scriptedAgent(async ({ worktree }) => {
      started.push("agent");
      await writeFile(
        path.join(worktree, "src/app.ts"),
        "export const limit = 250;\n",
      );
      return { summary: "Raised the limit." };
    }, "fake");
  let counter = 0;
  const deps: PipelineDeps = {
    repo: r.repo,
    output: path.join(r.root, "out"),
    policy: cfg.harness,
    improvement: {
      autonomousMutation: cfg.improvement_policy.autonomous_mutation,
      maxAutonomousMutations: cfg.improvement_policy.max_autonomous_mutations,
    },
    baseBranch: "main",
    agent: () => agent,
    ...("evaluation" in options && options.evaluation === undefined
      ? {}
      : { evaluate: async () => options.evaluation ?? passEvaluation }),
    ...("behavior" in options && options.behavior === undefined
      ? {}
      : { behavior: async () => options.behavior ?? passBehavior }),
    publisher,
    worktreeParent: r.worktrees,
    newRunId: () => `run-20261030T10000${counter++}-00000${counter}`,
  };
  return { r, deps, task: await taskFor(r.base), published, started };
}

describe("approval mode", () => {
  it("runs the harness, assesses the candidate and waits for a person before anything is published", async () => {
    const { deps, task, published } = await setup();
    const run = await startRun(deps, task);
    expect(run.state).toBe("awaiting_approval");
    expect(run.mode).toBe("approval");
    expect(run.assessment?.verdict).toBe("pass");
    expect(run.decision).toMatchObject({
      action: "await_approval",
      by: "policy",
    });
    expect(published).toEqual([]);
    expect(run.branch).toBe(`pathcompiler/${run.runId}`);

    const approved = await approveRun(deps, run.runId, "ana@example.com");
    expect(approved.state).toBe("published");
    expect(approved.decision).toMatchObject({
      action: "publish",
      by: "ana@example.com",
    });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      target: "pull_request",
      baseBranch: "main",
      draft: true,
      branch: run.branch,
    });
    expect(published[0]?.body).toContain("approved by ana@example.com");
    expect(published[0]?.body).toContain("It has not been merged or deployed");
    expect(published[0]?.body).toContain("PathCompiler behavior check");
    expect(approved.history.map((item) => item.event)).toContain("published");
    expect((await loadRun(deps.output, run.runId)).state).toBe("published");
  });

  it("can ask a person before the harness even starts", async () => {
    const { deps, task, started } = await setup({
      cfg: config("  mode: approval\n  approvals:\n    before_run: true\n"),
    });
    const waiting = await startRun(deps, task);
    expect(waiting.state).toBe("awaiting_run_approval");
    expect(started).toEqual([]);
    const next = await approveRun(deps, waiting.runId, "ana");
    expect(started).toEqual(["agent"]);
    expect(next.state).toBe("awaiting_approval");
    expect(next.history.map((item) => item.event)).toEqual(
      expect.arrayContaining(["run_approved", "candidate commit"]),
    );
  });

  it("lets a person reject, and publishes nothing", async () => {
    const { deps, task, published } = await setup();
    const run = await startRun(deps, task);
    const rejected = await rejectRun(
      deps,
      run.runId,
      "ana",
      "Not the approach I want.",
    );
    expect(rejected.state).toBe("rejected");
    expect(rejected.history.at(-1)).toMatchObject({
      by: "ana",
      detail: "Not the approach I want.",
    });
    await expect(approveRun(deps, run.runId, "ana")).rejects.toThrow(
      "is rejected; there is nothing to approve",
    );
    expect(published).toEqual([]);
  });

  it("can publish just the branch, or nothing, as the approver chooses", async () => {
    const { deps, task, published } = await setup();
    const first = await startRun(deps, task);
    expect(
      (await approveRun(deps, first.runId, "ana", { target: "branch" }))
        .publish,
    ).toMatchObject({ target: "branch" });
    expect(published[0]?.target).toBe("branch");
    const second = await startRun(deps, task);
    const kept = await approveRun(deps, second.runId, "ana", {
      target: "none",
    });
    expect(kept.state).toBe("approved");
    expect(kept.history.at(-1)?.event).toBe("publish_skipped");
  });

  it("keeps a run publishable after a failed push, and says so", async () => {
    const { deps, task } = await setup({ publishFails: true });
    const run = await startRun(deps, task);
    await expect(approveRun(deps, run.runId, "ana")).rejects.toThrow(
      "remote rejected the push",
    );
    const after = await loadRun(deps.output, run.runId);
    expect(after.state).toBe("approved");
    expect(after.history.at(-1)?.event).toBe("publish_failed");
  });
});

describe("automatic mode", () => {
  it("publishes by itself when the candidate is clean and inside the limits", async () => {
    const { deps, task, published } = await setup({ cfg: AUTOMATIC() });
    const run = await startRun(deps, task);
    expect(run.state).toBe("published");
    expect(run.decision).toMatchObject({ action: "publish", by: "policy" });
    expect(published).toHaveLength(1);
    expect(published[0]?.body).toContain("cleared automatically by policy");
  });

  it("stops for a person when a limit is crossed, and says which", async () => {
    const files = await setup({
      cfg: AUTOMATIC(
        "  automatic:\n    max_files: 1\n    max_changed_lines: 1\n",
      ),
      agent: scriptedAgent(async ({ worktree }) => {
        await writeFile(
          path.join(worktree, "src/app.ts"),
          "export const limit = 1;\nexport const more = 2;\n",
        );
        await writeFile(
          path.join(worktree, "src/b.ts"),
          "export const b = 1;\n",
        );
      }),
    });
    const run = await startRun(files.deps, files.task);
    expect(run.state).toBe("awaiting_approval");
    expect(run.decision?.reasons.join(" ")).toContain(
      "more than automatic.max_files (1)",
    );
    expect(run.decision?.reasons.join(" ")).toContain(
      "more than automatic.max_changed_lines (1)",
    );
    expect(files.published).toEqual([]);
    // The person can still approve it.
    expect((await approveRun(files.deps, run.runId, "ana")).state).toBe(
      "published",
    );
  });

  it("always asks a person about reserved paths, and about a review verdict unless allowed", async () => {
    const reserved = await setup({
      cfg: AUTOMATIC('  automatic:\n    require_approval_paths: ["src/**"]\n'),
    });
    expect(
      (await startRun(reserved.deps, reserved.task)).decision?.reasons.join(
        " ",
      ),
    ).toContain("require_approval_paths reserves");
    const flagged: EvaluationSummary = {
      applied: true,
      status: "pass_with_warnings",
      risks: [],
      warnings: ["Unexpected change in plans.create"],
    };
    const review = await setup({ cfg: AUTOMATIC(), evaluation: flagged });
    const held = await startRun(review.deps, review.task);
    expect(held.state).toBe("awaiting_approval");
    expect(held.assessment?.verdict).toBe("review");
    expect(held.decision?.reasons.join(" ")).toContain(
      "automatic.allow_verdict is pass",
    );
    const lenient = await setup({
      cfg: AUTOMATIC("  automatic:\n    allow_verdict: review\n"),
      evaluation: flagged,
    });
    expect((await startRun(lenient.deps, lenient.task)).state).toBe(
      "published",
    );
  });

  it("limits how many automatic publications there can be in a day", async () => {
    const { deps, task, published } = await setup({
      cfg: config("  mode: automatic\n", "  max_autonomous_mutations: 1\n"),
    });
    expect((await startRun(deps, task)).state).toBe("published");
    const second = await startRun(deps, task);
    expect(second.state).toBe("awaiting_approval");
    expect(second.decision?.reasons.join(" ")).toContain(
      "max_autonomous_mutations is 1",
    );
    expect(published).toHaveLength(1);
  });

  it("needs the double opt-in in the configuration", async () => {
    expect(() => config("  mode: automatic\n")).toThrow("autonomous_mutation");
    const { deps, task } = await setup();
    await expect(
      startRun(
        {
          ...deps,
          improvement: { autonomousMutation: false, maxAutonomousMutations: 0 },
        },
        task,
        { mode: "automatic" },
      ),
    ).rejects.toThrow("autonomous_mutation");
  });
});

describe("what both modes refuse", () => {
  it("rejects a candidate that the independent checks fail, in either mode, and never publishes it", async () => {
    const failing: BehaviorSummary = {
      applied: true,
      verdict: "fail",
      findings: [
        "refund enforces refunds.manager_approval_over_limit: held at the base, violated at the head.",
      ],
      markdown: "x",
      report: {} as never,
    };
    for (const cfg of [config(), AUTOMATIC()]) {
      const { deps, task, published } = await setup({ cfg, behavior: failing });
      const run = await startRun(deps, task);
      expect(run.state).toBe("rejected");
      expect(run.decision?.reasons.join(" ")).toContain(
        "manager_approval_over_limit",
      );
      expect(published).toEqual([]);
      await expect(approveRun(deps, run.runId, "ana")).rejects.toThrow(
        "nothing to approve",
      );
    }
  });

  it("does not let the harness grade itself: with nothing independent to run the verdict is review", async () => {
    const { deps, task } = await setup({
      cfg: AUTOMATIC(),
      evaluation: undefined,
      behavior: undefined,
    });
    const run = await startRun(deps, task);
    expect(run.assessment?.verdict).toBe("review");
    expect(run.assessment?.reasons[0]?.message).toContain(
      "Nothing independent of the harness could be run",
    );
    expect(run.state).toBe("awaiting_approval");
  });

  it("ends a blocked or failed harness without a candidate, and an unusable run as an error", async () => {
    const blocked = await setup({
      agent: scriptedAgent(async () => ({
        status: "blocked",
        unresolvedQuestions: ["Which plan?"],
      })),
    });
    const run = await startRun(blocked.deps, blocked.task);
    expect(run.state).toBe("no_candidate");
    expect(run.result?.unresolvedQuestions).toEqual(["Which plan?"]);
    const broken = await setup();
    const bad = await startRun(broken.deps, {
      ...broken.task,
      repository: { ...broken.task.repository, baseCommit: "c".repeat(40) },
    });
    expect(bad.state).toBe("error");
    expect(bad.history.at(-1)?.detail).toContain("is not in");
  });

  it("stops after the daily run limit", async () => {
    const { deps, task } = await setup({
      cfg: config("  mode: approval\n  limits:\n    max_runs_per_day: 1\n"),
    });
    await startRun(deps, task);
    await expect(startRun(deps, task)).rejects.toThrow("max_runs_per_day is 1");
    expect(await listRuns(deps.output)).toHaveLength(1);
  });
});

describe("merging the harness with the deterministic checks", () => {
  const result = (overrides: Record<string, unknown> = {}) =>
    ({
      status: "completed",
      unresolvedQuestions: [],
      assumptions: [],
      ...overrides,
    }) as never;
  const base = {
    checks: [],
    safety: [],
    evaluation: passEvaluation,
    behavior: passBehavior,
  };
  it("takes the worst verdict of independent sources and lists every reason with its source", () => {
    expect(mergeAssessment({ ...base, result: result() }).verdict).toBe("pass");
    const merged = mergeAssessment({
      ...base,
      result: result({
        status: "partial",
        unresolvedQuestions: ["Is 250 right?"],
      }),
      checks: [{ command: "pnpm test", passed: false, exitCode: 1, tail: "" }],
      safety: [
        {
          rule: "tests_deleted",
          severity: "warn",
          path: "t.test.ts",
          detail: "t.test.ts, a test file, was deleted.",
        },
      ],
      evaluation: {
        applied: true,
        status: "fail",
        risks: ["Permission boundary changed"],
        warnings: [],
      },
    });
    expect(merged.verdict).toBe("fail");
    expect(
      merged.reasons.map((item) => `${item.source}:${item.verdict}`),
    ).toEqual([
      "harness:review",
      "harness:review",
      "checks:review",
      "safety:review",
      "evaluation:fail",
    ]);
  });
  it("counts a source that did not apply as nothing, not as a pass", () => {
    const merged = mergeAssessment({
      ...base,
      result: result(),
      evaluation: { applied: false, reason: "not a Next.js app" },
    });
    expect(merged.verdict).toBe("pass");
    expect(merged.evaluation).toEqual({
      applied: false,
      reason: "not a Next.js app",
    });
  });
});

describe("the decision table", () => {
  const policy = AUTOMATIC().harness;
  const assessment = (verdict: Assessment["verdict"]) =>
    ({
      verdict,
      reasons:
        verdict === "pass" ? [] : [{ source: "x", verdict, message: "m" }],
    }) as Assessment;
  const result = (status = "completed") => ({ status }) as never;
  const stats = { files: 2, changedLines: 20, paths: ["src/a.ts"] };
  const decide = (
    mode: "approval" | "automatic",
    verdict: Assessment["verdict"],
    used = 0,
    status = "completed",
  ) =>
    decideNext({
      policy,
      mode,
      assessment: assessment(verdict),
      result: result(status),
      stats,
      autonomy: { used, allowed: 2 },
    }).action;
  it("maps mode × verdict × limits to reject, ask or publish", () => {
    expect([
      decide("approval", "pass"),
      decide("approval", "review"),
      decide("approval", "fail"),
    ]).toEqual(["await_approval", "await_approval", "reject"]);
    expect([
      decide("automatic", "pass"),
      decide("automatic", "review"),
      decide("automatic", "fail"),
    ]).toEqual(["publish", "await_approval", "reject"]);
    expect(decide("automatic", "pass", 2)).toBe("await_approval");
    expect(decide("automatic", "pass", 0, "partial")).toBe("await_approval");
  });
});

describe("publishing", () => {
  it("pushes the branch without force and opens a draft pull request through gh", async () => {
    const calls: string[][] = [];
    const publisher = gitPublisher(async (argv) => {
      calls.push([...argv]);
      return {
        code: 0,
        stdout: argv[0] === "gh" ? "https://github.com/o/r/pull/9\n" : "",
        stderr: "",
      };
    });
    const input = {
      repo: "/r",
      branch: "pathcompiler/run-1",
      baseBranch: "main",
      remote: "origin",
      title: "T",
      body: "B",
      draft: true,
      target: "pull_request" as const,
    };
    expect(await publisher.publish(input)).toEqual({
      target: "pull_request",
      remote: "origin",
      branch: "pathcompiler/run-1",
      url: "https://github.com/o/r/pull/9",
    });
    expect(calls[0]).toEqual([
      "git",
      "push",
      "--set-upstream",
      "origin",
      "pathcompiler/run-1:pathcompiler/run-1",
    ]);
    expect(calls[0]).not.toContain("--force");
    expect(calls[1]?.slice(0, 3)).toEqual(["gh", "pr", "create"]);
    expect(calls[1]).toContain("--draft");
    await expect(
      publisher.publish({ ...input, branch: "main" }),
    ).rejects.toThrow("Refusing to publish the base branch");
  });
  it("says what happened when the push or the pull request fails", async () => {
    const failPush = gitPublisher(async () => ({
      code: 1,
      stdout: "",
      stderr: "fatal: no remote",
    }));
    await expect(
      failPush.publish({
        repo: "/r",
        branch: "b",
        baseBranch: "main",
        remote: "origin",
        title: "",
        body: "",
        draft: true,
        target: "branch",
      }),
    ).rejects.toThrow("Nothing was published");
    const failPr = gitPublisher(async (argv) =>
      argv[0] === "gh"
        ? { code: 1, stdout: "", stderr: "not logged in" }
        : { code: 0, stdout: "", stderr: "" },
    );
    await expect(
      failPr.publish({
        repo: "/r",
        branch: "b",
        baseBranch: "main",
        remote: "origin",
        title: "",
        body: "",
        draft: true,
        target: "pull_request",
      }),
    ).rejects.toThrow("was pushed to origin, but opening the pull request");
  });
});
