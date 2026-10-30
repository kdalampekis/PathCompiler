import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type ExtractionOptions,
  extractBehavior,
  readSourceFiles,
} from "@pathcompiler/behavior-extraction";
import { openGitRepository } from "@pathcompiler/git-intelligence";
import type { MutationResult } from "@pathcompiler/harness-contracts";
import {
  formatPrGuardMarkdown,
  type PrGuardReport,
  verifyPullRequest,
} from "@pathcompiler/pr-guard";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import type { ChecksReport } from "./checks.js";
import type { ReviewOutcome } from "./review.js";
import type { RiskFinding } from "./risk.js";
import type { SafetyFinding } from "./safety.js";

/**
 * One verdict from sources the harness does not control. The harness's own
 * report is read, but only as one input (handoff §6). Every source reports a
 * *signal*, and the verdict follows from them:
 *
 *  - `fail`: something definitely broke: a check that passed at the base fails
 *    with the change, the product-model evaluation or the behavior check
 *    fails, or a blocking safety finding.
 *  - `review`: something needs a person: open questions, a partial result, a
 *    check that fails with nothing to compare, risk signals, reviewer
 *    concerns, warnings, or no source that vouches for the change.
 *  - `pass`: nothing flagged **and** at least one source from the configured
 *    `independent` list actually passed. Which sources may vouch (project
 *    checks, the behavior check, the product-model evaluation, a reviewer) and
 *    which are required is the user's configuration.
 *
 * None of this depends on a language or framework: project checks come from
 * whatever ecosystem the repository uses, the behavior check works on any
 * specification (extracted or discovered by a harness), risk signals read
 * paths and changed lines, and a reviewer is any harness or model.
 */
export type Verdict = "pass" | "review" | "fail";
export type Source = "checks" | "behavior" | "evaluation" | "reviewer";
export type Signal = "passed" | "failed" | "flagged" | "no_signal" | "not_run";
export type EvaluationSummary =
  | {
      applied: true;
      status: "pass" | "pass_with_warnings" | "fail" | "inconclusive";
      risks: string[];
      warnings: string[];
      nextStep?: string;
    }
  | { applied: false; reason: string };
export type BehaviorSummary =
  | {
      applied: true;
      verdict: Verdict;
      findings: string[];
      markdown: string;
      report: PrGuardReport;
    }
  | { applied: false; reason: string };

export type Assessment = {
  verdict: Verdict;
  reasons: { source: string; verdict: Verdict; message: string }[];
  /** Observations that do not change the verdict but belong in front of a reviewer. */
  notes: string[];
  /** What each source concluded. */
  signals: Record<Source, Signal>;
  /** The sources that vouch for the change under the configuration. */
  vouchedBy: Source[];
  evaluation: EvaluationSummary;
  behavior:
    | {
        applied: true;
        verdict: Verdict;
        findings: string[];
        markdown: string;
      }
    | { applied: false; reason: string };
  checks: ChecksReport;
  risk: RiskFinding[];
  review: ReviewOutcome;
};

export function mergeAssessment(input: {
  result: MutationResult;
  checks: ChecksReport;
  safety: readonly SafetyFinding[];
  risk: readonly RiskFinding[];
  evaluation: EvaluationSummary;
  behavior: BehaviorSummary;
  review: ReviewOutcome;
  /** Sources that may vouch for a change. Default: checks, behavior, evaluation. */
  independent?: readonly Source[];
  /** Sources that must have passed. */
  require?: readonly Source[];
}): Assessment {
  const reasons: Assessment["reasons"] = [];
  const notes: string[] = [];
  const add = (source: string, verdict: Verdict, message: string) =>
    reasons.push({ source, verdict, message });
  const { result } = input;

  // The harness.
  if (result.status === "partial")
    add("harness", "review", "The harness reported a partial result.");
  for (const question of result.unresolvedQuestions)
    add("harness", "review", `Open question: ${question}`);

  // Safety.
  for (const finding of input.safety)
    add(
      "safety",
      finding.severity === "block" ? "fail" : "review",
      finding.detail,
    );

  // Project checks, compared with the base.
  const signals: Record<Source, Signal> = {
    checks: "not_run",
    behavior: "not_run",
    evaluation: "not_run",
    reviewer: "not_run",
  };
  const ran = input.checks.comparison.filter((item) => item.kind === "check");
  const setupFailed = input.checks.comparison.filter(
    (item) => item.kind === "setup" && !item.candidate,
  );
  for (const item of setupFailed)
    add(
      "checks",
      "review",
      `The setup command "${item.command}" failed, so the checks could not give a signal.`,
    );
  if (ran.length > 0) {
    const regression = ran.filter((item) => item.outcome === "regression");
    const uncompared = ran.filter(
      (item) =>
        item.outcome === "fails_no_baseline" ||
        (item.outcome === "fails_both" && item.sameFailure === false),
    );
    const preexisting = ran.filter(
      (item) => item.outcome === "fails_both" && item.sameFailure !== false,
    );
    for (const item of regression)
      add(
        "checks",
        "fail",
        `"${item.command}" passed at the base commit and fails with the change.`,
      );
    for (const item of uncompared)
      add(
        "checks",
        "review",
        `"${item.command}" fails${item.outcome === "fails_no_baseline" ? " and was not run at the base to compare" : " differently from how it failed at the base"}.`,
      );
    for (const item of preexisting)
      notes.push(
        `"${item.command}" already failed the same way at the base, so it says nothing about this change.`,
      );
    signals.checks =
      regression.length > 0
        ? "failed"
        : uncompared.length > 0
          ? "flagged"
          : ran.every(
                (item) => item.outcome === "passes" || item.outcome === "fixed",
              )
            ? "passed"
            : "no_signal";
  } else
    notes.push(
      "No project checks were run; configure harness.checks (pathcompiler harness detect suggests them).",
    );

  // Product-model evaluation.
  if (input.evaluation.applied) {
    const evaluation = input.evaluation;
    if (evaluation.status === "fail") {
      for (const risk of evaluation.risks.length > 0
        ? evaluation.risks
        : ["The evaluation failed."])
        add("evaluation", "fail", risk);
      signals.evaluation = "failed";
    } else {
      if (evaluation.status === "inconclusive")
        add(
          "evaluation",
          "review",
          "The product-model evaluation was inconclusive.",
        );
      for (const warning of evaluation.warnings)
        add("evaluation", "review", warning);
      signals.evaluation =
        evaluation.status === "inconclusive" || evaluation.warnings.length > 0
          ? "flagged"
          : "passed";
    }
  }
  // Behavior check.
  if (input.behavior.applied) {
    const behavior = input.behavior;
    if (behavior.verdict !== "pass")
      for (const finding of behavior.findings.length > 0
        ? behavior.findings
        : [`The behavior check says ${behavior.verdict}.`])
        add("behavior", behavior.verdict, finding);
    signals.behavior =
      behavior.verdict === "pass"
        ? "passed"
        : behavior.verdict === "fail"
          ? "failed"
          : "flagged";
  } else
    notes.push(
      `Business rules were not checked: ${input.behavior.reason}. \`rules task\` lets your harness discover them.`,
    );

  // Risk signals from the diff: for a reviewer, never a pass.
  for (const item of input.risk) {
    if (item.severity === "review") add("risk", "review", item.message);
    else notes.push(item.message);
  }
  // The reviewer.
  if (input.review.ran) {
    for (const concern of input.review.concerns)
      add(
        "reviewer",
        "review",
        `${concern.message} (${concern.evidence[0]?.file}${concern.evidence[0]?.lines ? `:${concern.evidence[0].lines}` : ""})`,
      );
    for (const note of input.review.notes)
      notes.push(`Reviewer: ${note.message}`);
    if (input.review.dropped > 0)
      notes.push(
        `${input.review.dropped} reviewer finding(s) were discarded because their evidence could not be found in the candidate.`,
      );
    signals.reviewer = input.review.concerns.length > 0 ? "flagged" : "passed";
  }

  // Who may vouch, and who must.
  const independent = input.independent ?? ["checks", "behavior", "evaluation"];
  const vouchedBy = independent.filter(
    (source) => signals[source] === "passed",
  );
  for (const source of input.require ?? [])
    if (signals[source] !== "passed")
      add(
        "assessment",
        "review",
        `${source} is required by the configuration and ${signals[source] === "not_run" ? "did not run" : `its result was ${signals[source]}`}.`,
      );
  const hardened = reasons.some((item) => item.verdict === "fail")
    ? "fail"
    : reasons.length > 0
      ? "review"
      : null;
  if (!hardened && vouchedBy.length === 0)
    add(
      "assessment",
      "review",
      `Nothing independent of the harness vouched for this change (allowed to: ${independent.join(", ")}; none passed). No project check, behavior specification, product-model evaluation or reviewer gave a clean result.`,
    );
  const verdict: Verdict = reasons.some((item) => item.verdict === "fail")
    ? "fail"
    : reasons.length > 0
      ? "review"
      : "pass";
  const behavior: Assessment["behavior"] = input.behavior.applied
    ? {
        applied: true,
        verdict: input.behavior.verdict,
        findings: input.behavior.findings,
        markdown: input.behavior.markdown,
      }
    : input.behavior;
  return {
    verdict,
    reasons,
    notes,
    signals,
    vouchedBy,
    evaluation: input.evaluation,
    behavior,
    checks: input.checks,
    risk: [...input.risk],
    review: input.review,
  };
}

/** The behavior check: approved and extracted rules at the base against the candidate. */
export async function behaviorCheck(input: {
  repo: string;
  base: string;
  candidate: string;
  options: ExtractionOptions;
  exclude?: readonly string[];
  solver: SolverProvider;
  strict?: boolean;
}): Promise<BehaviorSummary> {
  const scratch = await mkdtemp(
    path.join(os.tmpdir(), "pathcompiler-behavior-"),
  );
  try {
    const git = await openGitRepository(input.repo);
    const exported = [];
    for (const [index, ref] of [input.base, input.candidate].entries()) {
      const directory = path.join(scratch, String(index));
      await mkdir(directory);
      const commit = await git.exportCommit(ref, directory);
      exported.push({
        commit,
        files: await readSourceFiles(directory, input.exclude ?? []),
      });
    }
    const [base, head] = exported as [
      (typeof exported)[number],
      (typeof exported)[number],
    ];
    const specification = extractBehavior(base.files, input.options).spec;
    if (
      specification.operations.length === 0 &&
      specification.businessRules.length === 0 &&
      specification.invariants.length === 0
    )
      return {
        applied: false,
        reason: "no behavior specification was found in the repository",
      };
    const report = await verifyPullRequest({
      base: base.files,
      head: head.files,
      baseCommit: base.commit,
      headCommit: head.commit,
      options: input.options,
      solver: input.solver,
      strict: input.strict === true,
    });
    return {
      applied: true,
      verdict: report.verdict,
      findings: report.findings
        .filter((item) => item.severity !== "info")
        .map((item) => item.message),
      markdown: formatPrGuardMarkdown(report),
      report,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
