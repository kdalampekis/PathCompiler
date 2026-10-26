import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo/", import.meta.url),
);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => rm(item, { recursive: true, force: true })),
  );
});
const report = {
  schemaVersion: 2,
  kind: "browser-verification",
  evidenceClass: "browser",
  workflowId: "plans.archive",
  workflowVersion: null,
  candidateCommit: null,
  origin: "http://127.0.0.1:3101",
  startedAt: "2026-10-24T10:00:00.000Z",
  finishedAt: "2026-10-24T10:00:01.000Z",
  valid: false,
  steps: [
    {
      stepId: "step.1",
      target: "plans.archive",
      action: "click",
      status: "failed",
      expected: "not-run",
    },
  ],
  terminal: "not-run",
  destructiveAllowed: ["plans.archive"],
  failure: {
    code: "target-not-found",
    stage: "resolve",
    message: "plans.archive not found",
    stepId: "step.1",
    target: "plans.archive",
  },
};

describe("diagnose", () => {
  it("ranks the likely cause of a failed browser run", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-diagnose-"));
    temporary.push(cwd);
    await writeFile(path.join(cwd, "report.json"), JSON.stringify(report));
    const output = await runCli(
      [
        "diagnose",
        "report.json",
        fixture,
        "--context",
        "role=editor",
        "--context",
        "plan_archive_enabled=true",
        "--context",
        "plan_structure_enabled=true",
      ],
      cwd,
    );
    expect(output).toContain(
      "Failure: target-not-found at resolve (plans.archive).\nLikely cause: permission-mismatch (a hypothesis).\n  1. permission-mismatch: supported, high",
    );
    const diagnosis = JSON.parse(
      await readFile(
        path.join(cwd, ".pathcompiler", "reports", "diagnosis.json"),
        "utf8",
      ),
    );
    expect(diagnosis).toMatchObject({
      meaning: "hypothesis",
      top: "permission-mismatch",
    });
    await writeFile(path.join(cwd, "bad.json"), "{");
    await expect(
      runCli(["diagnose", "bad.json", fixture], cwd),
    ).rejects.toThrow("Cannot read the browser verification report bad.json");
    await expect(
      runCli(["diagnose", "report.json", fixture, "--max-depth", "3"], cwd),
    ).rejects.toThrow("--context by diagnose");
  });

  it("separates backend changes from model errors with --base (#38)", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { cp, mkdir } = await import("node:fs/promises");
    const exec = promisify(execFile);
    const cwd = await mkdtemp(
      path.join(os.tmpdir(), "pathcompiler-diagnose-base-"),
    );
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
    await git("init", "--quiet");
    await git("add", ".");
    await git("commit", "--quiet", "-m", "base");
    const base = await git("rev-parse", "HEAD");
    const edit = async (file: string, from: string, to: string) => {
      const target = path.join(app, file);
      const content = await readFile(target, "utf8");
      if (!content.includes(from)) throw new Error(`Missing ${from}`);
      await writeFile(target, content.replace(from, to));
    };
    await edit("components/clients.tsx", "Create Client\n", "Add Client\n");
    await git("commit", "--quiet", "-am", "copy");
    const copy = await git("rev-parse", "HEAD");
    await edit(
      "app/api/clients/route.ts",
      "export async function POST(",
      "export async function PUT(",
    );
    await git("commit", "--quiet", "-am", "move create to PUT");
    const moved = await git("rev-parse", "HEAD");
    // The run completed every action but never saw the completion text.
    const outcome = (candidateCommit: string) => ({
      ...report,
      workflowId: "clients.create",
      candidateCommit,
      steps: [
        {
          stepId: "step.1",
          target: "clients.create",
          action: "click",
          status: "passed",
          expected: "passed",
        },
      ],
      terminal: "failed",
      failure: {
        code: "terminal-failed",
        stage: "terminal",
        message: "Client created text not visible",
      },
    });
    const top = async (candidate: string) => {
      await writeFile(
        path.join(cwd, "report.json"),
        JSON.stringify(outcome(candidate)),
      );
      return JSON.parse(
        await runCli(
          [
            "diagnose",
            "report.json",
            "app",
            "--base",
            base,
            "--json",
            "--out",
            "out",
          ],
          cwd,
        ),
      ).top;
    };
    expect(await top(copy)).toBe("formal-model-wrong");
    expect(await top(moved)).toBe("backend-changed");
    await expect(runCli(["scan", "app", "--base", base], cwd)).rejects.toThrow(
      "--base is only supported by diagnose.",
    );
  }, 120_000);
});
