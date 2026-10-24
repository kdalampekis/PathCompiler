import { fileURLToPath } from "node:url";
import { PERFORMANCE_TARGETS_MS } from "@pathcompiler/diagnostics";
import { createResolver } from "@pathcompiler/resolver";
import { compileWorkflows } from "@pathcompiler/workflow-compiler";
import { describe, expect, it } from "vitest";
import { analyzeFixture, approveAllCandidates } from "../src/index.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo/", import.meta.url),
);
const elapsed = async <T>(run: () => T | Promise<T>) => {
  const started = performance.now();
  const value = await run();
  return { value, ms: performance.now() - started };
};

// Development targets (CODEX §83), not production SLOs: a regression signal.
describe("performance targets", () => {
  it("scans, compiles and resolves the fixture within the §83 targets", async () => {
    const scan = await elapsed(() => analyzeFixture(fixture));
    expect(scan.ms).toBeLessThan(PERFORMANCE_TARGETS_MS["fixture scan"]);
    const approved = approveAllCandidates(scan.value);
    const compile = await elapsed(() => compileWorkflows(approved));
    expect(compile.ms).toBeLessThan(
      PERFORMANCE_TARGETS_MS["static workflow compile"],
    );
    const resolver = createResolver(compile.value.searchIndex);
    resolver.resolveProductHelp({ query: "warm up" });
    const lookup = await elapsed(() =>
      resolver.resolveProductHelp({ query: "how do I add a client" }),
    );
    expect(lookup.value.type).toBe("workflow_help");
    expect(lookup.ms).toBeLessThan(
      PERFORMANCE_TARGETS_MS["resolver local lookup"],
    );
  }, 60_000);
});
