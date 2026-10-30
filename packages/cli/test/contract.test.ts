import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const pyrefunds = fileURLToPath(
  new URL("../../../fixtures/pyrefunds/", import.meta.url),
);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => rm(item, { recursive: true, force: true })),
  );
});

const proposal = (taskId: string) => ({
  schemaVersion: 1,
  taskId,
  producer: { kind: "harness", name: "test-harness" },
  language: "python",
  variables: [
    { id: "refund.amount", type: "integer", scope: "input" },
    { id: "refund.manager_approval", type: "boolean", scope: "input" },
  ],
  operations: [
    {
      id: "refund",
      anchors: [
        {
          file: "refunds/service.py",
          lines: "9-17",
          quote: "if amount > 5000 and not manager_approval",
        },
      ],
      parameters: ["refund.amount", "refund.manager_approval"],
      preconditions: ["refund.amount > 0"],
    },
  ],
});

describe("behavior contract commands", () => {
  it("describes Python code, approves it, and reports when the code changes", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-contract-"));
    temporary.push(cwd);
    const repo = path.join(cwd, "repo");
    await cp(pyrefunds, repo, { recursive: true });
    const run = (args: string[]) =>
      runCli([...args, "--out", "out", "--exclude", "variants"], cwd);

    expect(await run(["contract", "status", repo])).toContain(
      "No behavior contract",
    );
    const task = await run(["contract", "task", repo]);
    const taskId = /Task (ct-[0-9a-f]{12})/.exec(task)?.[1];
    expect(taskId).toBeDefined();
    expect(task).toContain("ContractProposal.json");

    await writeFile(
      path.join(cwd, "answer.json"),
      JSON.stringify(proposal(taskId as string)),
    );
    const imported = await run(["contract", "import", "answer.json", repo]);
    expect(imported).toContain("1 of 1 operation(s) accepted");
    const stored = JSON.parse(
      await readFile(path.join(repo, "spec", "behavior-contract.json"), "utf8"),
    );
    expect(stored.operations[0].anchors[0].digest).toBeDefined();
    expect(stored.approvedBy).toBeUndefined();

    await expect(run(["contract", "approve", repo])).rejects.toThrow("--by");
    expect(
      await run(["contract", "approve", repo, "--by", "pm@example.com"]),
    ).toContain("approved 1 operation(s)");
    expect(await run(["contract", "status", repo])).toContain("up to date");

    // The code changes: the description is stale and cannot be approved again.
    await cp(
      path.join(pyrefunds, "variants", "support_fast_path.py"),
      path.join(repo, "refunds", "service.py"),
    );
    expect(await run(["contract", "status", repo])).toContain("STALE");
    await expect(
      run(["contract", "approve", repo, "--by", "pm@example.com"]),
    ).rejects.toThrow("changed since it was described");
  }, 60_000);

  it("rejects bad arguments and an unsupported description", async () => {
    await expect(runCli(["contract"])).rejects.toThrow(
      "Expected: pathcompiler contract",
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-contract-"));
    temporary.push(cwd);
    const repo = path.join(cwd, "repo");
    await cp(pyrefunds, repo, { recursive: true });
    const bad = proposal("ct-000000000000");
    for (const operation of bad.operations)
      for (const anchor of operation.anchors) anchor.quote = "not in the file";
    await writeFile(path.join(cwd, "bad.json"), JSON.stringify(bad));
    const out = await runCli(
      ["contract", "import", "bad.json", repo, "--out", "out"],
      cwd,
    );
    expect(out).toContain("0 of 1 operation(s) accepted");
    expect(out).toContain("No anchor could be verified");
  }, 60_000);
});
