import {
  parseSolverProblem,
  type SolverCheckResult,
  type SolverProvider,
  type SolverTerm,
  type SolverValue,
} from "@pathcompiler/solver-provider";
import { init, killThreads, type Z3_ast, Z3_lbool } from "z3-solver";

const MAX_TIMEOUT_MS = 2 ** 32 - 1;

/**
 * Z3 (WASM) backend. Z3 objects never leave this module: problems arrive as
 * solver-neutral terms and results return plain values. Each check runs in its
 * own Z3 context, deleted afterwards, so memory does not depend on JavaScript
 * garbage collection (the WASM heap is bounded).
 */
export async function createZ3SolverProvider(): Promise<SolverProvider> {
  const { Z3, em, getVersionString } = await init();
  let closed = false;
  return {
    name: `z3 ${getVersionString()}`,
    async check(input): Promise<SolverCheckResult> {
      if (closed) throw new Error("The Z3 solver provider is closed.");
      const problem = parseSolverProblem(input);
      const config = Z3.mk_config();
      const context = Z3.mk_context(config);
      Z3.del_config(config);
      try {
        const sorts = {
          bool: Z3.mk_bool_sort(context),
          int: Z3.mk_int_sort(context),
        };
        const constants = new Map<string, Z3_ast>();
        for (const variable of problem.variables)
          constants.set(
            variable.name,
            Z3.mk_const(
              context,
              Z3.mk_string_symbol(context, variable.name),
              sorts[variable.sort],
            ),
          );
        const translate = (term: SolverTerm): Z3_ast => {
          switch (term.op) {
            case "bool":
              return term.value ? Z3.mk_true(context) : Z3.mk_false(context);
            case "int":
              return Z3.mk_numeral(context, String(term.value), sorts.int);
            case "var":
              return constants.get(term.name) as Z3_ast;
            case "not":
              return Z3.mk_not(context, translate(term.arg));
            case "and":
              return term.args.length === 0
                ? Z3.mk_true(context)
                : Z3.mk_and(context, term.args.map(translate));
            case "or":
              return term.args.length === 0
                ? Z3.mk_false(context)
                : Z3.mk_or(context, term.args.map(translate));
            case "eq":
              return Z3.mk_eq(
                context,
                translate(term.left),
                translate(term.right),
              );
            case "lt":
              return Z3.mk_lt(
                context,
                translate(term.left),
                translate(term.right),
              );
            case "le":
              return Z3.mk_le(
                context,
                translate(term.left),
                translate(term.right),
              );
          }
        };
        const solver = Z3.mk_solver(context);
        Z3.solver_inc_ref(context, solver);
        try {
          const params = Z3.mk_params(context);
          Z3.params_inc_ref(context, params);
          Z3.params_set_uint(
            context,
            params,
            Z3.mk_string_symbol(context, "timeout"),
            Math.min(problem.timeoutMs, MAX_TIMEOUT_MS),
          );
          Z3.solver_set_params(context, solver, params);
          Z3.params_dec_ref(context, params);
          for (const assertion of problem.assertions)
            Z3.solver_assert(context, solver, translate(assertion));
          const status = await Z3.solver_check(context, solver);
          if (status === Z3_lbool.Z3_L_FALSE) return { status: "unsat" };
          if (status === Z3_lbool.Z3_L_UNDEF)
            return {
              status: "unknown",
              reason: Z3.solver_get_reason_unknown(context, solver),
            };
          const model = Z3.solver_get_model(context, solver);
          Z3.model_inc_ref(context, model);
          try {
            const values: Record<string, SolverValue> = {};
            for (const variable of problem.variables) {
              const value = Z3.model_eval(
                context,
                model,
                constants.get(variable.name) as Z3_ast,
                true,
              );
              if (value === null)
                throw new Error(`Z3 could not evaluate ${variable.name}`);
              values[variable.name] =
                variable.sort === "bool"
                  ? Z3.get_bool_value(context, value) === Z3_lbool.Z3_L_TRUE
                  : Number(Z3.get_numeral_string(context, value));
            }
            return { status: "sat", model: values };
          } finally {
            Z3.model_dec_ref(context, model);
          }
        } finally {
          Z3.solver_dec_ref(context, solver);
        }
      } finally {
        Z3.del_context(context);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await killThreads(em);
    },
  };
}
