import { createHash } from "node:crypto";
import { EvidenceRefSchema } from "@pathcompiler/workflow-ir";
import { z } from "zod";
import {
  assertShallow,
  type Expr,
  ExprSchema,
  formatExpression,
  IDENTIFIER,
} from "./expression.js";
import { ProvenanceListSchema } from "./provenance.js";

/**
 * BehaviorIR: the solver-neutral behavioral specification of a software
 * system. It describes what the system does (transitions, operations), what
 * the specification requires (invariants, permissions, rules) and how far to
 * trust each requirement (provenance). It imports no solver.
 *
 * Semantics, used by every verifier:
 * - an **invariant** holds in every reachable state;
 * - an **execution rule** (business rule, data policy) holds whenever an
 *   operation or transition executes, over state, inputs and context;
 * - a **permission** says a role may run an action only when its constraint
 *   holds (`allow`), or never (`deny`); roles without an entry are
 *   unconstrained by permissions;
 * - an **operation** is a contract: parameters, preconditions, and either
 *   effects (an update with a frame: unmentioned variables stay unchanged) or
 *   postconditions (a relation between `old(x)` and the new state);
 * - a **temporal rule** orders events: `must_precede` requires `before` to
 *   have occurred before `after` may; `never_after` forbids `after` once
 *   `before` has occurred.
 */
export const BEHAVIOR_SPEC_SCHEMA_VERSION = 1;
const id = z
  .string()
  .regex(
    IDENTIFIER,
    "IDs are lowercase dot-separated words, e.g. refunds.manager_approval_required",
  );
const text = z.string().trim().min(1);
const provenance = ProvenanceListSchema;

export const VariableSchema = z.discriminatedUnion("type", [
  z.strictObject({
    id,
    type: z.literal("boolean"),
    scope: z.enum(["state", "input", "context"]),
    description: text.optional(),
    evidence: z.array(EvidenceRefSchema).optional(),
  }),
  z.strictObject({
    id,
    type: z.literal("integer"),
    scope: z.enum(["state", "input", "context"]),
    min: z.number().int().safe().optional(),
    max: z.number().int().safe().optional(),
    description: text.optional(),
    evidence: z.array(EvidenceRefSchema).optional(),
  }),
  z.strictObject({
    id,
    type: z.literal("enum"),
    scope: z.enum(["state", "input", "context"]),
    values: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/)).min(1),
    description: text.optional(),
    evidence: z.array(EvidenceRefSchema).optional(),
  }),
  z.strictObject({
    id,
    type: z.literal("string"),
    scope: z.enum(["state", "input", "context"]),
    description: text.optional(),
    evidence: z.array(EvidenceRefSchema).optional(),
  }),
]);
export type Variable = z.infer<typeof VariableSchema>;

export const EffectSchema = z.strictObject({
  variable: id,
  /** Evaluated in the pre-state. */
  value: ExprSchema,
});
export type Effect = z.infer<typeof EffectSchema>;

export const WorkflowSchema = z.strictObject({
  id,
  title: text.optional(),
  description: text.optional(),
  capabilityId: text.optional(),
  /** Named states, when the workflow is a state machine. */
  states: z.array(text).optional(),
  entry: z.strictObject({
    state: text.optional(),
    condition: ExprSchema.optional(),
  }),
  terminal: z.strictObject({
    states: z.array(text).optional(),
    condition: ExprSchema.optional(),
  }),
  provenance,
});
export const TransitionSchema = z.strictObject({
  id,
  description: text.optional(),
  workflow: id.optional(),
  from: text.optional(),
  to: text.optional(),
  /** Conjunction; all must hold for the transition to be enabled. */
  preconditions: z.array(ExprSchema),
  effects: z.array(EffectSchema),
  cost: z.number().nonnegative().optional(),
  semanticTarget: text.optional(),
  capabilityId: text.optional(),
  provenance,
});
export const OperationSchema = z.strictObject({
  id,
  description: text.optional(),
  /** Input variables the operation takes. */
  parameters: z.array(id),
  preconditions: z.array(ExprSchema),
  /** A relation between `old(x)` and the new state. */
  postconditions: z.array(ExprSchema),
  /** An update with a frame; when present it defines the new state. */
  effects: z.array(EffectSchema),
  provenance,
});
export const InvariantSchema = z.strictObject({
  id,
  description: text.optional(),
  expression: ExprSchema,
  provenance,
});
export const PermissionSchema = z.strictObject({
  id,
  description: text.optional(),
  role: text,
  action: text,
  resource: text.optional(),
  effect: z.enum(["allow", "deny"]),
  constraint: ExprSchema.optional(),
  provenance,
});
export const TemporalRuleSchema = z.strictObject({
  id,
  description: text.optional(),
  /**
   * `must_precede`: `before` must have occurred before `after` may.
   * `never_after`: `after` may never occur once `before` has.
   */
  kind: z.enum(["must_precede", "never_after"]),
  /** A transition, operation or workflow state. */
  before: text,
  after: text,
  provenance,
});
export const DataPolicySchema = z.strictObject({
  id,
  description: text.optional(),
  rule: ExprSchema,
  provenance,
});
export const BusinessRuleSchema = z.strictObject({
  id,
  description: text.optional(),
  /** Whenever this holds at an execution, `must` has to hold too. */
  when: ExprSchema,
  must: ExprSchema,
  provenance,
});
export type Workflow = z.infer<typeof WorkflowSchema>;
export type Transition = z.infer<typeof TransitionSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export type Invariant = z.infer<typeof InvariantSchema>;
export type Permission = z.infer<typeof PermissionSchema>;
export type TemporalRule = z.infer<typeof TemporalRuleSchema>;
export type DataPolicy = z.infer<typeof DataPolicySchema>;
export type BusinessRule = z.infer<typeof BusinessRuleSchema>;

const SpecShape = z.strictObject({
  schemaVersion: z.literal(BEHAVIOR_SPEC_SCHEMA_VERSION),
  kind: z.literal("behavior-spec"),
  id,
  metadata: z.strictObject({
    repositoryCommit: text.nullable(),
    /** What produced this specification: an extractor, a conversion, a person. */
    producer: text,
    producerVersion: text,
    /** Carried through conversions from the Formal Product Model. */
    semanticModelVersion: text.optional(),
  }),
  variables: z.array(VariableSchema),
  /** Admissible initial states. */
  initial: ExprSchema.optional(),
  workflows: z.array(WorkflowSchema),
  transitions: z.array(TransitionSchema),
  operations: z.array(OperationSchema),
  invariants: z.array(InvariantSchema),
  permissions: z.array(PermissionSchema),
  temporalRules: z.array(TemporalRuleSchema),
  dataPolicies: z.array(DataPolicySchema),
  businessRules: z.array(BusinessRuleSchema),
});

type ValueType =
  | { kind: "boolean" }
  | { kind: "number" }
  | { kind: "string"; values?: string[] };

/** Validates structure, unique IDs, references, scopes and types. */
export const BehaviorSpecSchema = SpecShape.superRefine((spec, context) => {
  const issue = (path: (string | number)[], message: string) =>
    context.addIssue({ code: "custom", path, message });
  const unique = (
    key: keyof typeof spec & string,
    items: readonly { id: string }[],
  ) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id))
        issue([key, index, "id"], `Duplicate ${key} ID: ${item.id}`);
      seen.add(item.id);
    });
  };
  unique("variables", spec.variables);
  unique("workflows", spec.workflows);
  unique("transitions", spec.transitions);
  unique("operations", spec.operations);
  // A rule ID names exactly one rule, so counterexamples can cite it.
  const rules = [
    ...spec.invariants.map(
      (item, index) => ["invariants", index, item.id] as const,
    ),
    ...spec.permissions.map(
      (item, index) => ["permissions", index, item.id] as const,
    ),
    ...spec.temporalRules.map(
      (item, index) => ["temporalRules", index, item.id] as const,
    ),
    ...spec.dataPolicies.map(
      (item, index) => ["dataPolicies", index, item.id] as const,
    ),
    ...spec.businessRules.map(
      (item, index) => ["businessRules", index, item.id] as const,
    ),
  ];
  const seenRules = new Set<string>();
  for (const [key, index, ruleId] of rules) {
    if (seenRules.has(ruleId))
      issue(
        [key, index, "id"],
        `Rule ID ${ruleId} is used by more than one rule`,
      );
    seenRules.add(ruleId);
  }

  const variables = new Map(spec.variables.map((item) => [item.id, item]));
  spec.variables.forEach((variable, index) => {
    if (
      variable.type === "enum" &&
      new Set(variable.values).size !== variable.values.length
    )
      issue(
        ["variables", index, "values"],
        `Duplicate enum value in ${variable.id}`,
      );
    if (
      variable.type === "integer" &&
      variable.min !== undefined &&
      variable.max !== undefined &&
      variable.min > variable.max
    )
      issue(["variables", index], `Empty integer range for ${variable.id}`);
  });

  const typeOfVariable = (variable: Variable): ValueType =>
    variable.type === "boolean"
      ? { kind: "boolean" }
      : variable.type === "integer"
        ? { kind: "number" }
        : variable.type === "enum"
          ? { kind: "string", values: variable.values }
          : { kind: "string" };

  /** Type of an expression; null after a reported error, to avoid cascades. */
  function check(
    expr: Expr,
    path: (string | number)[],
    allowPre: boolean,
  ): ValueType | null {
    const same = (a: ValueType, b: ValueType) => a.kind === b.kind;
    const expect = (
      item: Expr,
      itemPath: (string | number)[],
      kind: ValueType["kind"],
    ) => {
      const type = check(item, itemPath, allowPre);
      if (type && type.kind !== kind)
        issue(
          itemPath,
          `${formatExpression(item)} is a ${type.kind}, but a ${kind} is needed here.`,
        );
    };
    switch (expr.op) {
      case "lit":
        return {
          kind:
            typeof expr.value === "boolean"
              ? "boolean"
              : typeof expr.value === "number"
                ? "number"
                : "string",
        };
      case "var": {
        const variable = variables.get(expr.id);
        if (!variable) {
          issue(path, `Unknown variable ${expr.id}`);
          return null;
        }
        if (expr.at && !allowPre)
          issue(path, `old(${expr.id}) is only allowed in postconditions.`);
        return typeOfVariable(variable);
      }
      case "add":
      case "mul":
        for (const [index, arg] of expr.args.entries())
          expect(arg, [...path, "args", index], "number");
        return { kind: "number" };
      case "sub":
      case "lt":
      case "le":
      case "gt":
      case "ge":
        expect(expr.left, [...path, "left"], "number");
        expect(expr.right, [...path, "right"], "number");
        return expr.op === "sub" ? { kind: "number" } : { kind: "boolean" };
      case "and":
      case "or":
        for (const [index, arg] of expr.args.entries())
          expect(arg, [...path, "args", index], "boolean");
        return { kind: "boolean" };
      case "not":
        expect(expr.arg, [...path, "arg"], "boolean");
        return { kind: "boolean" };
      case "implies":
        expect(expr.left, [...path, "left"], "boolean");
        expect(expr.right, [...path, "right"], "boolean");
        return { kind: "boolean" };
      case "eq":
      case "ne": {
        const left = check(expr.left, [...path, "left"], allowPre);
        const right = check(expr.right, [...path, "right"], allowPre);
        if (left && right && !same(left, right))
          issue(
            path,
            `${formatExpression(expr)} compares a ${left.kind} with a ${right.kind}.`,
          );
        // An enum variable may only be compared with its own values.
        for (const [side, other] of [
          [expr.left, expr.right],
          [expr.right, expr.left],
        ] as const) {
          const known = side.op === "var" ? variables.get(side.id) : undefined;
          if (
            known?.type === "enum" &&
            other.op === "lit" &&
            typeof other.value === "string" &&
            !known.values.includes(other.value)
          )
            issue(
              path,
              `"${other.value}" is not a value of ${known.id} (${known.values.join(", ")}).`,
            );
        }
        return { kind: "boolean" };
      }
    }
  }
  const boolean = (expr: Expr, path: (string | number)[], allowPre = false) => {
    try {
      assertShallow(expr);
    } catch (error) {
      issue(path, (error as Error).message);
      return;
    }
    const type = check(expr, path, allowPre);
    if (type && type.kind !== "boolean")
      issue(
        path,
        `${formatExpression(expr)} is a ${type.kind}, but a condition is needed.`,
      );
  };
  const effects = (list: readonly Effect[], path: (string | number)[]) => {
    const targets = new Set<string>();
    for (const [index, effect] of list.entries()) {
      const variable = variables.get(effect.variable);
      const at = [...path, index];
      if (!variable) {
        issue([...at, "variable"], `Unknown variable ${effect.variable}`);
        continue;
      }
      if (variable.scope !== "state")
        issue(
          [...at, "variable"],
          `${effect.variable} is a ${variable.scope} variable; only state variables can be updated.`,
        );
      if (targets.has(effect.variable))
        issue([...at, "variable"], `${effect.variable} is updated twice.`);
      targets.add(effect.variable);
      const type = check(effect.value, [...at, "value"], false);
      const expected = typeOfVariable(variable);
      if (type && type.kind !== expected.kind)
        issue(
          [...at, "value"],
          `${formatExpression(effect.value)} is a ${type.kind}, but ${effect.variable} is a ${expected.kind}.`,
        );
    }
  };

  if (spec.initial) boolean(spec.initial, ["initial"]);
  const states = new Set<string>();
  const workflows = new Map(spec.workflows.map((item) => [item.id, item]));
  spec.workflows.forEach((workflow, index) => {
    const at = ["workflows", index];
    for (const state of workflow.states ?? []) states.add(state);
    if (!workflow.entry.state && !workflow.entry.condition)
      issue([...at, "entry"], "A workflow entry needs a state or a condition.");
    if (!workflow.terminal.states?.length && !workflow.terminal.condition)
      issue(
        [...at, "terminal"],
        "A workflow terminal needs states or a condition.",
      );
    if (workflow.entry.condition)
      boolean(workflow.entry.condition, [...at, "entry", "condition"]);
    if (workflow.terminal.condition)
      boolean(workflow.terminal.condition, [...at, "terminal", "condition"]);
    if (workflow.states) {
      const declared = new Set(workflow.states);
      for (const state of [
        workflow.entry.state,
        ...(workflow.terminal.states ?? []),
      ])
        if (state && !declared.has(state))
          issue(at, `State ${state} is not in the states of ${workflow.id}.`);
    }
  });
  spec.transitions.forEach((transition, index) => {
    const at = ["transitions", index];
    for (const [position, item] of transition.preconditions.entries())
      boolean(item, [...at, "preconditions", position]);
    effects(transition.effects, [...at, "effects"]);
    states.add(transition.id);
    if (transition.workflow) {
      const workflow = workflows.get(transition.workflow);
      if (!workflow)
        issue([...at, "workflow"], `Unknown workflow ${transition.workflow}`);
      else if (workflow.states)
        for (const state of [transition.from, transition.to])
          if (state && !workflow.states.includes(state))
            issue(at, `State ${state} is not in the states of ${workflow.id}.`);
    }
  });
  spec.operations.forEach((operation, index) => {
    const at = ["operations", index];
    states.add(operation.id);
    for (const parameter of operation.parameters) {
      const variable = variables.get(parameter);
      if (!variable)
        issue([...at, "parameters"], `Unknown parameter variable ${parameter}`);
      else if (variable.scope !== "input")
        issue(
          [...at, "parameters"],
          `${parameter} is a ${variable.scope} variable; parameters must be input variables.`,
        );
    }
    for (const [position, item] of operation.preconditions.entries())
      boolean(item, [...at, "preconditions", position]);
    for (const [position, item] of operation.postconditions.entries())
      boolean(item, [...at, "postconditions", position], true);
    effects(operation.effects, [...at, "effects"]);
  });
  for (const [index, item] of spec.invariants.entries())
    boolean(item.expression, ["invariants", index, "expression"]);
  spec.permissions.forEach((item, index) => {
    if (item.constraint)
      boolean(item.constraint, ["permissions", index, "constraint"]);
    if (item.effect === "deny" && item.constraint)
      issue(
        ["permissions", index, "constraint"],
        "A deny permission is unconditional; remove the constraint or use allow.",
      );
  });
  for (const [index, item] of spec.dataPolicies.entries())
    boolean(item.rule, ["dataPolicies", index, "rule"]);
  spec.businessRules.forEach((item, index) => {
    boolean(item.when, ["businessRules", index, "when"]);
    boolean(item.must, ["businessRules", index, "must"]);
  });
  spec.temporalRules.forEach((item, index) => {
    for (const name of ["before", "after"] as const)
      if (!states.has(item[name]))
        issue(
          ["temporalRules", index, name],
          `${item[name]} is not a transition, operation or workflow state.`,
        );
  });
});
export type BehaviorSpec = z.infer<typeof BehaviorSpecSchema>;

export function parseBehaviorSpec(input: unknown): BehaviorSpec {
  return BehaviorSpecSchema.parse(input);
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => compare(a, b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
const byId = <T extends { id: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => compare(a.id, b.id));
const sortProvenance = <T extends { provenance: unknown[] }>(item: T): T => ({
  ...item,
  provenance: [...item.provenance].sort((a, b) =>
    compare(JSON.stringify(canonical(a)), JSON.stringify(canonical(b))),
  ),
});

/** Canonical form: collections and provenance sorted, so authoring order never matters. */
export function normalizeBehaviorSpec(input: unknown): BehaviorSpec {
  const spec = parseBehaviorSpec(input);
  return {
    ...spec,
    variables: byId(spec.variables),
    workflows: byId(spec.workflows).map(sortProvenance),
    transitions: byId(spec.transitions).map(sortProvenance),
    operations: byId(spec.operations).map(sortProvenance),
    invariants: byId(spec.invariants).map(sortProvenance),
    permissions: byId(spec.permissions).map(sortProvenance),
    temporalRules: byId(spec.temporalRules).map(sortProvenance),
    dataPolicies: byId(spec.dataPolicies).map(sortProvenance),
    businessRules: byId(spec.businessRules).map(sortProvenance),
  };
}
/** Deterministic, human-readable JSON with sorted keys and a trailing newline. */
export function serializeBehaviorSpec(input: unknown): string {
  return `${JSON.stringify(canonical(normalizeBehaviorSpec(input)), null, 2)}\n`;
}
/** `sha256:` hash of the canonical form. */
export function behaviorSpecHash(input: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(normalizeBehaviorSpec(input))))
    .digest("hex")}`;
}
