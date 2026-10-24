import { mkdtemp, readFile, rm } from "node:fs/promises";
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

describe("pathcompiler eval", () => {
  it("prints stable reports and writes them as JSON", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-eval-cli-"));
    temporary.push(cwd);
    const reportLine = (family: string) =>
      `Report: ${path.join(cwd, ".pathcompiler", "reports", "eval", `${family}.json`)}\n`;
    const text = [];
    for (const family of ["capabilities", "workflow-discovery", "resolver"]) {
      const output = await runCli(["eval", family, fixture], cwd);
      expect(output.endsWith(reportLine(family))).toBe(true);
      text.push(output.replace(reportLine(family), ""));
    }
    await expect(text.join("")).toMatchFileSnapshot("./golden/eval.txt");
    const written = JSON.parse(
      await readFile(
        path.join(cwd, ".pathcompiler", "reports", "eval", "resolver.json"),
        "utf8",
      ),
    );
    expect(written).toEqual(
      JSON.parse(await runCli(["eval", "resolver", fixture, "--json"], cwd)),
    );
  });

  it("compares reasoning-assisted discovery with the baseline", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-eval-cli-"));
    temporary.push(cwd);
    const output = await runCli(
      ["eval", "workflow-discovery", fixture, "--compare"],
      cwd,
    );
    expect(output).toContain(
      "Workflow discovery (baseline): precision 1, recall 0.6,",
    );
    expect(output).toContain(
      "Workflow discovery (reasoning): precision 1, recall 1,",
    );
    expect(output).toContain(
      `Report: ${path.join(cwd, ".pathcompiler", "reports", "eval", "workflow-discovery-comparison.json")}`,
    );
    await runCli(["init"], cwd);
    await expect(
      runCli(["eval", "workflow-discovery", fixture, "--compare"], cwd),
    ).rejects.toThrow(
      /eval workflow-discovery --compare is disabled .* reasoning\.planning to true/,
    );
    await expect(
      runCli(["eval", "resolver", fixture, "--compare"]),
    ).rejects.toThrow(
      "--compare is only supported by eval workflow-discovery.",
    );
  }, 120_000);

  it("rejects unknown families and unsupported options", async () => {
    await expect(runCli(["eval", "graphs"])).rejects.toThrow(
      "Expected: pathcompiler eval capabilities|workflow-discovery|resolver|impact [directory].",
    );
    await expect(
      runCli(["eval", "resolver", fixture, "--exclude", "x"]),
    ).rejects.toThrow("--exclude is not supported by eval.");
  });
});
