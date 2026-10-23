import { z } from "zod";

/**
 * Solver-neutral problem language. Backends translate it into their own terms;
 * no backend type ever crosses this boundary.
 */
export type SolverSort = "bool" | "int";
export type SolverTerm =
  | { op: "bool"; value: boolean }
  | { op: "int"; value: number }
  | { op: "var"; name: string }
  | { op: "not"; arg: SolverTerm }
  | { op: "and" | "or"; args: SolverTerm[] }
  | { op: "eq" | "lt" | "le"; left: SolverTerm; right: SolverTerm };
export type SolverValue = boolean | number;

const name = z.string().min(1);
export const SolverTermSchema: z.ZodType<SolverTerm> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.strictObject({ op: z.literal("bool"), value: z.boolean() }),
    z.strictObject({ op: z.literal("int"), value: z.number().int().safe() }),
    z.strictObject({ op: z.literal("var"), name }),
    z.strictObject({ op: z.literal("not"), arg: SolverTermSchema }),
    z.strictObject({ op: z.literal("and"), args: z.array(SolverTermSchema) }),
    z.strictObject({ op: z.literal("or"), args: z.array(SolverTermSchema) }),
    ...(["eq", "lt", "le"] as const).map((op) =>
      z.strictObject({
        op: z.literal(op),
        left: SolverTermSchema,
        right: SolverTermSchema,
      }),
    ),
  ]),
);
export const SolverProblemSchema = z
  .strictObject({
    variables: z.array(z.strictObject({ name, sort: z.enum(["bool", "int"]) })),
    assertions: z.array(SolverTermSchema),
    /** Wall-clock budget for this check; exceeding it yields `unknown`. */
    timeoutMs: z.number().int().positive(),
  })
  .superRefine((problem, context) => {
    const sorts = new Map<string, SolverSort>();
    for (const variable of problem.variables) {
      if (sorts.has(variable.name))
        context.addIssue({
          code: "custom",
          message: `Duplicate solver variable: ${variable.name}`,
        });
      sorts.set(variable.name, variable.sort);
    }
    for (const assertion of problem.assertions) {
      const issue = sortIssue(assertion, sorts, "bool");
      if (issue) context.addIssue({ code: "custom", message: issue });
    }
  });
export type SolverProblem = z.infer<typeof SolverProblemSchema>;

export type SolverCheckResult =
  | { status: "sat"; model: Record<string, SolverValue> }
  | { status: "unsat" }
  | { status: "unknown"; reason: string };

/**
 * Satisfiability backend. `enumerate` and `optimize` (reasoning spec §16) join
 * this interface in the phases that need them (R6, R7).
 */
export interface SolverProvider {
  readonly name: string;
  /** Checks the conjunction of `assertions`; a `sat` model assigns every declared variable. */
  check(problem: SolverProblem): Promise<SolverCheckResult>;
  /** Releases backend resources (worker threads, memory). */
  close(): Promise<void>;
}

function sortIssue(
  term: SolverTerm,
  sorts: Map<string, SolverSort>,
  expected: SolverSort,
): string | undefined {
  const actual = sortOf(term, sorts);
  if (typeof actual !== "string") return actual.issue;
  return actual === expected
    ? undefined
    : `Expected a ${expected} term, got ${actual} (${term.op})`;
}
function sortOf(
  term: SolverTerm,
  sorts: Map<string, SolverSort>,
): SolverSort | { issue: string } {
  switch (term.op) {
    case "bool":
      return "bool";
    case "int":
      return "int";
    case "var":
      return (
        sorts.get(term.name) ?? {
          issue: `Undeclared solver variable: ${term.name}`,
        }
      );
    case "not": {
      const issue = sortIssue(term.arg, sorts, "bool");
      return issue ? { issue } : "bool";
    }
    case "and":
    case "or": {
      for (const arg of term.args) {
        const issue = sortIssue(arg, sorts, "bool");
        if (issue) return { issue };
      }
      return "bool";
    }
    default: {
      const left = sortOf(term.left, sorts);
      if (typeof left !== "string") return left;
      const issue = sortIssue(
        term.right,
        sorts,
        term.op === "eq" ? left : "int",
      );
      if (issue) return { issue };
      if (term.op !== "eq" && left !== "int")
        return { issue: `${term.op} needs integer operands` };
      return "bool";
    }
  }
}

/** Validates a problem at the boundary; backends call this before translating. */
export function parseSolverProblem(input: unknown): SolverProblem {
  return SolverProblemSchema.parse(input);
}
