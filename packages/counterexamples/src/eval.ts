import {
  type ActionRequest,
  createActionGate,
  type Valuation,
} from "@pathcompiler/agent-gate";
import type { BehaviorSpec, Expr, Literal } from "@pathcompiler/behavior-ir";
import type {
  VerificationProperty,
  VerificationResult,
  VerificationRouter,
} from "@pathcompiler/verification";
import type { CounterexampleRecord } from "./record.js";

/**
 * A regression eval made from a counterexample. Its cases are concrete
 * actions with an expected outcome, so it can be run against *any*
 * implementation of the operation — real code behind an adapter, or the
 * contract extracted from a candidate — without a model or a human:
 *  - the counterexample itself must be rejected (`reproduction`);
 *  - nearby actions that break the same rule must be rejected (`reject-*`),
 *    so a fix that only handles the exact values does not pass;
 *  - nearby actions that break nothing must still be accepted (`accept-*`),
 *    so a fix that rejects everything does not pass either.
 * The specification labels the cases; it is the oracle, and it is only as
 * right as its rules.
 */
export type EvalCase = {
  id: string;
  kind: "reproduction" | "variant" | "neighbor";
  expect: "rejected" | "accepted";
  request: ActionRequest;
  /** What was changed from the counterexample. */
  change: string;
};
export type RegressionEval = {
  schemaVersion: 1;
  id: string;
  counterexample: string;
  rule: CounterexampleRecord["rule"];
  operation: string;
  /** The same question asked of a specification, for the SMT verifier. */
  property: VerificationProperty;
  description: string;
  cases: EvalCase[];
};

export type GenerateOptions = {
  /** At most this many rejected variants / accepted neighbors besides the reproduction. */
  maxVariants?: number;
  maxNeighbors?: number;
};

const propertyOf = (record: CounterexampleRecord): VerificationProperty => {
  switch (record.rule.kind) {
    case "invariant":
      return {
        kind: "invariant_preserved",
        operation: record.operation,
        invariant: record.rule.id,
      };
    case "permission":
      return {
        kind: "permission_enforced",
        operation: record.operation,
        permission: record.rule.id,
      };
    default:
      return {
        kind: "rule_enforced",
        operation: record.operation,
        rule: record.rule.id,
      };
  }
};

const literalsOf = (spec: BehaviorSpec, ruleId: string): number[] => {
  const exprs: Expr[] = [];
  for (const item of spec.businessRules)
    if (item.id === ruleId) exprs.push(item.when, item.must);
  for (const item of spec.dataPolicies)
    if (item.id === ruleId) exprs.push(item.rule);
  for (const item of spec.invariants)
    if (item.id === ruleId) exprs.push(item.expression);
  for (const item of spec.permissions)
    if (item.id === ruleId && item.constraint) exprs.push(item.constraint);
  const found = new Set<number>();
  const walk = (expr: Expr) => {
    if (expr.op === "lit" && typeof expr.value === "number")
      found.add(expr.value);
    else if (expr.op === "not") walk(expr.arg);
    else if ("args" in expr) for (const arg of expr.args) walk(arg);
    else if ("left" in expr) {
      walk(expr.left);
      walk(expr.right);
    }
  };
  for (const expr of exprs) walk(expr);
  return [...found].sort((a, b) => a - b);
};

const key = (request: ActionRequest) =>
  JSON.stringify([request.inputs, request.context, request.state]);
const violates = (
  decision: ReturnType<ReturnType<typeof createActionGate>["check"]>,
  record: CounterexampleRecord,
) =>
  decision.violations.some(
    (item) =>
      item.id === record.rule.id ||
      (item.id === undefined && item.rule === record.rule.text),
  );

/**
 * Builds the eval for a counterexample, labeling nearby actions with the
 * specification. Throws if the counterexample does not break the rule in
 * `spec` (it was already fixed there, or the spec is the wrong one).
 */
export function generateEval(
  record: CounterexampleRecord,
  spec: BehaviorSpec,
  options: GenerateOptions = {},
): RegressionEval {
  const gate = createActionGate(spec);
  const reproduction: ActionRequest = {
    operation: record.operation,
    inputs: record.action.inputs,
    context: record.action.context,
    state: record.state,
  };
  if (!violates(gate.check(reproduction), record))
    throw new Error(
      `The counterexample ${record.id} does not violate ${record.rule.id} in this specification, so there is nothing to test. Use the specification the rule is approved in.`,
    );

  const variables = new Map(spec.variables.map((item) => [item.id, item]));
  const literals = literalsOf(spec, record.rule.id);
  type Candidate = { variable: string; value: Literal; request: ActionRequest };
  const candidates: Candidate[] = [];
  const vary = (
    scope: "inputs" | "context",
    values: Valuation,
    variable: string,
    value: Literal,
  ) => {
    if (values[variable] === value) return;
    candidates.push({
      variable,
      value,
      request: { ...reproduction, [scope]: { ...values, [variable]: value } },
    });
  };
  for (const scope of ["inputs", "context"] as const) {
    const values = reproduction[scope] ?? {};
    for (const [id, current] of Object.entries(values)) {
      const variable = variables.get(id);
      if (!variable) continue;
      if (variable.type === "boolean") vary(scope, values, id, !current);
      else if (variable.type === "enum")
        for (const option of variable.values) vary(scope, values, id, option);
      else if (variable.type === "integer" && typeof current === "number") {
        const options = new Set<number>([0, 1, current + 1, current * 2]);
        if (current > 1) options.add(current - 1);
        for (const literal of literals)
          for (const near of [literal - 1, literal, literal + 1])
            options.add(near);
        for (const option of options) vary(scope, values, id, option);
      }
    }
  }

  const seen = new Set([key(reproduction)]);
  const rejected: Candidate[] = [];
  const accepted: Candidate[] = [];
  for (const candidate of candidates.sort(
    (a, b) =>
      (a.variable < b.variable ? -1 : a.variable > b.variable ? 1 : 0) ||
      JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)),
  )) {
    const id = key(candidate.request);
    if (seen.has(id)) continue;
    seen.add(id);
    const decision = gate.check(candidate.request);
    if (decision.decision === "PASS") accepted.push(candidate);
    else if (violates(decision, record)) rejected.push(candidate);
  }
  /** Round-robin over the changed variable so the sample is diverse. */
  const pick = (items: Candidate[], limit: number): Candidate[] => {
    const groups = new Map<string, Candidate[]>();
    for (const item of items) {
      const group = groups.get(item.variable) ?? [];
      group.push(item);
      groups.set(item.variable, group);
    }
    const chosen: Candidate[] = [];
    for (let round = 0; chosen.length < limit; round += 1) {
      let any = false;
      for (const group of groups.values()) {
        const item = group[round];
        if (item) {
          any = true;
          if (chosen.length < limit) chosen.push(item);
        }
      }
      if (!any) break;
    }
    return chosen;
  };
  const change = (item: Candidate) =>
    `${item.variable} = ${JSON.stringify(item.value)}`;
  const cases: EvalCase[] = [
    {
      id: "reproduction",
      kind: "reproduction",
      expect: "rejected",
      request: reproduction,
      change: "the counterexample itself",
    },
    ...pick(rejected, options.maxVariants ?? 8).map(
      (item, index): EvalCase => ({
        id: `reject-${index + 1}`,
        kind: "variant",
        expect: "rejected",
        request: item.request,
        change: change(item),
      }),
    ),
    ...pick(accepted, options.maxNeighbors ?? 6).map(
      (item, index): EvalCase => ({
        id: `accept-${index + 1}`,
        kind: "neighbor",
        expect: "accepted",
        request: item.request,
        change: change(item),
      }),
    ),
  ];
  return {
    schemaVersion: 1,
    id: `eval-${record.id.slice(3)}`,
    counterexample: record.id,
    rule: record.rule,
    operation: record.operation,
    property: propertyOf(record),
    description: `${record.operation} must not allow: ${record.violation}`,
    cases,
  };
}

// --- Running ----------------------------------------------------------------

export type Outcome = "accepted" | "rejected";
/** Anything that can say whether an implementation would accept an action. */
export type Executor = (request: ActionRequest) => Outcome | Promise<Outcome>;
export type CaseResult = {
  id: string;
  kind: EvalCase["kind"];
  expect: Outcome;
  outcome: Outcome;
  passed: boolean;
};
export type EvalRun = {
  eval: string;
  /** The reproduction and every rejected variant were rejected (and, if asked, every neighbor accepted). */
  passed: boolean;
  cases: CaseResult[];
  failed: string[];
  /**
   * Neighbors the specification allows but the implementation rejected. The
   * change may be stricter than the rule needs, or it may reject everything;
   * reported, and a failure only with `strictNeighbors`.
   */
  overRestrictive: string[];
};

export async function runEval(
  evaluation: RegressionEval,
  executor: Executor,
  options: { strictNeighbors?: boolean } = {},
): Promise<EvalRun> {
  const cases: CaseResult[] = [];
  for (const item of evaluation.cases) {
    const outcome = await executor(item.request);
    cases.push({
      id: item.id,
      kind: item.kind,
      expect: item.expect,
      outcome,
      passed: outcome === item.expect,
    });
  }
  const overRestrictive = cases
    .filter((item) => item.kind === "neighbor" && !item.passed)
    .map((item) => item.id);
  const failed = cases
    .filter(
      (item) =>
        !item.passed && (item.kind !== "neighbor" || options.strictNeighbors),
    )
    .map((item) => item.id);
  return {
    eval: evaluation.id,
    passed: failed.length === 0,
    cases,
    failed,
    overRestrictive,
  };
}

/**
 * Predicts acceptance from the operation contract extracted from a
 * candidate: an action is accepted if the operation's preconditions hold.
 * Business rules and invariants are left out on purpose; a rule the code does
 * not enforce is exactly what the eval is meant to expose.
 */
export function contractExecutor(spec: BehaviorSpec): Executor {
  const contract = createActionGate({
    ...spec,
    invariants: [],
    permissions: [],
    businessRules: [],
    dataPolicies: [],
    temporalRules: [],
  });
  return (request) =>
    contract.check(request).decision === "BLOCK" ? "rejected" : "accepted";
}

/** The eval's property, asked of a candidate's specification with the verifier. */
export function runSpecEval(
  evaluation: RegressionEval,
  spec: BehaviorSpec,
  router: VerificationRouter,
): Promise<VerificationResult> {
  return router.verify(evaluation.property, spec);
}
