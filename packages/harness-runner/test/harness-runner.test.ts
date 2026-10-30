import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkSafety,
  commandAgent,
  commandCompletion,
  commandRepairProvider,
  createCommandModelProvider,
  executeHarness,
  globToRegExp,
  parseCommandLine,
  redactSecretsInText,
  runJsonCommand,
  scriptedAgent,
} from "../src/index.js";
import { cleanup, repository, taskFor } from "./helpers.js";

afterEach(cleanup);
const node = process.execPath;

describe("command line", () => {
  it("splits quotes like a shell without running one, and takes a JSON array", () => {
    expect(parseCommandLine(`claude -p "fix it" --flag 'a b'`)).toEqual([
      "claude",
      "-p",
      "fix it",
      "--flag",
      "a b",
    ]);
    expect(parseCommandLine('["node","-e","1"]')).toEqual(["node", "-e", "1"]);
    expect(parseCommandLine('x ""')).toEqual(["x", ""]);
    expect(() => parseCommandLine('x "open')).toThrow("unclosed quote");
    expect(() => parseCommandLine("   ")).toThrow("empty");
    expect(() => parseCommandLine("[1]")).toThrow("non-empty strings");
  });
});

describe("a harness as a JSON command", () => {
  const echo = [
    node,
    "-e",
    "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const i=JSON.parse(d);console.log(JSON.stringify({got:i.kind,protocol:i.protocol,input:i.input}))})",
  ];
  it("sends the task on stdin and reads JSON from stdout", async () => {
    const answer = await commandCompletion({ argv: echo })({
      kind: "discoverRules",
      instructions: "x",
      input: JSON.stringify({ a: 1 }),
      outputSchema: {},
    });
    expect(answer).toEqual({
      got: "discoverRules",
      protocol: "pathcompiler-command/1",
      input: { a: 1 },
    });
  });

  it("reports a failing, silent, non-JSON or stuck command as an error with the reason", async () => {
    const run = (code: string, timeoutMs = 5000) =>
      runJsonCommand({ argv: [node, "-e", code], timeoutMs }, {});
    await expect(run("process.exit(3)")).rejects.toThrow("exited with code 3");
    await expect(run("console.error('boom');process.exit(1)")).rejects.toThrow(
      "boom",
    );
    await expect(run("console.log('not json')")).rejects.toThrow(
      "did not print JSON",
    );
    await expect(run("setTimeout(()=>{},60000)", 200)).rejects.toThrow(
      "did not answer within",
    );
    await expect(
      runJsonCommand({ argv: ["/no/such/command"], timeoutMs: 1000 }, {}),
    ).rejects.toThrow("Cannot run");
  });

  it("serves the analysis tasks and the repair requests with the same protocol", async () => {
    const provider = createCommandModelProvider({
      argv: [
        node,
        "-e",
        "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify({aliases:['a b']})))",
      ],
    });
    expect(provider.id).toBe("command");
    expect(
      await provider.generateAliases({
        workflowId: "w",
        title: "T",
        intent: { action: "a", entity: "e" },
        existingAliases: [],
      }),
    ).toEqual({ aliases: ["a b"] });
    const repair = commandRepairProvider({
      argv: [
        node,
        "-e",
        "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const i=JSON.parse(d);console.log(JSON.stringify({edits:[{path:i.input.files[0].path,content:'x'}],rationale:i.kind}))})",
      ],
    });
    expect(
      await repair.proposeRepair({
        iteration: 1,
        maxIterations: 1,
        files: [{ path: "a.ts", content: "" }],
      } as never),
    ).toEqual({ edits: [{ path: "a.ts", content: "x" }], rationale: "repair" });
  });
});

describe("safety rules", () => {
  const file = (p: string, status: "A" | "M" | "D" = "M") => ({
    status,
    path: p,
  });
  it("blocks protected paths, secrets, and warns about deleted tests", () => {
    const findings = checkSafety({
      files: [
        file("pathcompiler.yaml"),
        file(".github/workflows/ci.yml"),
        file("spec/approved-rules.json"),
        file("src/a.ts"),
        file("tests/a.test.ts", "D"),
        file("custom/x.ts"),
      ],
      added: [
        {
          path: "src/a.ts",
          line: 3,
          text: 'const key = "sk-ant-abcdefghijklmnopqrstuv";',
        },
        { path: "src/a.ts", line: 4, text: "const fine = 1;" },
        {
          path: "src/b.ts",
          line: 1,
          text: 'password = "hunter2hunter2hunter2"',
        },
      ],
      protectedPaths: ["custom/**"],
    });
    expect(
      findings
        .filter((item) => item.severity === "block")
        .map((item) => item.path),
    ).toEqual([
      "pathcompiler.yaml",
      ".github/workflows/ci.yml",
      "spec/approved-rules.json",
      "custom/x.ts",
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(
      findings.find((item) => item.rule === "tests_deleted")?.severity,
    ).toBe("warn");
    expect(
      findings.find((item) => item.rule === "secret")?.detail,
    ).not.toContain("sk-ant");
    expect(redactSecretsInText("x sk-ant-abcdefghijklmnopqrstuv y")).toBe(
      "x [redacted] y",
    );
  });
  it("matches globs", () => {
    expect(globToRegExp("**/*.pem").test("a/b/c.pem")).toBe(true);
    expect(globToRegExp("**/*.pem").test("c.pem")).toBe(true);
    expect(globToRegExp(".env.*").test(".env.local")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
  });
});

describe("Harness V0: executeHarness", () => {
  const baseInput = async (
    agent: Parameters<typeof executeHarness>[0]["agent"],
    extra: Partial<Parameters<typeof executeHarness>[0]> = {},
  ) => {
    const r = await repository();
    return {
      r,
      input: {
        repo: r.repo,
        task: await taskFor(r.base),
        agent,
        runId: "run-1",
        runDirectory: path.join(r.runs, "run-1"),
        worktreeParent: r.worktrees,
        ...extra,
      },
    };
  };

  it("works in an isolated worktree, commits a candidate and emits a valid result, leaving your tree alone", async () => {
    const agent = scriptedAgent(async ({ worktree }) => {
      await writeFile(
        path.join(worktree, "src/app.ts"),
        'export const title = "demo 250";\n',
      );
      return {
        summary: "Retitled the page.",
        assumptions: ["250 is enough"],
        claimedSemanticChanges: [
          { goal: "clients.created", kind: "restore-reachability" },
        ],
      };
    }, "test-agent");
    const { r, input } = await baseInput(agent, {
      checks: [`${node} -e "process.exit(0)"`],
    });
    const run = await executeHarness(input);
    expect(run.exitCode).toBe(0);
    expect(run.result).toMatchObject({
      status: "completed",
      changedFiles: ["src/app.ts"],
      implementationSummary: "Retitled the page.",
      assumptions: ["250 is enough"],
      repository: { baseCommit: r.base, branch: "pathcompiler/run-1" },
      harnessMetadata: { provider: "test-agent", runId: "run-1" },
    });
    expect(run.candidateCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(run.stats).toMatchObject({ files: 1, changedLines: 2 });
    expect(run.checks).toEqual([expect.objectContaining({ passed: true })]);
    // The candidate is on its branch, one commit above the base.
    const log = (
      await r.git("log", "--format=%H %s", "pathcompiler/run-1")
    ).stdout
      .trim()
      .split("\n");
    expect(log).toHaveLength(2);
    expect(log[0]).toContain("PathCompiler harness:");
    expect(await readFile(path.join(r.repo, "src/app.ts"), "utf8")).toBe(
      'export const title = "demo";\n',
    );
    expect((await r.git("status", "--porcelain")).stdout).toBe("");
    expect((await r.git("rev-parse", "HEAD")).stdout.trim()).toBe(r.base);
    await expect(stat(path.join(r.worktrees, "run-1"))).rejects.toThrow();
    expect(run.trace.map((item) => item.step)).toEqual([
      "task loaded",
      "worktree created",
      "agent started",
      "agent finished",
      "files changed",
      "check",
      "candidate commit",
      "baseline",
      "result emitted",
    ]);
  });

  it("runs a real command harness with the documented environment and exit codes", async () => {
    const script =
      "const fs=require('fs');fs.writeFileSync('src/app.ts','export const title = \"demo 7\";\\n');fs.writeFileSync(process.env.PATHCOMPILER_NOTES,JSON.stringify({summary:'cmd '+require('path').basename(process.env.PATHCOMPILER_TASK),unresolvedQuestions:['Is demo 7 right?']}));process.exit(2)";
    const { input } = await baseInput(
      commandAgent([node, "-e", script], { id: "cmd", version: "1.2" }),
    );
    const run = await executeHarness(input);
    expect(run.exitCode).toBe(2);
    expect(run.result).toMatchObject({
      status: "partial",
      implementationSummary: "cmd task.json",
      unresolvedQuestions: ["Is demo 7 right?"],
      harnessMetadata: { provider: "cmd", version: "1.2" },
    });
    expect(run.candidateCommit).not.toBeNull();
  });

  it("attributes a red check to the change only when it passed at the base", async () => {
    const agent = scriptedAgent(async ({ worktree }) => {
      await writeFile(
        path.join(worktree, "src/app.ts"),
        'export const title = "demo 1";\n',
      );
    });
    // Passes on the base text, fails on the changed text.
    const regression = await baseInput(agent, {
      checks: [
        `${node} -e "process.exit(require('fs').readFileSync('src/app.ts','utf8').includes('demo 1')?1:0)"`,
      ],
    });
    const run = await executeHarness(regression.input);
    expect(run.checksReport.comparison[0]).toMatchObject({
      outcome: "regression",
      base: true,
      candidate: false,
    });
    expect(run.result.status).toBe("partial");
    expect(run.result.unresolvedQuestions.join(" ")).toContain(
      "passed at the base and fails with the change",
    );
    expect(run.candidateCommit).not.toBeNull();

    // Red before the change in the same way: not the change's doing.
    const before = await baseInput(agent, {
      runId: "run-2",
      runDirectory: path.join((await repository()).runs, "run-2"),
      checks: [`${node} -e "console.error('3 tests failed');process.exit(1)"`],
    });
    const same = await executeHarness(before.input);
    expect(same.checksReport.comparison[0]).toMatchObject({
      outcome: "fails_both",
      sameFailure: true,
    });
    expect(same.result.status).toBe("completed");

    // Without a baseline there is nothing to compare with, so it is the change's to answer for.
    const alone = await baseInput(agent, {
      runId: "run-3",
      runDirectory: path.join((await repository()).runs, "run-3"),
      baseline: false,
      checks: [`${node} -e "process.exit(1)"`],
    });
    const solo = await executeHarness(alone.input);
    expect(solo.checksReport.comparison[0]?.outcome).toBe("fails_no_baseline");
    expect(solo.result.status).toBe("partial");
  });

  it("runs setup and links dependency directories into both worktrees", async () => {
    const r = await repository({
      "src/app.ts": 'export const title = "demo";\n',
      "check.cjs":
        "process.exit(require('fs').existsSync('prepared.txt') && require('fs').existsSync('deps/marker') ? 0 : 1)",
    });
    await mkdir(path.join(r.repo, "deps"));
    await writeFile(path.join(r.repo, "deps/marker"), "x");
    await r.git("add", "-A").catch(() => undefined);
    const agent = scriptedAgent(async ({ worktree }) => {
      await writeFile(
        path.join(worktree, "src/app.ts"),
        'export const title = "demo 2";\n',
      );
    });
    const run = await executeHarness({
      repo: r.repo,
      task: await taskFor(r.base),
      agent,
      runId: "run-4",
      runDirectory: path.join(r.runs, "run-4"),
      worktreeParent: r.worktrees,
      setup: [`${node} -e "require('fs').writeFileSync('prepared.txt','1')"`],
      linkPaths: ["deps"],
      checks: [`${node} check.cjs`],
    });
    expect(
      run.checksReport.comparison.map((item) => [item.kind, item.outcome]),
    ).toEqual([
      ["setup", "passes"],
      ["check", "passes"],
    ]);
    expect(run.checksReport.base?.map((item) => item.passed)).toEqual([
      true,
      true,
    ]);
    await expect(
      executeHarness({
        repo: r.repo,
        task: await taskFor(r.base),
        agent,
        runId: "run-5",
        runDirectory: path.join(r.runs, "run-5"),
        worktreeParent: r.worktrees,
        linkPaths: ["../outside"],
        checks: [`${node} check.cjs`],
      }),
    ).rejects.toThrow("must be a relative path inside the repository");
  });

  it("discards a candidate that touches a protected path or adds a secret, and keeps no branch", async () => {
    const agent = scriptedAgent(async ({ worktree }) => {
      await writeFile(path.join(worktree, "pathcompiler.yaml"), "version: 1\n");
      await writeFile(
        path.join(worktree, "src/app.ts"),
        'export const key = "sk-ant-abcdefghijklmnopqrstuv";\n',
      );
    });
    const { r, input } = await baseInput(agent);
    const run = await executeHarness(input);
    expect(run.exitCode).toBe(3);
    expect(run.result).toMatchObject({ status: "blocked", changedFiles: [] });
    expect(run.result.repository.candidateCommit).toBeUndefined();
    expect(run.result.unresolvedQuestions.join(" ")).toContain(
      "pathcompiler.yaml is protected",
    );
    expect(run.result.unresolvedQuestions.join(" ")).not.toContain("sk-ant");
    expect(run.branch).toBeNull();
    expect(
      (await r.git("branch", "--list", "pathcompiler/*")).stdout.trim(),
    ).toBe("");
  });

  it("reports blocked and failed agents, and an agent that changes nothing", async () => {
    const blocked = await baseInput(
      scriptedAgent(async () => ({
        status: "blocked",
        unresolvedQuestions: ["Which plan?"],
      })),
    );
    const b = await executeHarness(blocked.input);
    expect(b.result).toMatchObject({
      status: "blocked",
      unresolvedQuestions: ["Which plan?"],
    });
    expect(b.exitCode).toBe(3);
    const failed = await baseInput(
      scriptedAgent(async () => {
        throw new Error("agent crashed");
      }),
    );
    const f = await executeHarness(failed.input);
    expect(f.result.status).toBe("failed");
    expect(f.exitCode).toBe(4);
    const nothing = await baseInput(
      scriptedAgent(async () => ({ summary: "done" })),
    );
    const n = await executeHarness(nothing.input);
    expect(n.result.status).toBe("blocked");
    expect(n.result.unresolvedQuestions.join(" ")).toContain("changed nothing");
    const stuck = await baseInput(
      commandAgent([node, "-e", "setTimeout(()=>{},60000)"]),
      { agentTimeoutMs: 300 },
    );
    expect((await executeHarness(stuck.input)).result.status).toBe("failed");
  });

  it("fails before touching anything for a bad task, an unknown base commit or a reused run ID", async () => {
    const { r, input } = await baseInput(scriptedAgent(async () => undefined));
    await expect(
      executeHarness({
        ...input,
        task: {
          ...input.task,
          repository: { ...input.task.repository, baseCommit: "b".repeat(40) },
        },
      }),
    ).rejects.toThrow("is not in");
    await expect(
      executeHarness({
        ...input,
        task: { ...input.task, schemaVersion: "2.0" } as never,
      }),
    ).rejects.toThrow();
    await r.git("branch", "pathcompiler/run-1");
    await expect(executeHarness(input)).rejects.toThrow("already exists");
    expect((await r.git("status", "--porcelain")).stdout).toBe("");
  });

  it("records the run it retries", async () => {
    const agent = scriptedAgent(async ({ worktree }) => {
      await writeFile(
        path.join(worktree, "src/app.ts"),
        'export const title = "demo 3";\n',
      );
    });
    const { input } = await baseInput(agent, { previousRunId: "run-0" });
    expect(
      (await executeHarness(input)).result.harnessMetadata.previousRunId,
    ).toBe("run-0");
  });
});
