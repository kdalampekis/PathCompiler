import {
  parseSolverProblem,
  type SolverCheckResult,
  type SolverProvider,
  type SolverTerm,
  type SolverValue,
} from "@pathcompiler/solver-provider";
import {
  init,
  killThreads,
  type Arith as Z3Arith,
  type Bool as Z3Bool,
} from "z3-solver";

const NAME = "pathcompiler";
type Bool = Z3Bool<typeof NAME>;
type Arith = Z3Arith<typeof NAME>;

/**
 * Z3 (WASM) backend. Z3 objects never leave this module: problems arrive as
 * solver-neutral terms and results return plain values.
 */
export async function createZ3SolverProvider(): Promise<SolverProvider> {
  const z3 = await init();
  const context = new z3.Context(NAME);
  let closed = false;
  return {
    name: `z3 ${z3.getVersionString()}`,
    async check(input): Promise<SolverCheckResult> {
      if (closed) throw new Error("The Z3 solver provider is closed.");
      const problem = parseSolverProblem(input);
      const bools = new Map<string, Bool>();
      const ints = new Map<string, Arith>();
      for (const variable of problem.variables)
        if (variable.sort === "bool")
          bools.set(variable.name, context.Bool.const(variable.name));
        else ints.set(variable.name, context.Int.const(variable.name));
      const bool = (term: SolverTerm): Bool => {
        switch (term.op) {
          case "bool":
            return context.Bool.val(term.value);
          case "var":
            return bools.get(term.name) as Bool;
          case "not":
            return context.Not(bool(term.arg));
          case "and":
            return context.And(...term.args.map(bool));
          case "or":
            return context.Or(...term.args.map(bool));
          case "eq":
            return isBool(term.left)
              ? bool(term.left).eq(bool(term.right))
              : int(term.left).eq(int(term.right));
          case "lt":
            return int(term.left).lt(int(term.right));
          case "le":
            return int(term.left).le(int(term.right));
          default:
            throw new Error(`Not a boolean term: ${term.op}`);
        }
      };
      const int = (term: SolverTerm): Arith => {
        if (term.op === "int") return context.Int.val(term.value);
        if (term.op === "var") return ints.get(term.name) as Arith;
        throw new Error(`Not an integer term: ${term.op}`);
      };
      const isBool = (term: SolverTerm) =>
        term.op === "var" ? bools.has(term.name) : term.op !== "int";
      const solver = new context.Solver();
      try {
        solver.set("timeout", problem.timeoutMs);
        for (const assertion of problem.assertions) solver.add(bool(assertion));
        const status = await solver.check();
        if (status === "unsat") return { status: "unsat" };
        if (status === "unknown")
          return { status: "unknown", reason: solver.reasonUnknown() };
        const model = solver.model();
        try {
          const values: Record<string, SolverValue> = {};
          for (const [key, value] of bools)
            values[key] = context.isTrue(model.eval(value, true));
          for (const [key, value] of ints) {
            const evaluated = model.eval(value, true);
            if (!context.isIntVal(evaluated))
              throw new Error(`Z3 returned a non-integer value for ${key}`);
            values[key] = Number(evaluated.value());
          }
          return { status: "sat", model: values };
        } finally {
          model.release();
        }
      } finally {
        // Release eagerly: the WASM heap is bounded and finalizers run late.
        solver.release();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await killThreads(z3.em);
    },
  };
}
