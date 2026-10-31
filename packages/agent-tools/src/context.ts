import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FeedbackRecorder } from "@pathcompiler/alignment-data";
import {
  CandidateRulesFileSchema,
  createFileLoader,
  type ExtractionResult,
  extractBehavior,
  readSourceFiles,
  type SourceFile,
} from "@pathcompiler/behavior-extraction";
import { git, headCommit } from "@pathcompiler/harness-runner";
import { emptyCandidates } from "@pathcompiler/rule-discovery";
import type { SolverProvider } from "@pathcompiler/solver-provider";

/**
 * What a tool sees. The workspace is a local directory, usually a repository a
 * harness is working in. Tools read it and never leave it; the only writes are
 * the two explicit ones (candidate rules, feedback) and only when `allowWrite`.
 */
export type ToolContext = {
  /** The repository (or any directory) the tools look at. */
  directory: string;
  allowWrite?: boolean;
  /** `payment=payments`: which entity or operation a code identifier belongs to. */
  bindings?: Record<string, string>;
  exclude?: readonly string[];
  /** Creates the solver on first use; the toolbox closes it. */
  solver: () => Promise<SolverProvider>;
  now?: () => Date;
  /** When set, checks and outcomes are recorded for alignment datasets. */
  recorder?: FeedbackRecorder;
  agent?: string;
  session?: string;
};

export const CANDIDATE_FILE = "spec/candidate-rules.json";

export type Workspace = {
  files: SourceFile[];
  extraction: ExtractionResult;
  commit: string | null;
  candidates: ReturnType<typeof emptyCandidates>;
};

/** The workspace as it is now, working-tree changes included. */
export async function loadWorkspace(context: ToolContext): Promise<Workspace> {
  const files = await readSourceFiles(context.directory, context.exclude ?? []);
  const commit = await headCommit(context.directory).catch(() => null);
  const extraction = extractBehavior(files, {
    bindings: context.bindings ?? {},
    id: "behavior",
    repositoryCommit: commit,
  });
  let candidates = emptyCandidates();
  try {
    candidates = CandidateRulesFileSchema.parse(
      JSON.parse(
        await readFile(path.join(context.directory, CANDIDATE_FILE), "utf8"),
      ),
    );
  } catch {
    // None yet.
  }
  return { files, extraction, commit, candidates };
}

export const workspaceLoader = createFileLoader;

export async function commitExists(
  directory: string,
  sha: string,
): Promise<boolean> {
  try {
    await git(directory, ["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
