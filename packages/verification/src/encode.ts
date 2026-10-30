import {
  type BehaviorSpec,
  type Expr,
  isLinear,
  type Literal,
  type Operation,
  type Variable,
} from "@pathcompiler/behavior-ir";
import type { SolverSort, SolverTerm } from "@pathcompiler/solver-provider";

/** Thrown when a spec uses something outside the supported fragment. */
export class UnsupportedFragment extends Error {
  override name = "UnsupportedFragment";
}

export const FRAGMENT =
  "linear integer arithmetic over booleans, bounded integers, finite enums and string equality; one execution of one operation, from any state satisfying the invariants";

const walk = (expr: Expr, visit: (item: Expr) => void) => {
  visit(expr);
  if (expr.op === "not") walk(expr.arg, visit);
  else if ("args" in expr) for (const arg of expr.args) walk(arg, visit);
  else if ("left" in expr) {
    walk(expr.left, visit);
    walk(expr.right, visit);
  }
};

/**
 * Encodes BehaviorIR into solver-neutral terms. Strings and enum values are
 * interned as integers (equality is all the language allows on them), so no
 * string theory is needed. Variables exist at two times: the state before
 * (`pre`) and after (`post`) an operation; inputs and context do not change.
 */
export class Encoding {
  readonly variables: Map<string, Variable>;
  readonly interned = new Map<string, number>();
  private readonly byId = new Map<number, string>();

  constructor(readonly spec: BehaviorSpec) {
    this.variables = new Map(spec.variables.map((item) => [item.id, item]));
    const words = new Set<string>();
    for (const variable of spec.variables)
      if (variable.type === "enum")
        for (const v of variable.values) words.add(v);
    const exprs = [
      ...spec.invariants.map((item) => item.expression),
      ...spec.operations.flatMap((item) => [
        ...item.preconditions,
        ...item.postconditions,
        ...item.effects.map((effect) => effect.value),
      ]),
      ...spec.businessRules.flatMap((item) => [item.when, item.must]),
      ...spec.dataPolicies.map((item) => item.rule),
      ...spec.permissions.flatMap((item) =>
        item.constraint ? [item.constraint] : [],
      ),
    ];
    for (const expr of exprs)
      walk(expr, (item) => {
        if (item.op === "lit" && typeof item.value === "string")
          words.add(item.value);
      });
    for (const [index, word] of [...words].sort().entries()) {
      this.interned.set(word, index + 1);
      this.byId.set(index + 1, word);
    }
  }

  name(id: string, when: "pre" | "post"): string {
    const variable = this.variables.get(id);
    return when === "post" && variable?.scope === "state" ? `${id}'` : id;
  }
  sort(id: string): SolverSort {
    return this.variables.get(id)?.type === "boolean" ? "bool" : "int";
  }

  /** Every variable at the times it exists. */
  declarations(): { name: string; sort: SolverSort }[] {
    const list: { name: string; sort: SolverSort }[] = [];
    for (const variable of this.spec.variables) {
      list.push({ name: variable.id, sort: this.sort(variable.id) });
      if (variable.scope === "state")
        list.push({ name: `${variable.id}'`, sort: this.sort(variable.id) });
    }
    return list;
  }

  /** Domain constraints of the variables that exist at `when`. */
  domain(when: "pre" | "post"): SolverTerm[] {
    const terms: SolverTerm[] = [];
    for (const variable of this.spec.variables) {
      if (when === "post" && variable.scope !== "state") continue;
      const v: SolverTerm = { op: "var", name: this.name(variable.id, when) };
      if (variable.type === "integer") {
        if (variable.min !== undefined)
          terms.push({ op: "le", left: int(variable.min), right: v });
        if (variable.max !== undefined)
          terms.push({ op: "le", left: v, right: int(variable.max) });
      } else if (variable.type === "enum")
        terms.push({
          op: "or",
          args: variable.values.map((value) => ({
            op: "eq",
            left: v,
            right: int(this.id(value)),
          })),
        });
    }
    return terms;
  }

  private id(word: string): number {
    const id = this.interned.get(word);
    if (id === undefined)
      throw new UnsupportedFragment(`Unknown value "${word}"`);
    return id;
  }

  /**
   * `post` selects which state a plain variable refers to; `old(x)` always
   * means the pre-state.
   */
  term(expr: Expr, post: boolean): SolverTerm {
    if (!isLinear(expr))
      throw new UnsupportedFragment(
        "a product of variables (nonlinear arithmetic)",
      );
    const go = (item: Expr): SolverTerm => {
      switch (item.op) {
        case "lit":
          return typeof item.value === "boolean"
            ? { op: "bool", value: item.value }
            : typeof item.value === "number"
              ? int(item.value)
              : int(this.id(item.value));
        case "var":
          if (!this.variables.has(item.id))
            throw new UnsupportedFragment(`Unknown variable ${item.id}`);
          return {
            op: "var",
            name: this.name(item.id, item.at || !post ? "pre" : "post"),
          };
        case "add":
        case "mul":
          return { op: item.op, args: item.args.map(go) };
        case "sub":
          return { op: "sub", left: go(item.left), right: go(item.right) };
        case "and":
        case "or":
          return { op: item.op, args: item.args.map(go) };
        case "not":
          return { op: "not", arg: go(item.arg) };
        case "implies":
          return {
            op: "or",
            args: [{ op: "not", arg: go(item.left) }, go(item.right)],
          };
        case "eq":
          return { op: "eq", left: go(item.left), right: go(item.right) };
        case "ne":
          return {
            op: "not",
            arg: { op: "eq", left: go(item.left), right: go(item.right) },
          };
        case "lt":
          return { op: "lt", left: go(item.left), right: go(item.right) };
        case "le":
          return { op: "le", left: go(item.left), right: go(item.right) };
        case "gt":
          return { op: "lt", left: go(item.right), right: go(item.left) };
        case "ge":
          return { op: "le", left: go(item.right), right: go(item.left) };
      }
    };
    return go(expr);
  }

  /** `post = effects(pre)` with a frame, or the postconditions when there are no effects. */
  transition(operation: Operation, includePostconditions = true): SolverTerm[] {
    const terms: SolverTerm[] = [];
    if (operation.effects.length > 0) {
      const updated = new Set(operation.effects.map((item) => item.variable));
      for (const effect of operation.effects)
        terms.push({
          op: "eq",
          left: { op: "var", name: this.name(effect.variable, "post") },
          right: this.term(effect.value, false),
        });
      for (const variable of this.spec.variables)
        if (variable.scope === "state" && !updated.has(variable.id))
          terms.push({
            op: "eq",
            left: { op: "var", name: this.name(variable.id, "post") },
            right: { op: "var", name: this.name(variable.id, "pre") },
          });
    } else if (operation.postconditions.length === 0) {
      for (const variable of this.spec.variables)
        if (variable.scope === "state")
          terms.push({
            op: "eq",
            left: { op: "var", name: this.name(variable.id, "post") },
            right: { op: "var", name: this.name(variable.id, "pre") },
          });
    }
    if (includePostconditions)
      for (const postcondition of operation.postconditions)
        terms.push(this.term(postcondition, true));
    return terms;
  }

  /** Solver value back to a specification value (strings not seen in the spec are named). */
  literal(id: string, value: boolean | number): Literal {
    const variable = this.variables.get(id);
    if (variable?.type === "boolean") return Boolean(value);
    if (variable?.type === "integer") return Number(value);
    return this.byId.get(Number(value)) ?? `~${Number(value)}`;
  }
}

export const int = (value: number): SolverTerm => ({ op: "int", value });
