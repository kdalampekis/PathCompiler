import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { nextDemoFormalModel } from "../../formal-model/test/next-demo-model.js";
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
async function directory() {
  const result = await mkdtemp(
    path.join(os.tmpdir(), "pathcompiler-config-cli-"),
  );
  temporary.push(result);
  return result;
}

describe("pathcompiler.yaml in the CLI", () => {
  it("keeps behavior unchanged without a file and gates capabilities with one", async () => {
    const cwd = await directory();
    await writeFile(
      path.join(cwd, "model.json"),
      JSON.stringify(nextDemoFormalModel("abc")),
    );
    const args = [
      "reason",
      "reachable",
      "clients.created",
      "--model",
      "model.json",
      "--context",
      "role=editor",
      "--out",
      "out",
    ];
    const strip = (text: string) => text.replace(/\d+ ms/g, "N ms");
    const without = await runCli(args, cwd);
    expect(without).toContain("REACHABLE");

    expect(await runCli(["init"], cwd)).toContain("Wrote");
    await expect(runCli(["init"], cwd)).rejects.toThrow(/already exists/);
    await expect(runCli(args, cwd)).rejects.toThrow(
      `reason reachable is disabled in ${path.join(cwd, "pathcompiler.yaml")}. Set reasoning.enabled and reasoning.reachability to true to enable it.`,
    );
    await expect(
      runCli(["observe", "graph", "--out", "out"], cwd),
    ).rejects.toThrow(/observe graph is disabled .* modes\.observe to true/);
    await expect(
      runCli(["impact", "a", "b", "--reasoning"], cwd),
    ).rejects.toThrow(/--reasoning is disabled .* reasoning\.impact/);

    const file = path.join(cwd, "pathcompiler.yaml");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        "reasoning:\n  enabled: false\n  reachability: false",
        "reasoning:\n  enabled: true\n  reachability: true",
      ),
    );
    // Enabled through configuration, the output is the same as without a file.
    expect(strip(await runCli(args, cwd))).toBe(strip(without));
    expect(await runCli(["config", "show"], cwd)).toContain(
      "Reasoning on: enabled, reachability",
    );
  });

  it("shows the configuration and rejects invalid files with actionable errors", async () => {
    const cwd = await directory();
    expect(await runCli(["config", "show"], cwd)).toBe(
      "No pathcompiler.yaml here: nothing is gated. Run pathcompiler init to create one.\n",
    );
    expect(JSON.parse(await runCli(["config", "show", "--json"], cwd))).toEqual(
      {
        file: null,
        config: null,
      },
    );
    await runCli(["init"], cwd);
    const shown = JSON.parse(await runCli(["config", "show", "--json"], cwd));
    expect(shown.config).toMatchObject({
      version: 1,
      project: { name: path.basename(cwd) },
      modes: { observe: false, evaluate: true },
      improvement_policy: { autonomous_mutation: false },
    });
    await writeFile(
      path.join(cwd, "pathcompiler.yaml"),
      "version: 1\nmodes:\n  observ: true\n",
    );
    await expect(runCli(["scan", "."], cwd)).rejects.toThrow(
      /Invalid .*pathcompiler\.yaml:\n {2}- modes: Unrecognized key/,
    );
  });

  it("prints the scan counts table, caches analysis and names unsupported input", async () => {
    const cwd = await directory();
    const first = await runCli(["scan", fixture, "--out", "out"], cwd);
    expect(first).toMatch(/^Scanned \d+ source files/);
    expect(first).toContain("Scan complete");
    expect(first).toMatch(/\nRoutes {14}\s*3\n/);
    expect(first).toMatch(/\nCapabilities {8}\s*6\n/);
    expect(first).toMatch(/\nCandidate workflows\s+5\n/);
    expect(first).toMatch(
      /Phases: read source \d+ ms, analyze \d+ ms, mine tests/,
    );
    const graph = await readFile(
      path.join(cwd, "out/graph/source-graph.json"),
      "utf8",
    );
    const second = await runCli(["scan", fixture, "--out", "out"], cwd);
    expect(second).toMatch(/analyze \d+ ms \(cached\)/);
    expect(
      await readFile(path.join(cwd, "out/graph/source-graph.json"), "utf8"),
    ).toBe(graph);
    expect(
      await runCli(["scan", fixture, "--out", "out", "--no-cache"], cwd),
    ).not.toContain("(cached)");
    await expect(
      runCli(["scan", cwd, "--out", "out"], cwd),
    ).rejects.toMatchObject({
      name: "UnsupportedFrameworkError",
      message: expect.stringMatching(
        /PathCompiler currently supports Next\.js/,
      ),
    });
    await expect(
      runCli(["scan", path.join(cwd, "missing")], cwd),
    ).rejects.toMatchObject({
      name: "RepositoryAnalysisError",
      message: expect.stringMatching(
        /no such directory\. Pass the repository root\./,
      ),
    });
  }, 120_000);

  it("inspects the graph and lists capabilities from existing artifacts", async () => {
    const cwd = await directory();
    await expect(
      runCli(["graph", "inspect", "--out", "out"], cwd),
    ).rejects.toThrow(/No graph under/);
    await runCli(["capabilities", "discover", fixture, "--out", "out"], cwd);
    const graph = await runCli(["graph", "inspect", "--out", "out"], cwd);
    expect(graph).toMatch(
      /^Graph .*capability-graph\.json: \d+ nodes, \d+ edges\./,
    );
    expect(graph).toContain("  Capability: 6");
    expect(
      JSON.parse(
        await runCli(["graph", "inspect", "--json", "--out", "out"], cwd),
      ).edges,
    ).toHaveProperty("TESTED_BY");
    const listed = await runCli(["capabilities", "list", "--out", "out"], cwd);
    expect(listed).toContain("6 candidate capabilities (review required):");
    expect(listed).toMatch(
      /clients\.create\s+Create Client — high \(0\.9\), roles admin\/editor/,
    );
  });
});
