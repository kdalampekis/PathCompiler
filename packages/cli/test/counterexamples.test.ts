import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
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
];

describe("counterexamples", () => {
  it("stores what verify-pr finds, makes an eval, and the eval fails the candidate and passes the repair", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-cx-"));
    temporary.push(cwd);
    // A repository: the base on main, the support-agent fast path on a branch.
    const repo = path.join(cwd, "repo");
    await cp(refunds, repo, { recursive: true });
    await rm(path.join(repo, "variants"), { recursive: true });
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
    await git("commit", "-q", "-m", "base");
    await git("checkout", "-q", "-b", "candidate");
    await cp(
      path.join(refunds, "variants", "support-fast-path.ts"),
      path.join(repo, "src", "refunds.ts"),
    );
    await git("commit", "-q", "-am", "candidate");

    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    const guard = await run([
      "verify-pr",
      repo,
      "--base",
      "main",
      "--candidate",
      "candidate",
      ...BIND,
    ]).catch((error: Error) => error.message);
    expect(guard).toContain("Stored 1 new counterexample(s)");
    const listed = await run(["counterexamples", "list"]);
    const id =
      /(cx-[0-9a-f]{12}) open refund violates refunds\.manager_approval_over_limit/.exec(
        listed,
      )?.[1];
    expect(id).toBeDefined();
    // The same finding again is the same record.
    expect(
      await run([
        "verify-pr",
        repo,
        "--base",
        "main",
        "--candidate",
        "candidate",
        ...BIND,
      ]).catch((error: Error) => error.message),
    ).not.toContain("Stored");

    // The trusted specification (base) labels the eval; the candidate's is judged by it.
    const base = path.join(cwd, "base");
    await cp(refunds, base, { recursive: true });
    const candidate = path.join(cwd, "candidate");
    await cp(refunds, candidate, { recursive: true });
    await cp(
      path.join(refunds, "variants", "support-fast-path.ts"),
      path.join(candidate, "src", "refunds.ts"),
    );
    for (const [name, directory] of [
      ["base", base],
      ["candidate", candidate],
    ] as const)
      await runCli(
        [
          "behavior",
          "extract",
          directory,
          ...BIND,
          "--exclude",
          "variants",
          "--out",
          name,
        ],
        cwd,
      );
    const baseSpec = path.join("base", "reports", "behavior-spec.json");
    const candidateSpec = path.join(
      "candidate",
      "reports",
      "behavior-spec.json",
    );

    const made = await run([
      "counterexamples",
      "eval",
      id as string,
      "--spec",
      baseSpec,
    ]);
    expect(made).toContain("reproduction must be rejected");
    expect(made).toContain("must be accepted");
    const files = await readdir(
      path.join(cwd, "out", "counterexamples", "evals"),
    );
    const evalFile = path.join(
      "out",
      "counterexamples",
      "evals",
      files[0] as string,
    );

    const failed = await run([
      "counterexamples",
      "run",
      evalFile,
      "--spec",
      candidateSpec,
    ]).catch((error: Error) => error.message);
    expect(failed).toContain("FAIL");
    expect(failed).toContain("verifier: VIOLATED");
    // A behavior verify report can be recorded too.
    await runCli(
      ["behavior", "verify", candidateSpec, "--out", "verified"],
      cwd,
    ).catch(() => undefined);
    expect(
      await run([
        "counterexamples",
        "record",
        path.join("verified", "reports", "behavior-verification.json"),
      ]),
    ).toMatch(/Recorded \d+ new counterexample\(s\)/);
    const passed = await run([
      "counterexamples",
      "run",
      evalFile,
      "--spec",
      baseSpec,
    ]);
    expect(passed).toContain("PASS");
    expect(passed).toContain("verifier: VERIFIED");
  }, 180_000);

  it("records from a behavior verify report and rejects bad arguments", async () => {
    await expect(runCli(["counterexamples"])).rejects.toThrow(
      "Expected: pathcompiler counterexamples",
    );
    await expect(
      runCli(["counterexamples", "eval", "cx-000000000000"]),
    ).rejects.toThrow("needs --spec");
    await expect(runCli(["scan", ".", "--spec", "x.json"])).rejects.toThrow(
      "only supported by counterexamples",
    );
  });
});
