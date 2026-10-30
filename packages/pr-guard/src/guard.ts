import {
  type ExtractionOptions,
  extractBehavior,
  type SourceFile,
} from "@pathcompiler/behavior-extraction";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import {
  type Counterexample,
  createSmtVerifier,
  createVerificationRouter,
  propertyLabel,
  type RuleBasis,
  type VerificationProperty,
  type VerificationReport,
  type VerificationResult,
  verifySpec,
} from "@pathcompiler/verification";
import { type BehaviorDiff, diffBehavior } from "./diff.js";

export type FindingKind =
  /** Held at base, violated at head: a new reachable violation. */
  | "regression"
  /** Did not exist at base (a new operation or rule), violated at head. */
  | "new_violation"
  | "preexisting_violation"
  | "fixed"
  /** Verified at base, UNKNOWN or UNSUPPORTED at head. */
  | "coverage_lost"
  | "approved_rules_changed"
  | "rule_removed"
  | "limitation_added";
export type Finding = {
  kind: FindingKind;
  severity: "fail" | "review" | "info";
  message: string;
  property?: VerificationProperty;
  rule?: RuleBasis;
  counterexample?: Counterexample;
  caveats?: string[];
};
export type Verdict = "pass" | "review" | "fail";

export type PrGuardInput = {
  base: readonly SourceFile[];
  head: readonly SourceFile[];
  baseRef?: string;
  headRef?: string;
  baseCommit?: string | null;
  headCommit?: string | null;
  options?: ExtractionOptions;
  solver: SolverProvider;
  /** Treat "review" findings as failures. */
  strict?: boolean;
  timeoutMs?: number;
};

type Side = {
  ref: string | null;
  commit: string | null;
  specHash: string;
  summary: VerificationReport["summary"];
  unsupportedConstructs: number;
};
export type PrGuardReport = {
  schemaVersion: 1;
  verdict: Verdict;
  strict: boolean;
  base: Side;
  head: Side;
  diff: BehaviorDiff;
  findings: Finding[];
  /** Notes on how to read the result. */
  caveats: string[];
};

/** Files holding rules a person approved; they must not be changed by the PR under review. */
const APPROVED = /(^|\/)approved-rules[^/]*\.json$/;
const key = (property: VerificationProperty) => JSON.stringify(property);

export const PR_GUARD_CAVEATS = [
  "Rules come from the base branch (approved rules) and from the schema, validation models, OpenAPI documents and tests at each version; extracted rules are candidates, not business ground truth.",
  "A result holds within the supported model: one execution of one operation, linear integer arithmetic, booleans, finite enums and string equality. Code the extractor could not model is listed as a limitation of the operation.",
  "A passing verdict does not mean the change is correct or that tests are sufficient; it means no encoded rule was newly violated.",
];

/**
 * Verifies a change. The head's code, schema and contracts are extracted and
 * checked against the **base's approved rules** (so a PR cannot weaken a rule
 * by editing it), and each result is compared with the same property at the
 * base: only a violation the change introduces is a regression.
 */
export async function verifyPullRequest(
  input: PrGuardInput,
): Promise<PrGuardReport> {
  const options = input.options ?? {};
  const baseApproved = input.base.filter((file) => APPROVED.test(file.path));
  const headApproved = input.head.filter((file) => APPROVED.test(file.path));
  const headFiles = [
    ...input.head.filter((file) => !APPROVED.test(file.path)),
    ...baseApproved,
  ];
  const baseResult = extractBehavior(input.base, {
    ...options,
    id: "behavior",
    repositoryCommit: input.baseCommit ?? null,
  });
  const headResult = extractBehavior(headFiles, {
    ...options,
    id: "behavior",
    repositoryCommit: input.headCommit ?? null,
  });
  const router = createVerificationRouter([createSmtVerifier(input.solver)]);
  const verifyOptions = input.timeoutMs ? { timeoutMs: input.timeoutMs } : {};
  const baseReport = await verifySpec(router, baseResult.spec, verifyOptions);
  const headReport = await verifySpec(router, headResult.spec, verifyOptions);
  const diff = await diffBehavior(
    baseResult.spec,
    headResult.spec,
    input.solver,
  );

  const baseByKey = new Map<string, VerificationResult>(
    baseReport.results.map((item) => [key(item.property), item]),
  );
  const findings: Finding[] = [];
  const humanBacked = (result: VerificationResult) =>
    result.rule?.humanBacked === true;
  for (const result of headReport.results) {
    const before = baseByKey.get(key(result.property));
    const label = propertyLabel(result.property);
    const common = {
      property: result.property,
      ...(result.rule ? { rule: result.rule } : {}),
    };
    if (result.status === "VIOLATED") {
      const kind: FindingKind = !before
        ? "new_violation"
        : before.status === "VIOLATED"
          ? "preexisting_violation"
          : "regression";
      findings.push({
        kind,
        severity:
          kind === "preexisting_violation"
            ? "info"
            : humanBacked(result)
              ? "fail"
              : "review",
        message:
          kind === "preexisting_violation"
            ? `${label}: already violated at the base.`
            : kind === "new_violation"
              ? `${label}: violated by new behavior.`
              : `${label}: held at the base, violated at the head.`,
        ...common,
        ...(result.counterexample
          ? { counterexample: result.counterexample }
          : {}),
        caveats: result.caveats,
      });
    } else if (before?.status === "VIOLATED" && result.status === "VERIFIED") {
      findings.push({
        kind: "fixed",
        severity: "info",
        message: `${label}: violated at the base, holds at the head.`,
        ...common,
      });
    } else if (
      (result.status === "UNKNOWN" || result.status === "UNSUPPORTED") &&
      before?.status === "VERIFIED"
    ) {
      findings.push({
        kind: "coverage_lost",
        severity: "review",
        message: `${label}: verified at the base, ${result.status} at the head${result.reason ? ` (${result.reason})` : ""}.`,
        ...common,
      });
    }
  }
  for (const change of diff.operations)
    if (change.limitationsAdded.length > 0)
      findings.push({
        kind: "limitation_added",
        severity: "review",
        message: `${change.operation}: ${change.limitationsAdded.length} construct(s) the extractor cannot model were added (${change.limitationsAdded.slice(0, 2).join("; ")}), so its rules are checked against weaker preconditions.`,
      });
  const removed = [
    ...diff.invariants.removed.map((item) => `invariant ${item}`),
    ...diff.businessRules.removed.map((item) => `business rule ${item}`),
    ...diff.permissions.removed.map((item) => `permission ${item}`),
  ];
  for (const item of removed)
    findings.push({
      kind: "rule_removed",
      severity: "review",
      message: `The change removes ${item}.`,
    });
  const approvedText = (files: readonly SourceFile[]) =>
    files
      .map((file) => `${file.path}\n${file.content}`)
      .sort()
      .join("\n--\n");
  if (approvedText(baseApproved) !== approvedText(headApproved))
    findings.push({
      kind: "approved_rules_changed",
      severity: "review",
      message:
        "The change edits the approved rules. They were checked as they are at the base; a person has to approve the new rules before they apply.",
    });

  const order: Record<Finding["severity"], number> = {
    fail: 0,
    review: 1,
    info: 2,
  };
  findings.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      (a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
  );
  const failing = findings.some((item) => item.severity === "fail");
  const reviewing = findings.some((item) => item.severity === "review");
  const strict = input.strict === true;
  const verdict: Verdict =
    failing || (strict && reviewing) ? "fail" : reviewing ? "review" : "pass";
  const side = (
    ref: string | undefined,
    commit: string | null | undefined,
    report: VerificationReport,
    unsupported: number,
  ): Side => ({
    ref: ref ?? null,
    commit: commit ?? null,
    specHash: report.specHash,
    summary: report.summary,
    unsupportedConstructs: unsupported,
  });
  return {
    schemaVersion: 1,
    verdict,
    strict,
    base: side(
      input.baseRef,
      input.baseCommit,
      baseReport,
      baseResult.unsupported.length,
    ),
    head: side(
      input.headRef,
      input.headCommit,
      headReport,
      headResult.unsupported.length,
    ),
    diff,
    findings,
    caveats: [
      ...PR_GUARD_CAVEATS,
      ...headResult.conflicts.map((item) => `Extraction: ${item}`),
    ],
  };
}
