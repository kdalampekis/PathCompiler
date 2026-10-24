import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyticsPolicy,
  CONFIG_FILE,
  ConfigError,
  defaultConfigYaml,
  featureFlags,
  loadConfig,
  parseConfig,
  reasoningEnabled,
} from "../src/index.js";

const issues = (text: string) => {
  try {
    parseConfig(text);
    return [];
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
};

describe("pathcompiler.yaml", () => {
  it("fills privacy-first, capability-off defaults", () => {
    const config = parseConfig("version: 1\n");
    expect(featureFlags(config)).toEqual({
      modes: {
        understand: true,
        guide: true,
        observe: false,
        recommend: false,
        evaluate: true,
        self_improvement: false,
      },
      reasoning: {
        enabled: false,
        reachability: false,
        planning: false,
        unsat_explanations: false,
        property_checking: false,
        semantic_diff: false,
        impact: false,
        enumeration: false,
        optimization: false,
      },
      probabilistic: { evidence_fusion: false },
      analytics: {
        enabled: false,
        collect_pii: false,
        hash_user_ids: true,
        allowed_context_keys: [],
        ingest: false,
      },
    });
    expect(config.model_provider).toEqual({ provider: "none" });
    expect(config.improvement_policy.autonomous_mutation).toBe(false);
    expect(config.improvement_policy.max_autonomous_mutations).toBe(0);
    expect(analyticsPolicy(config)).toEqual({
      enabled: false,
      collectPii: false,
      hashUserIds: true,
      allowedContextKeys: [],
    });
  });

  it("round-trips the file written by init", () => {
    const text = defaultConfigYaml("Demo");
    expect(text.startsWith("# PathCompiler configuration.")).toBe(true);
    expect(parseConfig(text)).toEqual(
      parseConfig("version: 1\nproject:\n  name: Demo\n"),
    );
  });

  it("requires both the master switch and the capability flag", () => {
    const config = parseConfig("version: 1\nreasoning:\n  planning: true\n");
    expect(reasoningEnabled(config, "planning")).toBe(false);
    const on = parseConfig(
      "version: 1\nreasoning:\n  enabled: true\n  planning: true\n",
    );
    expect(reasoningEnabled(on, "planning")).toBe(true);
    expect(reasoningEnabled(on, "reachability")).toBe(false);
  });

  it("rejects invalid files with key paths and keeps secrets out", () => {
    expect(issues("project:\n  name: x\n")).toEqual([
      "version: Invalid input: expected 1",
    ]);
    expect(
      issues("version: 1\nreasoning:\n  planing: true\n").join(),
    ).toContain("reasoning: Unrecognized key");
    expect(
      issues("version: 1\nanalytics:\n  enabled: yes please\n").join(),
    ).toContain("analytics.enabled");
    expect(
      issues("version: 1\nprivacy:\n  source_upload: true\n").join(),
    ).toContain("privacy.source_upload");
    expect(
      issues(
        "version: 1\nmodel_provider:\n  provider: anthropic\n  api_key_env: my key\n",
      ).join(),
    ).toContain("Name an environment variable");
    expect(
      issues(
        "version: 1\nmodel_provider:\n  provider: openai\n  api_key: sk-abcdefghijklmnop\n",
      ),
    ).toEqual([
      "The file appears to contain an API key. Remove it and set model_provider.api_key_env to an environment variable name.",
    ]);
    expect(
      issues(
        "version: 1\nimprovement_policy:\n  max_autonomous_mutations: 3\n",
      ),
    ).toEqual([
      "improvement_policy.max_autonomous_mutations must be 0 while autonomous_mutation is false",
    ]);
    expect(issues("version: 1\n: [\n").join()).toContain("Not valid YAML");
  });

  it("loads from a directory, or reports that there is no file", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "pathcompiler-config-"),
    );
    try {
      expect(await loadConfig(directory)).toBeNull();
      await writeFile(
        path.join(directory, CONFIG_FILE),
        "version: 1\nmodes:\n  observe: true\n",
      );
      const loaded = await loadConfig(directory);
      expect(loaded?.file).toBe(path.join(directory, CONFIG_FILE));
      expect(loaded?.config.modes.observe).toBe(true);
      await writeFile(path.join(directory, CONFIG_FILE), "version: 2\n");
      await expect(loadConfig(directory)).rejects.toThrow(
        /Invalid .*pathcompiler\.yaml:\n {2}- version/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
