import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  contentKey,
  createFileCache,
  createJsonLogger,
  ERROR_KINDS,
  errorKind,
  GitProviderError,
  PathCompilerDiagnosticError,
  type PhaseTiming,
  RepositoryAnalysisError,
  timed,
} from "../src/index.js";

describe("error taxonomy", () => {
  it("names every spec §51 error and classifies foreign ones", () => {
    expect(ERROR_KINDS).toHaveLength(9);
    const error = new GitProviderError("Create an initial Git commit.", {
      cause: "x",
    });
    expect(error).toBeInstanceOf(PathCompilerDiagnosticError);
    expect(error).toMatchObject({
      name: "GitProviderError",
      kind: "GitProviderError",
      cause: "x",
    });
    expect(errorKind(new RepositoryAnalysisError("No directory."))).toBe(
      "RepositoryAnalysisError",
    );
    const review = new Error("Approval refused");
    review.name = "ReviewError";
    expect(errorKind(review)).toBe("WorkflowValidationError");
    const missing = Object.assign(new Error("No workflow"), {
      name: "PathCompilerError",
      code: "workflow-not-found",
    });
    expect(errorKind(missing)).toBe("WorkflowNotFoundError");
    class ConfigError extends ConfigurationError {}
    expect(errorKind(new ConfigError("bad"))).toBe("ConfigurationError");
    expect(errorKind(new Error("plain"))).toBeUndefined();
    expect(errorKind("text")).toBeUndefined();
  });
});

describe("structured logs", () => {
  it("writes JSON lines without source contents unless debugging", () => {
    const lines: string[] = [];
    const logger = createJsonLogger({
      write: (line) => lines.push(line),
      now: () => new Date("2026-10-24T10:00:00.000Z"),
    });
    logger.log("debug", "hidden");
    logger.log("info", "phase complete", {
      phase: "analyze",
      duration_ms: 12,
      content: "export default function Page() {}",
      node_id: "ui:clients.create",
    });
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      {
        time: "2026-10-24T10:00:00.000Z",
        level: "info",
        message: "phase complete",
        phase: "analyze",
        duration_ms: 12,
        node_id: "ui:clients.create",
      },
    ]);
    const debug: string[] = [];
    createJsonLogger({
      write: (line) => debug.push(line),
      level: "debug",
      debugSource: true,
    }).log("debug", "source", { source: "x" });
    expect(JSON.parse(debug[0] as string)).toMatchObject({ source: "x" });
  });

  it("times phases, including failing ones", async () => {
    const timings: PhaseTiming[] = [];
    const logged: string[] = [];
    const logger = createJsonLogger({ write: (line) => logged.push(line) });
    expect(
      await timed(timings, "read", async () => 42, logger, { project: "demo" }),
    ).toBe(42);
    await expect(
      timed(timings, "fail", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(timings.map((item) => item.phase)).toEqual(["read", "fail"]);
    expect(JSON.parse(logged[0] as string)).toMatchObject({
      phase: "read",
      project: "demo",
    });
  });
});

describe("content cache", () => {
  it("round-trips values, misses unknown keys and recomputes corrupt entries", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "pathcompiler-cache-"),
    );
    try {
      const corrupt: string[] = [];
      const cache = createFileCache(directory, {
        onCorrupt: (key) => corrupt.push(key),
      });
      const key = contentKey(["v1", "file.ts", "content"]);
      expect(contentKey(["v1", "file.ts", "content"])).toBe(key);
      expect(contentKey(["v1", "file.tsc", "ontent"])).not.toBe(key);
      expect(await cache.get(key)).toBeUndefined();
      await cache.set(key, { nodes: 3 });
      expect(await cache.get(key)).toEqual({ nodes: 3 });
      await writeFile(path.join(directory, `${key}.json`), "{not json");
      expect(await cache.get(key)).toBeUndefined();
      expect(corrupt).toEqual([key]);
      await expect(cache.get("../../etc/passwd")).rejects.toThrow(
        "contentKey()",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
