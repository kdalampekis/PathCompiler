import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  type HarnessTaskSpec,
  parseHarnessTask,
} from "@pathcompiler/harness-contracts";

const exec = promisify(execFile);
export const temporary: string[] = [];
export async function cleanup() {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => rm(item, { recursive: true, force: true })),
  );
}

export async function repository(
  files: Record<string, string> = {
    "src/app.ts": "export const limit = 100;\n",
    "README.md": "# demo\n",
  },
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-runner-"));
  temporary.push(root);
  const repo = path.join(root, "repo");
  await mkdir(repo);
  const git = (...args: string[]) =>
    exec(
      "git",
      [
        "-c",
        "user.name=T",
        "-c",
        "user.email=t@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: repo },
    );
  await git("init", "-q", "-b", "main");
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(repo, name)), { recursive: true });
    await writeFile(path.join(repo, name), content);
  }
  await git("add", "-A");
  await git("commit", "-q", "-m", "base");
  const base = (await git("rev-parse", "HEAD")).stdout.trim();
  return {
    root,
    repo,
    base,
    git,
    runs: path.join(root, "runs"),
    worktrees: path.join(root, "worktrees"),
  };
}

export async function taskFor(
  base: string,
  overrides: Record<string, unknown> = {},
): Promise<HarnessTaskSpec> {
  const example = JSON.parse(
    await readFile(
      new URL("../../../examples/harness-contract/task.json", import.meta.url),
      "utf8",
    ),
  );
  example.repository.baseCommit = base;
  return parseHarnessTask({ ...example, ...overrides });
}
