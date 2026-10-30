import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** A git command in `cwd`; a failure says what failed, without echoing file contents. */
export async function git(
  cwd: string,
  args: readonly string[],
): Promise<string> {
  try {
    const { stdout } = await run("git", [...args], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout;
  } catch (error) {
    const failure = error as { stderr?: string; message: string };
    throw new Error(
      `git ${args[0]} failed in ${cwd}: ${(failure.stderr ?? failure.message).trim().split("\n")[0]}`,
      { cause: error },
    );
  }
}

export const resolveCommit = async (repo: string, ref: string) =>
  (await git(repo, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
export const headCommit = (cwd: string) => resolveCommit(cwd, "HEAD");
export const workingTreeStatus = async (repo: string) =>
  (await git(repo, ["status", "--porcelain"])).trim();

export async function createWorktree(input: {
  repo: string;
  directory: string;
  branch: string;
  base: string;
}) {
  await git(input.repo, [
    "worktree",
    "add",
    "-b",
    input.branch,
    input.directory,
    input.base,
  ]);
}
/** A worktree with no branch, for looking at (and running things in) a commit. */
export async function createDetachedWorktree(input: {
  repo: string;
  directory: string;
  commit: string;
}) {
  await git(input.repo, [
    "worktree",
    "add",
    "--detach",
    input.directory,
    input.commit,
  ]);
}
export async function removeWorktree(repo: string, directory: string) {
  await git(repo, ["worktree", "remove", "--force", directory]).catch(
    () => undefined,
  );
}
export async function deleteBranch(repo: string, branch: string) {
  await git(repo, ["branch", "-D", branch]).catch(() => undefined);
}
export async function branchExists(repo: string, branch: string) {
  try {
    await git(repo, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

export type ChangedFile = { status: "A" | "M" | "D" | "T"; path: string };
export type AddedLine = { path: string; line: number; text: string };
/** A line the change removed; `line` is its number in the base version. */
export type RemovedLine = { path: string; line: number; text: string };
export type DiffStats = {
  files: ChangedFile[];
  added: AddedLine[];
  removed: RemovedLine[];
  changedLines: number;
};

/** Everything that differs from `base` in the worktree, committed or not. */
export async function diffAgainst(
  worktree: string,
  base: string,
): Promise<DiffStats> {
  await git(worktree, ["add", "-A"]);
  const names = await git(worktree, [
    "diff",
    "--cached",
    "--name-status",
    "--no-renames",
    base,
  ]);
  const files = names
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status = "M", ...rest] = line.split("\t");
      return {
        status: status.charAt(0) as ChangedFile["status"],
        path: rest.join("\t"),
      };
    });
  const stat = await git(worktree, [
    "diff",
    "--cached",
    "--numstat",
    "--no-renames",
    base,
  ]);
  let changedLines = 0;
  for (const line of stat.split("\n").filter(Boolean)) {
    const [added = "0", removed = "0"] = line.split("\t");
    changedLines += (Number(added) || 0) + (Number(removed) || 0);
  }
  const patch = await git(worktree, [
    "diff",
    "--cached",
    "--unified=0",
    "--no-renames",
    "--no-color",
    base,
  ]);
  const added: AddedLine[] = [];
  const removed: RemovedLine[] = [];
  let file = "";
  let oldFile = "";
  let next = 0;
  let previous = 0;
  // File headers (`--- a/x`, `+++ b/x`) only occur between `diff --git` and the first
  // hunk; a content line that starts with `-- ` or `++ ` must not be mistaken for one.
  let inHeader = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHeader = true;
      oldFile = "";
      file = "";
    } else if (inHeader && line.startsWith("--- ")) {
      oldFile = line.startsWith("--- a/") ? line.slice(6) : "";
    } else if (inHeader && line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : oldFile;
    } else if (line.startsWith("@@")) {
      inHeader = false;
      const match = /-(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      previous = match ? Number(match[1]) : 0;
      next = match ? Number(match[2]) : 0;
    } else if (!inHeader && line.startsWith("+")) {
      added.push({ path: file, line: next, text: line.slice(1) });
      next += 1;
    } else if (!inHeader && line.startsWith("-")) {
      removed.push({
        path: oldFile || file,
        line: previous,
        text: line.slice(1),
      });
      previous += 1;
    }
  }
  return { files, added, removed, changedLines };
}

export async function commitAll(
  worktree: string,
  message: string,
): Promise<string> {
  await git(worktree, ["add", "-A"]);
  await git(worktree, [
    "-c",
    "user.name=PathCompiler harness",
    "-c",
    "user.email=harness@pathcompiler.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "--no-verify",
    "-m",
    message,
  ]);
  return headCommit(worktree);
}

/** The unified patch of everything that differs from `base`, capped for a reader. */
export async function patchAgainst(
  worktree: string,
  base: string,
  limit = 60_000,
): Promise<{ patch: string; truncated: boolean }> {
  await git(worktree, ["add", "-A"]);
  const patch = await git(worktree, [
    "diff",
    "--cached",
    "--no-renames",
    "--no-color",
    base,
  ]);
  return { patch: patch.slice(0, limit), truncated: patch.length > limit };
}
