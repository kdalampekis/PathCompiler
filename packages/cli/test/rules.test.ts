import { execFile } from "node:child_process";
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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
  "--exclude",
  "variants",
];

async function setup() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-rules-"));
  temporary.push(cwd);
  const repo = path.join(cwd, "repo");
  await cp(refunds, repo, { recursive: true });
  const git = (...args: string[]) =>
    exec(
      "git",
      [
        "-c",
        "user.email=t@example.com",
        "-c",
        "user.name=T",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: repo },
    );
  await git("init", "-q", "-b", "main");
  await git("add", "-A");
  await git(
    "commit",
    "-q",
    "-m",
    "Refund approval above 5000 needs a manager\n\nSupport agents never approve their own requests.",
  );
  const sha = (await git("rev-parse", "HEAD")).stdout.trim();
  const source = (
    await readFile(path.join(repo, "src", "refunds.ts"), "utf8")
  ).split("\n");
  const line = (needle: string) =>
    String(source.findIndex((item) => item.includes(needle)) + 1);
  return {
    cwd,
    repo,
    sha,
    line,
    run: (args: string[]) => runCli([...args, "--out", "out"], cwd),
  };
}

describe("rules: the harness route", () => {
  it("exports a task, imports validated proposals as candidates, and a person approves or rejects them", async () => {
    const { cwd, repo, sha, line, run } = await setup();
    const task = await run([
      "rules",
      "task",
      repo,
      ...BIND,
      "--from",
      "v0",
      "--to",
      "HEAD",
    ]);
    expect(task).toContain("3 operation(s) from src/refunds.ts");
    const taskId = /Task (rd-[0-9a-f]{12})/.exec(task)?.[1] as string;
    expect((await readdir(path.join(cwd, "out", "rules", "tasks")))[0]).toBe(
      `${taskId}.json`,
    );
    const written = JSON.parse(
      await readFile(
        path.join(cwd, "out", "rules", "tasks", `${taskId}.json`),
        "utf8",
      ),
    );
    expect(written.commits).toEqual({ from: "v0", to: "HEAD" });
    expect(JSON.stringify(written)).not.toContain("CREATE TABLE");

    const evidence = (needle: string, quote?: string) => ({
      type: "code",
      file: "src/refunds.ts",
      lines: line(needle),
      quote: quote ?? needle,
    });
    await writeFile(
      path.join(cwd, "RuleProposals.json"),
      JSON.stringify({
        schemaVersion: 1,
        taskId,
        producer: { kind: "harness", name: "test-harness" },
        proposals: [
          {
            kind: "invariant",
            id: "refunds.processed_implies_approved",
            expression:
              "refund_requests.processed == false || refund_requests.approved == true",
            rationale:
              "A request is checked for approval before it is marked processed.",
            evidence: [
              evidence('throw new Error("Not approved.")', "Not approved."),
            ],
          },
          {
            kind: "business_rule",
            id: "refunds.agent_small_only",
            when: 'actor.role == "support_agent"',
            must: "refund.amount <= 2000",
            appliesTo: ["refund"],
            rationale: "Support agents handle small refunds.",
            evidence: [
              evidence("amount > 5000"),
              { type: "commit", commit: sha, quote: "needs a manager" },
            ],
          },
          {
            kind: "invariant",
            expression:
              "payments.refunded_amount >= 0 && payments.nonexistent > 1",
            rationale: "Invented variable.",
            evidence: [evidence("amount > 5000")],
          },
          {
            kind: "invariant",
            expression: "payments.original_amount >= 1",
            rationale: "No such text.",
            evidence: [evidence("amount > 5000", "text that is nowhere")],
          },
        ],
      }),
    );
    const imported = await run([
      "rules",
      "import",
      "RuleProposals.json",
      repo,
      ...BIND,
    ]);
    expect(imported).toContain(
      "harness: test-harness proposed 4 rule(s): 2 accepted as candidates, 2 rejected.",
    );
    expect(imported).toContain(
      "accepted refunds.processed_implies_approved (invariant, MEDIUM confidence); code: holds",
    );
    expect(imported).toContain(
      "accepted refunds.agent_small_only (business_rule, MEDIUM confidence); code: CONTRADICTED by the code",
    );
    expect(imported).toContain("Unknown variable payments.nonexistent");
    expect(imported).toContain("No evidence could be verified");
    expect(imported).toContain("They are inferred, not approved");

    // The candidates are a file in the repository, as inferred model-assisted rules.
    const candidateFile = JSON.parse(
      await readFile(path.join(repo, "spec", "candidate-rules.json"), "utf8"),
    );
    expect(candidateFile.rules.map((item: { id: string }) => item.id)).toEqual([
      "refunds.agent_small_only",
      "refunds.processed_implies_approved",
    ]);
    expect(await run(["rules", "list", repo])).toContain(
      "refunds.agent_small_only business_rule (MEDIUM confidence, harness: test-harness)",
    );

    // They flow into the specification and are reported as candidates, not approved rules.
    await runCli(
      ["behavior", "extract", repo, ...BIND, "--out", "spec-out"],
      cwd,
    );
    const failure = await runCli(
      [
        "behavior",
        "verify",
        path.join("spec-out", "reports", "behavior-spec.json"),
        "--out",
        "spec-out",
      ],
      cwd,
    ).catch((error: Error) => error.message);
    expect(failure).toContain(
      "VIOLATED refund enforces refunds.agent_small_only",
    );
    expect(failure).toContain("extracted candidate");

    // A person decides.
    const approved = await run([
      "rules",
      "approve",
      "refunds.processed_implies_approved",
      repo,
      "--by",
      "ana@example.com",
    ]);
    expect(approved).toContain(
      "Approved refunds.processed_implies_approved as ana@example.com",
    );
    const approvedFile = JSON.parse(
      await readFile(path.join(repo, "spec", "approved-rules.json"), "utf8"),
    );
    expect(approvedFile.invariants[0]).toMatchObject({
      id: "refunds.processed_implies_approved",
      declaredBy: "ana@example.com",
    });
    expect(approvedFile.businessRules.length).toBeGreaterThan(1);
    await expect(
      run([
        "rules",
        "reject",
        "refunds.agent_small_only",
        repo,
        "--by",
        "ana@example.com",
      ]),
    ).rejects.toThrow("needs --reason");
    await run([
      "rules",
      "reject",
      "refunds.agent_small_only",
      repo,
      "--by",
      "ana@example.com",
      "--reason",
      "Support may refund up to 5000.",
    ]);
    expect(await run(["rules", "list", repo])).toContain("No candidate rules");

    // The rejected rule is not accepted again.
    const second = await run(["rules", "task", repo, ...BIND]);
    const nextId = /Task (rd-[0-9a-f]{12})/.exec(second)?.[1] as string;
    const proposals = JSON.parse(
      await readFile(path.join(cwd, "RuleProposals.json"), "utf8"),
    );
    await writeFile(
      path.join(cwd, "again.json"),
      JSON.stringify({
        ...proposals,
        taskId: nextId,
        proposals: [proposals.proposals[1]],
      }),
    );
    expect(
      await run(["rules", "import", "again.json", repo, ...BIND]),
    ).toContain("already rejected");
  }, 180_000);

  it("refuses proposals for an unknown task, malformed proposals and stray arguments", async () => {
    const { cwd, repo, run } = await setup();
    await writeFile(
      path.join(cwd, "p.json"),
      JSON.stringify({
        schemaVersion: 1,
        taskId: "rd-000000000000",
        producer: { kind: "harness", name: "h" },
        proposals: [],
      }),
    );
    await expect(
      run(["rules", "import", "p.json", repo, ...BIND]),
    ).rejects.toThrow("No exported task rd-000000000000");
    await writeFile(
      path.join(cwd, "bad.json"),
      JSON.stringify({ taskId: "x" }),
    );
    await expect(run(["rules", "import", "bad.json", repo])).rejects.toThrow(
      "is not valid rule proposals",
    );
    await expect(run(["rules"])).rejects.toThrow(
      "Expected: pathcompiler rules",
    );
    await expect(runCli(["scan", ".", "--from", "x"])).rejects.toThrow(
      "only supported by rules",
    );
    await expect(
      run(["rules", "approve", "nope", repo, "--by", "ana"]),
    ).rejects.toThrow("No candidate rule nope");
  }, 120_000);
});

describe("rules: the model route", () => {
  it("shows exactly what would be sent and sends nothing, and needs a configured provider to run", async () => {
    const { repo, run } = await setup();
    const dry = await run([
      "rules",
      "discover",
      repo,
      ...BIND,
      "--explain-context",
    ]);
    expect(dry).toContain("Nothing was sent.");
    expect(dry).toContain("src/refunds.ts:");
    expect(dry).toContain("1 commit message(s)");
    expect(dry).toContain("and no other file.");
    expect(dry).not.toContain("CREATE TABLE");
    await expect(run(["rules", "discover", repo, ...BIND])).rejects.toThrow(
      "rules task, let the harness write RuleProposals.json",
    );
  }, 120_000);
});
