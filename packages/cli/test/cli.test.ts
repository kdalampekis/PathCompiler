import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const exec = promisify(execFile);
const temporary: string[] = [];
const binary = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo/", import.meta.url),
);
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function directory() {
  const result = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-cli-"));
  temporary.push(result);
  return result;
}

describe("pathcompiler CLI", () => {
  it("writes the specified artifacts from the built binary with repeatable bytes", async () => {
    const cwd = await directory();
    const first = await exec(process.execPath, [binary, "scan", fixture], {
      cwd,
    });
    expect(first.stdout).toContain("Scanned");
    expect(first.stderr).toBe("");
    const graphPath = path.join(cwd, ".pathcompiler/graph/source-graph.json");
    const reportPath = path.join(
      cwd,
      ".pathcompiler/reports/scan-summary.json",
    );
    const graph = await readFile(graphPath, "utf8");
    const report = await readFile(reportPath, "utf8");
    expect(JSON.parse(graph).schemaVersion).toBe(1);
    expect(JSON.parse(report).framework).toBe("nextjs-app-router");
    await exec(process.execPath, [binary, "scan", fixture], { cwd });
    expect(await readFile(graphPath, "utf8")).toBe(graph);
    expect(await readFile(reportPath, "utf8")).toBe(report);
  });

  it("supports explicit output and exclusions without mutating source files", async () => {
    const cwd = await directory();
    await mkdir(path.join(cwd, "app"));
    await mkdir(path.join(cwd, "private"));
    const source = "export default function Page() { return <main />; }";
    await writeFile(path.join(cwd, "app/page.tsx"), source);
    await writeFile(path.join(cwd, "private/invalid.ts"), "invalid syntax %%%");
    await runCli(
      ["scan", ".", "--out", "artifacts", "--exclude", "private"],
      cwd,
    );
    expect(await readFile(path.join(cwd, "app/page.tsx"), "utf8")).toBe(source);
    expect(
      await readFile(
        path.join(cwd, "artifacts/graph/source-graph.json"),
        "utf8",
      ),
    ).not.toContain("private/invalid.ts");
  });

  it("prints help and fails nonzero for invalid arguments or source syntax", async () => {
    expect(await runCli(["--help"])).toContain("Usage: pathcompiler scan");
    for (const args of [
      [],
      ["unknown"],
      ["scan"],
      ["scan", fixture, "--unknown"],
    ]) {
      await expect(
        exec(process.execPath, [binary, ...args]),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("PathCompiler:"),
      });
    }
    const cwd = await directory();
    await mkdir(path.join(cwd, "app"));
    await writeFile(
      path.join(cwd, "app/page.tsx"),
      "export default function ( broken",
    );
    await expect(
      exec(process.execPath, [binary, "scan", cwd], { cwd }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("app/page.tsx"),
    });
    await expect(
      readFile(path.join(cwd, ".pathcompiler/graph/source-graph.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
