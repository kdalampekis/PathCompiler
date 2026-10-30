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

const refunds = fileURLToPath(
  new URL("../../../fixtures/refunds/", import.meta.url),
);

describe("behavior", () => {
  it("exports the existing analysis as BehaviorIR, then validates and shows it", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-behavior-"));
    temporary.push(cwd);
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    const exported = await run(["behavior", "export", fixture]);
    expect(exported).toMatch(
      /^Exported \d+ transitions, 6 workflows, \d+ invariants/,
    );
    expect(exported).toContain(
      "inferred candidates, not business ground truth",
    );
    const file = path.join("out", "reports", "behavior-spec.json");
    // Deterministic: a second export is byte-identical.
    const first = await readFile(path.join(cwd, file), "utf8");
    await run(["behavior", "export", fixture]);
    expect(await readFile(path.join(cwd, file), "utf8")).toBe(first);
    expect(await run(["behavior", "validate", file])).toContain(
      "is a valid BehaviorIR specification",
    );
    const shown = await run(["behavior", "show", file]);
    expect(shown).toContain("invariant ");
    expect(shown).toContain("provenance: SOURCE_CODE/INFERRED");
    const json = JSON.parse(await run(["behavior", "show", file, "--json"]));
    expect(json.valid).toBe(true);

    // A rule without provenance is refused, with the reason.
    const spec = JSON.parse(first);
    spec.invariants[0].provenance = [];
    await writeFile(path.join(cwd, "bad.json"), JSON.stringify(spec));
    await expect(run(["behavior", "validate", "bad.json"])).rejects.toThrow(
      /Every rule needs provenance/,
    );
    await expect(run(["behavior", "other"])).rejects.toThrow(
      "Expected: pathcompiler behavior export",
    );
  }, 120_000);

  it("extracts a specification from SQL, Zod, OpenAPI, tests and approved rules without a model", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-extract-"));
    temporary.push(cwd);
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    const bind = [
      "--bind",
      "payment=payments",
      "--bind",
      "createRefund=refund",
    ];
    const text = await run(["behavior", "extract", refunds, ...bind]);
    expect(text).toContain("without a model");
    expect(text).toContain("4 constructs not modeled");
    expect(text).toContain("not business ground truth");
    const file = path.join("out", "reports", "behavior-spec.json");
    expect(await run(["behavior", "validate", file])).toContain(
      "is a valid BehaviorIR specification",
    );
    const report = JSON.parse(
      await readFile(
        path.join(cwd, "out", "reports", "behavior-extraction.json"),
        "utf8",
      ),
    );
    expect(report.ledger.length).toBeGreaterThan(30);
    expect(report.unsupported).toHaveLength(4);
    // Same input, same bytes.
    const first = await readFile(path.join(cwd, file), "utf8");
    await run(["behavior", "extract", refunds, ...bind]);
    expect(await readFile(path.join(cwd, file), "utf8")).toBe(first);
    await expect(
      run(["behavior", "extract", refunds, "--bind", "payment"]),
    ).rejects.toThrow("--bind expects <name>=<entity>");
  }, 120_000);
});
