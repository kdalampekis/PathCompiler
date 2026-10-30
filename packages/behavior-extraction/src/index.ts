import { behaviorSpecHash } from "@pathcompiler/behavior-ir";
import { extractApprovedRules } from "./approved.js";
import { extractAssertions } from "./assertions.js";
import {
  type ExtractedFragment,
  type ExtractionOptions,
  emptyFragment,
  type LedgerEntry,
  type MergeResult,
  mergeFragments,
  type SourceFile,
} from "./common.js";
import { collectTypes, extractGuards, type TypeIndex } from "./guards.js";
import { extractOpenApi } from "./openapi.js";
import { extractSql } from "./sql.js";
import { extractZod } from "./zod.js";

export * from "./approved.js";
export * from "./assertions.js";
export * from "./common.js";
export * from "./evaluate.js";
export * from "./guards.js";
export * from "./openapi.js";
export * from "./sql.js";
export * from "./zod.js";

export type ExtractorName =
  | "sql"
  | "zod"
  | "openapi"
  | "assertions"
  | "guards"
  | "approved";
export type ExtractionResult = MergeResult & {
  specHash: string;
  /** Files each extractor looked at. */
  inputs: Record<ExtractorName, string[]>;
};

const IGNORED = /(^|\/)(node_modules|dist|\.git|\.next|coverage)\//;
const OPENAPI_NAME = /(^|\/)(openapi|swagger)[^/]*\.(json|ya?ml)$/i;
const TEST_NAME = /\.(test|spec)\.tsx?$/;

/** Decides which extractors read a file, from its name and content. */
export function classify(file: SourceFile): ExtractorName[] {
  if (IGNORED.test(file.path)) return [];
  if (file.path.endsWith(".sql")) return ["sql"];
  if (/(^|\/)approved-rules[^/]*\.json$/.test(file.path)) return ["approved"];
  if (
    OPENAPI_NAME.test(file.path) ||
    /["']?openapi["']?\s*:\s*["']3\./.test(file.content)
  )
    return /\.(json|ya?ml)$/i.test(file.path) ? ["openapi"] : [];
  if (TEST_NAME.test(file.path)) return ["assertions"];
  if (!/\.tsx?$/.test(file.path) || /\.d\.ts$/.test(file.path)) return [];
  const names: ExtractorName[] = [];
  if (/from\s+["']zod["']/.test(file.content)) names.push("zod");
  if (/\bthrow\b/.test(file.content)) names.push("guards");
  return names;
}

/**
 * Runs every applicable extractor over the files and merges the result into
 * one BehaviorSpec. Pure: files in, specification out, same input same bytes.
 */
export function extractBehavior(
  files: readonly SourceFile[],
  options: ExtractionOptions & {
    id?: string;
    repositoryCommit?: string | null;
  } = {},
): ExtractionResult {
  const inputs: Record<ExtractorName, string[]> = {
    sql: [],
    zod: [],
    openapi: [],
    assertions: [],
    guards: [],
    approved: [],
  };
  const fragments: ExtractedFragment[] = [];
  const types: TypeIndex = collectTypes(files);
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    for (const name of classify(file)) {
      inputs[name].push(file.path);
      fragments.push(
        name === "sql"
          ? extractSql(file)
          : name === "zod"
            ? extractZod(file, options)
            : name === "openapi"
              ? extractOpenApi(file, options)
              : name === "approved"
                ? extractApprovedRules(file)
                : name === "guards"
                  ? extractGuards(file, options, types)
                  : extractAssertions(file, options),
      );
    }
  }
  const merged = mergeFragments(
    fragments.length ? fragments : [emptyFragment()],
    {
      id: options.id ?? "extracted",
      repositoryCommit: options.repositoryCommit ?? null,
    },
  );
  return { ...merged, specHash: behaviorSpecHash(merged.spec), inputs };
}
export type { LedgerEntry };
