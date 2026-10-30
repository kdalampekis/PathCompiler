import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseConfig } from "@pathcompiler/config";
import { parseHarnessTask } from "@pathcompiler/harness-contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  analyzeRisk,
  commandAgent,
  commandReviewer,
  detectChecks,
  git,
  type PipelineDeps,
  type Publisher,
  type Reviewer,
  runReview,
  startRun,
} from "../src/index.js";

const exec = promisify(execFile);
const pyrefunds = fileURLToPath(
  new URL("../../../fixtures/pyrefunds/", import.meta.url),
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
const CHECK = "python3 -m unittest discover -s tests -t .";

const config = (harness: string, improvement = "") =>
  parseConfig(
    `version: 1\nmodes:\n  self_improvement: true\nimprovement_policy:\n  autonomous_mutation: ${improvement ? "true" : "false"}\n${improvement}harness:\n${harness}`,
  );

/** A Python repository — no TypeScript, no Next.js — and a harness that applies one of the variants. */
async function python(
  options: {
    harness?: string;
    improvement?: string;
    reviewer?: Reviewer;
    removeTests?: boolean;
  } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-python-"));
  temporary.push(root);
  const repo = path.join(root, "repo");
  await cp(pyrefunds, repo, { recursive: true });
  await rm(path.join(repo, "variants"), { recursive: true });
  if (options.removeTests)
    await rm(path.join(repo, "tests"), { recursive: true });
  const run = (...args: string[]) =>
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
  await run("init", "-q", "-b", "main");
  await run("add", "-A");
  await run("commit", "-q", "-m", "base");
  const base = (await run("rev-parse", "HEAD")).stdout.trim();
  const task = parseHarnessTask({
    ...JSON.parse(await readFile(example, "utf8")),
    repository: { projectId: "py", baseCommit: base },
  });
  const cfg = config(
    options.harness ?? `  mode: approval\n  checks: ["${CHECK}"]\n`,
    options.improvement,
  );
  const published: string[] = [];
  const publisher: Publisher = {
    async publish(input) {
      published.push(input.branch);
      return {
        target: input.target,
        remote: input.remote,
        branch: input.branch,
      };
    },
  };
  const variant = (name: string) =>
    commandAgent(
      [
        process.execPath,
        "-e",
        `require('fs').copyFileSync(${JSON.stringify(path.join(pyrefunds, "variants", `${name}.py`))},'refunds/service.py')`,
      ],
      { id: "py-harness" },
    );
  const deps = (agentName: string): PipelineDeps => ({
    repo,
    output: path.join(root, "out"),
    policy: cfg.harness,
    improvement: {
      autonomousMutation: cfg.improvement_policy.autonomous_mutation,
      maxAutonomousMutations: cfg.improvement_policy.max_autonomous_mutations,
    },
    baseBranch: "main",
    agent: () => variant(agentName),
    ...(options.reviewer
      ? {
          review: async ({
            task: t,
            patch,
            patchTruncated,
            files,
            candidate,
          }) =>
            runReview({
              reviewer: options.reviewer as Reviewer,
              id: "test-reviewer",
              request: {
                task: {
                  objective: t.objective.summary,
                  protectedBehaviors: [],
                  constraints: [],
                },
                rules: [],
                files,
                patch,
                patchTruncated,
              },
              loadCandidateFile: async (file) =>
                git(repo, ["show", `${candidate}:${file}`]).catch(
                  () => undefined,
                ),
            }),
        }
      : {}),
    publisher,
    worktreeParent: path.join(root, "worktrees"),
  });
  let n = 0;
  const start = (agentName: string, extra = {}) =>
    startRun(
      {
        ...deps(agentName),
        newRunId: () => `run-20261030T10000${n++}-00000${n}`,
      },
      task,
      extra,
    );
  return { repo, start, published, root };
}

describe("any stack: a Python repository, assessed with no TypeScript and no Next.js", () => {
  it("passes a harmless change on the strength of the project's own tests, and says what was not checked", async () => {
    const { start } = await python();
    const run = await start("benign_refactor");
    expect(run.state).toBe("awaiting_approval");
    expect(run.assessment).toMatchObject({
      verdict: "pass",
      vouchedBy: ["checks"],
    });
    expect(run.assessment?.signals).toMatchObject({
      checks: "passed",
      behavior: "not_run",
      evaluation: "not_run",
    });
    expect(run.assessment?.checks.comparison[0]).toMatchObject({
      command: CHECK,
      outcome: "passes",
      base: true,
    });
    expect(run.assessment?.notes.join(" ")).toContain(
      "Business rules were not checked",
    );
  }, 120_000);

  it("fails a change that breaks a test that passed at the base", async () => {
    const { start, published } = await python();
    const run = await start("breaks_tests");
    expect(run.state).toBe("rejected");
    expect(run.assessment?.checks.comparison[0]?.outcome).toBe("regression");
    expect(run.decision?.reasons.join(" ")).toContain(
      "passed at the base commit and fails with the change",
    );
    expect(published).toEqual([]);
  }, 120_000);

  it("sends to review the changes that tests do not catch but the diff gives away", async () => {
    const { start } = await python();
    // The approval limit raised tenfold.
    const limit = await start("raises_limit");
    expect(limit.assessment?.verdict).toBe("review");
    expect(
      limit.assessment?.reasons.map((item) => item.message).join(" "),
    ).toContain("changes a number from 5000 to 50000");
    // A guard removed.
    const guard = await start("drops_self_approval_guard");
    expect(guard.assessment?.verdict).toBe("review");
    expect(
      guard.assessment?.reasons.map((item) => item.message).join(" "),
    ).toContain("guards or error paths were removed");
    expect(guard.assessment?.checks.comparison[0]?.outcome).toBe("passes");
    // The path is a billing module either way.
    expect(guard.assessment?.risk.map((item) => item.category)).toContain(
      "billing",
    );
  }, 240_000);

  it("lets a reviewer's concern, with evidence found in the candidate, hold back a change tests pass", async () => {
    const reviewer: Reviewer = async () => ({
      findings: [
        {
          severity: "concern",
          message:
            "Support agents can now skip manager approval for large refunds.",
          evidence: [
            {
              file: "refunds/service.py",
              quote: 'actor["role"] != "support_agent"',
            },
          ],
        },
        {
          severity: "concern",
          message: "Invented",
          evidence: [
            {
              file: "refunds/service.py",
              quote: "this text is not in the file",
            },
          ],
        },
      ],
    });
    const { start } = await python({ reviewer });
    const run = await start("support_fast_path");
    expect(run.assessment?.checks.comparison[0]?.outcome).toBe("passes");
    expect(run.assessment?.verdict).toBe("review");
    const reviewerReasons =
      run.assessment?.reasons.filter((item) => item.source === "reviewer") ??
      [];
    expect(reviewerReasons).toHaveLength(1);
    expect(reviewerReasons[0]?.message).toContain("skip manager approval");
    expect(run.assessment?.notes.join(" ")).toContain(
      "1 reviewer finding(s) were discarded",
    );
    expect(run.assessment?.signals.reviewer).toBe("flagged");
  }, 120_000);

  it("never vouches for a change when the project has no tests and nothing else could run", async () => {
    const { start } = await python({ removeTests: true });
    const run = await start("benign_refactor");
    expect(run.assessment?.verdict).toBe("review");
    expect(run.assessment?.reasons.at(-1)?.message).toContain(
      "Nothing independent of the harness vouched",
    );
  }, 120_000);

  it("lets automatic mode publish a clean change anywhere, and holds the risky one", async () => {
    const { start, published } = await python({
      harness: `  mode: automatic\n  publish:\n    target: branch\n  checks: ["${CHECK}"]\n`,
      improvement: "  max_autonomous_mutations: 3\n",
    });
    expect((await start("benign_refactor")).state).toBe("published");
    const held = await start("raises_limit");
    expect(held.state).toBe("awaiting_approval");
    expect(held.decision?.reasons.join(" ")).toContain(
      "the assessment says review",
    );
    expect(published).toHaveLength(1);
  }, 240_000);

  it("can be told that only a reviewer may vouch, or that the behavior check is required", async () => {
    const clean: Reviewer = async () => ({ findings: [] });
    const reviewerOnly = await python({
      harness: `  mode: approval\n  assessment:\n    independent: [reviewer]\n`,
      reviewer: clean,
    });
    const vouched = await reviewerOnly.start("benign_refactor");
    expect(vouched.assessment).toMatchObject({
      verdict: "pass",
      vouchedBy: ["reviewer"],
    });
    const required = await python({
      harness: `  mode: approval\n  checks: ["${CHECK}"]\n  assessment:\n    require: [behavior]\n`,
    });
    const strict = await required.start("benign_refactor");
    expect(strict.assessment?.verdict).toBe("review");
    expect(strict.assessment?.reasons.at(-1)?.message).toContain(
      "behavior is required by the configuration and did not run",
    );
  }, 240_000);
});

describe("ecosystem detection", () => {
  const files = (...paths: [string, string?][]) =>
    paths.map(([p, content]) => ({ path: p, content: content ?? "" }));
  const commands = (list: ReturnType<typeof files>) =>
    detectChecks(list).map((item) => item.command);
  it("suggests each ecosystem's own commands without running anything", () => {
    expect(
      commands(
        files(
          [
            "package.json",
            '{"scripts":{"test":"vitest","lint":"biome check .","typecheck":"tsc","build":"tsc"}}',
          ],
          ["pnpm-lock.yaml"],
        ),
      ),
    ).toEqual(["pnpm test", "pnpm lint", "pnpm typecheck", "pnpm build"]);
    expect(
      commands(files(["package.json", '{"scripts":{"test":"jest"}}'])),
    ).toEqual(["npm test"]);
    expect(
      commands(
        files(
          ["pyproject.toml", "[tool.pytest]\ndependencies = ['pytest']"],
          ["requirements.txt", "pytest"],
        ),
      ),
    ).toContain("python3 -m pytest -q");
    expect(commands(files(["tests/test_x.py"]))).toEqual([
      "python3 -m unittest discover",
    ]);
    expect(commands(files(["go.mod"]))).toEqual([
      "go test ./...",
      "go vet ./...",
      "go build ./...",
    ]);
    expect(commands(files(["Cargo.toml"]))).toContain("cargo test");
    expect(commands(files(["pom.xml"]))).toEqual(["mvn -q test"]);
    expect(commands(files(["app/build.gradle.kts"], ["gradlew"]))).toEqual([
      "./gradlew test",
    ]);
    expect(commands(files(["src/App.csproj"]))).toEqual(["dotnet test"]);
    expect(commands(files(["Gemfile"], ["spec/user_spec.rb"]))).toEqual([
      "bundle exec rspec",
    ]);
    expect(commands(files(["mix.exs"]))).toEqual(["mix test"]);
    expect(
      commands(files(["Makefile", "test:\n\tgo test\nlint:\n\tx\n"])),
    ).toEqual(["make test", "make lint"]);
    expect(detectChecks(files(["README.md"]))).toEqual([]);
    expect(
      detectChecks(
        files(["package.json", '{"scripts":{"test":"x"}}'], ["yarn.lock"]),
      )[0],
    ).toMatchObject({
      command: "yarn test",
      needsSetup: "yarn install --frozen-lockfile",
    });
  });
});

describe("risk signals from a diff", () => {
  const added = (path: string, text: string, line = 1) => ({
    path,
    line,
    text,
  });
  it("reads paths and changed lines, in any language, and points rather than judges", () => {
    const findings = analyzeRisk({
      files: [
        { status: "M", path: "billing/charge.go" },
        { status: "M", path: "src/auth/policy.rb" },
        { status: "M", path: "db/migrations/001.sql" },
        { status: "M", path: "agents/system_prompt.md" },
        { status: "M", path: "pnpm-lock.yaml" },
        { status: "M", path: "notes.md" },
      ],
      added: [
        added("billing/charge.go", "const Limit = 50000"),
        added("tests/x_test.go", "x"),
      ],
      removed: [
        { path: "billing/charge.go", line: 7, text: "const Limit = 5000" },
        {
          path: "src/auth/policy.rb",
          line: 3,
          text: "  raise Forbidden unless admin?",
        },
        { path: "src/auth/policy.rb", line: 4, text: "  raise Moved" },
        { path: "tests/x_test.go", line: 2, text: '  t.Error("bad")' },
        { path: "tests/x_test.go", line: 3, text: '  t.Fatal("worse")' },
      ],
    });
    const byCategory = (name: string) =>
      findings.filter((item) => item.category === name);
    expect(findings.map((item) => item.category)).toEqual(
      expect.arrayContaining([
        "authorization",
        "billing",
        "data model",
        "agent behavior",
        "dependencies",
        "removed guard",
        "changed constant",
        "weakened tests",
      ]),
    );
    expect(byCategory("dependencies")[0]?.severity).toBe("info");
    expect(byCategory("changed constant")[0]?.message).toContain(
      "from 5000 to 50000",
    );
    expect(byCategory("removed guard")[0]?.message).toContain(
      "src/auth/policy.rb:3",
    );
    // A guard that was moved, not removed, is not reported.
    const moved = analyzeRisk({
      files: [{ status: "M", path: "a.py" }],
      added: [added("a.py", "    raise ValueError('x')", 9)],
      removed: [{ path: "a.py", line: 3, text: "    raise ValueError('x')" }],
    });
    expect(moved.map((item) => item.category)).not.toContain("removed guard");
    // A guard whose message was only reworded is still there.
    const reworded = analyzeRisk({
      files: [{ status: "M", path: "a.ts" }],
      added: [added("a.ts", '  throw new Error("Needs a manager.");', 5)],
      removed: [
        {
          path: "a.ts",
          line: 5,
          text: '  throw new Error("Refunds above 5000 need manager approval.");',
        },
      ],
    });
    expect(reworded.map((item) => item.category)).not.toContain(
      "removed guard",
    );
    // Configured paths count as sensitive too.
    expect(
      analyzeRisk({
        files: [{ status: "M", path: "ops/rates.yaml" }],
        added: [],
        removed: [],
        extraSensitivePaths: ["ops/**"],
      })[0]?.category,
    ).toBe("configured sensitive path");
  });
});

describe("the reviewer", () => {
  it("keeps only findings whose evidence is in the candidate, and a bad answer is not a result", async () => {
    const files: Record<string, string> = {
      "a.py": "def f(x):\n    if x > 5:\n        return 1\n",
    };
    const request = {
      task: { objective: "o", protectedBehaviors: [], constraints: [] },
      rules: [],
      files: [],
      patch: "",
      patchTruncated: false,
    };
    const outcome = await runReview({
      reviewer: async () => ({
        findings: [
          {
            severity: "concern",
            message: "ok",
            evidence: [{ file: "a.py", lines: "2", quote: "if x > 5" }],
          },
          {
            severity: "concern",
            message: "wrong lines",
            evidence: [{ file: "a.py", lines: "3", quote: "if x > 5" }],
          },
          {
            severity: "note",
            message: "no file",
            evidence: [{ file: "b.py", quote: "x" }],
          },
          {
            severity: "note",
            message: "good note",
            evidence: [{ file: "a.py", quote: "return 1" }],
          },
        ],
      }),
      id: "r",
      request,
      loadCandidateFile: async (file) => files[file],
    });
    expect(outcome).toMatchObject({ ran: true, dropped: 2 });
    expect(outcome.ran && outcome.concerns.map((item) => item.message)).toEqual(
      ["ok"],
    );
    expect(outcome.ran && outcome.notes.map((item) => item.message)).toEqual([
      "good note",
    ]);
    const bad = await runReview({
      reviewer: async () => ({ nope: 1 }),
      id: "r",
      request,
      loadCandidateFile: async () => undefined,
    });
    expect(bad).toMatchObject({ ran: false });
    expect(bad.ran === false && bad.reason).toContain("not usable");
  });
  it("talks to a command with the same JSON protocol", async () => {
    const reviewer = commandReviewer([
      process.execPath,
      "-e",
      "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const i=JSON.parse(d);console.log(JSON.stringify({findings:[{severity:'note',message:i.kind,evidence:[{file:'a',quote:'q'}]}]}))})",
    ]);
    const answer = (await reviewer({
      task: { objective: "o", protectedBehaviors: [], constraints: [] },
      rules: [],
      files: [],
      patch: "",
      patchTruncated: false,
    })) as { findings: { message: string }[] };
    expect(answer.findings[0]?.message).toBe("review");
  });
});
