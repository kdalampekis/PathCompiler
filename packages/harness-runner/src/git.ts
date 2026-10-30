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
export type DiffStats = {
  files: ChangedFile[];
  added: AddedLine[];
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
  let file = "";
  let next = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ b/")) file = line.slice(6);
    else if (line.startsWith("@@")) {
      const match = /\+(\d+)/.exec(line);
      next = match ? Number(match[1]) : 0;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      added.push({ path: file, line: next, text: line.slice(1) });
      next += 1;
    }
  }
  return { files, added, changedLines };
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
