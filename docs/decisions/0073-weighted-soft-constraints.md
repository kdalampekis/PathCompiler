# ADR 0073 — Weighted soft constraints (P2)

## Context

P1 (ADR 0072) interprets each capability alone. Some constraints span
capabilities. Reasoning spec §50 asks for hard constraints plus weighted
semantic hypotheses: satisfy the hard constraints, and maximize the
supported soft constraints.

The solver boundary had only `check`, and its term language has no integer
sums, so a weighted objective could not be expressed. Spec §16 planned
`optimize` "in the phase that needs it".

## Decision

- **`SolverProvider.optimize(problem)`** (solver-provider). The problem has
  hard `assertions` and `soft: { id, term, weight }[]`, with positive
  integer weights so that optima are exact. The result is one of:
  - `optimal`: the model, the satisfied soft IDs, and the violated weight as
    `cost`;
  - `unsat`, when the hard constraints alone are unsatisfiable;
  - `unknown`, with a reason.

  The problem is validated like `check`'s (sorts, declared variables), and
  soft IDs must be unique.
- **Z3 backend:** `Z3_optimize` in a fresh context per call, deleted
  afterwards like `check` (ISSUES_LOG #3). The soft terms form one objective
  group, and the timeout comes from the problem. Term translation is shared
  with `check`.
- **`selectInterpretations` (probabilistic-evidence)** builds the joint
  problem:
  - **Variables:** one boolean per consistent P1 candidate.
  - **Hard constraints:** at most one meaning per subject, and exclusive
    subject pairs never share a meaning.
  - **Soft constraints:** each candidate, weighted by `candidateWeight`:
    evidence tier × 1000 + the P1 relative weight scaled to 0–999, + 1. The
    tier dominates, so code still outranks models, as in P0.

  Each assignment records the chosen value, P1's per-subject best, and
  whether the joint optimum differs (`joint`).
- **`selectCapabilityInterpretations` (formal-abstraction):** capabilities
  whose handlers call disjoint, non-empty endpoint sets are exclusive,
  because they are different actions. Capabilities without handler evidence
  may merge.
- **CLI.** `analyze` runs the joint selection when there is something to
  interpret, and adds `joint` to `reports/semantic-interpretations.json`.
  Capabilities are still never changed.

## Alternatives

- **Integer sums in the solver language** (`add`, `ite`) with an iterated
  `check` on a cost bound. That needs a search loop around the solver, while
  Z3's MaxSAT engine does the same exactly and faster. It remains an option
  for backends without optimization.
- **A greedy pass over P1 results.** It cannot trade one subject's second
  choice against another's first, which is the point of P2.
- **Floating-point weights.** They make optima depend on rounding; integers
  keep results exact and deterministic.

## Consequences

- R7's plan optimization could use `optimize` for cost bounds instead of
  length bounds (ISSUES_LOG #28).
- On the demo fixture, nothing is ambiguous and nothing changes.
