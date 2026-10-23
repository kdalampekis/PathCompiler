import {
  type FormalAction,
  type FormalExpr,
  type FormalGoal,
  type FormalProductModel,
  type FormalStateVariable,
  type FormalTerm,
  formalModelHash,
  normalizeFormalModel,
  parseFormalModel,
} from "@pathcompiler/formal-model";
import type {
  SolverProblem,
  SolverProvider,
  SolverTerm,
  SolverValue,
} from "@pathcompiler/solver-provider";
import { compareText } from "@pathcompiler/source-model";
import type { EvidenceRef } from "@pathcompiler/workflow-ir";

export type FormalValue = boolean | number | string;
export type FormalStateSnapshot = Record<string, FormalValue>;
export type ReachabilityQuery = {
  goal: string;
  /** Fixed context values (role, flags). Omitted context variables are free. */
  context?: Record<string, FormalValue>;
  /** Longest witness considered, in actions. */
  maxDepth?: number;
  /** Wall-clock budget for the whole query. */
  timeoutMs?: number;
};
export type ReasoningTraceStep = {
  index: number;
  actionId: string;
  semanticTarget?: string;
  capabilityId?: string;
  evidence: EvidenceRef[];
  /** State variables this step changed, with their new values. */
  changes: FormalStateSnapshot;
};
export type ReasoningTrace = {
  goal: string;
  /** Context the witness uses, including values the solver chose for free variables. */
  context: FormalStateSnapshot;
  /** Initial values of the variables in the slice; others are unconstrained. */
  initialState: FormalStateSnapshot;
  actions: ReasoningTraceStep[];
};
export type ReasoningStats = {
  solver: string;
  /** Depth of the last bounded check. */
  bound: number;
  solverCalls: number;
  /** Top-level assertions in the last solver problem. */
  constraintCount: number;
  durationMs: number;
  slice: {
    variables: number;
    actions: number;
    totalVariables: number;
    totalActions: number;
  };
};
export type UnknownReason = "bound-insufficient" | "timeout" | "solver-unknown";
type ResultBase = {
  goal: string;
  context: FormalStateSnapshot;
  model: {
    id: string;
    hash: string;
    repositoryCommit: string | null;
    source: FormalProductModel["metadata"]["source"];
  };
  stats: ReasoningStats;
};
/** `unknown` is a first-class answer and is never reported as `unreachable`. */
export type ReachabilityResult =
  | (ResultBase & { status: "reachable"; trace: ReasoningTrace })
  | (ResultBase & {
      status: "unreachable";
      /** No path within `depth` steps, and k-induction at `depth` closes every longer one. */
      proof: { method: "k-induction"; depth: number };
    })
  | (ResultBase & { status: "unknown"; reason: UnknownReason; detail: string });
export type PlanStep = ReasoningTraceStep & { cost: number };
export type Plan = {
  goal: string;
  context: FormalStateSnapshot;
  initialState: FormalStateSnapshot;
  steps: PlanStep[];
  length: number;
  cost: number;
};
export type PlanResult =
  | (ResultBase & {
      status: "found";
      plan: Plan;
      /** Shortest by length; cheapest only when every action in the slice costs the same (R7 optimizes cost). */
      optimality: { length: "optimal"; cost: "optimal" | "not-guaranteed" };
    })
  | (ResultBase & {
      status: "impossible";
      proof: { method: "k-induction"; depth: number };
    })
  | (ResultBase & { status: "unknown"; reason: UnknownReason; detail: string });
/** A named model constraint an explanation can cite (reasoning spec §24–§25). */
export type ConstraintProvenance = {
  /** Stable within a model: `context:<variable>`, `precondition:<action>#<n>`, `initial#<n>`. */
  id: string;
  kind: "context" | "precondition" | "initial";
  /** Product-semantic sentence, never a solver label. */
  description: string;
  actionId?: string;
  capabilityId?: string;
  semanticTarget?: string;
  variables: string[];
  /** The action's evidence plus the evidence of the variables the constraint mentions. */
  evidence: EvidenceRef[];
};
export type UnreachableExplanation = {
  /** A minimal set of constraints the unreachability proof needs (deletion-minimized core). */
  constraints: ConstraintProvenance[];
  /** False when a solver `unknown` stopped minimization early. */
  minimal: boolean;
  /** Actions in the slice that assign a goal variable. */
  goalSetters: { actionId: string; capabilityId?: string }[];
  summary: string[];
};
export type ExplanationResult =
  | Exclude<ReachabilityResult, { status: "unreachable" }>
  | (Extract<ReachabilityResult, { status: "unreachable" }> & {
      explanation: UnreachableExplanation;
    });
export interface ProductReasoner {
  checkReachability(
    model: FormalProductModel,
    query: ReachabilityQuery,
  ): Promise<ReachabilityResult>;
  /**
   * Shortest plan to the goal. Among equally short plans it returns the one with
   * the lexicographically smallest action sequence (by action ID), so plans do
   * not depend on solver choices.
   */
  findPlan(
    model: FormalProductModel,
    query: ReachabilityQuery,
  ): Promise<PlanResult>;
  /** Reachability plus, when unreachable, the constraints responsible and their source evidence. */
  explainUnreachable(
    model: FormalProductModel,
    query: ReachabilityQuery,
  ): Promise<ExplanationResult>;
}
export class ReasoningQueryError extends Error {
  override name = "ReasoningQueryError";
}

export const DEFAULT_MAX_DEPTH = 20;
export const DEFAULT_TIMEOUT_MS = 30_000;

export function formalExprVariables(expr: FormalExpr): string[] {
  switch (expr.type) {
    case "bool":
      return [];
    case "var":
      return [expr.id];
    case "not":
      return formalExprVariables(expr.expr);
    case "and":
    case "or":
      return expr.expressions.flatMap(formalExprVariables);
    default:
      return [expr.left, expr.right].flatMap((term) =>
        term.type === "var" ? [term.id] : [],
      );
  }
}

function termValue(term: FormalTerm, state: FormalStateSnapshot): FormalValue {
  if (term.type === "const") return term.value;
  const value = state[term.id];
  if (value === undefined) throw new Error(`State has no value for ${term.id}`);
  return value;
}
/** Evaluates an expression in a concrete state (used to replay witnesses). */
export function evaluateFormalExpr(
  expr: FormalExpr,
  state: FormalStateSnapshot,
): boolean {
  switch (expr.type) {
    case "bool":
      return expr.value;
    case "var":
      return termValue({ type: "var", id: expr.id }, state) === true;
    case "not":
      return !evaluateFormalExpr(expr.expr, state);
    case "and":
      return expr.expressions.every((item) => evaluateFormalExpr(item, state));
    case "or":
      return expr.expressions.some((item) => evaluateFormalExpr(item, state));
    default: {
      const left = termValue(expr.left, state);
      const right = termValue(expr.right, state);
      if (expr.type === "eq") return left === right;
      if (typeof left !== "number" || typeof right !== "number")
        throw new Error(`${expr.type} needs integer operands`);
      return expr.type === "lt"
        ? left < right
        : expr.type === "lte"
          ? left <= right
          : expr.type === "gt"
            ? left > right
            : left >= right;
    }
  }
}
/** Applies an action's simultaneous effects to a state; the precondition is not checked. */
export function applyFormalAction(
  action: FormalAction,
  state: FormalStateSnapshot,
): FormalStateSnapshot {
  const next = { ...state };
  for (const effect of action.effects)
    next[effect.variable] = termValue(effect.value, state);
  return next;
}

/**
 * Cone-of-influence slice: keeps the variables that can affect `roots` and the
 * actions that assign them. Removed actions cannot change any kept variable, so
 * reachability of conditions over `roots` is preserved.
 */
export function sliceFormalModel(
  input: FormalProductModel,
  roots: string[],
): FormalProductModel {
  const model = parseFormalModel(input);
  const relevant = new Set(roots);
  for (let changed = true; changed; ) {
    changed = false;
    for (const action of model.actions) {
      const effects = action.effects.filter((effect) =>
        relevant.has(effect.variable),
      );
      if (effects.length === 0) continue;
      for (const id of [
        ...formalExprVariables(action.precondition),
        ...effects.flatMap((effect) =>
          effect.value.type === "var" ? [effect.value.id] : [],
        ),
      ])
        if (!relevant.has(id)) {
          relevant.add(id);
          changed = true;
        }
    }
  }
  // The initial constraint is kept whole, so its variables stay declared; outside
  // the cone they are never assigned.
  const declared = new Set([
    ...relevant,
    ...formalExprVariables(model.initial),
  ]);
  return {
    ...model,
    variables: model.variables.filter((item) => declared.has(item.id)),
    actions: model.actions.flatMap((action) => {
      const effects = action.effects.filter((effect) =>
        relevant.has(effect.variable),
      );
      return effects.length > 0 ? [{ ...action, effects }] : [];
    }),
    invariants: model.invariants.filter((item) =>
      formalExprVariables(item.condition).every((id) => declared.has(id)),
    ),
    goals: model.goals.filter((item) =>
      formalExprVariables(item.condition).every((id) => declared.has(id)),
    ),
  };
}

const describeTerm = (term: FormalTerm) =>
  term.type === "var" ? term.id : String(term.value);
/** Renders an expression in product terms, e.g. `role = editor and not client_form_open`. */
export function describeFormalExpr(expr: FormalExpr): string {
  const nested = (item: FormalExpr) =>
    item.type === "and" || item.type === "or"
      ? `(${describeFormalExpr(item)})`
      : describeFormalExpr(item);
  switch (expr.type) {
    case "bool":
      return String(expr.value);
    case "var":
      return expr.id;
    case "not":
      return expr.expr.type === "eq"
        ? `${describeTerm(expr.expr.left)} ≠ ${describeTerm(expr.expr.right)}`
        : `not ${nested(expr.expr)}`;
    case "and":
      return expr.expressions.map(nested).join(" and ");
    case "or":
      return expr.expressions.map(nested).join(" or ");
    default: {
      const symbol = { eq: "=", lt: "<", lte: "≤", gt: ">", gte: "≥" }[
        expr.type
      ];
      return `${describeTerm(expr.left)} ${symbol} ${describeTerm(expr.right)}`;
    }
  }
}

const conjuncts = (expr: FormalExpr): FormalExpr[] =>
  expr.type === "and" ? expr.expressions.flatMap(conjuncts) : [expr];
const not = (arg: SolverTerm): SolverTerm => ({ op: "not", arg });
const and = (args: SolverTerm[]): SolverTerm => ({ op: "and", args });
const or = (args: SolverTerm[]): SolverTerm => ({ op: "or", args });
const eq = (left: SolverTerm, right: SolverTerm): SolverTerm => ({
  op: "eq",
  left,
  right,
});
const implies = (a: SolverTerm, b: SolverTerm) => or([not(a), b]);
const int = (value: number): SolverTerm => ({ op: "int", value });
const variable = (name: string): SolverTerm => ({ op: "var", name });

/** Bounded model checking for witnesses, k-induction for unreachability proofs. */
export function createProductReasoner(solver: SolverProvider): ProductReasoner {
  return {
    checkReachability: (model, query) => search(solver, model, query, "reach"),
    // Explain mode always attaches an explanation to unreachable results.
    explainUnreachable: (model, query) =>
      search(solver, model, query, "explain") as Promise<ExplanationResult>,
    async findPlan(input, query) {
      const result = await search(solver, input, query, "plan");
      if (result.status === "unknown") return result;
      if (result.status === "unreachable")
        return { ...result, status: "impossible" };
      const { trace, ...common } = result;
      const model = parseFormalModel(input);
      const actions = new Map(model.actions.map((item) => [item.id, item]));
      const steps = trace.actions.map((step) => ({
        ...step,
        cost: actions.get(step.actionId)?.cost ?? 1,
      }));
      const slice = sliceFormalModel(model, [
        ...formalExprVariables(
          (model.goals.find((item) => item.id === trace.goal) as FormalGoal)
            .condition,
        ),
        ...Object.keys(result.context),
      ]);
      const uniform =
        new Set(slice.actions.map((item) => item.cost ?? 1)).size <= 1;
      return {
        ...common,
        status: "found",
        plan: {
          goal: trace.goal,
          context: trace.context,
          initialState: trace.initialState,
          steps,
          length: steps.length,
          cost: steps.reduce((total, step) => total + step.cost, 0),
        },
        optimality: {
          length: "optimal",
          cost: uniform ? "optimal" : "not-guaranteed",
        },
      };
    },
  };
}

async function search(
  solver: SolverProvider,
  input: FormalProductModel,
  query: ReachabilityQuery,
  mode: "reach" | "plan" | "explain",
): Promise<ReachabilityResult | ExplanationResult> {
  const canonical = mode === "plan";
  const labeled = mode === "explain";
  const started = Date.now();
  // Normalized order makes action indices, and so canonical plans, independent of authoring order.
  const full = normalizeFormalModel(input);
  const match = full.goals.find((item) => item.id === query.goal);
  if (!match)
    throw new ReasoningQueryError(
      `Unknown goal ${query.goal}. Known goals: ${full.goals.map((item) => item.id).join(", ") || "none"}.`,
    );
  const goal = match;
  const maxDepth = query.maxDepth ?? DEFAULT_MAX_DEPTH;
  const timeoutMs = query.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 200)
    throw new ReasoningQueryError("maxDepth must be an integer from 0 to 200.");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
    throw new ReasoningQueryError("timeoutMs must be a positive integer.");
  const declared = new Map(full.variables.map((item) => [item.id, item]));
  const context = query.context ?? {};
  for (const [id, value] of Object.entries(context)) {
    const item = declared.get(id);
    if (item?.scope !== "context")
      throw new ReasoningQueryError(
        `${id} is not a context variable. Context variables: ${
          full.variables
            .filter((entry) => entry.scope === "context")
            .map((entry) => entry.id)
            .join(", ") || "none"
        }.`,
      );
    const valid =
      item.type === "boolean"
        ? typeof value === "boolean"
        : item.type === "enum"
          ? typeof value === "string" && item.values.includes(value)
          : item.type === "integer"
            ? Number.isInteger(value) &&
              (item.min === undefined || (value as number) >= item.min) &&
              (item.max === undefined || (value as number) <= item.max)
            : typeof value === "string";
    if (!valid)
      throw new ReasoningQueryError(
        `${JSON.stringify(value)} is not a valid value for ${id} (${item.type === "enum" ? `one of ${item.values.join(", ")}` : item.type}).`,
      );
  }

  const model = sliceFormalModel(full, [
    ...formalExprVariables(goal.condition),
    ...Object.keys(context),
  ]);
  const variables = new Map(model.variables.map((item) => [item.id, item]));
  const stateIds = model.variables
    .filter((item) => item.scope === "state")
    .map((item) => item.id);
  const dynamic = new Set(
    model.actions.flatMap((action) =>
      action.effects.map((effect) => effect.variable),
    ),
  );
  // Enum values and string literals share one code table, so equality is by value.
  const literals = new Set<string>();
  const collect = (term: FormalTerm) => {
    if (term.type === "const" && typeof term.value === "string")
      literals.add(term.value);
  };
  const exprs = [
    model.initial,
    goal.condition,
    ...model.actions.map((action) => action.precondition),
  ];
  const visit = (item: FormalExpr): void => {
    if (item.type === "not") visit(item.expr);
    else if (item.type === "and" || item.type === "or")
      for (const entry of item.expressions) visit(entry);
    else if (item.type !== "bool" && item.type !== "var") {
      collect(item.left);
      collect(item.right);
    }
  };
  for (const item of exprs) visit(item);
  for (const action of model.actions)
    for (const effect of action.effects) collect(effect.value);
  for (const item of model.variables)
    if (item.type === "enum")
      for (const value of item.values) literals.add(value);
  for (const value of Object.values(context))
    if (typeof value === "string") literals.add(value);
  const table = [...literals].sort(compareText);
  const code = (value: string) => table.indexOf(value);
  const decodeString = (value: number) => table[value] ?? `<value ${value}>`;

  const name = (id: string, step: number) =>
    variables.get(id)?.scope === "context" ? `c:${id}` : `s${step}:${id}`;
  const encodeConst = (value: FormalValue): SolverTerm =>
    typeof value === "boolean"
      ? { op: "bool", value }
      : typeof value === "number"
        ? int(value)
        : int(code(value));
  const term = (item: FormalTerm, step: number): SolverTerm =>
    item.type === "var"
      ? variable(name(item.id, step))
      : encodeConst(item.value);
  const expr = (item: FormalExpr, step: number): SolverTerm => {
    switch (item.type) {
      case "bool":
        return { op: "bool", value: item.value };
      case "var":
        return variable(name(item.id, step));
      case "not":
        return not(expr(item.expr, step));
      case "and":
        return and(item.expressions.map((entry) => expr(entry, step)));
      case "or":
        return or(item.expressions.map((entry) => expr(entry, step)));
      case "eq":
        return eq(term(item.left, step), term(item.right, step));
      case "lt":
        return {
          op: "lt",
          left: term(item.left, step),
          right: term(item.right, step),
        };
      case "lte":
        return {
          op: "le",
          left: term(item.left, step),
          right: term(item.right, step),
        };
      case "gt":
        return {
          op: "lt",
          left: term(item.right, step),
          right: term(item.left, step),
        };
      case "gte":
        return {
          op: "le",
          left: term(item.right, step),
          right: term(item.left, step),
        };
    }
  };
  const sort = (item: FormalStateVariable) =>
    item.type === "boolean" ? ("bool" as const) : ("int" as const);
  const domain = (item: FormalStateVariable, step: number): SolverTerm[] => {
    const own = variable(name(item.id, step));
    if (item.type === "enum")
      return [or(item.values.map((value) => eq(own, int(code(value)))))];
    if (item.type === "integer")
      return [
        ...(item.min === undefined
          ? []
          : [{ op: "le", left: int(item.min), right: own } as SolverTerm]),
        ...(item.max === undefined
          ? []
          : [{ op: "le", left: own, right: int(item.max) } as SolverTerm]),
      ];
    return [];
  };
  // Variables only the initial constraint mentions are declared at step 0 only.
  const used = new Set([
    ...formalExprVariables(goal.condition),
    ...model.actions.flatMap((action) => [
      ...formalExprVariables(action.precondition),
      ...action.effects.flatMap((effect) => [
        effect.variable,
        ...(effect.value.type === "var" ? [effect.value.id] : []),
      ]),
    ]),
  ]);
  const tracked = stateIds.filter((id) => used.has(id));
  const stepIds = (step: number) => (step === 0 ? stateIds : tracked);
  // Explanations guard each product constraint with a label assumed true; an
  // unsat core over the labels names the constraints a proof needs.
  const provenance = new Map<string, ConstraintProvenance>();
  const evidenceOf = (ids: string[], extra: EvidenceRef[] = []) => {
    const refs = new Map(
      [...extra, ...ids.flatMap((id) => variables.get(id)?.evidence ?? [])].map(
        (ref) => [JSON.stringify(ref), ref],
      ),
    );
    return [...refs.entries()]
      .sort(([a], [b]) => compareText(a, b))
      .map(([, ref]) => ref);
  };
  const label = (item: ConstraintProvenance) => {
    provenance.set(item.id, item);
    return `L:${item.id}`;
  };
  const guard = (labelName: string | undefined, body: SolverTerm) =>
    labeled && labelName ? implies(variable(labelName), body) : body;
  const contextLabels = new Map(
    Object.entries(context)
      .filter(([id]) => variables.has(id))
      .map(([id, value]) => [
        id,
        label({
          id: `context:${id}`,
          kind: "context",
          description: `Context fixes ${id} = ${String(value)}`,
          variables: [id],
          evidence: evidenceOf([id]),
        }),
      ]),
  );
  const preconditions = model.actions.map((action) => {
    const original = full.actions.find(
      (item) => item.id === action.id,
    ) as FormalAction;
    return conjuncts(action.precondition).map((item, index) => {
      if (item.type === "bool" && item.value) return { item, label: undefined };
      const ids = [...new Set(formalExprVariables(item))].sort(compareText);
      return {
        item,
        label: label({
          id: `precondition:${action.id}#${index + 1}`,
          kind: "precondition",
          description: `${action.id} requires ${describeFormalExpr(item)}`,
          actionId: action.id,
          ...(original.capabilityId
            ? { capabilityId: original.capabilityId }
            : {}),
          ...(original.semanticTarget
            ? { semanticTarget: original.semanticTarget }
            : {}),
          variables: ids,
          evidence: evidenceOf(
            ids.filter((id) => variables.get(id)?.scope === "context"),
            original.evidence,
          ),
        }),
      };
    });
  });
  const initialParts = conjuncts(model.initial).map((item, index) => {
    const ids = [...new Set(formalExprVariables(item))].sort(compareText);
    return {
      item,
      label: label({
        id: `initial#${index + 1}`,
        kind: "initial",
        description: `Initially ${describeFormalExpr(item)}`,
        variables: ids,
        evidence: evidenceOf(ids),
      }),
    };
  });
  const allLabels = labeled
    ? [...provenance.keys()].map((id) => `L:${id}`)
    : [];
  const initialTerm = and(
    initialParts.map((part) => guard(part.label, expr(part.item, 0))),
  );
  const declare = (steps: number) => {
    const declarations: SolverProblem["variables"] = [];
    const constraints: SolverTerm[] = [];
    for (const item of model.variables.filter(
      (entry) => entry.scope === "context",
    )) {
      declarations.push({ name: name(item.id, 0), sort: sort(item) });
      constraints.push(...domain(item, 0));
    }
    for (let step = 0; step <= steps; step += 1)
      for (const id of stepIds(step)) {
        const item = variables.get(id) as FormalStateVariable;
        declarations.push({ name: name(id, step), sort: sort(item) });
        constraints.push(...domain(item, step));
      }
    for (const [id, value] of Object.entries(context))
      if (variables.has(id))
        constraints.push(
          guard(
            contextLabels.get(id),
            eq(variable(name(id, 0)), encodeConst(value)),
          ),
        );
    for (const item of allLabels)
      declarations.push({ name: item, sort: "bool" });
    for (let step = 0; step < steps; step += 1) {
      declarations.push({ name: `a${step}`, sort: "int" });
      constraints.push(transition(step));
    }
    return { declarations, constraints };
  };
  const transition = (step: number): SolverTerm => {
    if (model.actions.length === 0) return { op: "bool", value: false };
    const choice = variable(`a${step}`);
    return and([
      { op: "le", left: int(0), right: choice },
      { op: "lt", left: choice, right: int(model.actions.length) },
      ...model.actions.map((action, index) => {
        const assigned = new Map(
          action.effects.map((effect) => [effect.variable, effect.value]),
        );
        return implies(
          eq(choice, int(index)),
          and([
            ...(preconditions[index] ?? []).map((part) =>
              guard(part.label, expr(part.item, step)),
            ),
            ...tracked.map((id) => {
              const value = assigned.get(id);
              return eq(
                variable(name(id, step + 1)),
                value ? term(value, step) : variable(name(id, step)),
              );
            }),
          ]),
        );
      }),
    ]);
  };
  // Variables no action assigns keep their initial values; their initial
  // conjuncts therefore hold in every reachable state.
  const frozen = initialParts.filter((part) =>
    formalExprVariables(part.item).every(
      (id) => variables.get(id)?.scope === "context" || !dynamic.has(id),
    ),
  );

  let solverCalls = 0;
  let constraintCount = 0;
  let bound = 0;
  const sliceStats = {
    variables: model.variables.length,
    actions: model.actions.length,
    totalVariables: full.variables.length,
    totalActions: full.actions.length,
  };
  const base = (): ResultBase => ({
    goal: goal.id,
    context: { ...context },
    model: {
      id: full.id,
      hash: formalModelHash(full),
      repositoryCommit: full.metadata.repositoryCommit,
      source: full.metadata.source,
    },
    stats: {
      solver: solver.name,
      bound,
      solverCalls,
      constraintCount,
      durationMs: Date.now() - started,
      slice: sliceStats,
    },
  });
  const run = async (
    problem: Omit<SolverProblem, "timeoutMs">,
  ): Promise<
    | { status: "sat"; model: Record<string, SolverValue> }
    | { status: "unsat"; core?: string[] }
    | ReachabilityResult
  > => {
    const remaining = started + timeoutMs - Date.now();
    if (remaining <= 0)
      return {
        ...base(),
        status: "unknown",
        reason: "timeout",
        detail: `The ${timeoutMs} ms budget ran out at bound ${bound}.`,
      };
    solverCalls += 1;
    constraintCount = problem.assertions.length;
    const result = await solver.check({
      ...problem,
      ...(labeled && !problem.assumptions ? { assumptions: allLabels } : {}),
      timeoutMs: remaining,
    });
    if (result.status !== "unknown") return result;
    const timedOut = /timeout|canceled/i.test(result.reason);
    return {
      ...base(),
      status: "unknown",
      reason: timedOut ? "timeout" : "solver-unknown",
      detail: `Solver returned unknown at bound ${bound}: ${result.reason}`,
    };
  };

  const baseProblem = (depth: number) => {
    const witness = declare(depth);
    return {
      variables: witness.declarations,
      assertions: [
        ...witness.constraints,
        initialTerm,
        expr(goal.condition, depth),
      ],
    };
  };
  const stepProblem = (depth: number) => {
    const step = declare(depth + 1);
    const distinct: SolverTerm[] = [];
    for (let i = 0; i <= depth + 1; i += 1)
      for (let j = i + 1; j <= depth + 1; j += 1)
        distinct.push(
          or(
            tracked.map((id) =>
              not(eq(variable(name(id, i)), variable(name(id, j)))),
            ),
          ),
        );
    return {
      variables: step.declarations,
      assertions: [
        ...step.constraints,
        ...frozen.map((part) => guard(part.label, expr(part.item, 0))),
        ...Array.from({ length: depth + 1 }, (_, index) =>
          not(expr(goal.condition, index)),
        ),
        expr(goal.condition, depth + 1),
        ...distinct,
      ],
    };
  };
  const explain = async (
    depth: number,
  ): Promise<UnreachableExplanation | ReachabilityResult> => {
    const problems = [
      ...Array.from({ length: depth + 1 }, (_, index) => baseProblem(index)),
      stepProblem(depth),
    ];
    let selected = new Set<string>();
    let minimal = true;
    for (const problem of problems) {
      const result = await run(problem);
      if ("goal" in result) return result;
      if (result.status === "sat")
        throw new Error("Internal reasoning error: proof does not replay.");
      for (const item of result.core ?? allLabels) selected.add(item);
    }
    for (const candidate of [...selected].sort(compareText)) {
      const trial = [...selected].filter((item) => item !== candidate);
      let needed = false;
      for (const problem of problems) {
        const result = await run({ ...problem, assumptions: trial });
        if ("goal" in result) {
          minimal = false;
          break;
        }
        if (result.status === "sat") {
          needed = true;
          break;
        }
      }
      if (!minimal) break;
      if (!needed) selected = new Set(trial);
    }
    const order = { context: 0, precondition: 1, initial: 2 };
    const constraints = [...selected]
      .map((item) => provenance.get(item.slice(2)) as ConstraintProvenance)
      .sort((a, b) => order[a.kind] - order[b.kind] || compareText(a.id, b.id));
    const goalVariables = new Set(formalExprVariables(goal.condition));
    const goalSetters = model.actions
      .filter((action) =>
        action.effects.some((effect) => goalVariables.has(effect.variable)),
      )
      .map((action) => {
        const capabilityId = full.actions.find(
          (item) => item.id === action.id,
        )?.capabilityId;
        return {
          actionId: action.id,
          ...(capabilityId ? { capabilityId } : {}),
        };
      });
    const setters = goalSetters.map((item) => item.actionId);
    return {
      constraints,
      minimal,
      goalSetters,
      summary: [
        setters.length === 0
          ? `No action can make ${goal.id} true.`
          : `${setters.length === 1 ? `Only ${setters[0]} can` : `Only ${setters.slice(0, -1).join(", ")} and ${setters.at(-1)} can`} make ${goal.id} true.`,
        ...constraints.map((item) => `${item.description}.`),
      ],
    };
  };

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    bound = depth;
    const witness = declare(depth);
    const found = await run(baseProblem(depth));
    if ("goal" in found) return found;
    if (found.status === "sat") {
      let values = found.model;
      if (canonical) {
        // Binary-search the smallest action index per step. The current
        // model always realizes `high`, so `values` stays consistent.
        const fixed: SolverTerm[] = [];
        for (let index = 0; index < depth; index += 1) {
          const choice = variable(`a${index}`);
          let low = 0;
          let high = values[`a${index}`] as number;
          while (low < high) {
            const middle = Math.floor((low + high) / 2);
            const probe = await run({
              variables: witness.declarations,
              assertions: [
                ...witness.constraints,
                initialTerm,
                expr(goal.condition, depth),
                ...fixed,
                { op: "le", left: choice, right: int(middle) },
              ],
            });
            if ("goal" in probe) return probe;
            if (probe.status === "sat") {
              values = probe.model;
              high = values[`a${index}`] as number;
            } else low = middle + 1;
          }
          fixed.push(eq(choice, int(low)));
        }
      }
      return {
        ...base(),
        status: "reachable",
        trace: decode(values, depth),
      };
    }
    const closed = await run(stepProblem(depth));
    if ("goal" in closed) return closed;
    if (closed.status === "unsat") {
      const proof = { method: "k-induction" as const, depth };
      if (!labeled) return { ...base(), status: "unreachable", proof };
      const explanation = await explain(depth);
      if ("goal" in explanation) return explanation;
      return { ...base(), status: "unreachable", proof, explanation };
    }
  }
  return {
    ...base(),
    status: "unknown",
    reason: "bound-insufficient",
    detail: `No witness within ${maxDepth} steps, and induction did not close at that depth. Raise maxDepth or add constraints.`,
  };

  function decode(
    values: Record<string, SolverValue>,
    depth: number,
  ): ReasoningTrace {
    const read = (item: FormalStateVariable, step: number): FormalValue => {
      const raw = values[name(item.id, step)];
      if (raw === undefined)
        throw new Error(`Solver model has no value for ${name(item.id, step)}`);
      return item.type === "enum" || item.type === "string"
        ? decodeString(raw as number)
        : raw;
    };
    const contextValues: FormalStateSnapshot = {};
    const initialState: FormalStateSnapshot = {};
    for (const item of model.variables)
      if (item.scope === "context") contextValues[item.id] = read(item, 0);
      else initialState[item.id] = read(item, 0);
    let state = { ...contextValues, ...initialState };
    if (!evaluateFormalExpr(model.initial, state))
      throw new Error(
        "Internal reasoning error: witness initial state is not admissible.",
      );
    const steps: ReasoningTraceStep[] = [];
    for (let index = 0; index < depth; index += 1) {
      const action = model.actions[values[`a${index}`] as number];
      if (!action || !evaluateFormalExpr(action.precondition, state))
        throw new Error(
          `Internal reasoning error: witness step ${index} does not replay.`,
        );
      const original = full.actions.find(
        (item) => item.id === action.id,
      ) as FormalAction;
      const next = applyFormalAction(action, state);
      const changes: FormalStateSnapshot = {};
      for (const id of Object.keys(next).sort(compareText))
        if (next[id] !== state[id]) changes[id] = next[id] as FormalValue;
      steps.push({
        index,
        actionId: action.id,
        ...(original.semanticTarget
          ? { semanticTarget: original.semanticTarget }
          : {}),
        ...(original.capabilityId
          ? { capabilityId: original.capabilityId }
          : {}),
        evidence: original.evidence,
        changes,
      });
      state = next;
    }
    if (!evaluateFormalExpr(goal.condition, state))
      throw new Error(
        "Internal reasoning error: witness does not reach the goal.",
      );
    return {
      goal: goal.id,
      context: contextValues,
      initialState,
      actions: steps,
    };
  }
}

export type PlanEvaluation = {
  /** The plan replays from its initial state and ends in the goal. */
  goalReached: boolean;
  /** Steps that are unknown to the model or whose precondition fails on replay. */
  invalidActionCount: number;
  /** Comparison with a reviewed workflow's steps, when one is given (spec §89). */
  majorSteps?: {
    expected: string[];
    planned: string[];
    matched: number;
    score: number;
    missing: string[];
    extra: string[];
  };
};
type WorkflowSteps = {
  steps: { target?: string | undefined; action: { type: string } }[];
};

/**
 * Replays a plan against a model and, optionally, compares its capability steps
 * with a workflow. Navigation (steps without a capability) maps to workflow
 * entrypoints and is not compared. Runs of adjacent input/select steps are
 * order-insensitive on both sides.
 */
export function evaluatePlan(
  input: FormalProductModel,
  plan: Plan,
  workflow?: WorkflowSteps,
): PlanEvaluation {
  const model = parseFormalModel(input);
  const goal = model.goals.find((item) => item.id === plan.goal);
  const actions = new Map(model.actions.map((item) => [item.id, item]));
  let state: FormalStateSnapshot = { ...plan.context, ...plan.initialState };
  let invalidActionCount = 0;
  const known = (expr: FormalExpr) =>
    formalExprVariables(expr).every((id) => id in state);
  for (const step of plan.steps) {
    const action = actions.get(step.actionId);
    if (
      !action ||
      !known(action.precondition) ||
      !evaluateFormalExpr(action.precondition, state)
    ) {
      invalidActionCount += 1;
      continue;
    }
    const next = { ...state };
    for (const effect of action.effects)
      if (effect.value.type === "var" && !(effect.value.id in state))
        delete next[effect.variable];
      else next[effect.variable] = termValue(effect.value, state);
    state = next;
  }
  const goalReached =
    goal !== undefined &&
    known(goal.condition) &&
    evaluateFormalExpr(goal.condition, state);
  if (!workflow) return { goalReached, invalidActionCount };
  const targeted = workflow.steps.flatMap((step) =>
    step.target ? [{ target: step.target, type: step.action.type }] : [],
  );
  const inputs = new Set(
    targeted
      .filter((step) => step.type === "input" || step.type === "select")
      .map((step) => step.target),
  );
  const normalize = (targets: string[]) => {
    const result: string[] = [];
    let run: string[] = [];
    for (const target of [...targets, ""]) {
      if (target !== "" && inputs.has(target)) {
        run.push(target);
        continue;
      }
      result.push(...run.sort(compareText));
      run = [];
      if (target !== "") result.push(target);
    }
    return result;
  };
  const expected = normalize(targeted.map((step) => step.target));
  const planned = normalize(
    plan.steps.flatMap((step) =>
      step.capabilityId && step.semanticTarget ? [step.semanticTarget] : [],
    ),
  );
  const table = Array.from({ length: expected.length + 1 }, () =>
    new Array<number>(planned.length + 1).fill(0),
  );
  for (let i = 1; i <= expected.length; i += 1)
    for (let j = 1; j <= planned.length; j += 1)
      (table[i] as number[])[j] =
        expected[i - 1] === planned[j - 1]
          ? ((table[i - 1] as number[])[j - 1] as number) + 1
          : Math.max(
              (table[i - 1] as number[])[j] as number,
              (table[i] as number[])[j - 1] as number,
            );
  const matched = (table[expected.length] as number[])[
    planned.length
  ] as number;
  return {
    goalReached,
    invalidActionCount,
    majorSteps: {
      expected,
      planned,
      matched,
      score: expected.length === 0 ? 1 : matched / expected.length,
      missing: expected.filter((target) => !planned.includes(target)),
      extra: planned.filter((target) => !expected.includes(target)),
    },
  };
}
