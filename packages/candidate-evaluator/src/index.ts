import { discoverCapabilities } from "@pathcompiler/capability-engine";
import type { CommitAnalysis, GraphDelta } from "@pathcompiler/graph-delta";
import { analyzeWorkflowImpact } from "@pathcompiler/impact-analysis";
import {
  createProductReasoner,
  type FormalStateSnapshot,
  type ProductProperty,
  ProductPropertySchema,
  type PropertyResult,
  propertiesFromInvariants,
  ReasoningQueryError,
  type ReasoningTrace,
} from "@pathcompiler/reasoner-core";
import {
  analyzeSemanticChange,
  buildCommitModel,
  type SemanticChangeReport,
} from "@pathcompiler/semantic-change";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { compareText } from "@pathcompiler/source-model";
import { z } from "zod";

const contextSchema = z.record(
  z.string(),
  z.union([z.boolean(), z.number(), z.string()]),
);
export const ExpectedChangeSchema = z.strictObject({
  goal: z.string().min(1),
  change: z.enum(["reachability-added", "reachability-removed"]),
  /** Partial context; matches observed changes that have these values. */
  context: contextSchema.optional(),
});
export type ExpectedChange = z.infer<typeof ExpectedChangeSchema>;
/**
 * Criteria frozen before a change is made (harness handoff §19). All fields
 * are optional: a human PR is evaluated with none of them.
 */
export const EvaluationCriteriaSchema = z.strictObject({
  /**
   * The intended semantic outcome. Omitted: no declared intent, so changes are
   * reported for review. `[]`: no reachability change is intended.
   */
  expectedChanges: z.array(ExpectedChangeSchema).optional(),
  protectedProperties: z.array(ProductPropertySchema).optional(),
  recommendationId: z.string().min(1).optional(),
  /** What the mutation's author claims; recorded, never trusted. */
  mutation: z
    .strictObject({
      id: z.string().min(1),
      claimedOutcome: z.enum(["success", "partial", "failed"]).optional(),
      summary: z.string().optional(),
    })
    .optional(),
});
export type EvaluationCriteria = z.infer<typeof EvaluationCriteriaSchema>;
export const TestRunSchema = z.strictObject({
  tests: z.array(
    z.strictObject({
      /** Full test title, describe blocks joined with " › " as in mined traces. */
      name: z.string().min(1),
      status: z.enum(["passed", "failed", "skipped"]),
    }),
  ),
});
export type TestRun = z.infer<typeof TestRunSchema>;

type PlaywrightSuite = {
  title?: string;
  specs?: { title: string; tests?: { status?: string }[] }[];
  suites?: PlaywrightSuite[];
};
/** Flattens a Playwright JSON reporter file (file suites, describe suites, specs). */
export function testRunFromPlaywrightJson(input: unknown): TestRun {
  const report = z.object({ suites: z.array(z.unknown()) }).parse(input) as {
    suites: PlaywrightSuite[];
  };
  const tests: TestRun["tests"] = [];
  const walk = (suite: PlaywrightSuite, titles: string[]) => {
    for (const spec of suite.specs ?? []) {
      const statuses = (spec.tests ?? []).map((item) => item.status);
      tests.push({
        name: [...titles, spec.title].join(" › "),
        status: statuses.some((item) => item === "unexpected")
          ? "failed"
          : statuses.length > 0 && statuses.every((item) => item === "skipped")
            ? "skipped"
            : "passed",
      });
    }
    for (const child of suite.suites ?? [])
      walk(child, [...titles, child.title ?? ""]);
  };
  // Top-level suites are files; their titles are not part of test names.
  for (const suite of report.suites) walk(suite, []);
  return { tests };
}

type Status = PropertyResult["status"] | "absent";
export type EvaluationFinding = { code: string; message: string };
export type ObservedChange = {
  goal: string;
  capabilityId?: string;
  change: ExpectedChange["change"];
  context: FormalStateSnapshot;
  expected: boolean;
};
export type CandidateEvaluation = {
  schemaVersion: 1;
  type: "candidate_evaluation";
  id: string;
  base: string;
  candidate: string;
  recommendationId?: string;
  mutationId?: string;
  status: "pass" | "pass_with_warnings" | "fail" | "inconclusive";
  /** A. Did the intended product effect occur, and nothing else? */
  intendedChange: {
    declared: boolean;
    expected: (ExpectedChange & { met: boolean })[];
    observed: ObservedChange[];
  };
  /** B. Do protected behaviors and model invariants still hold? */
  formalResults: {
    checked: number;
    holds: number;
    violated: number;
    unknown: number;
    results: {
      id: string;
      kind: ProductProperty["kind"];
      protected: boolean;
      base: Status;
      candidate: Status;
      counterexample?: ReasoningTrace;
    }[];
  };
  /** C. Which approved workflows changed (deterministic rules plus reasoning). */
  workflowRegression: {
    reviewRequired: {
      workflowId: string;
      severity: string;
      reasons: string[];
    }[];
  };
  /** D. Business-level tests: coverage per capability and ingested results. */
  testResults: {
    executed: boolean;
    passed: number;
    failed: number;
    skipped: number;
    failedTests: { name: string; capabilities: string[] }[];
    coverage: { capabilityId: string; base: number; candidate: number }[];
    coverageDecreased: string[];
    uncoveredAffected: string[];
  };
  mutationClaim?: { claimedOutcome?: string; contradicted: boolean };
  risks: EvaluationFinding[];
  warnings: EvaluationFinding[];
  /** Evidence this evaluation could not use (e.g. browser verification, I4). */
  evidenceGaps: string[];
  eligibleForExperiment: boolean;
  recommendedNextStep:
    | "human_review"
    | "experiment"
    | "revise_candidate"
    | "reject";
  semanticChange: SemanticChangeReport;
};

const capabilityOf = (workflowId: string) => workflowId.split("--")[0] ?? "";
const matches = (expected: ExpectedChange, observed: ObservedChange) =>
  expected.goal === observed.goal &&
  expected.change === observed.change &&
  Object.entries(expected.context ?? {}).every(
    ([name, value]) => observed.context[name] === value,
  );

/**
 * Independently evaluates a candidate commit against its base (mode 5,
 * harness handoff §17–§18). Nothing the candidate's author claims changes the
 * outcome; claims are only checked against it.
 */
export async function evaluateCandidate(
  range: { delta: GraphDelta; base: CommitAnalysis; head: CommitAnalysis },
  solver: SolverProvider,
  input: {
    criteria?: unknown;
    approved?: readonly unknown[];
    tests?: unknown;
  } = {},
): Promise<CandidateEvaluation> {
  const criteria = EvaluationCriteriaSchema.parse(input.criteria ?? {});
  const tests =
    input.tests === undefined ? undefined : TestRunSchema.parse(input.tests);
  const models = {
    base: buildCommitModel(range.base),
    head: buildCommitModel(range.head),
  };
  const semantic = await analyzeSemanticChange(range, solver, { models });
  const risks: EvaluationFinding[] = [];
  const warnings: EvaluationFinding[] = [];
  let inconclusive = semantic.uncertainty.some(
    (item) => item.kind === "unknown-result",
  );

  // A. Intended change.
  const declared = criteria.expectedChanges !== undefined;
  const observed: ObservedChange[] = [
    ...semantic.newReachability.map((item) => ({
      item,
      change: "reachability-added" as const,
    })),
    ...semantic.removedReachability.map((item) => ({
      item,
      change: "reachability-removed" as const,
    })),
  ].map(({ item, change }) => {
    const entry = {
      goal: item.goal,
      ...(item.capabilityId ? { capabilityId: item.capabilityId } : {}),
      change,
      context: item.context,
      expected: false,
    };
    entry.expected = (criteria.expectedChanges ?? []).some((expected) =>
      matches(expected, entry),
    );
    return entry;
  });
  const expected = (criteria.expectedChanges ?? []).map((item) => ({
    ...item,
    met: observed.some((change) => matches(item, change)),
  }));
  const describe = (change: ObservedChange) =>
    `${change.goal} ${change.change === "reachability-added" ? "became reachable" : "became unreachable"} for ${
      Object.entries(change.context)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(", ") || "any context"
    }`;
  if (declared) {
    for (const change of observed)
      if (!change.expected)
        risks.push({
          code: `unexpected-${change.change}`,
          message: `Unexpected: ${describe(change)}.`,
        });
    for (const item of expected)
      if (!item.met)
        risks.push({
          code: "expected-change-missing",
          message: `Expected ${item.goal} to ${item.change === "reachability-added" ? "become reachable" : "become unreachable"}${
            item.context
              ? ` for ${Object.entries(item.context)
                  .map(([name, value]) => `${name}=${String(value)}`)
                  .join(", ")}`
              : ""
          }, but it did not.`,
        });
  } else if (observed.length > 0)
    warnings.push({
      code: "semantic-change-review",
      message: `${observed.length} reachability changes with no declared intent; review them: ${observed.slice(0, 3).map(describe).join("; ")}${observed.length > 3 ? "; …" : ""}.`,
    });

  // B. Protected properties and invariants, on both commits.
  const reasoner = createProductReasoner(solver);
  const protectedIds = new Set(
    (criteria.protectedProperties ?? []).map((item) => item.id),
  );
  const properties = new Map<string, ProductProperty>();
  for (const property of [
    ...propertiesFromInvariants(models.base.model),
    ...propertiesFromInvariants(models.head.model),
    ...(criteria.protectedProperties ?? []),
  ])
    properties.set(property.id, property);
  const verify = async (
    model: typeof models.base.model,
    property: ProductProperty,
  ): Promise<PropertyResult | undefined> => {
    try {
      return await reasoner.verifyProperty(model, property);
    } catch (error) {
      // The property refers to something this commit does not have.
      if (error instanceof ReasoningQueryError) return undefined;
      throw error;
    }
  };
  const results: CandidateEvaluation["formalResults"]["results"] = [];
  for (const property of [...properties.values()].sort((a, b) =>
    compareText(a.id, b.id),
  )) {
    const before = await verify(models.base.model, property);
    const after = await verify(models.head.model, property);
    const isProtected = protectedIds.has(property.id);
    results.push({
      id: property.id,
      kind: property.kind,
      protected: isProtected,
      base: before?.status ?? "absent",
      candidate: after?.status ?? "absent",
      ...(after?.status === "violated"
        ? { counterexample: after.counterexample }
        : {}),
    });
    if (after?.status === "unknown") inconclusive = true;
    if (after?.status === "violated") {
      const steps = after.counterexample.actions
        .map((step) => step.actionId)
        .join(" → ");
      if (isProtected)
        risks.push({
          code: "protected-property-violated",
          message: `Protected property ${property.id} is violated${before?.status === "violated" ? " (already at base)" : ""}: ${steps}.`,
        });
      else if (before?.status !== "violated")
        risks.push({
          code: "property-regression",
          message: `${property.id} held at base and is violated by the candidate: ${steps}.`,
        });
      else
        warnings.push({
          code: "preexisting-violation",
          message: `${property.id} was already violated at base.`,
        });
    }
    if (!after && isProtected)
      risks.push({
        code: "protected-property-unverifiable",
        message: `Protected property ${property.id} no longer fits the candidate model (its goal, invariant or actions are gone).`,
      });
    else if (!after && before)
      warnings.push({
        code: "invariant-removed",
        message: `${property.id} is not checkable on the candidate model.`,
      });
  }

  // C. Workflow regressions.
  const impact = analyzeWorkflowImpact(range.delta, input.approved ?? [], {
    semantic: semantic.affectedWorkflows,
  });
  const reviewRequired = impact.impacts
    .filter((item) => item.severity === "medium" || item.severity === "high")
    .map((item) => ({
      workflowId: item.workflowId,
      severity: item.severity,
      reasons: item.reasons.map((reason) => reason.message),
    }));
  for (const item of reviewRequired) {
    const explained =
      declared &&
      observed.length > 0 &&
      observed
        .filter(
          (change) => change.capabilityId === capabilityOf(item.workflowId),
        )
        .every((change) => change.expected);
    if (!explained)
      warnings.push({
        code: "workflow-review",
        message: `Approved workflow ${item.workflowId} needs review (${item.severity}).`,
      });
  }

  // D. Business-level tests.
  const testCounts = (analysis: CommitAnalysis) =>
    new Map(
      discoverCapabilities(analysis.mined.graph).report.capabilities.map(
        (capability) => [
          capability.id,
          capability.evidenceNodeIds.filter((id) => id.startsWith("test:")),
        ],
      ),
    );
  const baseTests = testCounts(range.base);
  const headTests = testCounts(range.head);
  const affected = new Set([
    ...semantic.affectedWorkflows.map((item) => item.capabilityId),
    ...reviewRequired.map((item) => capabilityOf(item.workflowId)),
  ]);
  const coverage = [...new Set([...baseTests.keys(), ...headTests.keys()])]
    .sort(compareText)
    .map((capabilityId) => ({
      capabilityId,
      base: baseTests.get(capabilityId)?.length ?? 0,
      candidate: headTests.get(capabilityId)?.length ?? 0,
    }));
  const coverageDecreased = coverage
    .filter((item) => item.candidate < item.base)
    .map((item) => item.capabilityId);
  const uncoveredAffected = [...affected]
    .filter((id) => (headTests.get(id)?.length ?? 0) === 0)
    .sort(compareText);
  for (const id of coverageDecreased)
    warnings.push({
      code: "coverage-decreased",
      message: `Fewer tests cover ${id} in the candidate.`,
    });
  for (const id of uncoveredAffected)
    warnings.push({
      code: "affected-capability-untested",
      message: `${id} changed but no test covers it in the candidate.`,
    });
  const traceIds = new Map(
    range.head.mined.report.traces.map((trace) => [trace.testName, trace.id]),
  );
  const failedTests = (tests?.tests ?? [])
    .filter((item) => item.status === "failed")
    .map((item) => {
      const id = traceIds.get(item.name);
      return {
        name: item.name,
        capabilities: id
          ? [...headTests]
              .filter(([, ids]) => ids.includes(id))
              .map(([capabilityId]) => capabilityId)
              .sort(compareText)
          : [],
      };
    });
  for (const test of failedTests)
    risks.push({
      code: "test-failed",
      message: `Test failed: ${test.name}${test.capabilities.length ? ` (covers ${test.capabilities.join(", ")})` : ""}.`,
    });
  const count = (status: TestRun["tests"][number]["status"]) =>
    (tests?.tests ?? []).filter((item) => item.status === status).length;

  const status: CandidateEvaluation["status"] = risks.length
    ? "fail"
    : inconclusive
      ? "inconclusive"
      : warnings.length
        ? "pass_with_warnings"
        : "pass";
  const contradicted =
    criteria.mutation?.claimedOutcome === "success" && status === "fail";
  if (contradicted)
    warnings.push({
      code: "mutation-claim-contradicted",
      message: `Mutation ${criteria.mutation?.id} claims success, but the independent evaluation failed.`,
    });
  const eligibleForExperiment =
    status === "pass" && declared && expected.length > 0;
  return {
    schemaVersion: 1,
    type: "candidate_evaluation",
    id: `eval:${range.delta.base.commit.slice(0, 12)}..${range.delta.head.commit.slice(0, 12)}`,
    base: range.delta.base.commit,
    candidate: range.delta.head.commit,
    ...(criteria.recommendationId
      ? { recommendationId: criteria.recommendationId }
      : {}),
    ...(criteria.mutation ? { mutationId: criteria.mutation.id } : {}),
    status,
    intendedChange: { declared, expected, observed },
    formalResults: {
      checked: results.length,
      holds: results.filter((item) => item.candidate === "holds").length,
      violated: results.filter((item) => item.candidate === "violated").length,
      unknown: results.filter((item) => item.candidate === "unknown").length,
      results,
    },
    workflowRegression: { reviewRequired },
    testResults: {
      executed: tests !== undefined,
      passed: count("passed"),
      failed: count("failed"),
      skipped: count("skipped"),
      failedTests,
      coverage,
      coverageDecreased,
      uncoveredAffected,
    },
    ...(criteria.mutation
      ? {
          mutationClaim: {
            ...(criteria.mutation.claimedOutcome
              ? { claimedOutcome: criteria.mutation.claimedOutcome }
              : {}),
            contradicted,
          },
        }
      : {}),
    risks,
    warnings,
    evidenceGaps: [
      "Browser verification was not run (phase I4).",
      ...(tests ? [] : ["No test results were supplied; coverage is static."]),
    ],
    eligibleForExperiment,
    recommendedNextStep:
      status === "fail"
        ? risks.some((item) => item.code.startsWith("protected-property"))
          ? "reject"
          : "revise_candidate"
        : eligibleForExperiment
          ? "experiment"
          : "human_review",
    semanticChange: semantic,
  };
}
