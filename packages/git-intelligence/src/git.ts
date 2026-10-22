import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { compareText, RelativePathSchema } from "@pathcompiler/source-model";
import { z } from "zod";
import {
  type Blame,
  BlameSchema,
  type Commit,
  CommitSchema,
  CommitShaSchema,
  type DefaultBranch,
  type DiffHunk,
  type GitDiff,
  GitDiffSchema,
  type HistoryOptions,
  HistoryOptionsSchema,
  type PathHistory,
  PathHistorySchema,
} from "./schema.js";

const exec = promisify(execFile);
const MAX_BYTES = 8 * 1024 * 1024;
const revisionSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) => !value.startsWith("-") && !value.includes("\0"),
    "Expected a Git revision, not an option",
  );

/** Commands are bounded, local and read-only. Never relay raw Git stderr (it can contain credentials). */
async function git(
  root: string,
  args: string[],
  missingCodes: number[] = [],
): Promise<string | null> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  try {
    return (
      await exec(
        "git",
        [
          "--literal-pathspecs",
          "--no-lazy-fetch",
          "-C",
          root,
          "-c",
          "core.fsmonitor=false",
          "-c",
          "color.ui=false",
          ...args,
        ],
        {
          encoding: "utf8",
          maxBuffer: MAX_BYTES,
          timeout: 10_000,
          env: {
            ...env,
            LC_ALL: "C",
            GIT_OPTIONAL_LOCKS: "0",
            GIT_TERMINAL_PROMPT: "0",
            GIT_NO_LAZY_FETCH: "1",
            GIT_NO_REPLACE_OBJECTS: "1",
          },
        },
      )
    ).stdout;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (typeof error.code === "number" && missingCodes.includes(error.code))
        return null;
      if (error.code === "ENOENT")
        throw new Error("Git is unavailable. Install Git and retry.");
    }
    throw new Error(
      `Local Git ${args[0]} failed. Use Git supporting --no-lazy-fetch and check the repository, revision and path; queries must finish within 10 seconds and 8 MiB. No history was silently truncated.`,
    );
  }
}

function parseHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  // A patch ends in a newline; preserve all actual content, including empty context lines.
  for (const line of patch.replace(/\n$/, "").split("\n")) {
    // Type changes can emit separate delete/add sections for the same path.
    if (line.startsWith("diff --git ")) current = undefined;
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (match) {
      current = {
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? 1),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? 1),
        header: match[5] ?? "",
        lines: [],
      };
      hunks.push(current);
    } else if (current) {
      if (!/^[ +\-\\]/.test(line))
        throw new Error("Unexpected Git diff hunk output.");
      current.lines.push(line);
    }
  }
  for (const hunk of hunks) {
    if (
      hunk.lines.filter((line) => /^[ -]/.test(line)).length !==
        hunk.oldLines ||
      hunk.lines.filter((line) => /^[ +]/.test(line)).length !== hunk.newLines
    )
      throw new Error("Incomplete Git diff hunk output.");
  }
  return hunks;
}

/** Open a working tree or a subdirectory. All public paths are relative to that directory. */
export async function openGitRepository(
  directory: string,
): Promise<LocalGitRepository> {
  const scope = await realpath(directory);
  if (
    (
      await git(scope, ["rev-parse", "--is-inside-work-tree"], [128])
    )?.trim() !== "true"
  )
    throw new Error("Git intelligence requires a local Git working tree.");
  const output = await git(scope, ["rev-parse", "--show-toplevel"]);
  if (!output) throw new Error("Could not resolve the Git working tree.");
  const root = await realpath(output.replace(/\n$/, ""));
  const prefix = path.relative(root, scope).split(path.sep).join("/");
  if (prefix) RelativePathSchema.parse(prefix);
  return new LocalGitRepository(root, prefix);
}

export class LocalGitRepository {
  constructor(
    private readonly root: string,
    private readonly prefix: string,
  ) {}

  private scoped(file: string): string {
    const normalized = RelativePathSchema.parse(file);
    return this.prefix ? `${this.prefix}/${normalized}` : normalized;
  }

  private unscoped(file: string): string {
    if (this.prefix && !file.startsWith(`${this.prefix}/`))
      throw new Error("Git returned a path outside the selected directory.");
    return RelativePathSchema.parse(
      this.prefix ? file.slice(this.prefix.length + 1) : file,
    );
  }

  private async resolve(
    revision: string,
    optional = false,
  ): Promise<string | null> {
    const result = await git(
      this.root,
      [
        "rev-parse",
        "--verify",
        "--quiet",
        "--end-of-options",
        `${revisionSchema.parse(revision)}^{commit}`,
      ],
      optional ? [1] : [],
    );
    return result === null ? null : CommitShaSchema.parse(result.trim());
  }

  private async requireCommit(revision: string): Promise<string> {
    const sha = await this.resolve(revision);
    if (!sha) throw new Error("The requested commit is unavailable locally.");
    return sha;
  }

  async getCurrentCommit(): Promise<string | null> {
    return this.resolve("HEAD", true);
  }

  async hasCommit(sha: string): Promise<boolean> {
    return (await this.resolve(CommitShaSchema.parse(sha), true)) !== null;
  }

  async getSnapshot(): Promise<{
    commit: string | null;
    dirty: boolean;
    shallow: boolean;
  }> {
    return {
      commit: await this.getCurrentCommit(),
      dirty:
        (await git(this.root, [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
          "--",
          this.prefix || ".",
        ])) !== "",
      shallow:
        (
          await git(this.root, ["rev-parse", "--is-shallow-repository"])
        )?.trim() === "true",
    };
  }

  /** Uses cached origin/HEAD, then existing main/master conventions. Never contacts a remote. */
  async getDefaultBranch(): Promise<DefaultBranch | null> {
    const remote = (
      await git(
        this.root,
        ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
        [1],
      )
    )?.trim();
    if (
      remote?.startsWith("refs/remotes/origin/") &&
      (await this.resolve(remote, true))
    )
      return {
        name: remote.slice("refs/remotes/origin/".length),
        ref: remote,
        source: "remote-head",
      };
    for (const name of ["main", "master"]) {
      const ref = `refs/heads/${name}`;
      if (await this.resolve(ref, true))
        return { name, ref, source: "convention" };
    }
    return null;
  }

  async getCommit(revision: string): Promise<Commit> {
    const sha = await this.requireCommit(revision);
    const raw = await git(this.root, ["cat-file", "commit", sha]);
    const separator = raw?.indexOf("\n\n") ?? -1;
    if (raw === null || separator < 0)
      throw new Error("Malformed Git commit object.");
    const headers = raw.slice(0, separator);
    const encoding = /^encoding (.+)$/m.exec(headers)?.[1];
    if (encoding && !/^utf-?8$/i.test(encoding))
      throw new Error(
        "Git intelligence currently requires UTF-8 commit messages.",
      );
    const author = /^author .* (-?\d+) [+-]\d{4}$/m.exec(headers);
    if (!author) throw new Error("Git commit has no valid author date.");
    return CommitSchema.parse({
      sha,
      parents: [...headers.matchAll(/^parent ([0-9a-f]+)$/gm)].map(
        (match) => match[1],
      ),
      authorDate: new Date(Number(author[1]) * 1000).toISOString(),
      message: raw.slice(separator + 2),
    });
  }

  async getCommitMessage(sha: string): Promise<string> {
    return (await this.getCommit(sha)).message;
  }

  async getDiff(
    base: string | null,
    head: string,
    options: { paths?: string[]; maxFiles?: number } = {},
  ): Promise<GitDiff> {
    const parsed = z
      .strictObject({
        paths: z.array(RelativePathSchema).min(1).max(100).optional(),
        maxFiles: z.number().int().min(1).max(100).default(100),
      })
      .parse(options);
    const to = await this.requireCommit(head);
    const from = base === null ? null : await this.requireCommit(base);
    if (from === null && (await this.getCommit(to)).parents.length > 0)
      throw new Error(
        "A null diff base is only valid for a root commit; supply its parent SHA.",
      );
    const command =
      from === null
        ? ["diff-tree", "--root", "--no-commit-id", "-r", to]
        : ["diff", from, to];
    const flags = [
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--no-color",
      "--no-relative",
      "--submodule=short",
    ];
    const paths = parsed.paths?.map((file) => this.scoped(file)) ?? [
      this.prefix || ".",
    ];
    const names = await git(this.root, [
      ...command,
      ...flags,
      "--name-status",
      "-z",
      "--",
      ...paths,
    ]);
    const parts = (names ?? "").split("\0");
    if (parts.pop() !== "" || parts.length % 2 !== 0)
      throw new Error("Malformed Git changed-path output.");
    if (parts.length / 2 > parsed.maxFiles)
      throw new Error(
        `Diff exceeds ${parsed.maxFiles} files. Select fewer paths.`,
      );
    const changes: GitDiff["changes"] = [];
    let bytes = 0;
    for (let i = 0; i < parts.length; i += 2) {
      const status = z.enum(["A", "M", "D", "T"]).parse(parts[i]);
      const file = this.unscoped(parts[i + 1] ?? "");
      const patch =
        (await git(this.root, [
          ...command,
          ...flags,
          "--patch",
          "--unified=3",
          "--inter-hunk-context=0",
          "--diff-algorithm=myers",
          "--no-indent-heuristic",
          "--output-indicator-new=+",
          "--output-indicator-old=-",
          "--output-indicator-context= ",
          "--",
          this.scoped(file),
        ])) ?? "";
      bytes += Buffer.byteLength(patch);
      if (bytes > MAX_BYTES)
        throw new Error("Diff exceeds 8 MiB. Select fewer paths.");
      changes.push({
        path: file,
        status,
        binary: /^Binary files .* differ$/m.test(patch),
        hunks: parseHunks(patch),
      });
    }
    changes.sort((a, b) => compareText(a.path, b.path));
    return GitDiffSchema.parse({ base: from, head: to, changes });
  }

  async getCommitsForPath(
    file: string,
    options: HistoryOptions = {},
  ): Promise<PathHistory> {
    const scoped = this.scoped(file);
    const parsed = HistoryOptionsSchema.parse(options);
    const head = await this.requireCommit(parsed.revision ?? "HEAD");
    const output = await git(this.root, [
      "log",
      "--format=%H",
      `--max-count=${parsed.limit + 1}`,
      "--date-order",
      "--no-show-signature",
      "--no-renames",
      ...(parsed.since ? [`--since=${parsed.since}`] : []),
      head,
      "--",
      scoped,
    ]);
    const shas = (output ?? "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((sha) => CommitShaSchema.parse(sha));
    const commits: Commit[] = [];
    for (const sha of shas.slice(0, parsed.limit))
      commits.push(await this.getCommit(sha));
    return PathHistorySchema.parse({
      path: file,
      head,
      commits,
      limited: shas.length > parsed.limit,
      shallow:
        (
          await git(this.root, ["rev-parse", "--is-shallow-repository"])
        )?.trim() === "true",
    });
  }

  async getBlame(
    file: string,
    options: { revision?: string; startLine?: number; limit?: number } = {},
  ): Promise<Blame> {
    const scoped = this.scoped(file);
    const parsed = z
      .strictObject({
        revision: revisionSchema.optional(),
        startLine: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(1000).default(200),
      })
      .parse(options);
    const revision = await this.requireCommit(parsed.revision ?? "HEAD");
    const content = await git(this.root, [
      "cat-file",
      "blob",
      `${revision}:${scoped}`,
    ]);
    if (content === null || content.includes("\0"))
      throw new Error("Blame requires a text file at the selected commit.");
    const totalLines =
      content === "" ? 0 : content.replace(/\n$/, "").split("\n").length;
    if (parsed.startLine > Math.max(1, totalLines))
      throw new Error("Blame startLine exceeds the file length.");
    const end = Math.min(totalLines, parsed.startLine + parsed.limit - 1);
    const output =
      totalLines === 0
        ? ""
        : ((await git(this.root, [
            "blame",
            "--line-porcelain",
            "--no-textconv",
            "-L",
            `${parsed.startLine},${end}`,
            revision,
            "--",
            scoped,
          ])) ?? "");
    const lines: Blame["lines"] = [];
    let current: Blame["lines"][number] | undefined;
    for (const line of output.split("\n")) {
      const match = /^([0-9a-f]{40}|[0-9a-f]{64}) (\d+) (\d+)(?: \d+)?$/.exec(
        line,
      );
      if (match)
        current = {
          sha: CommitShaSchema.parse(match[1]),
          originalLine: Number(match[2]),
          line: Number(match[3]),
        };
      else if (line.startsWith("\t")) {
        if (!current) throw new Error("Malformed Git blame output.");
        lines.push(current);
        current = undefined;
      }
    }
    if (lines.length !== Math.max(0, end - parsed.startLine + 1))
      throw new Error("Incomplete Git blame output.");
    return BlameSchema.parse({
      path: file,
      revision,
      startLine: parsed.startLine,
      totalLines,
      limited: lines.length < totalLines,
      lines,
      shallow:
        (
          await git(this.root, ["rev-parse", "--is-shallow-repository"])
        )?.trim() === "true",
    });
  }
}
