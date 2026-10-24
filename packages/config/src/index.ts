import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConfigurationError } from "@pathcompiler/diagnostics";
import { parse, stringify } from "yaml";
import { z } from "zod";

/**
 * `pathcompiler.yaml` (CODEX spec §44, reasoning spec §116, §139, ADR 0033,
 * ADR 0034). Every capability flag defaults to off and privacy-first. Without
 * a file, nothing is gated and behavior is unchanged.
 */
export const CONFIG_FILE = "pathcompiler.yaml";

const flag = z.boolean().default(false);
const share = z.number().min(0).max(1);
const count = z.number().int().nonnegative();
/** Provider API keys live in the environment only (ADR 0034). */
const envName = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    "Name an environment variable such as ANTHROPIC_API_KEY",
  );

export const PathCompilerConfigSchema = z.strictObject({
  version: z.literal(1),
  project: z.strictObject({ name: z.string().min(1).max(200) }).optional(),
  repository: z
    .strictObject({ default_branch: z.string().min(1).default("main") })
    .default({ default_branch: "main" }),
  framework: z
    .strictObject({ adapter: z.literal("nextjs").default("nextjs") })
    .default({ adapter: "nextjs" }),
  /** Operating modes (ADR 0033); each is usable on its own. */
  modes: z
    .strictObject({
      understand: z.boolean().default(true),
      guide: z.boolean().default(true),
      observe: flag,
      recommend: flag,
      evaluate: z.boolean().default(true),
      self_improvement: flag,
    })
    .default({
      understand: true,
      guide: true,
      observe: false,
      recommend: false,
      evaluate: true,
      self_improvement: false,
    }),
  /** Development flags (reasoning spec §116); enable phase by phase. */
  reasoning: z
    .strictObject({
      enabled: flag,
      reachability: flag,
      planning: flag,
      unsat_explanations: flag,
      property_checking: flag,
      semantic_diff: flag,
      /** Adds reasoning findings to impact, proposals and the GitHub check. */
      impact: flag,
      enumeration: flag,
      optimization: flag,
    })
    .default({
      enabled: false,
      reachability: false,
      planning: false,
      unsat_explanations: false,
      property_checking: false,
      semantic_diff: false,
      impact: false,
      enumeration: false,
      optimization: false,
    }),
  probabilistic: z
    .strictObject({ evidence_fusion: flag })
    .default({ evidence_fusion: false }),
  /** Privacy-first analytics defaults (reasoning spec §139). */
  analytics: z
    .strictObject({
      enabled: flag,
      collect_pii: flag,
      hash_user_ids: z.boolean().default(true),
      allowed_context_keys: z.array(z.string().min(1).max(64)).default([]),
      /** Lets `pathcompiler serve` accept events (also `--events`). */
      ingest: flag,
    })
    .default({
      enabled: false,
      collect_pii: false,
      hash_user_ids: true,
      allowed_context_keys: [],
      ingest: false,
    }),
  /** Channel A model provider (ADR 0034); deterministic analysis when `none`. */
  model_provider: z
    .strictObject({
      provider: z
        .enum(["none", "anthropic", "openai", "local"])
        .default("none"),
      model: z.string().min(1).max(200).optional(),
      api_key_env: envName.optional(),
      /** OpenAI-compatible endpoint for `openai` or `local` (C9). */
      base_url: z.url({ protocol: /^https?$/ }).optional(),
    })
    .default({ provider: "none" }),
  /** Improvement gating (ADR 0033); autonomous mutation is never the default. */
  improvement_policy: z
    .strictObject({
      autonomous_mutation: flag,
      min_affected_users: count.default(100),
      min_confidence: share.default(0.8),
      min_expected_gain: share.default(0.05),
      max_recommendations_per_period: count.default(5),
      max_experiments: count.default(1),
      max_autonomous_mutations: count.default(0),
    })
    .default({
      autonomous_mutation: false,
      min_affected_users: 100,
      min_confidence: 0.8,
      min_expected_gain: 0.05,
      max_recommendations_per_period: 5,
      max_experiments: 1,
      max_autonomous_mutations: 0,
    }),
  privacy: z
    .strictObject({ source_upload: z.literal(false).default(false) })
    .default({ source_upload: false }),
});
export type PathCompilerConfig = z.infer<typeof PathCompilerConfigSchema>;

/** A `ConfigurationError` (spec §51) listing every issue by key path. */
export class ConfigError extends ConfigurationError {
  constructor(
    readonly file: string,
    readonly issues: string[],
    options?: { cause?: unknown },
  ) {
    super(
      `Invalid ${file}:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`,
      options,
    );
    this.name = "ConfigError";
  }
}

const KEY_LIKE = /\b(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,})/;

/** Parses and validates YAML text; issues name the offending key path. */
export function parseConfig(
  text: string,
  file = CONFIG_FILE,
): PathCompilerConfig {
  if (KEY_LIKE.test(text))
    throw new ConfigError(file, [
      "The file appears to contain an API key. Remove it and set model_provider.api_key_env to an environment variable name.",
    ]);
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw new ConfigError(
      file,
      [`Not valid YAML: ${(error as Error).message}`],
      {
        cause: error,
      },
    );
  }
  const parsed = PathCompilerConfigSchema.safeParse(raw ?? {});
  if (!parsed.success)
    throw new ConfigError(
      file,
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
      { cause: parsed.error },
    );
  if (
    parsed.data.improvement_policy.autonomous_mutation === false &&
    parsed.data.improvement_policy.max_autonomous_mutations > 0
  )
    throw new ConfigError(file, [
      "improvement_policy.max_autonomous_mutations must be 0 while autonomous_mutation is false",
    ]);
  return parsed.data;
}

/**
 * Loads `pathcompiler.yaml` from a directory. Returns `null` when there is no
 * file: callers then apply no gating (behavior before configuration existed).
 */
export async function loadConfig(
  directory: string,
): Promise<{ config: PathCompilerConfig; file: string } | null> {
  const file = path.join(directory, CONFIG_FILE);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return { config: parseConfig(text, file), file };
}

/** Resolved flags for library callers. */
export type FeatureFlags = {
  modes: PathCompilerConfig["modes"];
  reasoning: PathCompilerConfig["reasoning"];
  probabilistic: PathCompilerConfig["probabilistic"];
  analytics: PathCompilerConfig["analytics"];
};
export function featureFlags(config: PathCompilerConfig): FeatureFlags {
  return {
    modes: { ...config.modes },
    reasoning: { ...config.reasoning },
    probabilistic: { ...config.probabilistic },
    analytics: { ...config.analytics },
  };
}

export type ReasoningCapability = Exclude<
  keyof PathCompilerConfig["reasoning"],
  "enabled"
>;
/** A reasoning capability needs both `reasoning.enabled` and its own flag. */
export function reasoningEnabled(
  config: PathCompilerConfig,
  capability: ReasoningCapability,
): boolean {
  return config.reasoning.enabled && config.reasoning[capability];
}

/** The privacy policy (`@pathcompiler/observability-core`) the analytics block describes. */
export function analyticsPolicy(config: PathCompilerConfig) {
  return {
    enabled: config.analytics.enabled,
    collectPii: config.analytics.collect_pii,
    hashUserIds: config.analytics.hash_user_ids,
    allowedContextKeys: [...config.analytics.allowed_context_keys],
  };
}

/** The file `pathcompiler init` writes: every default spelled out. */
export function defaultConfigYaml(projectName: string): string {
  const config = PathCompilerConfigSchema.parse({
    version: 1,
    project: { name: projectName },
  });
  return `# PathCompiler configuration. Capability flags default to off; see ADR 0053.\n${stringify(config)}`;
}
