import { existsSync } from "node:fs";
import { symlink } from "node:fs/promises";
import path from "node:path";
import { parseCommandLine, runProcess } from "./command.js";
import { redactSecretsInText } from "./safety.js";

/**
 * The project's own checks, run in a fresh worktree. A check run once says
 * little: a red test may have been red before the change, or the worktree may
 * lack what the tests need. So the same checks are run at the base commit too,
 * and each is classified: it passes, the change broke it (regression), the
 * change fixed it, it was already failing the same way (so it says nothing
 * about the change), or there is no baseline to compare with.
 */
export type CheckResult = {
  command: string;
  kind: "setup" | "check";
  passed: boolean;
  exitCode: number | null;
  tail: string;
};
export type CheckOutcome =
  | "passes"
  | "regression"
  | "fixed"
  | "fails_both"
  | "fails_no_baseline";
export type CheckComparison = {
  command: string;
  kind: "setup" | "check";
  candidate: boolean;
  base: boolean | null;
  outcome: CheckOutcome;
  /** For a failure at both: the failure output is the same, so the change did not cause it. */
  sameFailure?: boolean;
};
export type ChecksReport = {
  candidate: CheckResult[];
  base: CheckResult[] | null;
  comparison: CheckComparison[];
};

const tailOf = (text: string) =>
  text.trim().split("\n").slice(-6).join("\n").slice(-1_200);
const signature = (text: string) =>
  text
    .replace(/\d+(?:\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export async function runCommandCheck(
  command: string,
  kind: CheckResult["kind"],
  cwd: string,
  timeoutMs: number,
): Promise<CheckResult> {
  const result = await runProcess({
    argv: parseCommandLine(command),
    cwd,
    timeoutMs,
  }).catch((error: Error) => ({
    code: null as number | null,
    stdout: "",
    stderr: error.message,
    timedOut: false,
    truncated: false,
  }));
  return {
    command,
    kind,
    passed: result.code === 0 && !result.timedOut,
    exitCode: result.code,
    tail: redactSecretsInText(
      tailOf(
        `${result.stdout}\n${result.stderr}${result.timedOut ? "\n[timed out]" : ""}`,
      ),
    ),
  };
}

/** Links dependency directories from the repository into a worktree and runs the setup commands. */
export async function prepareWorktree(input: {
  repo: string;
  worktree: string;
  linkPaths: readonly string[];
  setup: readonly string[];
  timeoutMs: number;
}): Promise<CheckResult[]> {
  for (const link of input.linkPaths) {
    if (path.isAbsolute(link) || link.split(/[\\/]/).includes(".."))
      throw new Error(
        `harness.link_paths entry "${link}" must be a relative path inside the repository.`,
      );
    const from = path.join(input.repo, link);
    const to = path.join(input.worktree, link);
    if (existsSync(from) && !existsSync(to))
      await symlink(from, to, "dir").catch(() => undefined);
  }
  const results: CheckResult[] = [];
  for (const command of input.setup) {
    const result = await runCommandCheck(
      command,
      "setup",
      input.worktree,
      input.timeoutMs,
    );
    results.push(result);
    if (!result.passed) break;
  }
  return results;
}

export function compareChecks(
  candidate: readonly CheckResult[],
  base: readonly CheckResult[] | null,
): CheckComparison[] {
  return candidate.map((item) => {
    const before = base?.find(
      (entry) => entry.command === item.command && entry.kind === item.kind,
    );
    if (!base || !before)
      return {
        command: item.command,
        kind: item.kind,
        candidate: item.passed,
        base: null,
        outcome: item.passed
          ? ("passes" as const)
          : ("fails_no_baseline" as const),
      };
    const outcome: CheckOutcome = item.passed
      ? before.passed
        ? "passes"
        : "fixed"
      : before.passed
        ? "regression"
        : "fails_both";
    return {
      command: item.command,
      kind: item.kind,
      candidate: item.passed,
      base: before.passed,
      outcome,
      ...(outcome === "fails_both"
        ? { sameFailure: signature(item.tail) === signature(before.tail) }
        : {}),
    };
  });
}

/** A change is accountable for a check that regressed, or one that fails with nothing to compare. */
export const accountable = (item: CheckComparison) =>
  item.outcome === "regression" ||
  item.outcome === "fails_no_baseline" ||
  (item.outcome === "fails_both" && item.sameFailure === false);
