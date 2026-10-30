import {
  type ExtractionOptions,
  extractBehavior,
  type SourceFile,
} from "@pathcompiler/behavior-extraction";
import {
  contractExecutor,
  createRecord,
  generateEval,
  type RegressionEval,
  runEval,
} from "@pathcompiler/counterexamples";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import {
  createSmtVerifier,
  createVerificationRouter,
  propertyLabel,
  type RuleBasis,
  type VerificationProperty,
  type VerificationReport,
  type VerificationResult,
  verifySpec,
} from "@pathcompiler/verification";
import { unifiedDiff } from "./diff.js";
import {
  type AttemptSummary,
  RepairProposalSchema,
  type RepairProvider,
  type RepairRequest,
} from "./provider.js";

/**
 * A conservative repair loop (prototype). One violation at a time:
 *
 *   violation → counterexample → structured feedback → candidate repair from
 *   a provider → verification → regression eval → tests → report.
 *
 * What makes it conservative:
 *  - the provider sees the violated rule, the counterexample and the source
 *    file of the operation, never the repository;
 *  - it may change only that operation's source files (not the approved rules,
 *    the schema, the contracts or the tests);
 *  - a candidate is accepted only if the target property now holds, no other
 *    property became violated, the regression eval built from the
 *    counterexample passes, and the caller's tests (if given) pass;
 *  - every attempt starts again from the original files, so a failed attempt
 *    cannot compound;
 *  - the iterations are bounded, every step is logged, and nothing is written,
 *    merged or deployed: the result is a patch for a person to review.
 */
export type TestOutcome = { passed: boolean; detail: string };
export type RepairInput = {
  /** The repository's files as the extractors read them, including approved rules. */
  files: readonly SourceFile[];
  options?: ExtractionOptions;
  provider: RepairProvider;
  solver: SolverProvider;
  /** Default 3, at most 10. */
  maxIterations?: number;
  /** Optional: runs the project's tests on a candidate's files. */
  runTests?: (files: readonly SourceFile[]) => Promise<TestOutcome>;
  /** Injected so reports are reproducible. */
  now: string;
};

export type Check = { name: string; passed: boolean; detail: string };
export type Attempt = {
  iteration: number;
  rationale: string;
  edited: string[];
  checks: Check[];
  outcome: "repaired" | "rejected";
};
export type TraceEntry = { iteration: number; step: string; detail: string };
export type RepairStatus = "already_verified" | "repaired" | "not_repaired";
export type RepairReport = {
  schemaVersion: 1;
  status: RepairStatus;
  provider: string;
  /** Why nothing was attempted or repaired, when that is the case. */
  reason?: string;
  target?: {
    property: VerificationProperty;
    rule: RuleBasis;
    counterexample: string;
    eval: string;
  };
  attempts: Attempt[];
  patch?: { path: string; before: string; after: string; diff: string }[];
  before: VerificationReport["summary"];
  after?: VerificationReport["summary"];
  /** Violations other than the target; this loop repairs one at a time. */
  otherViolations: number;
  trace: TraceEntry[];
  approval: { required: true; status: "pending"; note: string };
  caveats: string[];
};

const key = (property: VerificationProperty) => JSON.stringify(property);
const MAX_ITERATIONS = 10;

export async function runRepairLoop(input: RepairInput): Promise<RepairReport> {
  const maxIterations = Math.min(
    Math.max(1, input.maxIterations ?? 3),
    MAX_ITERATIONS,
  );
  const trace: TraceEntry[] = [];
  const log = (iteration: number, step: string, detail: string) =>
    trace.push({ iteration, step, detail });
  const router = createVerificationRouter([createSmtVerifier(input.solver)]);
  const extract = (files: readonly SourceFile[]) =>
    extractBehavior(files, { ...input.options, id: "behavior" });
  const approval = {
    required: true as const,
    status: "pending" as const,
    note: "Nothing was written, merged or deployed. A person has to review and apply the patch.",
  };
  const caveats = [
    "The repair is checked against the encoded specification, the regression eval and the tests supplied; it is not proven correct for the business.",
    "Only the target violation is repaired; others, if any, remain and need their own pass.",
  ];

  const original = extract(input.files);
  const baseline = await verifySpec(router, original.spec);
  log(
    0,
    "verify",
    `${baseline.summary.VIOLATED} violated, ${baseline.summary.VERIFIED} verified`,
  );
  const violated = baseline.results
    .filter(
      (item) => item.status === "VIOLATED" && item.counterexample && item.rule,
    )
    .sort(
      (a, b) =>
        Number(b.rule?.humanBacked) - Number(a.rule?.humanBacked) ||
        (propertyLabel(a.property) < propertyLabel(b.property) ? -1 : 1),
    );
  const base = {
    schemaVersion: 1 as const,
    provider: input.provider.id,
    attempts: [] as Attempt[],
    before: baseline.summary,
    otherViolations: Math.max(0, violated.length - 1),
    trace,
    approval,
    caveats,
  };
  const target = violated[0];
  if (!target?.counterexample || !target.rule) {
    log(0, "stop", "nothing is violated");
    return { ...base, status: "already_verified", otherViolations: 0 };
  }

  // The counterexample becomes the regression eval every candidate must pass.
  const record = createRecord({
    rule: target.rule,
    counterexample: target.counterexample,
    trigger: "verification",
    specHash: baseline.specHash,
    now: input.now,
  });
  let evaluation: RegressionEval;
  try {
    evaluation = generateEval(record, original.spec);
  } catch (error) {
    return {
      ...base,
      status: "not_repaired",
      reason: `No regression eval could be built: ${(error as Error).message}`,
    };
  }
  log(
    0,
    "target",
    `${propertyLabel(target.property)} (${record.id}); eval ${evaluation.id} has ${evaluation.cases.length} cases`,
  );
  const info = {
    target: {
      property: target.property,
      rule: target.rule,
      counterexample: record.id,
      eval: evaluation.id,
    },
  };

  // The provider may change only the source files the operation was read from.
  const operation = original.spec.operations.find(
    (item) => item.id === target.property.operation,
  );
  const editable = [
    ...new Set(
      (operation?.provenance ?? [])
        .filter((item) => item.sourceType === "SOURCE_CODE" && item.sourceFile)
        .map((item) => item.sourceFile as string),
    ),
  ].sort();
  if (editable.length === 0)
    return {
      ...base,
      ...info,
      status: "not_repaired",
      reason: `${target.property.operation} was not read from source code, so there is no file to change.`,
    };

  const mustKeep = baseline.results
    .filter((item) => item.status === "VERIFIED")
    .map((item) => propertyLabel(item.property));
  const previous: AttemptSummary[] = [];
  const attempts: Attempt[] = [];
  const explanation = `${target.counterexample.operation} can be run with ${JSON.stringify({ ...target.counterexample.inputs, ...target.counterexample.context })} on ${JSON.stringify(target.counterexample.state)}, which violates ${target.rule.text}.`;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const request: RepairRequest = {
      iteration,
      maxIterations,
      violation: {
        property: target.property,
        rule: target.rule,
        counterexample: target.counterexample,
        explanation,
        caveats: target.caveats,
      },
      files: input.files.filter((file) => editable.includes(file.path)),
      mustKeep,
      constraints: [
        `Change only ${editable.join(", ")}.`,
        "Do not edit tests, the approved rules, the schema or the API contract.",
        "Do not remove checks that other rules depend on, and do not reject valid actions to make the violation go away.",
      ],
      previousAttempts: [...previous],
    };
    log(
      iteration,
      "request",
      `asked ${input.provider.id} about ${editable.join(", ")}`,
    );
    const reject = (rationale: string, edited: string[], checks: Check[]) => {
      const reasons = checks
        .filter((item) => !item.passed)
        .map((item) => `${item.name}: ${item.detail}`);
      attempts.push({
        iteration,
        rationale,
        edited,
        checks,
        outcome: "rejected",
      });
      previous.push({ iteration, rationale, rejectedBecause: reasons });
      log(iteration, "rejected", reasons.join("; "));
    };

    let proposal: ReturnType<typeof RepairProposalSchema.parse>;
    try {
      proposal = RepairProposalSchema.parse(
        await input.provider.proposeRepair(request),
      );
    } catch (error) {
      reject(
        "(no usable proposal)",
        [],
        [
          {
            name: "proposal",
            passed: false,
            detail:
              error instanceof Error
                ? error.message.slice(0, 300)
                : "invalid response",
          },
        ],
      );
      continue;
    }
    const edited = proposal.edits.map((item) => item.path);
    const outside = edited.filter((path) => !editable.includes(path));
    const unchanged = proposal.edits.filter(
      (edit) =>
        input.files.find((file) => file.path === edit.path)?.content ===
        edit.content,
    );
    if (outside.length > 0 || unchanged.length === proposal.edits.length) {
      reject(proposal.rationale, edited, [
        {
          name: "allowed edits",
          passed: false,
          detail:
            outside.length > 0
              ? `${outside.join(", ")} may not be changed (allowed: ${editable.join(", ")})`
              : "the proposal does not change anything",
        },
      ]);
      continue;
    }
    const candidateFiles = input.files.map((file) => {
      const edit = proposal.edits.find((item) => item.path === file.path);
      return edit ? { ...file, content: edit.content } : file;
    });

    let candidate: ReturnType<typeof extract>;
    let after: VerificationReport;
    try {
      candidate = extract(candidateFiles);
      after = await verifySpec(router, candidate.spec);
    } catch (error) {
      reject(proposal.rationale, edited, [
        {
          name: "analysis",
          passed: false,
          detail: `the patched files could not be analyzed: ${(error as Error).message.slice(0, 300)}`,
        },
      ]);
      continue;
    }
    const checks: Check[] = [];
    const now = new Map<string, VerificationResult>(
      after.results.map((item) => [key(item.property), item]),
    );
    const targetNow = now.get(key(target.property));
    checks.push({
      name: "target property",
      passed: targetNow?.status === "VERIFIED",
      detail: targetNow
        ? `${propertyLabel(target.property)} is ${targetNow.status} after the change`
        : "the property no longer exists",
    });
    const wasViolated = new Set(
      baseline.results
        .filter((item) => item.status === "VIOLATED")
        .map((item) => key(item.property)),
    );
    const introduced = after.results.filter(
      (item) =>
        item.status === "VIOLATED" && !wasViolated.has(key(item.property)),
    );
    checks.push({
      name: "no new violations",
      passed: introduced.length === 0,
      detail:
        introduced.length === 0
          ? "no other property became violated"
          : `now violated: ${introduced.map((item) => propertyLabel(item.property)).join("; ")}`,
    });
    const run = await runEval(evaluation, contractExecutor(candidate.spec));
    checks.push({
      name: "regression eval",
      passed: run.passed,
      detail: run.passed
        ? `${run.cases.length} cases as expected${run.overRestrictive.length > 0 ? `; over-restrictive on ${run.overRestrictive.join(", ")}` : ""}`
        : `failed ${run.failed.join(", ")}`,
    });
    if (input.runTests) {
      const outcome = await input.runTests(candidateFiles);
      checks.push({
        name: "tests",
        passed: outcome.passed,
        detail: outcome.detail,
      });
    }
    log(
      iteration,
      "checked",
      checks
        .map((item) => `${item.name} ${item.passed ? "ok" : "FAILED"}`)
        .join(", "),
    );

    if (checks.every((item) => item.passed)) {
      attempts.push({
        iteration,
        rationale: proposal.rationale,
        edited,
        checks,
        outcome: "repaired",
      });
      log(iteration, "accepted", "all checks passed; patch ready for review");
      return {
        ...base,
        ...info,
        attempts,
        status: "repaired",
        after: after.summary,
        patch: proposal.edits.map((edit) => {
          const before =
            input.files.find((file) => file.path === edit.path)?.content ?? "";
          return {
            path: edit.path,
            before,
            after: edit.content,
            diff: unifiedDiff(edit.path, before, edit.content),
          };
        }),
      };
    }
    reject(proposal.rationale, edited, checks);
  }
  log(
    maxIterations,
    "stop",
    `no repair passed within ${maxIterations} attempt(s)`,
  );
  return {
    ...base,
    ...info,
    attempts,
    status: "not_repaired",
    reason: `No candidate passed every check within ${maxIterations} attempt(s).`,
  };
}
