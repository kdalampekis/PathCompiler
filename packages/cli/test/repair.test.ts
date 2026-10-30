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

describe("repair propose", () => {
  it("finds a repair from prepared proposals, writes a patch that applies, and changes nothing", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-repair-"));
    temporary.push(cwd);
    const repo = path.join(cwd, "repo");
    await cp(refunds, repo, { recursive: true });
    const broken = await readFile(
      path.join(refunds, "variants", "support-fast-path.ts"),
      "utf8",
    );
    await writeFile(path.join(repo, "src", "refunds.ts"), broken);
    // Proposal 1 changes nothing useful; proposal 2 restores the guard.
    await writeFile(path.join(cwd, "commented.ts"), `${broken}\n// reviewed\n`);
    await cp(
      path.join(refunds, "src", "refunds.ts"),
      path.join(cwd, "repaired.ts"),
    );
    await writeFile(
      path.join(cwd, "proposals.json"),
      JSON.stringify({
        proposals: [
          {
            rationale: "Add a note",
            edits: [{ path: "src/refunds.ts", contentFile: "commented.ts" }],
          },
          {
            rationale: "Require approval above the limit for every role",
            edits: [{ path: "src/refunds.ts", contentFile: "repaired.ts" }],
          },
        ],
      }),
    );
    const text = await runCli(
      [
        "repair",
        "propose",
        repo,
        "--fixture",
        "proposals.json",
        ...BIND,
        "--out",
        "out",
      ],
      cwd,
    );
    expect(text).toContain(
      "Repair found for refunds.manager_approval_over_limit",
    );
    expect(text).toContain("attempt 1: rejected");
    expect(text).toContain("attempt 2: repaired");
    expect(text).toContain("Nothing was written, merged or deployed");
    // The repository is untouched; the patch is a file for a person to apply.
    expect(await readFile(path.join(repo, "src", "refunds.ts"), "utf8")).toBe(
      broken,
    );
    const patches = (await exec("ls", [path.join(cwd, "out", "repair")])).stdout
      .trim()
      .split("\n");
    expect(patches).toHaveLength(1);
    const patch = path.join(cwd, "out", "repair", patches[0] as string);
    await exec("git", ["apply", "--check", patch], { cwd: repo });
    const report = JSON.parse(
      await readFile(path.join(cwd, "out", "reports", "repair.json"), "utf8"),
    );
    expect(report).toMatchObject({
      status: "repaired",
      approval: { required: true, status: "pending" },
    });
    expect(report.attempts).toHaveLength(2);
  }, 120_000);

  it("fails with the reasons when no proposal passes, and explains bad input", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-repair-"));
    temporary.push(cwd);
    const repo = path.join(cwd, "repo");
    await cp(refunds, repo, { recursive: true });
    await cp(
      path.join(refunds, "variants", "support-fast-path.ts"),
      path.join(repo, "src", "refunds.ts"),
    );
    await writeFile(
      path.join(cwd, "bad.json"),
      JSON.stringify({
        proposals: [
          {
            rationale: "Touch the rules",
            edits: [{ path: "spec/approved-rules.json", content: "{}" }],
          },
        ],
      }),
    );
    const failure = await runCli(
      [
        "repair",
        "propose",
        repo,
        "--fixture",
        "bad.json",
        "--max-attempts",
        "1",
        ...BIND,
        "--out",
        "out",
      ],
      cwd,
    ).catch((error: Error) => error.message);
    expect(failure).toContain("No repair found");
    expect(failure).toContain("spec/approved-rules.json may not be changed");
    expect(failure).toContain(
      "No candidate passed every check within 1 attempt(s).",
    );

    await expect(runCli(["repair", "propose", repo], cwd)).rejects.toThrow(
      "needs a provider",
    );
    await expect(
      runCli(
        [
          "repair",
          "propose",
          repo,
          "--fixture",
          "bad.json",
          "--max-attempts",
          "20",
        ],
        cwd,
      ),
    ).rejects.toThrow("--max-attempts must be an integer from 1 to 10.");
    await expect(runCli(["scan", ".", "--fixture", "x"])).rejects.toThrow(
      "only supported by repair",
    );
    await expect(runCli(["repair"])).rejects.toThrow(
      "Expected: pathcompiler repair propose",
    );
  }, 120_000);
});
