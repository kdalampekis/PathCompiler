import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CONTRACT_VERSION,
  type HarnessTaskSpec,
  type MutationResult,
  parseHarnessTask,
  parseMutationResult,
} from "@pathcompiler/harness-contracts";
import {
  type AgentOutcome,
  type CodingAgent,
  EXIT_CODES,
  writeTaskFile,
} from "./agent.js";
import { parseCommandLine, runProcess } from "./command.js";
import {
  branchExists,
  commitAll,
  createWorktree,
  deleteBranch,
  diffAgainst,
  git,
  headCommit,
  removeWorktree,
  resolveCommit,
  workingTreeStatus,
} from "./git.js";
import {
  checkSafety,
  redactSecretsInText,
  type SafetyFinding,
} from "./safety.js";

/**
 * Harness V0 (handoff §49, §78). One run: validate the task before touching
 * anything, create an isolated worktree at the base commit on a new branch,
 * let the agent work there, check the diff against the safety rules, run the
 * project's checks, commit the candidate and emit a valid MutationResult. The
 * developer's own working tree is never modified, and nothing is pushed,
 * merged or deployed.
 */
export type CheckResult = {
  command: string;
  passed: boolean;
  exitCode: number | null;
  tail: string;
};
export type ExecutionInput = {
  repo: string;
  task: HarnessTaskSpec;
  agent: CodingAgent;
  runId: string;
  previousRunId?: string;
  /** Where worktrees are made; defaults to the system temporary directory. */
  worktreeParent?: string;
  /** Where the task copy, notes and log of the run are written. */
  runDirectory: string;
  checks?: readonly string[];
  agentTimeoutMs?: number;
  checkTimeoutMs?: number;
  protectedPaths?: readonly string[];
  now?: () => Date;
};
export type ExecutionResult = {
  result: MutationResult;
  branch: string | null;
  candidateCommit: string | null;
  stats: { files: number; changedLines: number; paths: string[] };
  safety: SafetyFinding[];
  checks: CheckResult[];
  agentExitCode: number | null;
  logFile: string;
  trace: { step: string; detail: string }[];
  /** The 0 / 2 / 3 / 4 exit code of the contract (handoff §25). */
  exitCode: number;
};

const tailOf = (text: string) =>
  text.trim().split("\n").slice(-6).join("\n").slice(-1_200);

export async function executeHarness(
  input: ExecutionInput,
): Promise<ExecutionResult> {
  const now = input.now ?? (() => new Date());
  const trace: ExecutionResult["trace"] = [];
  const log = (step: string, detail: string) => trace.push({ step, detail });
  const startedAt = now().toISOString();

  // 1. Fail before any mutation if the task or the repository is not usable (handoff §58).
  const task = parseHarnessTask(input.task);
  if (task.schemaVersion.split(".")[0] !== CONTRACT_VERSION.split(".")[0])
    throw new Error(
      `The task uses contract ${task.schemaVersion}; this harness supports ${CONTRACT_VERSION}.`,
    );
  const base = await resolveCommit(
    input.repo,
    task.repository.baseCommit,
  ).catch(() => {
    throw new Error(
      `The base commit ${task.repository.baseCommit} is not in ${input.repo}; fetch it first.`,
    );
  });
  const branch = `pathcompiler/${input.runId}`;
  if (await branchExists(input.repo, branch))
    throw new Error(`The branch ${branch} already exists; use a new run ID.`);
  log("task loaded", `${task.id} at ${base.slice(0, 12)}`);

  const mainHead = await headCommit(input.repo);
  const mainStatus = await workingTreeStatus(input.repo);
  const parent =
    input.worktreeParent ?? path.join(os.tmpdir(), "pathcompiler-harness");
  const worktree = path.join(parent, input.runId);
  const taskFile = path.join(input.runDirectory, "task.json");
  const notesFile = path.join(input.runDirectory, "notes.json");
  const logFile = path.join(input.runDirectory, "agent.log");
  await mkdir(parent, { recursive: true });
  await writeTaskFile(taskFile, task);
  await createWorktree({ repo: input.repo, directory: worktree, branch, base });
  log("worktree created", `${worktree} on ${branch}`);

  let outcome: AgentOutcome;
  let candidateCommit: string | null = null;
  let safety: SafetyFinding[] = [];
  const checks: CheckResult[] = [];
  let stats: ExecutionResult["stats"] = {
    files: 0,
    changedLines: 0,
    paths: [],
  };
  let discard = false;
  let committed = false;
  try {
    // 2. The agent works in the worktree.
    log("agent started", input.agent.id);
    outcome = await input.agent.run({
      task,
      taskFile,
      worktree,
      notesFile,
      runId: input.runId,
      baseCommit: base,
      timeoutMs: input.agentTimeoutMs ?? 1_800_000,
    });
    log(
      "agent finished",
      `${outcome.status}${outcome.exitCode === null ? "" : ` (exit ${outcome.exitCode})`}${outcome.timedOut ? ", timed out" : ""}`,
    );
    await writeFile(logFile, outcome.log);

    // 3. What changed, and is it allowed?
    const diff = await diffAgainst(worktree, base);
    stats = {
      files: diff.files.length,
      changedLines: diff.changedLines,
      paths: diff.files.map((item) => item.path),
    };
    safety = checkSafety({
      files: diff.files,
      added: diff.added,
      protectedPaths: input.protectedPaths ?? [],
    });
    log(
      "files changed",
      `${stats.files} file(s), ${stats.changedLines} line(s)`,
    );
    const blocking = safety.filter((item) => item.severity === "block");
    if (blocking.length > 0) {
      discard = true;
      log(
        "safety",
        `${blocking.length} blocking finding(s); the candidate is discarded`,
      );
    }

    // 4. Project checks, then the candidate commit.
    if (
      !discard &&
      stats.files > 0 &&
      (outcome.status === "completed" || outcome.status === "partial")
    ) {
      for (const command of input.checks ?? []) {
        const result = await runProcess({
          argv: parseCommandLine(command),
          cwd: worktree,
          timeoutMs: input.checkTimeoutMs ?? 900_000,
        }).catch((error: Error) => ({
          code: null as number | null,
          stdout: "",
          stderr: error.message,
          timedOut: false,
          truncated: false,
        }));
        checks.push({
          command,
          passed: result.code === 0 && !result.timedOut,
          exitCode: result.code,
          tail: redactSecretsInText(
            tailOf(`${result.stdout}\n${result.stderr}`),
          ),
        });
        log("check", `${command}: ${result.code === 0 ? "passed" : "failed"}`);
      }
      // Checks may have created files (build output); the candidate is the agent's change.
      const after = await diffAgainst(worktree, base);
      stats = {
        files: after.files.length,
        changedLines: after.changedLines,
        paths: after.files.map((item) => item.path),
      };
      candidateCommit = await commitAll(
        worktree,
        `PathCompiler harness: ${task.objective.summary}\n\nTask: ${task.id}\nRun: ${input.runId}\nHarness: ${input.agent.id}${input.agent.version ? ` ${input.agent.version}` : ""}\n\nA candidate for review. It has not been merged or deployed.`,
      );
      committed = true;
      log("candidate commit", candidateCommit.slice(0, 12));
    }
  } finally {
    await removeWorktree(input.repo, worktree);
    await rm(worktree, { recursive: true, force: true });
    if (!committed) await deleteBranch(input.repo, branch);
  }

  // 5. The developer's working tree must be exactly as it was.
  if (
    (await headCommit(input.repo)) !== mainHead ||
    (await workingTreeStatus(input.repo)) !== mainStatus
  )
    throw new Error(
      "The harness run changed the repository's own working tree; this is a bug in the runner. Nothing was published.",
    );

  // 6. The result.
  const failedChecks = checks.filter((item) => !item.passed);
  const blocking = safety.filter((item) => item.severity === "block");
  let status: AgentOutcome["status"] = outcome.status;
  const questions = [...(outcome.notes?.unresolvedQuestions ?? [])];
  if (blocking.length > 0) {
    status = "blocked";
    questions.push(...blocking.map((item) => item.detail));
  } else if (
    !candidateCommit &&
    (status === "completed" || status === "partial")
  ) {
    status = "blocked";
    questions.push(
      "The harness finished but changed nothing, so there is no candidate.",
    );
  } else if (
    candidateCommit &&
    failedChecks.length > 0 &&
    status === "completed"
  ) {
    status = "partial";
    questions.push(
      ...failedChecks.map(
        (item) =>
          `The check "${item.command}" failed: ${item.tail.split("\n").slice(-2).join(" ")}`,
      ),
    );
  }
  const summary =
    outcome.notes?.summary ??
    (candidateCommit
      ? `Candidate for: ${task.objective.summary} (${stats.files} file(s) changed).`
      : `No candidate: ${questions[0] ?? outcome.status}.`);
  const result = parseMutationResult(
    {
      schemaVersion: CONTRACT_VERSION,
      id: `mutation:${task.id}:${input.runId}`,
      harnessTaskId: task.id,
      recommendationId: task.recommendationId,
      repository: {
        baseCommit: base,
        ...(candidateCommit ? { candidateCommit, branch } : {}),
      },
      status,
      changedFiles: candidateCommit ? stats.paths : [],
      implementationSummary: redactSecretsInText(summary),
      claimedSemanticChanges: outcome.notes?.claimedSemanticChanges ?? [],
      testsAddedOrChanged: outcome.notes?.testsAddedOrChanged ?? [],
      assumptions: outcome.notes?.assumptions ?? [],
      unresolvedQuestions: questions.map(redactSecretsInText),
      artifacts: [{ type: "log", value: logFile }],
      harnessMetadata: {
        provider: input.agent.id,
        ...(input.agent.version ? { version: input.agent.version } : {}),
        runId: input.runId,
        ...(input.previousRunId ? { previousRunId: input.previousRunId } : {}),
        startedAt,
        finishedAt: now().toISOString(),
      },
    },
    task,
  );
  log("result emitted", status);
  return {
    result,
    branch: committed ? branch : null,
    candidateCommit,
    stats,
    safety,
    checks,
    agentExitCode: outcome.exitCode,
    logFile,
    trace,
    exitCode: EXIT_CODES[status],
  };
}

export { git as runGit };
