import { fileURLToPath } from "node:url";
import type { ContentCache } from "@pathcompiler/diagnostics";
import { readSourceProject } from "@pathcompiler/source-model";
import { describe, expect, it } from "vitest";
import {
  analysisCacheKey,
  analyzeNextProject,
  analyzeNextProjectCached,
} from "../src/index.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo", import.meta.url),
);
function memoryCache(): ContentCache & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>();
  return {
    entries,
    async get(key) {
      return structuredClone(entries.get(key));
    },
    async set(key, value) {
      entries.set(key, structuredClone(value));
    },
  };
}

describe("analysis cache", () => {
  it("never changes output: a hit equals a fresh analysis", async () => {
    const project = await readSourceProject(fixture);
    const fresh = analyzeNextProject(project);
    const cache = memoryCache();
    const first = await analyzeNextProjectCached(project, cache);
    const second = await analyzeNextProjectCached(project, cache);
    expect([first.cached, second.cached]).toEqual([false, true]);
    expect(second.graph.serialize()).toBe(fresh.graph.serialize());
    expect(second.summary).toEqual(fresh.summary);
  });

  it("keys on file contents and recomputes unusable entries", async () => {
    const project = await readSourceProject(fixture);
    const key = analysisCacheKey(project);
    const changed = {
      ...project,
      files: project.files.map((file, index) =>
        index === 0
          ? { ...file, content: `${file.content}\n// changed` }
          : file,
      ),
    };
    expect(analysisCacheKey(changed)).not.toBe(key);
    const cache = memoryCache();
    cache.entries.set(key, { graph: "not a graph", summary: {} });
    expect((await analyzeNextProjectCached(project, cache)).cached).toBe(false);
  });
});
