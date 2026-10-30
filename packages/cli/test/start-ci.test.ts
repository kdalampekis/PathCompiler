import { execFile } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
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

describe("start and ci", () => {
  it("tells a newcomer where they stand and prints the harness config", async () => {
    const text = await runCli([
      "start",
      refunds,
      "--exclude",
      "variants",
      ...BIND,
    ]);
    expect(text).toContain("approved rule(s)");
    expect(text).toContain('"mcpServers"');
    const json = JSON.parse(
      await runCli([
        "start",
        refunds,
        "--json",
        "--exclude",
        "variants",
        ...BIND,
      ]),
    );
    expect(json.stage).toBe("protecting");
  });

  it("checks a pull request, can run report-only, and prints a workflow", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-ci-"));
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
    await git("commit", "-q", "-m", "base");
    await git("checkout", "-q", "-b", "feature");
    await cp(
      path.join(refunds, "variants", "support-fast-path.ts"),
      path.join(repo, "src", "refunds.ts"),
    );
    await git("commit", "-q", "-am", "feature");

    const args = ["ci", repo, "--exclude", "variants", "--out", "out", ...BIND];
    // It picked main as the base without being told, and blocks the change.
    await expect(runCli(args, cwd)).rejects.toThrow("newly violates");
    const reported = await runCli([...args, "--report-only"], cwd);
    expect(reported).toContain("(report-only)");
    expect(reported).toContain("Report-only: this would have failed the build");
    expect(await runCli(["ci", "--print-workflow"])).toContain(
      "pathcompiler ci --report-only",
    );
    await expect(runCli(["scan", ".", "--report-only"])).rejects.toThrow(
      "only supported by ci",
    );
  }, 180_000);
});
