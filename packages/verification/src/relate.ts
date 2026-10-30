import type { BehaviorSpec, Expr } from "@pathcompiler/behavior-ir";
import type { SolverProvider, SolverTerm } from "@pathcompiler/solver-provider";
import { Encoding, UnsupportedFragment } from "./encode.js";

/**
 * How two conjunctions of conditions relate over the variables of `spec`:
 * - `equivalent`: they allow exactly the same valuations;
 * - `left_stronger`: left implies right (left allows less);
 * - `left_weaker`: right implies left (left allows more);
 * - `incomparable`: neither implies the other.
 * Used to say whether a changed set of preconditions got stricter, looser or
 * is just a refactoring. Domains (ranges, enum values) are respected.
 */
export type ConditionRelation =
  | "equivalent"
  | "left_stronger"
  | "left_weaker"
  | "incomparable"
  | "unknown"
  | "unsupported";

export async function relateConditions(
  solver: SolverProvider,
  spec: BehaviorSpec,
  left: readonly Expr[],
  right: readonly Expr[],
  timeoutMs = 10_000,
): Promise<{ relation: ConditionRelation; reason?: string }> {
  let encoding: Encoding;
  let a: SolverTerm;
  let b: SolverTerm;
  try {
    encoding = new Encoding(spec, [...left, ...right]);
    a = { op: "and", args: left.map((item) => encoding.term(item, false)) };
    b = { op: "and", args: right.map((item) => encoding.term(item, false)) };
  } catch (error) {
    if (error instanceof UnsupportedFragment)
      return { relation: "unsupported", reason: error.message };
    throw error;
  }
  const domain = encoding.domain("pre");
  const difference = async (x: SolverTerm, y: SolverTerm) =>
    solver.check({
      variables: encoding.declarations(),
      assertions: [...domain, x, { op: "not", arg: y }],
      timeoutMs,
    });
  // `canExceed(x, y)`: some valuation satisfies x but not y.
  const first = await difference(a, b);
  const second = await difference(b, a);
  if (first.status === "unknown")
    return { relation: "unknown", reason: first.reason };
  if (second.status === "unknown")
    return { relation: "unknown", reason: second.reason };
  const leftExceeds = first.status === "sat";
  const rightExceeds = second.status === "sat";
  if (!leftExceeds && !rightExceeds) return { relation: "equivalent" };
  if (!leftExceeds) return { relation: "left_stronger" };
  if (!rightExceeds) return { relation: "left_weaker" };
  return { relation: "incomparable" };
}
