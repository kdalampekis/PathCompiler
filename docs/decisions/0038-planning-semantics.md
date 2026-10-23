# ADR 0038 — Planning semantics

## Context

Phase R3 turns bounded reachability (ADR 0037) into plans: "how is goal G
reached under context C?" Plans will feed reasoning-assisted workflow discovery
(R-WI) and planning metrics (reasoning spec §89). A plan therefore has to be:
- stable, so that artifacts and candidate workflows do not change between runs
  or solver versions;
- comparable with reviewed workflows.

## Decision

- **`findPlan(model, query)`** reuses the reachability search. It returns
  `found` with a plan, `impossible` with the k-induction proof, or `unknown`
  with the same reasons as reachability.
- **Optimality.** Plans have minimal length, because depths increase one at a
  time. Cost (`action.cost`, default 1) is summed and reported. The plan is
  marked cost-optimal only when every action in the slice costs the same.
  Otherwise `cost: "not-guaranteed"`. Real cost optimization belongs to R7
  (OMT/MaxSAT), so planning does not add arithmetic to the solver boundary.
- **Canonical plans.** Among the shortest plans, the result has the
  lexicographically smallest sequence of action indices. Actions are taken in
  normalized order (sorted by ID). This is found by binary search on each step's
  action index, about log₂|actions| solver calls per step. Plans therefore
  depend on the model, not on the solver's choice. Values of free state and
  context variables come from the final solver model; they are deterministic for
  a given solver version, but not across versions.
- **`evaluatePlan(model, plan, workflow?)`** replays the plan on the model and
  reports `goalReached` and `invalidActionCount`. Given a workflow, it compares
  major steps:
  - only plan steps with a capability are compared; navigation maps to workflow
    entrypoints;
  - adjacent input/select steps are order-insensitive on both sides;
  - the score is the longest common subsequence divided by the workflow's step
    count, with missing and extra targets listed.
- **CLI.** `pathcompiler reason plan <goal>` writes
  `reports/reasoning/plans/<goal>.json`. When `workflows/<capability>.yaml`
  exists (an approved workflow), the CLI also compares the plan with it.
  Default discovery is unchanged.

## Alternatives

- **PDDL or a dedicated planner.** Spec §110 allows bounded SMT for the MVP,
  and adding tooling now is premature.
- **Taking the solver's first witness as the plan.** Stable only for a fixed Z3
  build and encoding. Rejected for user-facing artifacts.
- **Minimizing cost now with an `add` term and iterative bounds.** This extends
  the boundary before R7 defines optimization. Deferred.

## Consequences

For `next-demo`, the plans for Create Client, Change Plan Structure (hand model)
and Create Plan (extracted model) match their workflows' major steps exactly.
The extracted model's Change Plan Structure plan skips the selector, scoring
2/3, because the chosen value is not tied to stored state (ADR 0036,
`value-not-persisted`). R-WI must surface such gaps rather than turn shortcut
plans into workflows.
