import {
  type OptimizationResult,
  parseOptimizationProblem,
  parseSolverProblem,
  type SolverCheckResult,
  type SolverProblem,
  type SolverProvider,
  type SolverTerm,
  type SolverValue,
} from "@pathcompiler/solver-provider";
import {
  init,
  killThreads,
  type Z3_ast,
  type Z3_context,
  Z3_lbool,
  type Z3_model,
} from "z3-solver";

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
  // Declares the problem's variables in a context and translates terms.
  const terms = (
    context: Z3_context,
    variables: SolverProblem["variables"],
  ) => {
    const sorts = {
      bool: Z3.mk_bool_sort(context),
      int: Z3.mk_int_sort(context),
    };
    const constants = new Map<string, Z3_ast>();
    for (const variable of variables)
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
          return Z3.mk_eq(context, translate(term.left), translate(term.right));
        case "lt":
          return Z3.mk_lt(context, translate(term.left), translate(term.right));
        case "le":
          return Z3.mk_le(context, translate(term.left), translate(term.right));
        case "add":
          return Z3.mk_add(context, term.args.map(translate));
        case "mul":
          return Z3.mk_mul(context, term.args.map(translate));
        case "sub":
          return Z3.mk_sub(context, [
            translate(term.left),
            translate(term.right),
          ]);
      }
    };
    return { constants, translate };
  };
  const read = (
    context: Z3_context,
    model: Z3_model,
    variables: SolverProblem["variables"],
    constants: Map<string, Z3_ast>,
  ) => {
    const values: Record<string, SolverValue> = {};
    for (const variable of variables) {
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
    return values;
  };
  return {
    name: `z3 ${getVersionString()}`,
    async check(input): Promise<SolverCheckResult> {
      if (closed) throw new Error("The Z3 solver provider is closed.");
      const problem = parseSolverProblem(input);
      const config = Z3.mk_config();
      const context = Z3.mk_context(config);
      Z3.del_config(config);
      try {
        const { constants, translate } = terms(context, problem.variables);
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
          const assumed = new Map(
            (problem.assumptions ?? []).map((item) => [
              constants.get(item) as Z3_ast,
              item,
            ]),
          );
          const status = problem.assumptions
            ? await Z3.solver_check_assumptions(context, solver, [
                ...assumed.keys(),
              ])
            : await Z3.solver_check(context, solver);
          if (status === Z3_lbool.Z3_L_FALSE) {
            if (!problem.assumptions) return { status: "unsat" };
            const vector = Z3.solver_get_unsat_core(context, solver);
            Z3.ast_vector_inc_ref(context, vector);
            try {
              const core: string[] = [];
              for (
                let index = 0;
                index < Z3.ast_vector_size(context, vector);
                index += 1
              ) {
                const item = assumed.get(
                  Z3.ast_vector_get(context, vector, index),
                );
                if (item === undefined)
                  throw new Error("Z3 returned a core outside the assumptions");
                core.push(item);
              }
              return { status: "unsat", core: core.sort() };
            } finally {
              Z3.ast_vector_dec_ref(context, vector);
            }
          }
          if (status === Z3_lbool.Z3_L_UNDEF)
            return {
              status: "unknown",
              reason: Z3.solver_get_reason_unknown(context, solver),
            };
          const model = Z3.solver_get_model(context, solver);
          Z3.model_inc_ref(context, model);
          try {
            const values = read(context, model, problem.variables, constants);
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
    async optimize(input): Promise<OptimizationResult> {
      if (closed) throw new Error("The Z3 solver provider is closed.");
      const problem = parseOptimizationProblem(input);
      const config = Z3.mk_config();
      const context = Z3.mk_context(config);
      Z3.del_config(config);
      try {
        const { constants, translate } = terms(context, problem.variables);
        const optimizer = Z3.mk_optimize(context);
        Z3.optimize_inc_ref(context, optimizer);
        try {
          const params = Z3.mk_params(context);
          Z3.params_inc_ref(context, params);
          Z3.params_set_uint(
            context,
            params,
            Z3.mk_string_symbol(context, "timeout"),
            Math.min(problem.timeoutMs, MAX_TIMEOUT_MS),
          );
          Z3.optimize_set_params(context, optimizer, params);
          Z3.params_dec_ref(context, params);
          for (const assertion of problem.assertions)
            Z3.optimize_assert(context, optimizer, translate(assertion));
          // One objective group: Z3 minimizes the weight of violated terms.
          const group = Z3.mk_string_symbol(context, "soft");
          const soft = problem.soft.map((item) => ({
            id: item.id,
            weight: item.weight,
            ast: translate(item.term),
          }));
          for (const item of soft)
            Z3.optimize_assert_soft(
              context,
              optimizer,
              item.ast,
              String(item.weight),
              group,
            );
          const status = await Z3.optimize_check(context, optimizer, []);
          if (status === Z3_lbool.Z3_L_FALSE) return { status: "unsat" };
          if (status === Z3_lbool.Z3_L_UNDEF)
            return {
              status: "unknown",
              reason: Z3.optimize_get_reason_unknown(context, optimizer),
            };
          const model = Z3.optimize_get_model(context, optimizer);
          Z3.model_inc_ref(context, model);
          try {
            const satisfied = soft.filter((item) => {
              const value = Z3.model_eval(context, model, item.ast, true);
              return (
                value !== null &&
                Z3.get_bool_value(context, value) === Z3_lbool.Z3_L_TRUE
              );
            });
            return {
              status: "optimal",
              model: read(context, model, problem.variables, constants),
              satisfied: satisfied.map((item) => item.id).sort(),
              cost:
                soft.reduce((sum, item) => sum + item.weight, 0) -
                satisfied.reduce((sum, item) => sum + item.weight, 0),
            };
          } finally {
            Z3.model_dec_ref(context, model);
          }
        } finally {
          Z3.optimize_dec_ref(context, optimizer);
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
