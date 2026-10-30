import {
  type BusinessRule,
  type DataPolicy,
  type Expr,
  evaluateExpression,
  formatExpression,
  type Invariant,
  isHumanBacked,
  type Literal,
  type Operation,
  type Permission,
  type Provenance,
  variableUses,
  weakestConfidence,
} from "@pathcompiler/behavior-ir";
import type { SolverProvider, SolverTerm } from "@pathcompiler/solver-provider";
import { Encoding, FRAGMENT, int, UnsupportedFragment } from "./encode.js";
import { findRoleVariable } from "./roles.js";
import type {
  Counterexample,
  RuleBasis,
  SupportDecision,
  VerificationProperty,
  VerificationResult,
  Verifier,
  VerifyOptions,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;

type Valuation = Record<string, Literal>;
/** A property compiled to a satisfiability question plus a way to replay its answer. */
type Plan = {
  operation: Operation;
  basis?: RuleBasis;
  withPost: boolean;
  assertions: SolverTerm[];
  /** Constraints under which the operation can run at all, to detect vacuous proofs. */
  runnable: SolverTerm[];
  /** The thing a counterexample violates, as text. */
  violated: string;
  /** Re-evaluates a candidate counterexample with the IR evaluator. */
  confirm(state: Valuation, after: Valuation | undefined): boolean;
  caveats: string[];
};

const sourceOf = (item: Provenance) =>
  `${item.sourceType}${item.sourceFile ? ` ${item.sourceFile}${item.sourceLines ? `:${item.sourceLines}` : ""}` : ""}`;
function basisOf(
  kind: string,
  id: string,
  text: string,
  provenance: readonly Provenance[],
): RuleBasis {
  return {
    id,
    kind,
    text,
    confidence: weakestConfidence(provenance),
    humanBacked: isHumanBacked(provenance),
    sources: provenance.map(sourceOf),
  };
}

/** Compiles a property, or throws UnsupportedFragment saying why not. */
function plan(
  encoding: Encoding,
  property: VerificationProperty,
  options: VerifyOptions & { roleVariable?: string },
): Plan {
  const spec = encoding.spec;
  const operation = spec.operations.find(
    (item) => item.id === property.operation,
  );
  if (!operation)
    throw new UnsupportedFragment(
      `There is no operation ${property.operation} in the specification.`,
    );
  const caveats: string[] = [];
  const invariants = spec.invariants;
  const holds = (expr: Expr, state: Valuation, pre: Valuation = state) =>
    evaluateExpression(expr, state, pre) === true;
  const inDomain = (state: Valuation) =>
    spec.variables.every((variable) => {
      const value = state[variable.id];
      if (value === undefined) return false;
      if (variable.type === "integer")
        return (
          typeof value === "number" &&
          (variable.min === undefined || value >= variable.min) &&
          (variable.max === undefined || value <= variable.max)
        );
      if (variable.type === "enum")
        return variable.values.includes(String(value));
      return true;
    });
  /** The state a step ends in, computed from the effects alone. */
  const apply = (state: Valuation): Valuation | undefined => {
    if (operation.effects.length === 0) return undefined;
    const after: Valuation = { ...state };
    for (const effect of operation.effects)
      after[effect.variable] = evaluateExpression(effect.value, state);
    return after;
  };
  const startsValid = (state: Valuation) =>
    inDomain(state) &&
    invariants.every((item) => holds(item.expression, state)) &&
    operation.preconditions.every((item) => holds(item, state));
  const common = (withPost: boolean): SolverTerm[] => [
    ...encoding.domain("pre"),
    ...(withPost ? encoding.domain("post") : []),
    ...invariants.map((item) => encoding.term(item.expression, false)),
    ...operation.preconditions.map((item) => encoding.term(item, false)),
  ];
  const find = <T extends { id: string }>(list: readonly T[], id: string) =>
    list.find((item) => item.id === id);

  switch (property.kind) {
    case "invariant_preserved": {
      const invariant = find<Invariant>(invariants, property.invariant);
      if (!invariant)
        throw new UnsupportedFragment(
          `There is no invariant ${property.invariant}.`,
        );
      const text = formatExpression(invariant.expression);
      caveats.push(
        "The starting state satisfies every invariant, but it may not be reachable from the initial state.",
      );
      return {
        operation,
        basis: basisOf("invariant", invariant.id, text, invariant.provenance),
        withPost: true,
        runnable: common(false),
        assertions: [
          ...common(true),
          ...encoding.transition(operation),
          { op: "not", arg: encoding.term(invariant.expression, true) },
        ],
        violated: text,
        caveats,
        confirm(state, after) {
          if (!startsValid(state)) return false;
          const next = apply(state) ?? after;
          if (!next) return false;
          const pre = state;
          const post = { ...state, ...next };
          return (
            operation.postconditions.every((item) => holds(item, post, pre)) &&
            !holds(invariant.expression, post)
          );
        },
      };
    }
    case "rule_enforced": {
      const rule: BusinessRule | DataPolicy | undefined =
        find<BusinessRule>(spec.businessRules, property.rule) ??
        find<DataPolicy>(spec.dataPolicies, property.rule);
      if (!rule)
        throw new UnsupportedFragment(
          `There is no business rule or data policy ${property.rule}.`,
        );
      if (rule.appliesTo && !rule.appliesTo.includes(operation.id))
        throw new UnsupportedFragment(
          `${rule.id} applies to ${rule.appliesTo.join(", ")}, not to ${operation.id}.`,
        );
      const isBusiness = "must" in rule;
      const text = isBusiness
        ? `${formatExpression(rule.when)} => ${formatExpression(rule.must)}`
        : formatExpression(rule.rule);
      const violation: SolverTerm = isBusiness
        ? {
            op: "and",
            args: [
              encoding.term(rule.when, false),
              { op: "not", arg: encoding.term(rule.must, false) },
            ],
          }
        : { op: "not", arg: encoding.term(rule.rule, false) };
      return {
        operation,
        basis: basisOf(
          isBusiness ? "business rule" : "data policy",
          rule.id,
          text,
          rule.provenance,
        ),
        withPost: false,
        runnable: common(false),
        assertions: [...common(false), violation],
        violated: text,
        caveats,
        confirm(state) {
          if (!startsValid(state)) return false;
          return isBusiness
            ? holds(rule.when, state) && !holds(rule.must, state)
            : !holds(rule.rule, state);
        },
      };
    }
    case "permission_enforced": {
      const permission: Permission | undefined = find(
        spec.permissions,
        property.permission,
      );
      if (!permission)
        throw new UnsupportedFragment(
          `There is no permission ${property.permission}.`,
        );
      if (permission.action !== operation.id)
        throw new UnsupportedFragment(
          `${permission.id} is about ${permission.action}, not ${operation.id}.`,
        );
      if (permission.effect === "allow" && !permission.constraint)
        throw new UnsupportedFragment(
          "An unconstrained allow permission grants access; there is nothing to enforce.",
        );
      const found = findRoleVariable(
        spec,
        permission.role,
        options.roleVariable,
      );
      if (!found.id) throw new UnsupportedFragment(found.reason);
      const roleVariable = found.id;
      const isRole = (state: Valuation) =>
        state[roleVariable] === permission.role;
      const text =
        permission.effect === "deny"
          ? `${permission.role} may never ${permission.action}`
          : `${permission.role} may ${permission.action} only when ${formatExpression(permission.constraint as Expr)}`;
      return {
        operation,
        basis: basisOf(
          "permission",
          permission.id,
          text,
          permission.provenance,
        ),
        withPost: false,
        runnable: common(false),
        assertions: [
          ...common(false),
          {
            op: "eq",
            left: { op: "var", name: roleVariable },
            right: int(encoding.interned.get(permission.role) as number),
          },
          ...(permission.constraint
            ? [
                {
                  op: "not" as const,
                  arg: encoding.term(permission.constraint, false),
                },
              ]
            : []),
        ],
        violated: text,
        caveats,
        confirm(state) {
          if (!startsValid(state) || !isRole(state)) return false;
          return permission.constraint
            ? !holds(permission.constraint, state)
            : true;
        },
      };
    }
    case "postconditions_guaranteed": {
      if (
        operation.effects.length === 0 ||
        operation.postconditions.length === 0
      )
        throw new UnsupportedFragment(
          "Only an operation with both effects and postconditions has postconditions to check; otherwise they define the step.",
        );
      return {
        operation,
        withPost: true,
        runnable: common(false),
        assertions: [
          ...common(true),
          ...encoding.transition(operation, false),
          {
            op: "not",
            arg: {
              op: "and",
              args: operation.postconditions.map((item) =>
                encoding.term(item, true),
              ),
            },
          },
        ],
        violated: operation.postconditions.map(formatExpression).join(" && "),
        caveats,
        confirm(state) {
          if (!startsValid(state)) return false;
          const next = apply(state);
          if (!next) return false;
          return !operation.postconditions.every((item) =>
            holds(item, next, state),
          );
        },
      };
    }
  }
}

export type SmtVerifierOptions = {
  roleVariable?: string;
};

/**
 * SMT backend. Compiles a property into a satisfiability question over the
 * solver-neutral language, asks the provider, and — for a violation — replays
 * the model with the specification's own evaluator. A violation that does not
 * replay is reported UNKNOWN, never VIOLATED.
 */
export function createSmtVerifier(
  solver: SolverProvider,
  config: SmtVerifierOptions = {},
): Verifier {
  const name = `smt (${solver.name})`;
  return {
    name,
    fragment: FRAGMENT,
    supports(property, spec): SupportDecision {
      try {
        plan(new Encoding(spec), property, config);
        return { supported: true };
      } catch (error) {
        if (error instanceof UnsupportedFragment)
          return { supported: false, reason: error.message };
        throw error;
      }
    },
    async verify(property, spec, options = {}): Promise<VerificationResult> {
      const started = performance.now();
      const base = { property, verifier: name, fragment: FRAGMENT };
      const finish = (
        fields: Pick<VerificationResult, "status"> &
          Partial<VerificationResult>,
      ): VerificationResult => ({
        ...base,
        caveats: [],
        ...fields,
        elapsedMs: Math.round(performance.now() - started),
      });
      const encoding = new Encoding(spec);
      let compiled: Plan;
      try {
        compiled = plan(encoding, property, { ...options, ...config });
      } catch (error) {
        if (error instanceof UnsupportedFragment)
          return finish({ status: "UNSUPPORTED", reason: error.message });
        throw error;
      }
      const limitations = compiled.operation.limitations ?? [];
      const note = (violated: boolean) => {
        const caveats = [...compiled.caveats];
        if (limitations.length > 0)
          caveats.push(
            violated
              ? `${compiled.operation.id} has ${limitations.length} construct(s) the extractor did not model, so its preconditions may be weaker than the code and this violation may not be possible in the real system.`
              : `${compiled.operation.id} has ${limitations.length} construct(s) the extractor did not model; any effects among them are not covered by this result.`,
          );
        if (compiled.basis && !compiled.basis.humanBacked)
          caveats.push(
            `${compiled.basis.id} is an extracted candidate (${compiled.basis.confidence} confidence), not an approved requirement; the result is only as good as the rule.`,
          );
        return caveats;
      };
      const result = await solver.check({
        variables: encoding.declarations(),
        assertions: compiled.assertions,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      const common = {
        ...(compiled.basis ? { rule: compiled.basis } : {}),
      };
      if (result.status === "unknown")
        return finish({
          status: "UNKNOWN",
          reason: result.reason,
          ...common,
          caveats: note(false),
        });
      if (result.status === "unsat") {
        // A proof is vacuous if the operation can never run at all.
        const reachable = await solver.check({
          variables: encoding.declarations(),
          assertions: compiled.runnable,
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });
        const caveats = note(false);
        if (reachable.status === "unsat")
          caveats.push(
            `Vacuous: no state satisfies the invariants and the preconditions of ${compiled.operation.id}, so it can never run and every property of it holds trivially. The specification is probably contradictory.`,
          );
        return finish({ status: "VERIFIED", ...common, caveats });
      }

      const state: Valuation = {};
      const inputs: Valuation = {};
      const context: Valuation = {};
      const after: Valuation = {};
      for (const variable of spec.variables) {
        const value = encoding.literal(
          variable.id,
          result.model[variable.id] as boolean | number,
        );
        (variable.scope === "state"
          ? state
          : variable.scope === "input"
            ? inputs
            : context)[variable.id] = value;
        if (compiled.withPost && variable.scope === "state")
          after[variable.id] = encoding.literal(
            variable.id,
            result.model[`${variable.id}'`] as boolean | number,
          );
      }
      const pre: Valuation = { ...state, ...inputs, ...context };
      const post: Valuation | undefined = compiled.withPost
        ? { ...inputs, ...context, ...after }
        : undefined;
      let confirmed = false;
      try {
        confirmed = compiled.confirm(pre, post);
      } catch {
        confirmed = false;
      }
      if (!confirmed)
        return finish({
          status: "UNKNOWN",
          reason:
            "The solver found a counterexample but re-evaluating the specification on it disagreed, so it is not reported as a violation (an encoding problem).",
          ...common,
          caveats: note(false),
        });
      // The variables the violated rule talks about, plus those of any
      // precondition or effect connected to them (sharing a variable): the
      // rest of the valuation is noise for whoever reads the counterexample.
      const mentions = (text: string, id: string) =>
        new RegExp(
          `(^|[^a-z0-9_.])${id.replace(/\./g, "\\.")}($|[^a-z0-9_])`,
        ).test(text);
      const core = new Set(
        spec.variables
          .map((variable) => variable.id)
          .filter((id) => mentions(compiled.violated, id)),
      );
      const connected: string[][] = [
        ...compiled.operation.preconditions.map((item) =>
          variableUses(item).map((use) => use.id),
        ),
        ...compiled.operation.effects.map((effect) => [
          effect.variable,
          ...variableUses(effect.value).map((use) => use.id),
        ]),
      ];
      const relevant = new Set(core);
      for (const group of connected)
        if (group.some((id) => core.has(id)))
          for (const id of group) relevant.add(id);
      const counterexample: Counterexample = {
        operation: compiled.operation.id,
        state,
        inputs,
        context,
        ...(compiled.withPost ? { after } : {}),
        violated: compiled.violated,
        replayed: true,
        relevant: [...relevant].sort(),
      };
      return finish({
        status: "VIOLATED",
        ...common,
        counterexample,
        caveats: note(true),
      });
    },
  };
}
