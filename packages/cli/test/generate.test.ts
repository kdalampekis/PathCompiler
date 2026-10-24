import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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

describe("pathcompiler tests generate", () => {
  it("writes candidate tests for review and skips contexts it cannot set", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-generate-"));
    temporary.push(cwd);
    const output = await runCli(
      [
        "tests",
        "generate",
        fixture,
        "--setup",
        path.join(fixture, "eval", "test-setup.json"),
      ],
      cwd,
    );
    expect(output).toContain(
      "Generated 15 candidate tests (6 positive, 9 negative)",
    );
    const files = await readdir(
      path.join(cwd, ".pathcompiler", "generated-tests"),
    );
    expect(files).toHaveLength(15);
    const report = JSON.parse(
      await readFile(
        path.join(cwd, ".pathcompiler", "reports", "generated-tests.json"),
        "utf8",
      ),
    );
    expect(report).toMatchObject({ reviewRequired: true, skipped: [] });
    expect(await runCli(["tests", "generate", fixture], cwd)).toContain(
      "Generated 0 candidate tests",
    );
    await expect(
      runCli(["scan", fixture, "--setup", "x.json"], cwd),
    ).rejects.toThrow("--setup is only supported by tests generate.");
  }, 300_000);
});
