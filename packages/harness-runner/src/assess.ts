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
import type { CheckResult } from "./execute.js";
import type { SafetyFinding } from "./safety.js";

/**
 * One verdict from independent sources. The harness does not grade itself
 * (handoff §6): its own report is read, but only as one input next to what
 * PathCompiler computes. Each source can fail a candidate; a candidate passes
 * only if nothing fails, nothing is flagged for review, and at least one
 * deterministic source actually ran.
 *
 *  - the harness: its status, open questions and assumptions;
 *  - safety: protected paths and secrets (blocking findings never get here),
 *    deleted tests;
 *  - the project's checks, run in the isolated worktree;
 *  - the product-model evaluation (reachability, permissions, protected
 *    properties, claimed against observed semantic change), when the
 *    repository is one PathCompiler can model;
 *  - the behavior check (BehaviorIR: approved rules and extracted rules at the
 *    base and at the candidate), when the repository has a specification.
 */
export type Verdict = "pass" | "review" | "fail";
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
  evaluation: EvaluationSummary;
  behavior:
    | {
        applied: true;
        verdict: Verdict;
        findings: string[];
        markdown: string;
      }
    | { applied: false; reason: string };
};

export function mergeAssessment(input: {
  result: MutationResult;
  checks: readonly CheckResult[];
  safety: readonly SafetyFinding[];
  evaluation: EvaluationSummary;
  behavior: BehaviorSummary;
}): Assessment {
  const reasons: Assessment["reasons"] = [];
  const add = (source: string, verdict: Verdict, message: string) =>
    reasons.push({ source, verdict, message });
  const { result } = input;

  if (result.status === "partial")
    add("harness", "review", "The harness reported a partial result.");
  for (const question of result.unresolvedQuestions)
    add("harness", "review", `Open question: ${question}`);
  for (const check of input.checks)
    if (!check.passed)
      add(
        "checks",
        "review",
        `The check "${check.command}" failed (exit ${check.exitCode ?? "none"}).`,
      );
  for (const finding of input.safety)
    add(
      "safety",
      finding.severity === "block" ? "fail" : "review",
      finding.detail,
    );

  if (input.evaluation.applied) {
    const evaluation = input.evaluation;
    if (evaluation.status === "fail")
      for (const risk of evaluation.risks.length > 0
        ? evaluation.risks
        : ["The evaluation failed."])
        add("evaluation", "fail", risk);
    else if (evaluation.status === "inconclusive")
      add(
        "evaluation",
        "review",
        "The product-model evaluation was inconclusive.",
      );
    for (const warning of evaluation.warnings)
      add("evaluation", "review", warning);
  }
  if (input.behavior.applied) {
    const behavior = input.behavior;
    if (behavior.verdict !== "pass")
      for (const finding of behavior.findings.length > 0
        ? behavior.findings
        : [`The behavior check says ${behavior.verdict}.`])
        add("behavior", behavior.verdict, finding);
  }
  if (!input.evaluation.applied && !input.behavior.applied)
    add(
      "assessment",
      "review",
      `Nothing independent of the harness could be run: no product-model evaluation (${input.evaluation.reason}) and no behavior check (${input.behavior.reason}).`,
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
  return { verdict, reasons, evaluation: input.evaluation, behavior };
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
