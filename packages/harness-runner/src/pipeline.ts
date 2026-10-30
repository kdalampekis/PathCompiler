import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type HarnessTaskSpec,
  parseHarnessTask,
} from "@pathcompiler/harness-contracts";
import { type CodingAgent, writeTaskFile } from "./agent.js";
import {
  type Assessment,
  type BehaviorSummary,
  type EvaluationSummary,
  mergeAssessment,
} from "./assess.js";
import { executeHarness } from "./execute.js";
import { decideNext, type HarnessPolicy, type Mode } from "./policy.js";
import { type Publisher, pullRequestBody } from "./publish.js";
import {
  isRunId,
  listRuns,
  loadRun,
  newRunId,
  type RunRecord,
  record,
  runDirectory,
  saveRun,
  usageInLastDay,
} from "./runs.js";

/**
 * The pipeline that ties the pieces together and enforces the mode:
 * task → (approval?) → harness run in a worktree → independent assessment →
 * policy decision → (approval?) → publish. Every transition is saved with who
 * decided it. Merging and deploying are not in this file because they are not
 * in PathCompiler.
 */
export type PipelineDeps = {
  repo: string;
  /** The `.pathcompiler` directory. */
  output: string;
  policy: HarnessPolicy;
  improvement: { autonomousMutation: boolean; maxAutonomousMutations: number };
  baseBranch: string;
  agent: () => CodingAgent;
  /** The product-model evaluation; omit when the repository has none. */
  evaluate?: (input: {
    task: HarnessTaskSpec;
    result: NonNullable<RunRecord["result"]>;
    base: string;
    candidate: string;
  }) => Promise<EvaluationSummary>;
  /** The behavior check; omit when there is no specification. */
  behavior?: (input: {
    base: string;
    candidate: string;
  }) => Promise<BehaviorSummary>;
  publisher: Publisher;
  worktreeParent?: string;
  now?: () => Date;
  newRunId?: () => string;
};

const clock = (deps: PipelineDeps) => (deps.now ?? (() => new Date()))();
const stamp = (deps: PipelineDeps) => clock(deps).toISOString();

export async function startRun(
  deps: PipelineDeps,
  task: HarnessTaskSpec,
  options: { mode?: Mode; previousRunId?: string } = {},
): Promise<RunRecord> {
  const valid = parseHarnessTask(task);
  const mode = options.mode ?? deps.policy.mode;
  if (mode === "automatic" && !deps.improvement.autonomousMutation)
    throw new Error(
      "Automatic mode needs improvement_policy.autonomous_mutation: true in pathcompiler.yaml.",
    );
  const usage = usageInLastDay(await listRuns(deps.output), clock(deps));
  if (usage.runs >= deps.policy.limits.max_runs_per_day)
    throw new Error(
      `${usage.runs} harness run(s) were started in the last day; harness.limits.max_runs_per_day is ${deps.policy.limits.max_runs_per_day}.`,
    );
  const runId = (deps.newRunId ?? (() => newRunId(clock(deps))))();
  const at = stamp(deps);
  const run: RunRecord = {
    schemaVersion: 1,
    runId,
    ...(options.previousRunId ? { previousRunId: options.previousRunId } : {}),
    taskId: valid.id,
    recommendationId: valid.recommendationId,
    mode,
    state: "running",
    createdAt: at,
    updatedAt: at,
    baseCommit: valid.repository.baseCommit,
    history: [
      { at, event: "created", detail: `${mode} mode, task ${valid.id}` },
    ],
  };
  await writeTaskFile(
    path.join(runDirectory(deps.output, runId), "task.json"),
    valid,
  );
  if (mode === "approval" && deps.policy.approvals.before_run) {
    const waiting = record(
      { ...run, state: "awaiting_run_approval" },
      "awaiting_run_approval",
      "harness.approvals.before_run is on: a person approves before the harness starts",
      at,
    );
    await saveRun(deps.output, waiting);
    return waiting;
  }
  await saveRun(deps.output, run);
  return executeRun(deps, runId);
}

async function readTask(deps: PipelineDeps, runId: string) {
  return parseHarnessTask(
    JSON.parse(
      await readFile(
        path.join(runDirectory(deps.output, runId), "task.json"),
        "utf8",
      ),
    ),
  );
}

/** Runs the harness for a run that is ready, assesses the candidate and applies the policy. */
export async function executeRun(
  deps: PipelineDeps,
  runId: string,
): Promise<RunRecord> {
  let run = await loadRun(deps.output, runId);
  const task = await readTask(deps, runId);
  run = record(
    { ...run, state: "running" },
    "started",
    `harness ${deps.policy.timeout_ms / 1000} s budget`,
    stamp(deps),
  );
  await saveRun(deps.output, run);
  const fail = async (message: string) => {
    const failed = record(
      { ...run, state: "error" },
      "error",
      message,
      stamp(deps),
    );
    await saveRun(deps.output, failed);
    return failed;
  };
  let execution: Awaited<ReturnType<typeof executeHarness>>;
  try {
    execution = await executeHarness({
      repo: deps.repo,
      task,
      agent: deps.agent(),
      runId,
      ...(run.previousRunId ? { previousRunId: run.previousRunId } : {}),
      runDirectory: runDirectory(deps.output, runId),
      ...(deps.worktreeParent ? { worktreeParent: deps.worktreeParent } : {}),
      checks: deps.policy.checks,
      agentTimeoutMs: deps.policy.timeout_ms,
      protectedPaths: deps.policy.protected_paths,
      ...(deps.now ? { now: deps.now } : {}),
    });
  } catch (error) {
    return fail((error as Error).message);
  }
  run = {
    ...run,
    result: execution.result,
    checks: execution.checks,
    safety: execution.safety,
    stats: execution.stats,
    ...(execution.branch ? { branch: execution.branch } : {}),
    ...(execution.candidateCommit
      ? { candidateCommit: execution.candidateCommit }
      : {}),
  };
  for (const step of execution.trace)
    run = record(run, step.step, step.detail, stamp(deps));
  if (!execution.candidateCommit) {
    run = record(
      { ...run, state: "no_candidate" },
      "no_candidate",
      `${execution.result.status}: ${execution.result.unresolvedQuestions[0] ?? execution.result.implementationSummary}`,
      stamp(deps),
    );
    await saveRun(deps.output, run);
    return run;
  }

  // Independent assessment: the harness is one voice among several.
  let assessment: Assessment;
  try {
    const evaluation: EvaluationSummary = deps.evaluate
      ? await deps.evaluate({
          task,
          result: execution.result,
          base: run.baseCommit,
          candidate: execution.candidateCommit,
        })
      : { applied: false, reason: "no evaluation is configured" };
    const behavior: BehaviorSummary = deps.behavior
      ? await deps.behavior({
          base: run.baseCommit,
          candidate: execution.candidateCommit,
        })
      : { applied: false, reason: "no behavior check is configured" };
    assessment = mergeAssessment({
      result: execution.result,
      checks: execution.checks,
      safety: execution.safety,
      evaluation,
      behavior,
    });
  } catch (error) {
    return fail(
      `The assessment could not be completed: ${(error as Error).message}`,
    );
  }
  run = record(
    { ...run, assessment },
    "assessed",
    `${assessment.verdict}: ${assessment.reasons.length} finding(s)`,
    stamp(deps),
  );

  const usage = usageInLastDay(await listRuns(deps.output), clock(deps));
  const decision = decideNext({
    policy: deps.policy,
    mode: run.mode,
    assessment,
    result: execution.result,
    stats: execution.stats,
    autonomy: {
      used: usage.automatic,
      allowed: deps.improvement.maxAutonomousMutations,
    },
  });
  const at = stamp(deps);
  run = { ...run, decision: { ...decision, by: "policy", at } };
  if (decision.action === "reject") {
    run = record(
      { ...run, state: "rejected" },
      "rejected",
      decision.reasons.join(" "),
      at,
      "policy",
    );
    await saveRun(deps.output, run);
    return run;
  }
  await writeFile(
    path.join(runDirectory(deps.output, runId), "report.md"),
    pullRequestBody({ task, result: execution.result, assessment, run }),
  );
  if (decision.action === "await_approval") {
    run = record(
      { ...run, state: "awaiting_approval" },
      "awaiting_approval",
      decision.reasons.join(" "),
      at,
      "policy",
    );
    await saveRun(deps.output, run);
    return run;
  }
  run = record(
    { ...run, state: "approved" },
    "approved",
    decision.reasons.join(" "),
    at,
    "policy",
  );
  await saveRun(deps.output, run);
  return publishRun(deps, runId, "policy");
}

/** Pushes the candidate branch, and opens a pull request when the target says so. */
export async function publishRun(
  deps: PipelineDeps,
  runId: string,
  by: string,
  target?: "none" | "branch" | "pull_request",
): Promise<RunRecord> {
  let run = await loadRun(deps.output, runId);
  const chosen = target ?? deps.policy.publish.target;
  if (!run.branch || !run.result || !run.assessment)
    throw new Error(`Run ${runId} has no candidate to publish.`);
  if (chosen === "none") {
    run = record(
      run,
      "publish_skipped",
      `publish.target is none; the candidate stays on the local branch ${run.branch}`,
      stamp(deps),
      by,
    );
    await saveRun(deps.output, run);
    return run;
  }
  const task = await readTask(deps, runId);
  try {
    const outcome = await deps.publisher.publish({
      repo: deps.repo,
      branch: run.branch,
      baseBranch: deps.baseBranch,
      remote: deps.policy.publish.remote,
      title: `${task.objective.summary} [PathCompiler harness ${runId}]`,
      body: pullRequestBody({
        task,
        result: run.result,
        assessment: run.assessment,
        run,
      }),
      draft: deps.policy.publish.draft,
      target: chosen,
    });
    run = record(
      {
        ...run,
        state: "published",
        publish: { ...outcome, at: stamp(deps) },
      },
      "published",
      `${outcome.target}${outcome.url ? ` ${outcome.url}` : ` ${outcome.remote}/${outcome.branch}`}`,
      stamp(deps),
      by,
    );
  } catch (error) {
    run = record(
      run,
      "publish_failed",
      (error as Error).message,
      stamp(deps),
      by,
    );
    await saveRun(deps.output, run);
    throw error;
  }
  await saveRun(deps.output, run);
  return run;
}

/** A person approves: the harness start (if it was waiting) or the publication. */
export async function approveRun(
  deps: PipelineDeps,
  runId: string,
  by: string,
  options: { target?: "none" | "branch" | "pull_request" } = {},
): Promise<RunRecord> {
  if (!by.trim()) throw new Error("Record who is approving.");
  let run = await loadRun(deps.output, runId);
  if (run.state === "awaiting_run_approval") {
    run = record(run, "run_approved", "the harness may start", stamp(deps), by);
    await saveRun(deps.output, run);
    return executeRun(deps, runId);
  }
  if (run.state === "awaiting_approval" || run.state === "approved") {
    if (run.state === "awaiting_approval")
      run = {
        ...run,
        decision: {
          action: "publish",
          reasons: ["Approved by a person."],
          by,
          at: stamp(deps),
        },
      };
    run = record(
      { ...run, state: "approved" },
      "approved",
      "candidate approved for publication",
      stamp(deps),
      by,
    );
    await saveRun(deps.output, run);
    return publishRun(deps, runId, by, options.target);
  }
  throw new Error(`Run ${runId} is ${run.state}; there is nothing to approve.`);
}

export async function rejectRun(
  deps: PipelineDeps,
  runId: string,
  by: string,
  reason: string,
): Promise<RunRecord> {
  if (!by.trim()) throw new Error("Record who is rejecting.");
  let run = await loadRun(deps.output, runId);
  if (
    !["awaiting_run_approval", "awaiting_approval", "approved"].includes(
      run.state,
    )
  )
    throw new Error(
      `Run ${runId} is ${run.state}; there is nothing to reject.`,
    );
  run = record(
    { ...run, state: "rejected" },
    "rejected",
    reason,
    stamp(deps),
    by,
  );
  await saveRun(deps.output, run);
  return run;
}

export { isRunId, listRuns, loadRun };
