import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { SourceFile } from "./common.js";

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
 * `directory`) to skip, for example a folder of alternative versions.
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
  return files;
}
