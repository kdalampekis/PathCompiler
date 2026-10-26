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

describe("analysis cache beyond scan (#33)", () => {
  it("is shared by analyzing commands and never changes their output", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-cache-"));
    temporary.push(cwd);
    const run = (extra: string[] = []) =>
      runCli(
        ["capabilities", "discover", fixture, "--out", "out", ...extra],
        cwd,
      );
    const report = () =>
      readFile(path.join(cwd, "out", "reports", "capabilities.json"), "utf8");
    const first = await run();
    const fresh = await report();
    expect(
      await readdir(path.join(cwd, "out", "cache", "analysis")),
    ).toHaveLength(1);
    expect(await run()).toBe(first);
    expect(await report()).toBe(fresh);
    expect(await run(["--no-cache"])).toBe(first);
    expect(await report()).toBe(fresh);
  });
});
