import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
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

/** A repository with the refund service on `main` and a candidate on a branch. */
async function repository(variant: string) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-pr-"));
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
        "user.name=Test",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: repo },
    );
  await rm(path.join(repo, "variants"), { recursive: true });
  await git("init", "-q", "-b", "main");
  await git("add", "-A");
  await git("commit", "-q", "-m", "base");
  await git("checkout", "-q", "-b", "candidate");
  await cp(
    path.join(refunds, "variants", `${variant}.ts`),
    path.join(repo, "src", "refunds.ts"),
  );
  await git("commit", "-q", "-am", "candidate");
  return { cwd, repo };
}

describe("verify-pr", () => {
  it("blocks a candidate that violates an approved rule, with a counterexample", async () => {
    const { cwd, repo } = await repository("support-fast-path");
    const failure = await runCli(
      [
        "verify-pr",
        repo,
        "--base",
        "main",
        "--candidate",
        "candidate",
        ...BIND,
        "--out",
        "out",
      ],
      cwd,
    ).catch((error: Error) => error.message);
    expect(failure).toContain("The change newly violates the specification.");
    expect(failure).toContain("Blocked: a business rule is newly violated");
    expect(failure).toContain("refunds.manager_approval_over_limit");
    expect(failure).toContain("confirmed");
    const report = JSON.parse(
      await readFile(path.join(cwd, "out", "reports", "pr-guard.json"), "utf8"),
    );
    expect(report.verdict).toBe("fail");
    expect(report.base.ref).toBe("main");
    expect(report.head.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(
      await readFile(path.join(cwd, "out", "reports", "pr-guard.md"), "utf8"),
    ).toContain("Behavior that changed");
  }, 120_000);

  it("passes a behavior-preserving refactor", async () => {
    const { cwd, repo } = await repository("benign-refactor");
    const text = await runCli(
      [
        "verify-pr",
        repo,
        "--base",
        "main",
        "--candidate",
        "candidate",
        ...BIND,
        "--out",
        "out",
      ],
      cwd,
    );
    expect(text).toContain("No encoded rule is newly violated");
    expect(text).not.toContain("Behavior that changed");
  }, 120_000);

  it("explains what is missing and rejects stray options", async () => {
    await expect(runCli(["verify-pr", "--base", "main"])).rejects.toThrow(
      "Expected: pathcompiler verify-pr --base <ref> --candidate <ref>",
    );
    await expect(runCli(["scan", ".", "--candidate", "x"])).rejects.toThrow(
      "--candidate and --strict are only supported by verify-pr.",
    );
  });
});
