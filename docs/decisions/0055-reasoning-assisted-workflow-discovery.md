# ADR 0055 — Reasoning-assisted workflow discovery

## Context

Phase R-WI implements reasoning spec §23 and §125. Workflow candidates can be
derived from the formal model (Product Graph → formal abstraction → shortest
plan → feasible trace → candidate) instead of from test segments alone, and
the two strategies are compared (§117). The reasoning system "must earn its
complexity". C3 measured the baseline on the fixture: recall 0.6, because
Edit and Deactivate Client have no test segment with a positive completion
assertion on a semantic target.

## Decision

- **New `@pathcompiler/reasoning-discovery`**, with
  `discoverWorkflowsByReasoning(graph, capabilities, traces, solver, options)`.
  For each capability with a formal goal it:
  - calls `findPlan` with a free context; navigation steps become the
    capability's route entrypoint, not steps;
  - turns the plan's own-capability actions into workflow steps (action type
    from the UI node, label for the instruction, the formal action's evidence);
  - derives **applicability** from reachability. `roles` lists every model
    role value (except the catch-all `unlisted`) under which the goal is
    reachable. A feature flag becomes a `feature_flag` precondition when the
    goal is unreachable with that flag off. Unknown results are reported as
    ambiguities, never as facts;
  - takes the **terminal** from the tests. In a trace that activates the
    path's first and last targets, it uses the first positive text assertion
    on a single feedback element after any activation of the last target,
    before the next UI action. Otherwise the terminal is `explicit_next`, with
    a `terminal-not-derived` ambiguity;
  - reports inconclusive or impossible planning as `skipped`, with the reason.

  Candidates are always `status: candidate` with `reviewRequired: true`.
- **It is a separate package, not part of `workflow-discovery`.** The roadmap
  named `workflow-discovery`. Baseline discovery stays free of solver and
  formal-model dependencies, and `reasoner-core`'s tests already depend on
  `workflow-discovery`, so a strategy there would create a package cycle.
- **`DiscoveryStrategy`** (`{ name, discover }`, sync or async) lives in
  `@pathcompiler/evaluation`, next to `baselineStrategy`,
  `reasoningStrategy(solver)` and `compareDiscoveryStrategies`.
  `evaluateWorkflowDiscovery` is now async. The report adds:
  - invented-step rate;
  - applicability accuracy, against the new optional `roles` and `flags` in
    the ground-truth workflows;
  - per-case and mean step edit distance. The mean covers every reviewed
    workflow, so a missing workflow costs all its steps.
- **CLI:** `pathcompiler eval workflow-discovery --compare` writes
  `reports/eval/workflow-discovery-comparison.json`. With
  `pathcompiler.yaml` it needs `reasoning.enabled` and `reasoning.planning`.
- **The baseline stays the default** everywhere: `workflows discover`, the
  review flow and runtime artifacts are unchanged. Reasoning candidates are
  not written to the review queue yet.

## Results on the fixture

| Metric | Baseline | Reasoning |
| --- | --- | --- |
| Precision | 1 | 1 |
| Recall | 0.6 | 1 |
| Mean major-step score (found) | 1 | 0.867 |
| Terminal accuracy (found) | 0.667 | 0.4 |
| Invented steps | 0 | 0 |
| Applicability accuracy | 0 | 1 |
| Mean edit distance (all reviewed) | 1 | 0.4 |

Reasoning finds every workflow, invents nothing and gets roles and flags
right. It loses on steps where the model under-approximates data entry:
- Edit Client skips the name field, because the form is prefilled;
- Change Plan Structure skips the selector (ISSUES_LOG #4).

It also loses on terminals where tests assert with role or text locators
(ISSUES_LOG #20). The baseline has no applicability, because its workflows
omit the capability's roles (ISSUES_LOG #21).

## Alternatives

- **Making reasoning the default now.** Its terminal accuracy is lower, so
  the switch needs its own ADR once terminals and data steps improve.
- **Writing reasoning candidates into the review queue.** The candidate
  schema requires test observations that reasoning candidates do not have. A
  schema change belongs with the default-strategy decision.
- **Taking terminals from the formal goal.** Goals are model state, not UI
  conditions, so a goal-based terminal would invent completion signals.

## Consequences

The comparison runs on every test run (a golden comparison report), so
improvements to the abstraction show up as metric changes. A merged strategy
(baseline steps and terminals, reasoning recall and applicability) is the
obvious next experiment, and needs no new infrastructure.
