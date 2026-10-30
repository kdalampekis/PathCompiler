import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MutationResult } from "@pathcompiler/harness-contracts";
import type { Assessment } from "./assess.js";
import type { CheckResult, ChecksReport } from "./checks.js";
import type { Mode } from "./policy.js";
import type { SafetyFinding } from "./safety.js";

/**
 * A run is a record on disk with its whole history, so what happened, who
 * decided and why can be read back later. States:
 *
 *   awaiting_run_approval → running → no_candidate
 *                                   → rejected          (the assessment failed)
 *                                   → awaiting_approval → approved → published
 *                                                       → rejected
 *                                   → published         (automatic mode, cleared by policy)
 *   error                            (the runner itself failed)
 */
export type RunState =
  | "awaiting_run_approval"
  | "running"
  | "no_candidate"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "published"
  | "error";
export const TERMINAL: readonly RunState[] = [
  "no_candidate",
  "rejected",
  "published",
  "error",
];

export type RunRecord = {
  schemaVersion: 1;
  runId: string;
  previousRunId?: string;
  taskId: string;
  recommendationId: string;
  mode: Mode;
  state: RunState;
  createdAt: string;
  updatedAt: string;
  baseCommit: string;
  branch?: string;
  candidateCommit?: string;
  stats?: { files: number; changedLines: number; paths: string[] };
  result?: MutationResult;
  checks?: CheckResult[];
  checksReport?: ChecksReport;
  safety?: SafetyFinding[];
  assessment?: Assessment;
  decision?: {
    action: "reject" | "await_approval" | "publish";
    reasons: string[];
    /** `policy`, or the name of the person. */
    by: string;
    at: string;
  };
  publish?: {
    target: "branch" | "pull_request";
    remote: string;
    branch: string;
    url?: string;
    at: string;
  };
  history: { at: string; event: string; by?: string; detail: string }[];
};

export const runsDirectory = (output: string) =>
  path.join(output, "harness", "runs");
export const runDirectory = (output: string, runId: string) =>
  path.join(runsDirectory(output), runId);
const recordFile = (output: string, runId: string) =>
  path.join(runDirectory(output, runId), "run.json");

const RUN_ID = /^run-[0-9]{8}T[0-9]{6}-[0-9a-f]{6}$/;
export function newRunId(
  now: Date,
  random = randomBytes(3).toString("hex"),
): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "");
  return `run-${stamp}-${random}`;
}
export const isRunId = (value: string) => RUN_ID.test(value);

export async function saveRun(
  output: string,
  record: RunRecord,
): Promise<void> {
  await mkdir(runDirectory(output, record.runId), { recursive: true });
  await writeFile(
    recordFile(output, record.runId),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}
export async function loadRun(
  output: string,
  runId: string,
): Promise<RunRecord> {
  if (!isRunId(runId))
    throw new Error(`"${runId}" is not a run ID (run-YYYYMMDDTHHMMSS-xxxxxx).`);
  try {
    return JSON.parse(
      await readFile(recordFile(output, runId), "utf8"),
    ) as RunRecord;
  } catch (error) {
    throw new Error(`No harness run ${runId} under ${runsDirectory(output)}.`, {
      cause: error,
    });
  }
}
export async function listRuns(output: string): Promise<RunRecord[]> {
  let names: string[];
  try {
    names = await readdir(runsDirectory(output));
  } catch {
    return [];
  }
  const records: RunRecord[] = [];
  for (const name of names.sort())
    if (isRunId(name)) records.push(await loadRun(output, name));
  return records;
}

export function record(
  run: RunRecord,
  event: string,
  detail: string,
  at: string,
  by?: string,
): RunRecord {
  return {
    ...run,
    updatedAt: at,
    history: [...run.history, { at, event, ...(by ? { by } : {}), detail }],
  };
}

/** Runs created, and automatic publications made, in the last day. */
export function usageInLastDay(runs: readonly RunRecord[], now: Date) {
  const since = now.getTime() - 24 * 60 * 60 * 1000;
  const recent = runs.filter((item) => Date.parse(item.createdAt) >= since);
  return {
    runs: recent.length,
    automatic: recent.filter(
      (item) => item.state === "published" && item.decision?.by === "policy",
    ).length,
  };
}
