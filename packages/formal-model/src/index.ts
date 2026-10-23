import { createHash } from "node:crypto";
import { type EvidenceRef, EvidenceRefSchema } from "@pathcompiler/workflow-ir";
import { z } from "zod";

/**
 * Solver-independent Formal Product Model: a business-level abstraction of
 * application state, actions, invariants and goals. No solver types appear
 * here; reasoners translate this model into their own encodings.
 */
export const FORMAL_MODEL_SCHEMA_VERSION = 1;
const MAX_EXPRESSION_DEPTH = 32;

const id = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/,
    "IDs are lowercase dot-separated words, e.g. clients.submit_create",
  );
const text = z.string().trim().min(1);
const evidence = z.array(EvidenceRefSchema).min(1);
const confidence = z.number().min(0).max(1);

const variableBase = {
  id,
  description: text.optional(),
  /** `context`: fixed for a reasoning query (role, flags); `state`: changes via actions. */
  scope: z.enum(["state", "context"]),
  evidence,
};
export const FormalStateVariableSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...variableBase, type: z.literal("boolean") }),
  z.strictObject({
    ...variableBase,
    type: z.literal("enum"),
    values: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/)).min(1),
  }),
  z.strictObject({
    ...variableBase,
    type: z.literal("integer"),
    min: z.number().int().optional(),
    max: z.number().int().optional(),
  }),
  z.strictObject({ ...variableBase, type: z.literal("string") }),
]);
export type FormalStateVariable = z.infer<typeof FormalStateVariableSchema>;

export type FormalTerm =
  | { type: "var"; id: string }
  | { type: "const"; value: boolean | number | string };
export const FormalTermSchema: z.ZodType<FormalTerm> = z.discriminatedUnion(
  "type",
  [
    z.strictObject({ type: z.literal("var"), id }),
    z.strictObject({
      type: z.literal("const"),
      value: z.union([z.boolean(), z.number().int(), z.string()]),
    }),
  ],
);

type Comparison = "eq" | "lt" | "lte" | "gt" | "gte";
export type FormalExpr =
  | { type: "bool"; value: boolean }
  | { type: "var"; id: string }
  | { type: "not"; expr: FormalExpr }
  | { type: "and"; expressions: FormalExpr[] }
  | { type: "or"; expressions: FormalExpr[] }
  | { type: Comparison; left: FormalTerm; right: FormalTerm };
export const FormalExprSchema: z.ZodType<FormalExpr> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("bool"), value: z.boolean() }),
    z.strictObject({ type: z.literal("var"), id }),
    z.strictObject({ type: z.literal("not"), expr: FormalExprSchema }),
    z.strictObject({
      type: z.literal("and"),
      expressions: z.array(FormalExprSchema).min(1),
    }),
    z.strictObject({
      type: z.literal("or"),
      expressions: z.array(FormalExprSchema).min(1),
    }),
    ...(["eq", "lt", "lte", "gt", "gte"] as const).map((type) =>
      z.strictObject({
        type: z.literal(type),
        left: FormalTermSchema,
        right: FormalTermSchema,
      }),
    ),
  ]),
);

/** Effects assign a state variable from a constant or another variable's pre-state value. */
export const FormalEffectSchema = z.strictObject({
  type: z.literal("assign"),
  variable: id,
  value: FormalTermSchema,
});
export type FormalEffect = z.infer<typeof FormalEffectSchema>;

export const FormalActionSchema = z.strictObject({
  id,
  description: text.optional(),
  precondition: FormalExprSchema,
  effects: z.array(FormalEffectSchema).min(1),
  /** Non-negative interaction cost; defaults to 1 when reasoning about effort. */
  cost: z.number().nonnegative().optional(),
  /** `data-pathcompiler` semantic target the user operates, when the action has one. */
  semanticTarget: text.optional(),
  capabilityId: text.optional(),
  evidence,
  confidence: confidence.optional(),
});
export type FormalAction = z.infer<typeof FormalActionSchema>;

export const FormalInvariantSchema = z.strictObject({
  id,
  description: text,
  condition: FormalExprSchema,
  evidence,
});
export type FormalInvariant = z.infer<typeof FormalInvariantSchema>;

export const FormalGoalSchema = z.strictObject({
  id,
  condition: FormalExprSchema,
  businessMeaning: text,
  capabilityId: text.optional(),
  evidence,
  confidence,
});
export type FormalGoal = z.infer<typeof FormalGoalSchema>;

const ModelShape = z.strictObject({
  schemaVersion: z.literal(FORMAL_MODEL_SCHEMA_VERSION),
  id,
  metadata: z.strictObject({
    /** Commit the model describes; null for models not bound to a scan. */
    repositoryCommit: text.nullable(),
    /** `hand-encoded` reference models or the extractor that produced the model. */
    source: z.enum(["hand-encoded", "extracted"]),
    extractorVersion: text,
    semanticModelVersion: text.optional(),
  }),
  variables: z.array(FormalStateVariableSchema).min(1),
  /** Admissible initial states; context variables are usually left unconstrained. */
  initial: FormalExprSchema,
  actions: z.array(FormalActionSchema),
  invariants: z.array(FormalInvariantSchema),
  goals: z.array(FormalGoalSchema),
});

type ValueType =
  | { type: "boolean" }
  | { type: "integer"; min?: number | undefined; max?: number | undefined }
  | { type: "string" }
  | { type: "enum"; values: string[]; variable: string };

/** Validates structure, unique IDs, references and types of every expression and effect. */
export const FormalProductModelSchema = ModelShape.superRefine(
  (model, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    for (const key of [
      "variables",
      "actions",
      "invariants",
      "goals",
    ] as const) {
      const seen = new Set<string>();
      model[key].forEach((item, index) => {
        if (seen.has(item.id))
          issue([key, index, "id"], `Duplicate ${key} ID: ${item.id}`);
        seen.add(item.id);
      });
    }
    const variables = new Map(model.variables.map((item) => [item.id, item]));
    model.variables.forEach((variable, index) => {
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

    function termType(
      term: FormalTerm,
      path: (string | number)[],
    ): ValueType | "literal-string" | null {
      if (term.type === "var") {
        const variable = variables.get(term.id);
        if (!variable) {
          issue(path, `Unknown variable: ${term.id}`);
          return null;
        }
        return variable.type === "enum"
          ? { type: "enum", values: variable.values, variable: variable.id }
          : variable.type === "integer"
            ? { type: "integer", min: variable.min, max: variable.max }
            : { type: variable.type };
      }
      if (typeof term.value === "boolean") return { type: "boolean" };
      if (typeof term.value === "number") return { type: "integer" };
      return "literal-string";
    }
    /** Checks that two terms are comparable; string literals adapt to enum or string types. */
    function compatible(
      left: FormalTerm,
      right: FormalTerm,
      path: (string | number)[],
      ordered: boolean,
    ) {
      const a = termType(left, [...path, "left"]);
      const b = termType(right, [...path, "right"]);
      if (!a || !b) return;
      const literal = (term: FormalTerm) =>
        term.type === "const" && typeof term.value === "string"
          ? term.value
          : null;
      const resolve = (
        type: ValueType | "literal-string",
        other: ValueType | "literal-string",
      ) =>
        type === "literal-string"
          ? other !== "literal-string" && other.type === "enum"
            ? other
            : ({ type: "string" } as const)
          : type;
      const x = resolve(a, b);
      const y = resolve(b, a);
      if (x.type !== y.type) {
        issue(path, `Cannot compare ${x.type} with ${y.type}`);
        return;
      }
      if (ordered && x.type !== "integer") {
        issue(path, `Ordering comparisons need integers, not ${x.type}`);
        return;
      }
      for (const [type, term, side] of [
        [x, left, "left"],
        [y, right, "right"],
      ] as const)
        if (type.type === "enum") {
          const value = literal(term);
          if (value !== null && !type.values.includes(value))
            issue(
              [...path, side],
              `${value} is not a value of ${type.variable}`,
            );
        }
      for (const [type, other] of [
        [x, right],
        [y, left],
      ] as const)
        if (
          type.type === "integer" &&
          other.type === "const" &&
          typeof other.value === "number"
        ) {
          if (
            (type.min !== undefined && other.value < type.min) ||
            (type.max !== undefined && other.value > type.max)
          )
            issue(
              path,
              `${other.value} is outside the variable's integer range`,
            );
        }
    }
    function check(expr: FormalExpr, path: (string | number)[], depth: number) {
      if (depth > MAX_EXPRESSION_DEPTH) {
        issue(path, `Expression nesting exceeds ${MAX_EXPRESSION_DEPTH}`);
        return;
      }
      switch (expr.type) {
        case "bool":
          return;
        case "var": {
          const variable = variables.get(expr.id);
          if (!variable) issue(path, `Unknown variable: ${expr.id}`);
          else if (variable.type !== "boolean")
            issue(
              path,
              `${expr.id} is ${variable.type}; compare it with eq instead`,
            );
          return;
        }
        case "not":
          return check(expr.expr, [...path, "expr"], depth + 1);
        case "and":
        case "or":
          for (const [index, item] of expr.expressions.entries())
            check(item, [...path, "expressions", index], depth + 1);
          return;
        default:
          compatible(expr.left, expr.right, path, expr.type !== "eq");
      }
    }
    check(model.initial, ["initial"], 0);
    model.actions.forEach((action, index) => {
      check(action.precondition, ["actions", index, "precondition"], 0);
      const assigned = new Set<string>();
      action.effects.forEach((effect, effectIndex) => {
        const path = ["actions", index, "effects", effectIndex];
        const variable = variables.get(effect.variable);
        if (!variable) {
          issue(path, `Unknown variable: ${effect.variable}`);
          return;
        }
        if (variable.scope === "context")
          issue(
            path,
            `${variable.id} is a context variable and cannot be assigned`,
          );
        if (assigned.has(variable.id))
          issue(
            path,
            `${variable.id} is assigned more than once by ${action.id}`,
          );
        assigned.add(variable.id);
        compatible({ type: "var", id: variable.id }, effect.value, path, false);
      });
    });
    for (const [index, invariant] of model.invariants.entries())
      check(invariant.condition, ["invariants", index, "condition"], 0);
    for (const [index, goal] of model.goals.entries())
      check(goal.condition, ["goals", index, "condition"], 0);
  },
);
export type FormalProductModel = z.infer<typeof FormalProductModelSchema>;

export function parseFormalModel(input: unknown): FormalProductModel {
  return FormalProductModelSchema.parse(input);
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byId = <T extends { id: string }>(items: T[]) =>
  [...items].sort((a, b) => compare(a.id, b.id));
const sortEvidence = (refs: EvidenceRef[]) =>
  [...refs].sort(
    (a, b) => compare(a.id, b.id) || compare(a.locator, b.locator),
  );

/**
 * Canonical form: named collections and evidence sorted by ID, so authoring
 * order never changes serialization or hash. Expression operand order is kept.
 */
export function normalizeFormalModel(input: unknown): FormalProductModel {
  const model = parseFormalModel(input);
  const withEvidence = <T extends { evidence: EvidenceRef[] }>(item: T): T => ({
    ...item,
    evidence: sortEvidence(item.evidence),
  });
  return {
    ...model,
    variables: byId(model.variables).map((variable) =>
      variable.type === "enum"
        ? withEvidence({ ...variable, values: [...variable.values] })
        : withEvidence(variable),
    ),
    actions: byId(model.actions).map(withEvidence),
    invariants: byId(model.invariants).map(withEvidence),
    goals: byId(model.goals).map(withEvidence),
  };
}

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

/** Deterministic, human-readable JSON with sorted keys and a trailing newline. */
export function serializeFormalModel(input: unknown): string {
  return `${JSON.stringify(canonical(normalizeFormalModel(input)), null, 2)}\n`;
}

/** `sha256:` hash of the canonical model; equal for equivalent authoring orders. */
export function formalModelHash(input: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(normalizeFormalModel(input))))
    .digest("hex")}`;
}

/** Every evidence reference with the formal object that cites it. */
export function collectFormalEvidence(
  input: unknown,
): { owner: string; ref: EvidenceRef }[] {
  const model = parseFormalModel(input);
  return [
    ...model.variables.map((item) => ["variable", item] as const),
    ...model.actions.map((item) => ["action", item] as const),
    ...model.invariants.map((item) => ["invariant", item] as const),
    ...model.goals.map((item) => ["goal", item] as const),
  ].flatMap(([kind, item]) =>
    item.evidence.map((ref) => ({ owner: `${kind}:${item.id}`, ref })),
  );
}

/** Small constructors that keep hand-encoded models readable. */
export const f = {
  bool: (value: boolean): FormalExpr => ({ type: "bool", value }),
  var: (variable: string): FormalExpr => ({ type: "var", id: variable }),
  not: (expr: FormalExpr): FormalExpr => ({ type: "not", expr }),
  and: (...expressions: FormalExpr[]): FormalExpr => ({
    type: "and",
    expressions,
  }),
  or: (...expressions: FormalExpr[]): FormalExpr => ({
    type: "or",
    expressions,
  }),
  /** `a → b`, encoded as `¬a ∨ b`. */
  implies: (a: FormalExpr, b: FormalExpr): FormalExpr => ({
    type: "or",
    expressions: [{ type: "not", expr: a }, b],
  }),
  eq: (left: FormalTerm, right: FormalTerm): FormalExpr => ({
    type: "eq",
    left,
    right,
  }),
  neq: (left: FormalTerm, right: FormalTerm): FormalExpr => ({
    type: "not",
    expr: { type: "eq", left, right },
  }),
  /** `variable == value` for a constant value. */
  is: (variable: string, value: boolean | number | string): FormalExpr => ({
    type: "eq",
    left: { type: "var", id: variable },
    right: { type: "const", value },
  }),
  ref: (variable: string): FormalTerm => ({ type: "var", id: variable }),
  lit: (value: boolean | number | string): FormalTerm => ({
    type: "const",
    value,
  }),
  set: (
    variable: string,
    value: boolean | number | string | FormalTerm,
  ): FormalEffect => ({
    type: "assign",
    variable,
    value: typeof value === "object" ? value : { type: "const", value },
  }),
};
