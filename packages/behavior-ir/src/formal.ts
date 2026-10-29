import {
  type FormalAction,
  type FormalExpr,
  type FormalProductModel,
  FormalProductModelSchema,
  type FormalTerm,
  normalizeFormalModel,
} from "@pathcompiler/formal-model";
import type { EvidenceRef } from "@pathcompiler/workflow-ir";
import type { Expr } from "./expression.js";
import { confidenceBand, type Provenance } from "./provenance.js";
import {
  type BehaviorSpec,
  BehaviorSpecSchema,
  type Effect,
  type Variable,
} from "./spec.js";

/**
 * Conversion between the Formal Product Model (the transition-system core
 * that UX reasoning, reachability and semantic change run on) and
 * BehaviorIR. The model's fragment (booleans, enums, bounded integers,
 * comparisons, assignments) converts losslessly in both directions; rule
 * kinds the model has no place for (operations, permissions, temporal rules,
 * data policies, business rules) are reported as omitted going back.
 */
const termToExpr = (term: FormalTerm): Expr =>
  term.type === "var"
    ? { op: "var", id: term.id }
    : { op: "lit", value: term.value };

function exprFromFormal(expr: FormalExpr): Expr {
  switch (expr.type) {
    case "bool":
      return { op: "lit", value: expr.value };
    case "var":
      return { op: "var", id: expr.id };
    case "not":
      return { op: "not", arg: exprFromFormal(expr.expr) };
    case "and":
    case "or":
      return expr.expressions.length === 1
        ? exprFromFormal(expr.expressions[0] as FormalExpr)
        : { op: expr.type, args: expr.expressions.map(exprFromFormal) };
    case "eq":
    case "lt":
    case "gt":
      return {
        op: expr.type,
        left: termToExpr(expr.left),
        right: termToExpr(expr.right),
      };
    case "lte":
      return {
        op: "le",
        left: termToExpr(expr.left),
        right: termToExpr(expr.right),
      };
    case "gte":
      return {
        op: "ge",
        left: termToExpr(expr.left),
        right: termToExpr(expr.right),
      };
  }
}

const SCORE_OF_BAND = { HIGH: 0.9, MEDIUM: 0.75, LOW: 0.5 } as const;
function provenanceOf(
  model: FormalProductModel,
  evidence: EvidenceRef[],
  score: number | undefined,
): Provenance {
  const handEncoded = model.metadata.source === "hand-encoded";
  return {
    sourceType: handEncoded ? "HUMAN_DECLARATION" : "SOURCE_CODE",
    origin: handEncoded ? "EXPLICIT" : "INFERRED",
    extractionMethod: handEncoded ? "HUMAN" : "FORMAL_MODEL",
    extractorVersion: model.metadata.extractorVersion,
    confidence:
      score === undefined
        ? handEncoded
          ? "HIGH"
          : "MEDIUM"
        : confidenceBand(score),
    ...(score === undefined ? {} : { score }),
    ...(handEncoded ? { declaredBy: "hand-encoded formal model" } : {}),
    evidence,
  };
}

export function fromFormalModel(input: unknown): BehaviorSpec {
  const model = normalizeFormalModel(input);
  const initial = exprFromFormal(model.initial);
  const variables: Variable[] = model.variables.map((variable): Variable => {
    const base = {
      id: variable.id,
      scope: variable.scope,
      ...(variable.description ? { description: variable.description } : {}),
      evidence: variable.evidence,
    };
    if (variable.type === "boolean") return { ...base, type: "boolean" };
    if (variable.type === "enum")
      return { ...base, type: "enum", values: [...variable.values] };
    if (variable.type === "integer")
      return {
        ...base,
        type: "integer",
        ...(variable.min === undefined ? {} : { min: variable.min }),
        ...(variable.max === undefined ? {} : { max: variable.max }),
      };
    return { ...base, type: "string" };
  });
  return BehaviorSpecSchema.parse({
    schemaVersion: 1,
    kind: "behavior-spec",
    id: model.id,
    metadata: {
      repositoryCommit: model.metadata.repositoryCommit,
      producer: `formal-model:${model.metadata.source}`,
      producerVersion: model.metadata.extractorVersion,
      ...(model.metadata.semanticModelVersion
        ? { semanticModelVersion: model.metadata.semanticModelVersion }
        : {}),
    },
    variables,
    initial,
    workflows: model.goals.map((goal) => ({
      id: goal.id,
      description: goal.businessMeaning,
      ...(goal.capabilityId ? { capabilityId: goal.capabilityId } : {}),
      entry: { condition: initial },
      terminal: { condition: exprFromFormal(goal.condition) },
      provenance: [provenanceOf(model, goal.evidence, goal.confidence)],
    })),
    transitions: model.actions.map((action) => ({
      id: action.id,
      ...(action.description ? { description: action.description } : {}),
      preconditions: [exprFromFormal(action.precondition)],
      effects: action.effects.map((effect) => ({
        variable: effect.variable,
        value: termToExpr(effect.value),
      })),
      ...(action.cost === undefined ? {} : { cost: action.cost }),
      ...(action.semanticTarget
        ? { semanticTarget: action.semanticTarget }
        : {}),
      ...(action.capabilityId ? { capabilityId: action.capabilityId } : {}),
      provenance: [provenanceOf(model, action.evidence, action.confidence)],
    })),
    operations: [],
    invariants: model.invariants.map((invariant) => ({
      id: invariant.id,
      description: invariant.description,
      expression: exprFromFormal(invariant.condition),
      provenance: [provenanceOf(model, invariant.evidence, undefined)],
    })),
    permissions: [],
    temporalRules: [],
    dataPolicies: [],
    businessRules: [],
  });
}

// --- Back to the Formal Product Model -------------------------------------------

export type OmittedItem = { kind: string; id: string; reason: string };
export type FormalConversion = {
  model: FormalProductModel;
  /** Everything the Formal Product Model cannot represent, with the reason. */
  omitted: OmittedItem[];
};
class Unsupported extends Error {}

export function toFormalModel(input: unknown): FormalConversion {
  const spec = BehaviorSpecSchema.parse(input);
  const variables = new Map(spec.variables.map((item) => [item.id, item]));
  const omitted: OmittedItem[] = [];

  const term = (expr: Expr): FormalTerm => {
    if (expr.op === "lit") return { type: "const", value: expr.value };
    if (expr.op === "var") {
      if (expr.at) throw new Unsupported("old() has no formal counterpart");
      const variable = variables.get(expr.id);
      if (variable?.scope === "input")
        throw new Unsupported(`${expr.id} is an input variable`);
      return { type: "var", id: expr.id };
    }
    throw new Unsupported("arithmetic is outside the Formal Product Model");
  };
  const formal = (expr: Expr): FormalExpr => {
    switch (expr.op) {
      case "lit":
        if (typeof expr.value !== "boolean")
          throw new Unsupported("a non-boolean literal used as a condition");
        return { type: "bool", value: expr.value };
      case "var":
        term(expr);
        return { type: "var", id: expr.id };
      case "not":
        return { type: "not", expr: formal(expr.arg) };
      case "and":
      case "or":
        return { type: expr.op, expressions: expr.args.map(formal) };
      case "implies":
        return {
          type: "or",
          expressions: [
            { type: "not", expr: formal(expr.left) },
            formal(expr.right),
          ],
        };
      case "ne":
        return {
          type: "not",
          expr: { type: "eq", left: term(expr.left), right: term(expr.right) },
        };
      case "eq":
      case "lt":
      case "gt":
        return {
          type: expr.op,
          left: term(expr.left),
          right: term(expr.right),
        };
      case "le":
        return { type: "lte", left: term(expr.left), right: term(expr.right) };
      case "ge":
        return { type: "gte", left: term(expr.left), right: term(expr.right) };
      default:
        throw new Unsupported("arithmetic is outside the Formal Product Model");
    }
  };
  const attempt = <T>(
    kind: string,
    id: string,
    build: () => T,
  ): T | undefined => {
    try {
      return build();
    } catch (error) {
      if (!(error instanceof Unsupported)) throw error;
      omitted.push({ kind, id, reason: error.message });
      return undefined;
    }
  };
  const all = (items: readonly Expr[]): FormalExpr =>
    items.length === 0
      ? { type: "bool", value: true }
      : items.length === 1
        ? formal(items[0] as Expr)
        : { type: "and", expressions: items.map(formal) };
  const evidenceOf = (
    id: string,
    records: readonly Provenance[],
  ): EvidenceRef[] => {
    const refs = records.flatMap((record) => record.evidence ?? []);
    if (refs.length > 0) return refs;
    const commit = spec.metadata.repositoryCommit ?? "unknown";
    return records.map((record) => ({
      id: `behavior:${id}`,
      type:
        record.sourceType === "TEST"
          ? ("test" as const)
          : record.sourceType === "HUMAN_DECLARATION"
            ? ("documentation" as const)
            : ("source_file" as const),
      locator: record.sourceFile
        ? `${record.sourceFile}${record.sourceLines ? `:${record.sourceLines}` : ""}`
        : `declared by ${record.declaredBy ?? "unknown"}`,
      repositoryCommit: commit,
    }));
  };
  const score = (records: readonly Provenance[]) =>
    records.find((record) => record.score !== undefined)?.score;

  const formalVariables = spec.variables.flatMap((variable) => {
    if (variable.scope === "input") {
      omitted.push({
        kind: "variable",
        id: variable.id,
        reason: "input variables have no formal counterpart",
      });
      return [];
    }
    const base = {
      id: variable.id,
      scope: variable.scope,
      ...(variable.description ? { description: variable.description } : {}),
      evidence: variable.evidence?.length
        ? variable.evidence
        : [
            {
              id: `behavior:${variable.id}`,
              type: "documentation" as const,
              locator: `variable ${variable.id}`,
              repositoryCommit: spec.metadata.repositoryCommit ?? "unknown",
            },
          ],
    };
    return [
      variable.type === "boolean"
        ? { ...base, type: "boolean" as const }
        : variable.type === "string"
          ? { ...base, type: "string" as const }
          : variable.type === "enum"
            ? { ...base, type: "enum" as const, values: [...variable.values] }
            : {
                ...base,
                type: "integer" as const,
                ...(variable.min === undefined ? {} : { min: variable.min }),
                ...(variable.max === undefined ? {} : { max: variable.max }),
              },
    ];
  });
  const actions = spec.transitions.flatMap((transition) => {
    const built = attempt("transition", transition.id, (): FormalAction => {
      if (transition.effects.length === 0)
        throw new Unsupported("the model needs at least one effect");
      return {
        id: transition.id,
        ...(transition.description
          ? { description: transition.description }
          : {}),
        precondition: all(transition.preconditions),
        effects: transition.effects.map((effect: Effect) => ({
          type: "assign" as const,
          variable: effect.variable,
          value: term(effect.value),
        })),
        ...(transition.cost === undefined ? {} : { cost: transition.cost }),
        ...(transition.semanticTarget
          ? { semanticTarget: transition.semanticTarget }
          : {}),
        ...(transition.capabilityId
          ? { capabilityId: transition.capabilityId }
          : {}),
        evidence: evidenceOf(transition.id, transition.provenance),
        ...(score(transition.provenance) === undefined
          ? {}
          : { confidence: score(transition.provenance) as number }),
      };
    });
    return built ? [built] : [];
  });
  const invariants = spec.invariants.flatMap((invariant) => {
    const built = attempt("invariant", invariant.id, () => ({
      id: invariant.id,
      description: invariant.description ?? invariant.id,
      condition: formal(invariant.expression),
      evidence: evidenceOf(invariant.id, invariant.provenance),
    }));
    return built ? [built] : [];
  });
  const goals = spec.workflows.flatMap((workflow) => {
    if (!workflow.terminal.condition) {
      omitted.push({
        kind: "workflow",
        id: workflow.id,
        reason: "named terminal states have no formal goal",
      });
      return [];
    }
    const condition = workflow.terminal.condition;
    const built = attempt("workflow", workflow.id, () => ({
      id: workflow.id,
      condition: formal(condition),
      businessMeaning: workflow.description ?? workflow.title ?? workflow.id,
      ...(workflow.capabilityId ? { capabilityId: workflow.capabilityId } : {}),
      evidence: evidenceOf(workflow.id, workflow.provenance),
      confidence:
        score(workflow.provenance) ??
        SCORE_OF_BAND[workflow.provenance[0]?.confidence ?? "LOW"],
    }));
    return built ? [built] : [];
  });
  for (const [kind, items] of [
    ["operation", spec.operations],
    ["permission", spec.permissions],
    ["temporal rule", spec.temporalRules],
    ["data policy", spec.dataPolicies],
    ["business rule", spec.businessRules],
  ] as const)
    for (const item of items)
      omitted.push({
        kind,
        id: item.id,
        reason: "verified by the verification layer, not the transition system",
      });

  const handEncoded = spec.metadata.producer === "formal-model:hand-encoded";
  const initial = spec.initial
    ? attempt("initial", "initial", () => formal(spec.initial as Expr))
    : undefined;
  const model = FormalProductModelSchema.parse({
    schemaVersion: 1,
    id: spec.id,
    metadata: {
      repositoryCommit: spec.metadata.repositoryCommit,
      source: handEncoded ? "hand-encoded" : "extracted",
      extractorVersion: spec.metadata.producerVersion,
      ...(spec.metadata.semanticModelVersion
        ? { semanticModelVersion: spec.metadata.semanticModelVersion }
        : {}),
    },
    variables: formalVariables,
    initial: initial ?? { type: "bool", value: true },
    actions,
    invariants,
    goals,
  });
  return { model: normalizeFormalModel(model), omitted };
}
