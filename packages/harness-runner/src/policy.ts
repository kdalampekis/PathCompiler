import type { PathCompilerConfig } from "@pathcompiler/config";
import type { MutationResult } from "@pathcompiler/harness-contracts";
import type { Assessment } from "./assess.js";
import { matchesAny } from "./safety.js";

/**
 * The two ways to run the harness, and the control between them.
 *
 *  - **approval**: a person decides. Optionally before the harness starts, and
 *    always before anything leaves the machine (a pushed branch or a pull
 *    request).
 *  - **automatic**: the pipeline goes on by itself when the candidate is
 *    clean and inside the limits you set, and stops for a person when it is
 *    not. An automatic run can publish; it can never merge or deploy.
 *
 * In both, a candidate that fails the assessment is rejected, never
 * published, and nothing is ever merged by PathCompiler.
 */
export type HarnessPolicy = PathCompilerConfig["harness"];
export type Mode = HarnessPolicy["mode"];
export type Decision = {
  action: "reject" | "await_approval" | "publish";
  reasons: string[];
};
export type CandidateStats = {
  files: number;
  changedLines: number;
  paths: readonly string[];
};

export function decideNext(input: {
  policy: HarnessPolicy;
  mode: Mode;
  assessment: Assessment;
  result: MutationResult;
  stats: CandidateStats;
  /** Automatic publications in the last day, and how many are allowed. */
  autonomy: { used: number; allowed: number };
}): Decision {
  const { assessment } = input;
  if (assessment.verdict === "fail")
    return {
      action: "reject",
      reasons: assessment.reasons
        .filter((item) => item.verdict === "fail")
        .map((item) => `${item.source}: ${item.message}`),
    };
  if (input.mode === "approval")
    return {
      action: "await_approval",
      reasons: [
        "Approval mode: a person decides before anything is published.",
      ],
    };

  // Automatic mode: every condition must hold, otherwise a person is asked.
  const automatic = input.policy.automatic;
  const holds: string[] = [];
  if (input.result.status !== "completed")
    holds.push(`the harness reported ${input.result.status}, not completed`);
  if (assessment.verdict === "review" && automatic.allow_verdict !== "review")
    holds.push(
      `the assessment says review (${assessment.reasons
        .slice(0, 2)
        .map((item) => item.message)
        .join("; ")}) and automatic.allow_verdict is pass`,
    );
  if (input.stats.files > automatic.max_files)
    holds.push(
      `${input.stats.files} files changed, more than automatic.max_files (${automatic.max_files})`,
    );
  if (input.stats.changedLines > automatic.max_changed_lines)
    holds.push(
      `${input.stats.changedLines} lines changed, more than automatic.max_changed_lines (${automatic.max_changed_lines})`,
    );
  const sensitive = input.stats.paths.filter((item) =>
    matchesAny(item, automatic.require_approval_paths),
  );
  if (sensitive.length > 0)
    holds.push(
      `it changes ${sensitive.slice(0, 3).join(", ")}, which automatic.require_approval_paths reserves for a person`,
    );
  if (input.autonomy.used >= input.autonomy.allowed)
    holds.push(
      `${input.autonomy.used} automatic publication(s) were made in the last day and improvement_policy.max_autonomous_mutations is ${input.autonomy.allowed}`,
    );
  if (input.policy.publish.target === "none")
    holds.push("publish.target is none, so there is nothing to publish");
  return holds.length > 0
    ? {
        action: "await_approval",
        reasons: holds.map((item) => `Held for a person: ${item}.`),
      }
    : {
        action: "publish",
        reasons: [
          "Automatic mode: the candidate is clean and inside every limit.",
        ],
      };
}
