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
});
