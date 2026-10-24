# ADR 0059 — Minimal correction sets (minimal enablement)

## Context

Phase R5 implements reasoning spec §26 (MUS and MCS) and §72 (minimal
enablement). It answers "why can't role X do Y?" and "what is the minimum
configuration or permission change that would enable it?" The spec says this
is diagnostic only and must never change permissions automatically. R4
already returns a deletion-minimized unsatisfiable core of named constraints:
context fixings, action precondition conjuncts and initial conjuncts.

## Decision

- **MUS.** R4's minimal core (`explainUnreachable`) is the MUS. It is
  minimal (no member can be dropped), not necessarily minimum, and that is
  documented rather than recomputed.
- **MCS.** `findMinimalEnablement(reasoner, model, { goal, context },
  options)` in `reasoner-core` searches for the smallest sets of **policy**
  constraints whose removal makes the goal reachable. Policy constraints are:
  - a fixed context value ("run as a different role" or "turn a flag on");
  - an action precondition conjunct that mentions only context variables: a
    role, flag or permission guard.

  Structural constraints (a dialog must be open) and initial state are never
  candidates.
- **Algorithm.** A core-guided breadth-first search. Each candidate set is
  applied to a *copy* of the model (context freed, guard conjunct dropped,
  matched by action and condition rather than by renumbered ID), then R4
  explains it. A reachable result is a correction set; an unreachable one
  yields a core, and every correction must relax one of its policy members,
  so the search branches on those. Breadth-first order means the first sets
  found have minimum cardinality, and all sets of that size are returned,
  each with a witness. There are bounds (`maxChanges` 3, `maxChecks` 200),
  and solver `unknown` results make `minimum: false`.
- **The result** has a status (`already-reachable`, `enableable`,
  `not-enableable` or `unknown`) and per-change descriptions, evidence and a
  suggestion phrased as a product decision. It is always marked
  `diagnosticOnly: true`, and the input model is never mutated.
- **CLI:** `pathcompiler reason enable <goal> [directory] --context …` writes
  `reports/reasoning/enablement/<goal>.json`. It is gated by
  `reasoning.unsat_explanations`, the R4 family.
- **Evaluation:** reasoning cases gain an `enablement` query kind with the
  expected minimal sets. The fixture has two such cases: the viewer-create
  question from the roadmap acceptance, and an editor with the archive flag
  off, which needs one change for the role and one for the flag (four minimal
  pairs).

## Alternatives

- **Solver-internal MaxSAT over the labels.** Faster on large models, but it
  needs optimization support in the provider (R7). The model-level search
  reuses R4 and is provider-neutral.
- **Enumerating subsets blindly.** That is combinatorial in the number of
  guards. Core guidance branches only on constraints that actually block.
- **Treating initial state as correctable.** "Assume the client already
  exists" is not a configuration change and would produce misleading
  advice.

## Consequences

Permission audits and "who can do what" questions can show minimal changes
with evidence. The search is exact within its bounds, and reports when it
hit them.
