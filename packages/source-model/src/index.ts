import { execFile } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const exec = promisify(execFile);
export const RelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes("\\") &&
      !value.includes("\0") &&
      !path.posix.isAbsolute(value) &&
      !/^[A-Za-z]:/.test(value) &&
      value
        .split("/")
        .every((part) => part !== ".." && part !== "." && part !== ""),
    "Expected a normalized repository-relative POSIX path",
  );
export const DiagnosticSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  file: RelativePathSchema.optional(),
});
export const SourceProjectSchema = z
  .strictObject({
    files: z.array(
      z.strictObject({ path: RelativePathSchema, content: z.string() }),
    ),
    configs: z.record(RelativePathSchema, z.string()).default({}),
    repository: z.strictObject({
      commit: z.string().nullable(),
      dirty: z.boolean().nullable(),
    }),
    diagnostics: z.array(DiagnosticSchema).default([]),
  })
  .superRefine((project, context) => {
    const paths = new Set<string>();
    project.files.forEach((file, index) => {
      if (paths.has(file.path))
        context.addIssue({
          code: "custom",
          path: ["files", index, "path"],
          message: `Duplicate source file: ${file.path}`,
        });
      paths.add(file.path);
    });
  });
export type SourceProject = z.infer<typeof SourceProjectSchema>;
export type AnalysisDiagnostic = z.infer<typeof DiagnosticSchema>;

export const DEFAULT_EXCLUDES = [
  "node_modules",
  ".git",
  ".next",
  ".pathcompiler",
  "dist",
  "build",
  "out",
  "coverage",
  "test-results",
  "playwright-report",
] as const;

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Reads source, never executes repository code. Symlinks and hidden directories are excluded. */
export async function readSourceProject(
  directory: string,
  options: {
    exclude?: string[];
    /**
     * Treat the directory as a clean export of this commit (e.g. `git archive`)
     * instead of reading Git metadata, which the export does not contain.
     */
    snapshot?: { commit: string };
  } = {},
): Promise<SourceProject> {
  const root = await realpath(directory);
  if (!(await stat(root)).isDirectory())
    throw new Error("Scan target must be a directory");
  const exclude = (options.exclude ?? []).map((entry) =>
    RelativePathSchema.parse(entry.replace(/\/$/, "")),
  );
  const files: SourceProject["files"] = [];
  const configs: Record<string, string> = {};
  const diagnostics: AnalysisDiagnostic[] = [];
  let commit: string | null = null;
  let dirty: boolean | null = null;
  let allowed: Set<string> | undefined;
  const git = (args: string[]) =>
    exec("git", ["-C", root, "-c", "core.fsmonitor=false", ...args], {
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
  let isGit = false;
  if (options.snapshot) {
    commit = z
      .string()
      .regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/, "Expected a full commit SHA")
      .parse(options.snapshot.commit);
    dirty = false;
  } else
    try {
      isGit =
        (await git(["rev-parse", "--is-inside-work-tree"])).stdout.trim() ===
        "true";
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === 128 || error.code === "ENOENT")
      ) {
        diagnostics.push({
          code: "git-unavailable",
          message:
            "Git metadata and Git ignore rules are unavailable; only default and explicit excludes apply.",
        });
      } else throw error;
    }
  if (isGit) {
    allowed = new Set(
      (
        await git([
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
          "--",
          ".",
        ])
      ).stdout
        .split("\0")
        .filter(Boolean),
    );
    try {
      commit = (await git(["rev-parse", "--verify", "HEAD"])).stdout.trim();
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 128
      ) {
        diagnostics.push({
          code: "unborn-repository",
          message:
            "Repository has no commit; source evidence is bound to the current working tree only.",
        });
      } else throw error;
    }
    dirty =
      (await git(["status", "--porcelain", "--untracked-files=all", "--", "."]))
        .stdout.length > 0;
  }
  async function walk(relative: string): Promise<void> {
    const entries = await readdir(path.join(root, relative), {
      withFileTypes: true,
    });
    entries.sort((a, b) => compareText(a.name, b.name));
    for (const entry of entries) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (exclude.some((item) => file === item || file.startsWith(`${item}/`)))
        continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (
          entry.name.startsWith(".") ||
          DEFAULT_EXCLUDES.some((name) => name === entry.name)
        )
          continue;
        await walk(file);
      } else if (
        entry.isFile() &&
        !entry.name.startsWith(".") &&
        (!allowed || allowed.has(file))
      ) {
        const isSource =
          /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name) &&
          !/\.d\.[cm]?ts$/.test(entry.name);
        const isConfig =
          entry.name === "package.json" ||
          /^(?:tsconfig[^/]*|jsconfig)\.json$/.test(entry.name);
        if (!isSource && !isConfig) continue;
        const content = await readFile(path.join(root, file), "utf8");
        if (content.includes("\0")) {
          diagnostics.push({
            code: "binary-source",
            message: "Skipped a file containing binary data.",
            file,
          });
          continue;
        }
        if (isSource) files.push({ path: file, content });
        else configs[file] = content;
      }
    }
  }
  await walk("");
  return SourceProjectSchema.parse({
    files,
    configs,
    repository: { commit, dirty },
    diagnostics,
  });
}
