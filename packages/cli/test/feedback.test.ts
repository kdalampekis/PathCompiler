import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const agent = fileURLToPath(
  new URL("../../../fixtures/support-agent/", import.meta.url),
);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => rm(item, { recursive: true, force: true })),
  );
});

describe("feedback capture and datasets", () => {
  it("records checks only when asked, and exports datasets that say what they leave out", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-feedback-"));
    temporary.push(cwd);
    const repo = path.join(cwd, "repo");
    await cp(agent, repo, { recursive: true });
    const call = (extra: string[]) =>
      runCli(
        [
          "tools",
          "call",
          "pathcompiler_check_output",
          repo,
          "--input",
          JSON.stringify({
            text: "We guarantee it.",
            claims: [
              {
                operation: "refund",
                inputs: { amount: 6000, manager_approval: false },
              },
            ],
          }),
          ...extra,
        ],
        cwd,
      );
    await call([]);
    expect(await runCli(["feedback", "summary", repo])).toContain("0 event(s)");
    await call(["--record", "--agent", "support-bot"]);
    const summary = await runCli(["feedback", "summary", repo]);
    expect(summary).toContain("1 event(s)");
    expect(summary).toContain("output_check 1");
    expect(await runCli(["feedback", "list", repo])).toContain("support-bot");

    await expect(runCli(["dataset", "export", repo])).rejects.toThrow("--out");
    const out = await runCli(
      ["dataset", "export", repo, "--out", "data", "--format", "reward"],
      cwd,
    );
    expect(out).toContain("reward 1");
    expect(out).toContain("Structure only");
    const reward = await readFile(
      path.join(cwd, "data", "reward.jsonl"),
      "utf8",
    );
    expect(reward).not.toContain("guarantee it");
    expect(JSON.parse(reward.trim()).reward).toBe(0);
    expect(
      await readFile(path.join(cwd, "data", "DATASET_CARD.md"), "utf8"),
    ).toContain("not included (structure only)");
    await expect(
      runCli(
        ["dataset", "export", repo, "--out", "x", "--format", "nope"],
        cwd,
      ),
    ).rejects.toThrow("--format must be");
    await expect(runCli(["scan", ".", "--record"])).rejects.toThrow(
      "only supported by",
    );
  }, 120_000);
});
