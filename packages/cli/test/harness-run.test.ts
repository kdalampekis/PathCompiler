import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const exec = promisify(execFile);
const refunds = fileURLToPath(
  new URL("../../../fixtures/refunds/", import.meta.url),
);
const example = fileURLToPath(
  new URL("../../../examples/harness-contract/task.json", import.meta.url),
);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => rm(item, { recursive: true, force: true })),
  );
});
const BIND = [
  "--bind",
  "payment=payments",
  "--bind",
  "createRefund=refund",
  "--bind",
  "request=refund_requests",
];

const POLICY = (harness: string, automatic = false) =>
  `version: 1\nmodes:\n  self_improvement: true\nimprovement_policy:\n  autonomous_mutation: ${automatic}\n${automatic ? "  max_autonomous_mutations: 3\n" : ""}harness:\n${harness}`;

/** A refund repository with a remote, a config, a task and a harness script. */
async function setup(yaml: string) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-harness-"));
  temporary.push(cwd);
  const repo = path.join(cwd, "repo");
  const remote = path.join(cwd, "remote.git");
  await cp(refunds, repo, { recursive: true });
  await cp(path.join(refunds, "variants"), path.join(cwd, "variants"), {
    recursive: true,
  });
  await rm(path.join(repo, "variants"), { recursive: true });
  await writeFile(path.join(repo, "pathcompiler.yaml"), yaml);
  const git = (...args: string[]) =>
    exec(
      "git",
      [
        "-c",
        "user.name=T",
        "-c",
        "user.email=t@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: repo },
    );
  await exec("git", ["init", "-q", "--bare", remote]);
  await git("init", "-q", "-b", "main");
  await git("add", "-A");
  await git("commit", "-q", "-m", "base");
  await git("remote", "add", "origin", remote);
  const base = (await git("rev-parse", "HEAD")).stdout.trim();
  const task = JSON.parse(await readFile(example, "utf8"));
  task.repository.baseCommit = base;
  await writeFile(path.join(cwd, "task.json"), JSON.stringify(task));
  await writeFile(
    path.join(cwd, "harness.cjs"),
    "const fs=require('fs');fs.copyFileSync(process.argv[2],'src/refunds.ts');fs.writeFileSync(process.env.PATHCOMPILER_NOTES,JSON.stringify({summary:'Changed the refund guard.',assumptions:['No other caller depends on it.']}));",
  );
  const harness = (variant: string) =>
    `node ${path.join(cwd, "harness.cjs")} ${path.join(cwd, "variants", `${variant}.ts`)}`;
  const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
  const remoteBranches = async () =>
    (await exec("git", [`--git-dir=${remote}`, "branch", "--list"])).stdout;
  return { cwd, repo, git, base, harness, run, remoteBranches };
}
const start = (
  s: Awaited<ReturnType<typeof setup>>,
  variant: string,
  extra: string[] = [],
) =>
  s.run([
    "harness",
    "run",
    path.join(s.cwd, "task.json"),
    s.repo,
    "--harness-command",
    s.harness(variant),
    ...BIND,
    ...extra,
  ]);
const runId = (text: string) =>
  /Run (run-[0-9T]+-[0-9a-f]{6})/.exec(text)?.[1] as string;

describe("harness run: approval mode", () => {
  it("runs your harness in a worktree, assesses the change, and publishes only after a person approves", async () => {
    const s = await setup(
      POLICY("  mode: approval\n  publish:\n    target: branch\n"),
    );
    const text = await start(s, "benign-refactor");
    expect(text).toContain("(approval mode): AWAITING APPROVAL");
    expect(text).toContain("Assessment: pass");
    expect(text).toContain("behavior check: pass");
    expect(text).toContain("product-model evaluation: not applied");
    const id = runId(text);
    // Your own working tree is untouched and nothing has left the machine.
    expect((await s.git("status", "--porcelain")).stdout).toBe("");
    expect((await s.git("rev-parse", "HEAD")).stdout.trim()).toBe(s.base);
    expect(await s.remoteBranches()).toBe("");
    expect(await s.run(["harness", "runs"])).toContain(
      `${id} awaiting_approval (approval)`,
    );
    expect(
      await readFile(
        path.join(s.cwd, "out", "harness", "runs", id, "report.md"),
        "utf8",
      ),
    ).toContain("It has not been merged or deployed");

    await expect(s.run(["harness", "approve", id, s.repo])).rejects.toThrow(
      "Record who is reviewing",
    );
    const approved = await s.run([
      "harness",
      "approve",
      id,
      s.repo,
      "--by",
      "ana@example.com",
    ]);
    expect(approved).toContain("PUBLISHED");
    expect(approved).toContain("Nothing is merged or deployed");
    expect(await s.remoteBranches()).toContain(`pathcompiler/${id}`);
    const status = await s.run(["harness", "status", id]);
    expect(status).toContain("approved (ana@example.com)");
    expect(status).toContain("published (ana@example.com)");
    // The main branch of the remote was never touched.
    expect(await s.remoteBranches()).not.toContain("main");
  }, 180_000);

  it("rejects a change that breaks an approved rule while the example tests pass, and publishes nothing", async () => {
    const s = await setup(POLICY("  mode: approval\n"));
    const failure = await start(s, "support-fast-path").catch(
      (error: Error) => error.message,
    );
    expect(failure).toContain("REJECTED");
    expect(failure).toContain(
      "behavior: refund enforces refunds.manager_approval_over_limit",
    );
    expect(failure).toContain("Nothing was published.");
    expect(await s.remoteBranches()).toBe("");
  }, 180_000);

  it("can wait for a person before the harness starts at all", async () => {
    const s = await setup(
      POLICY("  mode: approval\n  approvals:\n    before_run: true\n"),
    );
    const waiting = await start(s, "benign-refactor");
    expect(waiting).toContain("AWAITING RUN APPROVAL");
    const id = runId(waiting);
    expect((await s.git("branch", "--list", "pathcompiler/*")).stdout).toBe("");
    // Approving the start needs the harness command again.
    await expect(
      s.run(["harness", "approve", id, s.repo, "--by", "ana"]),
    ).rejects.toThrow("No harness command");
    const approved = await s.run([
      "harness",
      "approve",
      id,
      s.repo,
      "--by",
      "ana",
      "--harness-command",
      s.harness("benign-refactor"),
      ...BIND,
    ]);
    expect(approved).toContain("AWAITING APPROVAL");
    expect(
      (await s.git("branch", "--list", "pathcompiler/*")).stdout,
    ).toContain(id);
    expect(
      await s.run([
        "harness",
        "reject",
        id,
        s.repo,
        "--by",
        "ana",
        "--reason",
        "Changed my mind.",
      ]),
    ).toContain("REJECTED");
  }, 180_000);
});

describe("harness run: automatic mode", () => {
  it("publishes by itself when the candidate is clean, and holds the one that is not", async () => {
    const s = await setup(
      POLICY("  mode: automatic\n  publish:\n    target: branch\n", true),
    );
    const clean = await start(s, "benign-refactor");
    expect(clean).toContain("PUBLISHED");
    expect(clean).toContain("Decision (policy): publish");
    expect(await s.remoteBranches()).toContain(`pathcompiler/${runId(clean)}`);

    const broken = await start(s, "support-fast-path").catch(
      (error: Error) => error.message,
    );
    expect(broken).toContain("REJECTED");
    expect((await s.remoteBranches()).match(/pathcompiler\//g)).toHaveLength(1);

    // A limit you set turns an automatic run into an ask.
    const held = await setup(
      POLICY(
        "  mode: automatic\n  publish:\n    target: branch\n  automatic:\n    max_changed_lines: 1\n",
        true,
      ),
    );
    const waiting = await start(held, "benign-refactor");
    expect(waiting).toContain("AWAITING APPROVAL");
    expect(waiting).toContain("more than automatic.max_changed_lines (1)");
    expect(await held.remoteBranches()).toBe("");
  }, 240_000);

  it("can be started in the other mode for one run", async () => {
    const s = await setup(
      POLICY("  mode: automatic\n  publish:\n    target: branch\n", true),
    );
    expect(await start(s, "benign-refactor", ["--mode", "approval"])).toContain(
      "(approval mode): AWAITING APPROVAL",
    );
  }, 180_000);
});

describe("harness run: refusals", () => {
  it("needs mode 6, a harness command that is not read from the repository, and valid options", async () => {
    const s = await setup(POLICY("  mode: approval\n"));
    await expect(
      s.run(["harness", "run", path.join(s.cwd, "task.json"), s.repo, ...BIND]),
    ).rejects.toThrow("No harness command");
    await expect(
      start(s, "benign-refactor", ["--mode", "fast"]),
    ).rejects.toThrow("--mode must be approval or automatic");
    await expect(
      s.run([
        "harness",
        "approve",
        "run-20260101T000000-aaaaaa",
        s.repo,
        "--by",
        "a",
      ]),
    ).rejects.toThrow("No harness run");
    await expect(
      s.run(["harness", "approve", "bad", s.repo, "--by", "a"]),
    ).rejects.toThrow("is not a run ID");
    await expect(runCli(["scan", ".", "--mode", "x"])).rejects.toThrow(
      "only supported by harness",
    );
    await expect(
      runCli(["scan", ".", "--harness-command", "x"]),
    ).rejects.toThrow(
      "only supported by harness run, repair propose and rules discover",
    );
    await writeFile(path.join(s.repo, "pathcompiler.yaml"), "version: 1\n");
    await expect(start(s, "benign-refactor")).rejects.toThrow(
      "modes.self_improvement: true",
    );
    await rm(path.join(s.repo, "pathcompiler.yaml"));
    await expect(start(s, "benign-refactor")).rejects.toThrow(
      "needs pathcompiler.yaml",
    );
  }, 180_000);
});

describe("a harness answering structured tasks", () => {
  it("proposes repairs and rules through the same JSON command", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-command-"));
    temporary.push(cwd);
    const repo = path.join(cwd, "repo");
    await cp(refunds, repo, { recursive: true });
    await cp(
      path.join(refunds, "variants", "support-fast-path.ts"),
      path.join(repo, "src", "refunds.ts"),
    );
    // The "harness" repairs by returning the original file.
    const original = await readFile(
      path.join(refunds, "src", "refunds.ts"),
      "utf8",
    );
    await writeFile(
      path.join(cwd, "repairer.cjs"),
      `let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const i=JSON.parse(d);if(i.kind!=='repair'){console.log(JSON.stringify({proposals:[]}));return}console.log(JSON.stringify({edits:[{path:i.input.files[0].path,content:${JSON.stringify(original)}}],rationale:'Restore the guard.'}))})`,
    );
    const command = `node ${path.join(cwd, "repairer.cjs")}`;
    const repaired = await runCli(
      [
        "repair",
        "propose",
        repo,
        "--harness-command",
        command,
        ...BIND,
        "--exclude",
        "variants",
        "--out",
        "out",
      ],
      cwd,
    );
    expect(repaired).toContain(
      "Repair found for refunds.manager_approval_over_limit",
    );
    expect(repaired).toContain("attempt 1: repaired");
    const rules = await runCli(
      [
        "rules",
        "discover",
        repo,
        "--harness-command",
        command,
        ...BIND,
        "--exclude",
        "variants",
        "--out",
        "out",
      ],
      cwd,
    );
    expect(rules).toContain("harness command proposed 0 rule(s)");
  }, 180_000);
});

describe("harness on a Python repository (any stack)", () => {
  const pyrefunds = fileURLToPath(
    new URL("../../../fixtures/pyrefunds/", import.meta.url),
  );
  const CHECK = "python3 -m unittest discover -s tests -t .";
  async function pythonSetup(yaml: string) {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-py-"));
    temporary.push(cwd);
    const repo = path.join(cwd, "repo");
    await cp(pyrefunds, repo, { recursive: true });
    await rm(path.join(repo, "variants"), { recursive: true });
    await writeFile(path.join(repo, "pathcompiler.yaml"), yaml);
    const git = (...args: string[]) =>
      exec(
        "git",
        [
          "-c",
          "user.name=T",
          "-c",
          "user.email=t@example.com",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd: repo },
      );
    await git("init", "-q", "-b", "main");
    await git("add", "-A");
    await git("commit", "-q", "-m", "base");
    const base = (await git("rev-parse", "HEAD")).stdout.trim();
    const task = JSON.parse(await readFile(example, "utf8"));
    task.repository.baseCommit = base;
    await writeFile(path.join(cwd, "task.json"), JSON.stringify(task));
    await writeFile(
      path.join(cwd, "harness.cjs"),
      "require('fs').copyFileSync(process.argv[2],'refunds/service.py')",
    );
    const harness = (variant: string) =>
      `node ${path.join(cwd, "harness.cjs")} ${path.join(pyrefunds, "variants", `${variant}.py`)}`;
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    return { cwd, repo, harness, run };
  }

  it("suggests the project's own checks for any ecosystem and runs nothing", async () => {
    const s = await pythonSetup(POLICY("  mode: approval\n"));
    const text = await s.run(["harness", "detect", s.repo]);
    expect(text).toContain("python test: python3 -m unittest discover");
    expect(text).toContain("nothing was run");
    expect(text).toContain("harness:");
    expect(text).toContain("baseline: true");
    expect(await s.run(["harness", "detect", s.repo, "--json"])).toContain(
      '"ecosystem": "python"',
    );
  }, 120_000);

  it("assesses a Python change with the project's tests compared with the base, and rejects a regression", async () => {
    const s = await pythonSetup(
      POLICY(`  mode: approval\n  checks: ["${CHECK}"]\n`),
    );
    const run = (variant: string) =>
      s.run([
        "harness",
        "run",
        path.join(s.cwd, "task.json"),
        s.repo,
        "--harness-command",
        s.harness(variant),
      ]);
    const clean = await run("benign_refactor");
    expect(clean).toContain("AWAITING APPROVAL");
    expect(clean).toContain("vouched for by: checks");
    expect(clean).toContain("Business rules were not checked");
    const broken = await run("breaks_tests").catch(
      (error: Error) => error.message,
    );
    expect(broken).toContain("REJECTED");
    expect(broken).toContain(
      "passed at the base commit and fails with the change",
    );
    const limit = await run("raises_limit");
    expect(limit).toContain("changes a number from 5000 to 50000");
    expect(limit).toContain("Assessment: review");
  }, 240_000);

  it("adds a separate reviewer whose findings must cite evidence in the candidate", async () => {
    const s = await pythonSetup(
      POLICY(`  mode: approval\n  checks: ["${CHECK}"]\n`),
    );
    await writeFile(
      path.join(s.cwd, "reviewer.cjs"),
      `let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const i=JSON.parse(d);console.log(JSON.stringify({findings:[{severity:'concern',message:'Support agents skip manager approval.',evidence:[{file:'refunds/service.py',quote:'actor["role"] != "support_agent"'}]},{severity:'concern',message:'Invented.',evidence:[{file:'refunds/service.py',quote:'not in the file'}]}]}))})`,
    );
    const text = await s.run([
      "harness",
      "run",
      path.join(s.cwd, "task.json"),
      s.repo,
      "--harness-command",
      s.harness("support_fast_path"),
      "--review-command",
      `node ${path.join(s.cwd, "reviewer.cjs")}`,
    ]);
    expect(text).toContain("Assessment: review");
    expect(text).toContain(
      "reviewer: Support agents skip manager approval. (refunds/service.py)",
    );
    expect(text).not.toContain("Invented");
    expect(text).toContain("1 reviewer finding(s) were discarded");
  }, 240_000);
});
