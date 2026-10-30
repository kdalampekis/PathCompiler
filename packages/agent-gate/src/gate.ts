import {
  type BehaviorSpec,
  type Expr,
  evaluateExpression,
  formatExpression,
  isHumanBacked,
  type Literal,
  type Provenance,
  variableUses,
  weakestConfidence,
} from "@pathcompiler/behavior-ir";
import {
  type Counterexample,
  findRoleVariable,
  type RuleBasis,
} from "@pathcompiler/verification";

/**
 * The runtime action gate. Before an agent executes an action, the gate
 * checks it against the specification **on the concrete values**: the
 * operation's preconditions, the permissions of the actor's role, every
 * applicable business rule and data policy, and the invariants of the state
 * the action would produce. No solver is involved: this is evaluation, so it
 * is fast and deterministic. What the gate cannot evaluate (a value it was not
 * given) is UNKNOWN, and the default policy is to block.
 */
export type Valuation = Readonly<Record<string, Literal>>;
export type ActionRequest = {
  operation: string;
  /** Operation parameters, by full ID (`refund.amount`) or short name (`amount`). */
  inputs?: Valuation;
  /** Who is acting and in what setting, by full ID (`actor.role`). */
  context?: Valuation;
  /** The relevant stored state, by full ID (`payments.original_amount`). */
  state?: Valuation;
};

export type ViolationKind =
  | "unknown_operation"
  | "invalid_value"
  | "precondition"
  | "permission"
  | "business_rule"
  | "data_policy"
  | "invariant_after"
  | "postcondition";
export type Violation = {
  kind: ViolationKind;
  /** The rule's ID when it has one. */
  id?: string;
  /** The rule, in expression text. */
  rule: string;
  /** In plain words, with the values that make it fail. */
  explanation: string;
  /** The values the rule was evaluated on. */
  because: Record<string, Literal>;
  basis?: RuleBasis;
  /** True when this violation alone blocks under the gate's enforcement policy. */
  enforced: boolean;
};
export type Unresolved = {
  kind: ViolationKind | "invariant_before";
  id?: string;
  rule: string;
  missing: string[];
};
export type ActionDecision = {
  decision: "PASS" | "BLOCK";
  /** VIOLATED, UNKNOWN (missing values) or VERIFIED. */
  status: "VERIFIED" | "VIOLATED" | "UNKNOWN";
  operation: string;
  violations: Violation[];
  unresolved: Unresolved[];
  /** Not blocking: unenforced violations, ignored values, rules the gate cannot check. */
  warnings: string[];
  /** The checked values, when a rule was violated. */
  counterexample?: Counterexample;
  /** One line for an agent or a log. */
  summary: string;
};

export type GateOptions = {
  /**
   * `all`: any violated rule blocks. `approved_only`: only violations of rules
   * a person approved block; the rest are warnings (for specifications whose
   * extracted rules are not trusted yet).
   */
  enforce?: "all" | "approved_only";
  /** What to do when a rule cannot be evaluated for lack of values. Default: block. */
  onUnknown?: "block" | "allow";
  /** What to do with an operation the specification does not describe. Default: block. */
  onUnmodeledOperation?: "block" | "allow";
  /** Context variable holding the role, when it cannot be found by name. */
  roleVariable?: string;
};

export interface ActionGate {
  readonly spec: BehaviorSpec;
  check(request: ActionRequest): ActionDecision;
}

const basisOf = (
  kind: string,
  id: string,
  text: string,
  provenance: readonly Provenance[],
): RuleBasis => ({
  id,
  kind,
  text,
  confidence: weakestConfidence(provenance),
  humanBacked: isHumanBacked(provenance),
  sources: provenance.map(
    (item) =>
      `${item.sourceType}${item.sourceFile ? ` ${item.sourceFile}${item.sourceLines ? `:${item.sourceLines}` : ""}` : ""}`,
  ),
});

const KIND_ORDER: ViolationKind[] = [
  "unknown_operation",
  "invalid_value",
  "permission",
  "business_rule",
  "data_policy",
  "invariant_after",
  "postcondition",
  "precondition",
];

export function createActionGate(
  spec: BehaviorSpec,
  options: GateOptions = {},
): ActionGate {
  const variables = new Map(spec.variables.map((item) => [item.id, item]));
  const enforceAll = (options.enforce ?? "all") === "all";
  return {
    spec,
    check(request): ActionDecision {
      const operation = spec.operations.find(
        (item) => item.id === request.operation,
      );
      const violations: Violation[] = [];
      const unresolved: Unresolved[] = [];
      const warnings: string[] = [];
      const finish = (
        extra: { counterexample?: Counterexample } = {},
      ): ActionDecision => {
        // Approved rules explain best, so they come first; then the kind of rule.
        violations.sort(
          (a, b) =>
            Number(b.basis?.humanBacked === true) -
              Number(a.basis?.humanBacked === true) ||
            KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
        );
        const blocking = violations.filter((item) => item.enforced);
        const needsInput = unresolved.length > 0;
        const decision: ActionDecision["decision"] =
          blocking.length > 0 ||
          (needsInput && (options.onUnknown ?? "block") === "block")
            ? "BLOCK"
            : "PASS";
        const status: ActionDecision["status"] =
          violations.length > 0
            ? "VIOLATED"
            : needsInput
              ? "UNKNOWN"
              : "VERIFIED";
        const summary =
          decision === "PASS"
            ? `PASS ${request.operation}: no rule is violated${warnings.length > 0 ? ` (${warnings.length} warning(s))` : ""}.`
            : blocking.length > 0
              ? `BLOCK ${request.operation}: ${blocking[0]?.explanation}${blocking.length > 1 ? ` (+${blocking.length - 1} more)` : ""}`
              : `BLOCK ${request.operation}: cannot be checked, missing ${[...new Set(unresolved.flatMap((item) => item.missing))].join(", ")}.`;
        return {
          decision,
          status,
          operation: request.operation,
          violations,
          unresolved,
          warnings,
          ...extra,
          summary,
        };
      };

      if (!operation) {
        const allowed = (options.onUnmodeledOperation ?? "block") === "allow";
        violations.push({
          kind: "unknown_operation",
          rule: request.operation,
          explanation: `${request.operation} is not an operation of the specification, so nothing says it is safe${allowed ? "" : "; unmodeled actions are blocked by policy"}.`,
          because: {},
          enforced: !allowed,
        });
        return finish();
      }

      // Inputs may use the short parameter name (`amount` for `refund.amount`).
      const values: Record<string, Literal> = {};
      const ignore = (id: string) =>
        warnings.push(
          `Ignored ${id}: it is not a variable of the specification.`,
        );
      const take = (
        given: Valuation | undefined,
        scope: "state" | "context" | "input",
        resolve: (name: string) => string,
      ) => {
        for (const [name, value] of Object.entries(given ?? {})) {
          const id = resolve(name);
          if (variables.get(id)?.scope === scope) values[id] = value;
          else ignore(name);
        }
      };
      take(request.state, "state", (name) => name);
      take(request.context, "context", (name) => name);
      take(request.inputs, "input", (name) =>
        variables.has(name) ? name : `${operation.id}.${name}`,
      );

      const record = (
        kind: ViolationKind,
        rule: string,
        explanation: string,
        because: Record<string, Literal>,
        basis: RuleBasis | undefined,
        id?: string,
      ) =>
        violations.push({
          kind,
          ...(id ? { id } : {}),
          rule,
          explanation,
          because,
          ...(basis ? { basis } : {}),
          enforced: enforceAll || basis?.humanBacked === true,
        });
      // Values have to be of the declared type and inside the declared domain.
      for (const [id, value] of Object.entries(values)) {
        const variable = variables.get(id);
        if (!variable) continue;
        const bad =
          variable.type === "boolean"
            ? typeof value !== "boolean"
            : variable.type === "integer"
              ? typeof value !== "number" ||
                !Number.isInteger(value) ||
                (variable.min !== undefined && value < variable.min) ||
                (variable.max !== undefined && value > variable.max)
              : variable.type === "enum"
                ? typeof value !== "string" || !variable.values.includes(value)
                : typeof value !== "string";
        if (bad)
          violations.push({
            kind: "invalid_value",
            id,
            rule: `${id} is ${variable.type === "enum" ? `one of ${variable.values.join(", ")}` : variable.type}`,
            explanation: `${id}=${JSON.stringify(value)} is not a valid ${variable.type}${variable.type === "enum" ? ` (${variable.values.join(", ")})` : ""}.`,
            because: { [id]: value },
            enforced: true,
          });
      }
      if (violations.length > 0) return finish();

      type Check = { kind: ViolationKind; id?: string; expr: Expr };
      /** True or false, or "unknown" (recorded in `unresolved`) when a value is missing. */
      const evaluate = (
        check: Check,
        state: Record<string, Literal>,
        pre: Record<string, Literal> = state,
      ): boolean | "unknown" => {
        const missing = [
          ...new Set(
            variableUses(check.expr)
              .filter((use) => (use.at ? pre : state)[use.id] === undefined)
              .map((use) => use.id),
          ),
        ];
        if (missing.length > 0) {
          unresolved.push({
            kind: check.kind,
            ...(check.id ? { id: check.id } : {}),
            rule: formatExpression(check.expr),
            missing,
          });
          return "unknown";
        }
        return evaluateExpression(check.expr, state, pre) === true;
      };
      const because = (expr: Expr, state: Record<string, Literal>) =>
        Object.fromEntries(
          variableUses(expr)
            .filter((use) => state[use.id] !== undefined)
            .map((use) => [use.id, state[use.id] as Literal]),
        );

      // 1. Preconditions: what the operation itself requires.
      const operationBasis = basisOf(
        "operation",
        operation.id,
        operation.id,
        operation.provenance,
      );
      for (const expr of operation.preconditions) {
        const text = formatExpression(expr);
        const ok = evaluate({ kind: "precondition", expr }, values);
        if (ok === false)
          record(
            "precondition",
            text,
            `${operation.id} requires ${text}, which is false${explain(because(expr, values))}.`,
            because(expr, values),
            operationBasis,
          );
      }

      // 2. Permissions of the acting role.
      for (const permission of spec.permissions) {
        if (permission.action !== operation.id) continue;
        const found = findRoleVariable(
          spec,
          permission.role,
          options.roleVariable,
        );
        if (!found.id) continue;
        if (values[found.id] === undefined) {
          unresolved.push({
            kind: "permission",
            id: permission.id,
            rule: `${permission.role} ${permission.effect} ${permission.action}`,
            missing: [found.id],
          });
          continue;
        }
        if (values[found.id] !== permission.role) continue;
        // An allow without a constraint grants access; there is nothing to check.
        if (permission.effect === "allow" && !permission.constraint) continue;
        const basis = basisOf(
          "permission",
          permission.id,
          permission.effect === "deny"
            ? `${permission.role} may never ${permission.action}`
            : `${permission.role} may ${permission.action} only when ${formatExpression(permission.constraint as Expr)}`,
          permission.provenance,
        );
        if (permission.effect === "deny")
          record(
            "permission",
            basis.text,
            `A ${permission.role} may never ${permission.action}.`,
            { [found.id]: permission.role },
            basis,
            permission.id,
          );
        else if (permission.constraint) {
          const ok = evaluate(
            {
              kind: "permission",
              id: permission.id,
              expr: permission.constraint,
            },
            values,
          );
          if (ok === false)
            record(
              "permission",
              basis.text,
              `A ${permission.role} may ${permission.action} only when ${formatExpression(permission.constraint)}, which is false${explain(because(permission.constraint, values))}.`,
              because(permission.constraint, values),
              basis,
              permission.id,
            );
        }
      }

      // 3. Business rules and data policies that apply to this operation.
      for (const rule of [...spec.businessRules, ...spec.dataPolicies]) {
        if (rule.appliesTo && !rule.appliesTo.includes(operation.id)) continue;
        const business = "must" in rule;
        const expr: Expr = business
          ? { op: "implies", left: rule.when, right: rule.must }
          : rule.rule;
        const text = business
          ? `${formatExpression(rule.when)} => ${formatExpression(rule.must)}`
          : formatExpression(rule.rule);
        const basis = basisOf(
          business ? "business rule" : "data policy",
          rule.id,
          text,
          rule.provenance,
        );
        const ok = evaluate(
          {
            kind: business ? "business_rule" : "data_policy",
            id: rule.id,
            expr,
          },
          values,
        );
        if (ok === false) {
          const shown = because(expr, values);
          record(
            business ? "business_rule" : "data_policy",
            text,
            `${rule.description ?? `Rule ${rule.id}`} (${text}) is violated${explain(shown)}.`,
            shown,
            basis,
            rule.id,
          );
        }
      }

      // 4. The state the action would produce.
      let after: Record<string, Literal> | undefined;
      if (operation.effects.length > 0) {
        const next: Record<string, Literal> = { ...values };
        let complete = true;
        for (const effect of operation.effects) {
          const missing = variableUses(effect.value)
            .filter((use) => values[use.id] === undefined)
            .map((use) => use.id);
          if (missing.length > 0) {
            complete = false;
            unresolved.push({
              kind: "invariant_after",
              rule: `${effect.variable} := ${formatExpression(effect.value)}`,
              missing: [...new Set(missing)],
            });
            continue;
          }
          next[effect.variable] = evaluateExpression(effect.value, values);
        }
        if (complete) after = next;
      }
      if (after) {
        const result = after;
        // Only invariants that mention something the action updates can break;
        // the rest held before and are unaffected (the frame).
        const updated = new Set(operation.effects.map((item) => item.variable));
        for (const invariant of spec.invariants) {
          if (
            !variableUses(invariant.expression).some((use) =>
              updated.has(use.id),
            )
          )
            continue;
          const text = formatExpression(invariant.expression);
          const ok = evaluate(
            {
              kind: "invariant_after",
              id: invariant.id,
              expr: invariant.expression,
            },
            result,
          );
          if (ok === false) {
            const shown = because(invariant.expression, result);
            record(
              "invariant_after",
              text,
              `After ${operation.id}, ${text} would be false${explain(shown)}.`,
              shown,
              basisOf("invariant", invariant.id, text, invariant.provenance),
              invariant.id,
            );
          }
        }
        for (const postcondition of operation.postconditions) {
          const ok = evaluate(
            { kind: "postcondition", expr: postcondition },
            result,
            values,
          );
          if (ok === false)
            record(
              "postcondition",
              formatExpression(postcondition),
              `${operation.id} promises ${formatExpression(postcondition)}, which would be false.`,
              because(postcondition, result),
              operationBasis,
            );
        }
      }
      if (spec.temporalRules.length > 0)
        warnings.push(
          `${spec.temporalRules.length} temporal rule(s) are not checked by the gate.`,
        );
      for (const item of operation.limitations ?? [])
        warnings.push(`Not modeled: ${item}`);
      for (const violation of violations)
        if (!violation.enforced)
          warnings.push(
            `Not enforced (the rule is not human-approved): ${violation.explanation}`,
          );

      const first = violations.find((item) => item.enforced) ?? violations[0];
      if (first) {
        const split = (scope: string) =>
          Object.fromEntries(
            Object.entries(values).filter(
              ([id]) => variables.get(id)?.scope === scope,
            ),
          );
        return finish({
          counterexample: {
            operation: operation.id,
            state: split("state"),
            inputs: split("input"),
            context: split("context"),
            ...(after
              ? {
                  after: Object.fromEntries(
                    Object.entries(after).filter(
                      ([id]) => variables.get(id)?.scope === "state",
                    ),
                  ),
                }
              : {}),
            violated: first.rule,
            replayed: true,
          },
        });
      }
      return finish();
    },
  };
}

/** `: refund.amount=6000, refund.manager_approval=false` */
function explain(values: Record<string, Literal>): string {
  const parts = Object.entries(values).map(
    ([id, value]) => `${id}=${JSON.stringify(value)}`,
  );
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}
