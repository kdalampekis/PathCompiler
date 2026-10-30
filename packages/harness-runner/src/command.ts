import { spawn } from "node:child_process";
import {
  createStructuredModelProvider,
  ModelProviderError,
  type PathCompilerModelProvider,
  type StructuredCompletion,
} from "@pathcompiler/model-provider";
import {
  RepairProposalSchema,
  type RepairProvider,
  type RepairRequest,
} from "@pathcompiler/repair-loop";
import { z } from "zod";

/**
 * Your own harness (or any script) as a backend. It is run as a process with
 * no shell, receives one JSON document on stdin and answers with one JSON
 * document on stdout. The same protocol serves the analysis tasks of
 * `model_provider`, rule discovery and repair proposals, so a harness that can
 * read JSON and write JSON can do all three.
 *
 * The command is chosen by the person running PathCompiler (a flag or an
 * environment variable), never by a repository's configuration file: a
 * checked-out repository is untrusted input and must not decide what to run.
 */
export const COMMAND_PROTOCOL = "pathcompiler-command/1";
const MAX_OUTPUT = 8_000_000;

/** Splits a command line like a shell would for quotes, but never runs a shell. */
export function parseCommandLine(input: string): string[] {
  const trimmed = input.trim();
  if (trimmed.startsWith("[")) {
    const parsed = z
      .array(z.string().min(1))
      .min(1)
      .safeParse(JSON.parse(trimmed));
    if (!parsed.success)
      throw new Error("A JSON command must be an array of non-empty strings.");
    return parsed.data;
  }
  const argv: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const char of trimmed) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started || current) argv.push(current);
      current = "";
      started = false;
    } else current += char;
  }
  if (quote) throw new Error("The command has an unclosed quote.");
  if (started || current) argv.push(current);
  if (argv.length === 0) throw new Error("The command is empty.");
  return argv;
}

export type ProcessSpec = {
  argv: readonly string[];
  timeoutMs: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};
export type ProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** The output limit was reached and the process was stopped. */
  truncated: boolean;
};

export function runProcess(
  spec: ProcessSpec,
  stdin?: string,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const [command, ...args] = spec.argv;
    if (!command) return reject(new Error("The command is empty."));
    const child = spawn(command, args, {
      cwd: spec.cwd,
      env: spec.env ?? process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let truncated = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, spec.timeoutMs);
    const collect = (target: "out" | "err") => (chunk: Buffer) => {
      if (target === "out") stdout += chunk.toString();
      else stderr += chunk.toString();
      if (stdout.length + stderr.length > MAX_OUTPUT && !truncated) {
        truncated = true;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", collect("out"));
    child.stderr.on("data", collect("err"));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Cannot run ${command}: ${(error as NodeJS.ErrnoException).code ?? error.message}`,
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, truncated });
    });
    // The child may exit before reading its input; that is its answer, not our error.
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin ?? "");
  });
}

const tail = (text: string) =>
  text.trim().split("\n").slice(-3).join(" | ").slice(0, 400);

/** Runs a command with a JSON document on stdin and parses the JSON it prints. */
export async function runJsonCommand(
  spec: ProcessSpec,
  input: unknown,
): Promise<unknown> {
  const result = await runProcess(spec, JSON.stringify(input));
  const name = spec.argv[0] as string;
  if (result.timedOut)
    throw new ModelProviderError(
      "request-failed",
      `${name} did not answer within ${Math.round(spec.timeoutMs / 1000)} s and was stopped.`,
    );
  if (result.truncated)
    throw new ModelProviderError(
      "invalid-response",
      `${name} printed more than ${MAX_OUTPUT} characters and was stopped.`,
    );
  if (result.code !== 0)
    throw new ModelProviderError(
      "request-failed",
      `${name} exited with code ${result.code}${result.stderr.trim() ? `: ${tail(result.stderr)}` : ""}.`,
    );
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new ModelProviderError(
      "invalid-response",
      `${name} did not print JSON: ${(error as Error).message}`,
    );
  }
}

export type CommandBackend = { argv: readonly string[]; timeoutMs?: number };
const timeout = (spec: CommandBackend) => spec.timeoutMs ?? 300_000;

/** A structured task (analysis, rule discovery) answered by the command. */
export function commandCompletion(spec: CommandBackend): StructuredCompletion {
  return (task) => {
    let input: unknown = task.input;
    try {
      input = JSON.parse(task.input);
    } catch {
      // Not JSON: pass it through as text.
    }
    return runJsonCommand(
      { argv: spec.argv, timeoutMs: timeout(spec) },
      {
        protocol: COMMAND_PROTOCOL,
        kind: task.kind,
        instructions: task.instructions,
        input,
        outputSchema: task.outputSchema,
      },
    );
  };
}

/** The harness as `model_provider` for the analysis tasks. */
export function createCommandModelProvider(
  spec: CommandBackend,
): PathCompilerModelProvider {
  return createStructuredModelProvider("command", commandCompletion(spec));
}

/** The harness as the repair proposer: it receives the repair request, answers with the edits. */
export function commandRepairProvider(
  spec: CommandBackend,
  id = "command",
): RepairProvider {
  return {
    id,
    proposeRepair: (request: RepairRequest) =>
      runJsonCommand(
        { argv: spec.argv, timeoutMs: timeout(spec) },
        {
          protocol: COMMAND_PROTOCOL,
          kind: "repair",
          instructions:
            "Propose a change that makes the violated property hold without breaking the properties that must keep holding. Change only the files given. Answer with the complete new content of each file you change.",
          input: request,
          outputSchema: z.toJSONSchema(RepairProposalSchema, {
            io: "output",
            unrepresentable: "any",
          }),
        },
      ),
  };
}
