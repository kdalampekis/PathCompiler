import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { SourceFile } from "./common.js";
import { anchoredPaths, CONTRACT_PATH, parseContract } from "./contract.js";

const EXTENSIONS = /\.(sql|tsx?|json|ya?ml)$/;
const SKIPPED = new Set([
  "node_modules",
  "dist",
  ".git",
  ".next",
  ".pathcompiler",
  "coverage",
]);
const MAX_BYTES = 1_000_000;

/**
 * Reads the files the extractors may use, with paths relative to
 * `directory` and in a stable order. `exclude` lists directories (relative to
 * `directory`) to skip, for example a folder of alternative versions. Files a
 * behavior contract is anchored to are read whatever their language, so code
 * drift can be judged without a parser.
 */
export async function readSourceFiles(
  directory: string,
  exclude: readonly string[] = [],
): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  const excluded = new Set(
    exclude.map((item) => path.resolve(directory, item)),
  );
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      if (excluded.has(full)) continue;
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) await walk(full);
      } else if (entry.isFile() && EXTENSIONS.test(entry.name)) {
        const content = await readFile(full, "utf8");
        if (content.length <= MAX_BYTES)
          files.push({
            path: path.relative(directory, full).split(path.sep).join("/"),
            content,
          });
      }
    }
  };
  await walk(directory);
  const root = path.resolve(directory);
  const known = new Set(files.map((file) => file.path));
  for (const file of [...files]) {
    if (!CONTRACT_PATH.test(file.path)) continue;
    const parsed = parseContract(file.content);
    if (!("contract" in parsed)) continue;
    for (const anchored of anchoredPaths(parsed.contract)) {
      const relative = path.posix.normalize(anchored.replace(/^\.\//, ""));
      const full = path.resolve(root, relative);
      if (known.has(relative) || !full.startsWith(`${root}${path.sep}`))
        continue;
      try {
        const content = await readFile(full, "utf8");
        if (content.length <= MAX_BYTES) {
          files.push({ path: relative, content });
          known.add(relative);
        }
      } catch {
        // A missing anchored file is reported as drift, not as a read error.
      }
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const VENDORED = new Set([
  ...SKIPPED,
  "vendor",
  "target",
  "build",
  "out",
  "venv",
  ".venv",
  "__pycache__",
  ".gradle",
  ".idea",
  ".tox",
  "Pods",
  "bin",
  "obj",
]);
const CODE_EXTENSIONS =
  /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|kts|scala|cs|rb|php|swift|ex|exs|erl|clj|c|cc|cpp|h|hpp|m|mm|dart|lua|pl|sql|graphql|proto|ya?ml|json|md|txt|rst)$/;

/**
 * The repository's files by path and size, in any language, for a reader who
 * must decide what to read. Contents are not returned.
 */
export async function listRepositoryFiles(
  directory: string,
  exclude: readonly string[] = [],
  limit = 3000,
): Promise<{ path: string; bytes: number }[]> {
  const result: { path: string; bytes: number }[] = [];
  const excluded = new Set(
    exclude.map((item) => path.resolve(directory, item)),
  );
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (result.length >= limit) return;
      const full = path.join(current, entry.name);
      if (excluded.has(full)) continue;
      if (entry.isDirectory()) {
        if (!VENDORED.has(entry.name)) await walk(full);
      } else if (entry.isFile() && CODE_EXTENSIONS.test(entry.name)) {
        const { size } = await stat(full);
        result.push({
          path: path.relative(directory, full).split(path.sep).join("/"),
          bytes: size,
        });
      }
    }
  };
  await walk(directory);
  return result;
}

/**
 * Reads one file of the repository by relative path, whatever its language.
 * Anything outside the directory, missing or oversized is undefined.
 */
export function createFileLoader(directory: string) {
  const root = path.resolve(directory);
  return async (relative: string): Promise<string | undefined> => {
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`))
      return undefined;
    try {
      const content = await readFile(target, "utf8");
      return content.length <= 2_000_000 ? content : undefined;
    } catch {
      return undefined;
    }
  };
}
