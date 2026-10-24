import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Diagnostics (CODEX spec §51–§53, §83–§84): the error taxonomy, structured
 * logs without source contents, phase timings against development targets,
 * and a content-hash cache that never changes results. No dependencies.
 */
export const ERROR_KINDS = [
  "ConfigurationError",
  "RepositoryAnalysisError",
  "UnsupportedFrameworkError",
  "WorkflowValidationError",
  "TargetResolutionError",
  "WorkflowNotFoundError",
  "AmbiguousWorkflowError",
  "ModelProviderError",
  "GitProviderError",
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** Base of the taxonomy; messages are written for the person who must act. */
export class PathCompilerDiagnosticError extends Error {
  readonly kind: ErrorKind;
  constructor(kind: ErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.kind = kind;
    this.name = kind;
  }
}
const named = (kind: ErrorKind) =>
  class extends PathCompilerDiagnosticError {
    constructor(message: string, options?: { cause?: unknown }) {
      super(kind, message, options);
    }
  };
export class ConfigurationError extends named("ConfigurationError") {}
export class RepositoryAnalysisError extends named("RepositoryAnalysisError") {}
export class UnsupportedFrameworkError extends named(
  "UnsupportedFrameworkError",
) {}
export class WorkflowValidationError extends named("WorkflowValidationError") {}
export class TargetResolutionError extends named("TargetResolutionError") {}
export class WorkflowNotFoundError extends named("WorkflowNotFoundError") {}
export class AmbiguousWorkflowError extends named("AmbiguousWorkflowError") {}
export class ModelProviderError extends named("ModelProviderError") {}
export class GitProviderError extends named("GitProviderError") {}

/**
 * The taxonomy kind of any error, including errors of packages that keep
 * their own public classes (matched by name and code), or `undefined`.
 */
export function errorKind(error: unknown): ErrorKind | undefined {
  if (error instanceof PathCompilerDiagnosticError) return error.kind;
  if (!(error instanceof Error)) return undefined;
  const code = (error as { code?: unknown }).code;
  if (error.name === "ReviewError" || error.name === "ProposalError")
    return "WorkflowValidationError";
  if (error.name === "ConfigError") return "ConfigurationError";
  if (error.name === "PathCompilerError" && code === "workflow-not-found")
    return "WorkflowNotFoundError";
  if ((ERROR_KINDS as readonly string[]).includes(error.name))
    return error.name as ErrorKind;
  return undefined;
}

// --- Structured logs (§52) --------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = {
  project?: string;
  commit?: string | null;
  phase?: string;
  workflow_id?: string;
  node_id?: string;
  duration_ms?: number;
  [field: string]: unknown;
};
export interface Logger {
  log(level: LogLevel, message: string, fields?: LogFields): void;
}
export const noopLogger: Logger = { log() {} };
const ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
/** Fields that could carry source code; dropped unless debug asks for them. */
const SOURCE_FIELD = /^(source|content|code|snippet|text|body)$/i;

/** One JSON object per line; source-like fields are removed unless `debugSource`. */
export function createJsonLogger(options: {
  write: (line: string) => void;
  level?: LogLevel;
  debugSource?: boolean;
  now?: () => Date;
}): Logger {
  const threshold = ORDER[options.level ?? "info"];
  return {
    log(level, message, fields = {}) {
      if (ORDER[level] < threshold) return;
      const kept = Object.fromEntries(
        Object.entries(fields).filter(
          ([key, value]) =>
            value !== undefined &&
            (options.debugSource || !SOURCE_FIELD.test(key)),
        ),
      );
      options.write(
        `${JSON.stringify({
          time: (options.now?.() ?? new Date()).toISOString(),
          level,
          message,
          ...kept,
        })}\n`,
      );
    },
  };
}

// --- Timings (§53, §83) -----------------------------------------------------

/** Development targets (§83); not production SLOs. */
export const PERFORMANCE_TARGETS_MS = {
  "fixture scan": 10_000,
  "small project scan": 30_000,
  "resolver local lookup": 100,
  "static workflow compile": 2_000,
} as const;
export type PhaseTiming = { phase: string; durationMs: number };
/** Runs a phase, records its duration and logs it. */
export async function timed<T>(
  timings: PhaseTiming[],
  phase: string,
  run: () => T | Promise<T>,
  logger: Logger = noopLogger,
  fields: LogFields = {},
): Promise<T> {
  const started = performance.now();
  try {
    return await run();
  } finally {
    const durationMs = Math.round(performance.now() - started);
    timings.push({ phase, durationMs });
    logger.log("info", "phase complete", {
      ...fields,
      phase,
      duration_ms: durationMs,
    });
  }
}

// --- Content-hash cache (§84) -----------------------------------------------

export interface ContentCache {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}
/** A stable key over versions and content parts (sha-256). */
export function contentKey(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(`${part.length}:${part}\u0000`);
  return hash.digest("hex");
}
/**
 * One JSON file per key under `directory`. A corrupt entry is reported to
 * `onCorrupt` and treated as a miss, so a bad cache costs time, never output.
 */
export function createFileCache(
  directory: string,
  options: { onCorrupt?: (key: string, error: unknown) => void } = {},
): ContentCache {
  const file = (key: string) => {
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new Error("Cache keys must come from contentKey().");
    return path.join(directory, `${key}.json`);
  };
  return {
    async get(key) {
      let text: string;
      try {
        text = await readFile(file(key), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      }
      try {
        return JSON.parse(text);
      } catch (error) {
        options.onCorrupt?.(key, error);
        return undefined;
      }
    },
    async set(key, value) {
      await mkdir(directory, { recursive: true });
      // Write then rename: readers never see a partial entry.
      const temporary = `${file(key)}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(value));
      await rename(temporary, file(key));
    },
  };
}
