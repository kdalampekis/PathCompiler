import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HarnessTaskSpec } from "@pathcompiler/harness-contracts";
import { z } from "zod";
import { runProcess } from "./command.js";
import { redactSecretsInText } from "./safety.js";

/**
 * The coding agent that makes the change. PathCompiler does not write the
 * change: it hands a task to an agent (your harness) in an isolated worktree
 * and judges what comes back. An agent is any process that edits the files in
 * its working directory and may leave a notes file.
 *
 * Contract for a command agent (handoff §25):
 *  - working directory: the isolated worktree at the base commit;
 *  - environment: PATHCOMPILER_TASK (the task JSON), PATHCOMPILER_WORKTREE,
 *    PATHCOMPILER_NOTES (where to write notes, optional), PATHCOMPILER_RUN_ID,
 *    PATHCOMPILER_BASE_COMMIT; the same values replace `{task}`, `{worktree}`,
 *    `{notes}`, `{run}` and `{base}` in the arguments;
 *  - exit code: 0 completed, 2 partial, 3 blocked, 4 failed;
 *  - it must not merge, push or deploy; it may commit, but PathCompiler makes
 *    the candidate commit itself.
 */
export const AgentNotesSchema = z.strictObject({
  status: z.enum(["completed", "partial", "blocked", "failed"]).optional(),
  summary: z.string().trim().min(1).max(4_000).optional(),
  assumptions: z.array(z.string().trim().min(1)).default([]),
  unresolvedQuestions: z.array(z.string().trim().min(1)).default([]),
  testsAddedOrChanged: z.array(z.string().trim().min(1)).default([]),
  claimedSemanticChanges: z
    .array(
      z.strictObject({
        workflow: z.string().optional(),
        goal: z.string().optional(),
        kind: z.string().optional(),
        property: z.string().optional(),
        claimedStatus: z
          .enum(["preserved", "changed", "added", "removed"])
          .optional(),
      }),
    )
    .default([]),
});
export type AgentNotes = z.infer<typeof AgentNotesSchema>;
export type AgentStatus = "completed" | "partial" | "blocked" | "failed";

export type AgentRequest = {
  task: HarnessTaskSpec;
  taskFile: string;
  worktree: string;
  notesFile: string;
  runId: string;
  baseCommit: string;
  timeoutMs: number;
};
export type AgentOutcome = {
  status: AgentStatus;
  notes: AgentNotes | null;
  exitCode: number | null;
  timedOut: boolean;
  /** Redacted output of the agent, capped. */
  log: string;
};
export interface CodingAgent {
  readonly id: string;
  readonly version?: string;
  run(request: AgentRequest): Promise<AgentOutcome>;
}

export const EXIT_CODES: Record<AgentStatus, number> = {
  completed: 0,
  partial: 2,
  blocked: 3,
  failed: 4,
};
const fromExit = (code: number | null): AgentStatus =>
  code === 0
    ? "completed"
    : code === 2
      ? "partial"
      : code === 3
        ? "blocked"
        : "failed";

async function readNotes(file: string): Promise<AgentNotes | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return null;
  }
  const parsed = AgentNotesSchema.safeParse(JSON.parse(text));
  if (!parsed.success)
    throw new Error(
      `The agent's notes are not valid: ${parsed.error.issues[0]?.path.join(".") || "(root)"}: ${parsed.error.issues[0]?.message}`,
    );
  return parsed.data;
}
const capLog = (text: string) => redactSecretsInText(text).slice(-200_000);

/** Runs the harness command in the worktree. */
export function commandAgent(
  argv: readonly string[],
  options: { id?: string; version?: string } = {},
): CodingAgent {
  return {
    id: options.id ?? path.basename(argv[0] ?? "command"),
    ...(options.version ? { version: options.version } : {}),
    async run(request) {
      const values: Record<string, string> = {
        task: request.taskFile,
        worktree: request.worktree,
        notes: request.notesFile,
        run: request.runId,
        base: request.baseCommit,
      };
      const filled = argv.map((item) =>
        item.replace(
          /\{(task|worktree|notes|run|base)\}/g,
          (_, key: string) => values[key] as string,
        ),
      );
      await mkdir(path.dirname(request.notesFile), { recursive: true });
      const result = await runProcess({
        argv: filled,
        cwd: request.worktree,
        timeoutMs: request.timeoutMs,
        env: {
          ...process.env,
          PATHCOMPILER_TASK: request.taskFile,
          PATHCOMPILER_WORKTREE: request.worktree,
          PATHCOMPILER_NOTES: request.notesFile,
          PATHCOMPILER_RUN_ID: request.runId,
          PATHCOMPILER_BASE_COMMIT: request.baseCommit,
        },
      });
      let notes: AgentNotes | null = null;
      let notesError = "";
      try {
        notes = await readNotes(request.notesFile);
      } catch (error) {
        notesError = `\n[notes ignored] ${(error as Error).message}`;
      }
      const status: AgentStatus = result.timedOut
        ? "failed"
        : (notes?.status ?? fromExit(result.code));
      return {
        status,
        notes,
        exitCode: result.code,
        timedOut: result.timedOut,
        log: capLog(
          `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}${result.timedOut ? "\n[stopped: timeout]" : ""}${notesError}`,
        ),
      };
    },
  };
}

/** An agent that is a function; for tests and for harnesses written in-process. */
export function scriptedAgent(
  run: (request: AgentRequest) => Promise<Partial<AgentNotes>> | Promise<void>,
  id = "scripted",
): CodingAgent {
  return {
    id,
    async run(request) {
      try {
        const notes = (await run(request)) || {};
        const parsed = AgentNotesSchema.parse(notes);
        return {
          status: parsed.status ?? "completed",
          notes: parsed,
          exitCode: 0,
          timedOut: false,
          log: "",
        };
      } catch (error) {
        return {
          status: "failed",
          notes: null,
          exitCode: null,
          timedOut: false,
          log: capLog(String((error as Error).message)),
        };
      }
    },
  };
}

export async function writeTaskFile(file: string, task: HarnessTaskSpec) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(task, null, 2)}\n`);
}
