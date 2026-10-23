# ADR 0039 — Unreachability explanations

## Context

Phase R4 explains `unreachable` answers (reasoning spec §24–§25). The
explanation must:
- use stable constraint IDs with provenance;
- read as product sentences, never solver labels;
- trace back to source evidence.

R2 proves unreachability by k-induction (ADR 0037). The proof is a set of base
checks (depths 0…k) plus one inductive step check.

## Decision

- **The solver boundary gains assumptions and cores.**
  `SolverProblem.assumptions` names boolean variables that are assumed true
  for one check. For an `unsat` answer with assumptions, the result includes a
  `core`, which is a subset of the assumptions. In Z3, this uses
  `solver_check_assumptions` and `solver_get_unsat_core`. Core entries are
  mapped back by AST handle.
- **Labeled product constraints.** In explain mode, each of the following is
  guarded by a label, as `label → constraint`:
  - each context assignment: `context:<variable>`;
  - each top-level conjunct of each sliced action's precondition:
    `precondition:<action>#<n>`, numbered in the normalized model;
  - each conjunct of the initial constraint: `initial#<n>`.

  The proof runs with all labels assumed, so it behaves exactly like R2.
  Domains, frame, effects and the goal stay hard: they are the model's
  semantics, not choices a product team would change.
- **Minimal explanation.** After the proof closes at depth k, the cores of all
  k+2 proof checks are combined. The result is then minimized by deletion: drop
  a label when every proof check stays unsat without it. The result is minimal
  for the k-induction certificate. Relaxing every other labeled constraint
  provably keeps the goal unreachable, and dropping any remaining one breaks
  that certificate.
  - The result is not necessarily a globally smallest MUS. Enumerating MUSes
    and computing correction sets is R5.
  - If a minimization check returns unknown, the explanation is returned with
    `minimal: false`.
- **Product rendering.** `describeFormalExpr` renders conjuncts. Each
  constraint carries a description (for example "clients.create.submit
  requires role = editor"), its action, capability, semantic target and
  variables. It also carries evidence: the action's evidence plus the
  evidence of the context variables it mentions, so that `requireEditor`, the
  API handler and the permission node appear. The explanation also lists the
  actions that can set the goal.
- **`ProductReasoner.explainUnreachable`** returns the reachable witness or
  unknown unchanged, and adds `explanation` to unreachable results.
  `pathcompiler reason why-not <goal>` prints the summary and the source
  evidence per constraint, then writes
  `reports/reasoning/why-not/<goal>.json`.

## Alternatives

- **One combined formula for the whole proof.** The proof needs every check to
  be unsat, while a conjunction of checks is unsat when any one is. Rejected.
- **Raw Z3 cores without minimization.** Not minimal, so they include
  incidental constraints. Rejected.
- **Labeling frame and effect axioms.** They would show up as "explanations"
  that a product team cannot act on. Rejected.

## Consequences

For `next-demo`, "viewer creates a client" is explained by three constraints on
both models:
- the context role;
- the submit action's editor requirement, traced to
  `symbol:lib/session.ts#requireEditor` and the POST handler;
- the creation goal initially false.

"Flag off changes a plan structure" names both goal-setting actions' flag
requirements.

A seeded check over 40 random models confirms each explanation is sufficient:
keeping only the explained constraints still makes the goal unreachable under
explicit-state search.
