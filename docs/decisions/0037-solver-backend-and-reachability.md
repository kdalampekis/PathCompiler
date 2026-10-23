# ADR 0037 — Solver backend and bounded reachability semantics

## Context

Phase R2 answers "can goal G be reached under context C?" over a Formal Product
Model (ADR 0035), hand-encoded or extracted (ADR 0036). Reasoning spec §16 and
§109 require:
- a solver-independent architecture with a Z3-compatible first backend;
- no Z3 types outside the provider;
- `unknown` preserved as a first-class answer (§17, §83);
- per-call timeouts and reported statistics (§90).

## Decision

- **Three packages.**
  - `@pathcompiler/solver-provider` holds the neutral boundary, with no
    dependencies besides Zod. Problems use a small sorted term language: bool and
    int constants and variables, `not`, `and`, `or`, `eq`, `lt`, `le`. A problem
    is a list of declared variables, a list of assertions and a timeout. It is
    validated and sort-checked at the boundary. `SolverProvider` exposes
    `check(problem) → sat (plain values) | unsat | unknown (reason)` and
    `close()`. `enumerate` and `optimize` (spec §16) join the interface in R6 and
    R7, when they are needed.
  - `@pathcompiler/solver-z3` is the only package that imports Z3.
  - `@pathcompiler/reasoner-core` depends only on the provider interface.

  The roadmap named only `solver-provider` and `reasoner-core`. The separate
  backend package makes "domain packages must not depend on Z3" a rule the
  package graph enforces.
- **Backend:** `z3-solver` 5.2.0, the official Z3 WebAssembly build (MIT,
  released 2026-08-21). It needs no native toolchain and runs in Node 22.
  - Each check runs in its own low-level Z3 context with the `timeout`
    parameter, and the context is deleted afterwards. The WASM heap is bounded
    (2 GB) and the high-level API frees AST nodes only through garbage-collection
    finalizers. Under R3's planning workload that exhausted the heap even with
    eager solver and model release. (Amended in R3; the first R2 version used the
    high-level API.)
  - `close()` terminates Z3's worker threads so CLI processes exit.
- **Encoding.**
  - State variables get one solver variable per step. Context variables get one
    for the whole query, because context is fixed.
  - Booleans map to bool. Integers map to int with their declared bounds as
    domain constraints, so an out-of-range assignment disables the transition.
  - Enum values and string literals share one code table, so equality compares
    values even across variables. String variables are unconstrained ints, which
    keeps equality reasoning exact.
  - Each step chooses exactly one action, which must have its precondition
    true. Effects are simultaneous, and unassigned variables keep their value
    (frame rule).
- **Slicing.** A cone of influence of the goal's and the context's variables is
  computed. Actions that assign nothing in the cone are dropped. Variables
  mentioned only by the initial constraint are declared at step 0 and never
  change.
- **Algorithm.** For depth k = 0…maxDepth (default 20):
  - Bounded model checking (BMC) checks the admissible initial state, k
    transitions and the goal at step k. SAT gives `reachable` with a witness.
    Because depths increase, it is a shortest witness.
  - Otherwise a k-induction step checks k+1 distinct non-goal states followed by
    a goal state, from any state. The distinctness (simple-path) constraint
    makes the method complete for finite models. The step is strengthened with
    initial conjuncts over variables no action assigns. UNSAT gives
    `unreachable` with `proof: { method: "k-induction", depth: k }`.
  - Exhausting the bound gives `unknown: bound-insufficient`.
  - A solver `unknown`, or running past the query's wall-clock budget (default
    30 s), gives `unknown: timeout | solver-unknown`. `unknown` is never mapped
    to `unreachable`.
- **Witnesses are replayed.** Before returning, a witness is decoded into
  product values and re-executed with an independent evaluator
  (`evaluateFormalExpr`, `applyFormalAction`). A mismatch throws an internal
  error instead of returning a wrong trace. Each step carries the action's
  semantic target, capability and evidence, plus the variables it changed.
- **Results carry provenance and stats.** Each result includes the model's ID,
  hash, commit and source. Stats report the solver, bound, number of solver
  calls, constraint count, duration, and slice size against the full model.
- **CLI.** `pathcompiler reason reachable <goal>` either extracts the model
  from the repository or reads one with `--model`. It writes
  `reports/reasoning/<goal>.json`, which for extracted models includes model
  coverage and uncertainties. For an `unreachable` answer on an extracted
  model, the CLI says the result holds in the model only (spec §84–§86).
  Reasoning is not exposed through MCP or HTTP (spec §108).

## Alternatives

- **Explicit-state search only.** Exact for finite models, but it gives no path
  to unsat explanations (R4), optimization (R7) or symbolic integers.
  Rejected. It is kept as the test oracle.
- **A native Z3 binding or an external `z3` binary.** Needs a platform toolchain
  or a system install. Rejected for the first backend; the provider boundary
  allows either later.
- **BMC alone, reporting "not found within k" as unreachable.** Unsound.
  Rejected; that case is `unknown: bound-insufficient`.
- **Z3 enum sorts and string theory.** More backend-specific surface for no gain
  in the current language, which has only equality and integer ordering.

## Consequences

- Reachability over the fixture models is exact. A seeded cross-check of 120
  queries against breadth-first search found no disagreement, minimal witness
  lengths, and 0 unknown answers.
- `unreachable` on an extracted model is only as good as the abstraction, and
  is always reported with model coverage.
- Large models may need a better slice: extracted dialog guards couple
  capabilities through "no dialog open". They may also need incremental
  solving, a later optimization behind the same interface.
- R4 (unsat explanations) will add named assertions and cores to the provider.
