# ADR 0061 — Cost-optimal plans and UX metrics

## Context

Phase R7 implements reasoning spec §29 and §30:
- rank valid plans with explicit costs (clicks, page transitions, form
  fields, modal interactions…);
- return a recommended path plus alternatives;
- derive per-workflow UX metrics, treated as hypotheses rather than redesign
  prescriptions.

The roadmap suggested an `optimize` operation in `solver-provider` (OMT or
MaxSAT). The solver language has no arithmetic beyond comparisons, and R6
already enumerates plans exactly.

## Decision

- **Costs come from action categories.** `actionCategories(abstraction)`
  maps the formal abstraction's coverage rules to:
  - navigation;
  - entry (opening a dialog);
  - field;
  - submit (commit or one-click);
  - confirmation;
  - back and cancel;
  - other.

  `costsFromCategories(model, categories, weights)` turns category weights
  (default 1 each, so cost counts interactions) into per-action costs.
  Weights must be positive.
- **`findCheapestPlan(reasoner, model, query & { costs?, maxSlack?, limit?
  })`** enumerates plans one length at a time, starting at the shortest. A
  plan of length L costs at least L times the cheapest action, so it stops as
  soon as the best cost found divided by the cheapest action is within the
  length searched; at that point the plan is proven `optimal`. If the bound
  exceeds the shortest length plus `maxSlack` (default 2), or enumeration hits
  its limit or budget, it keeps the best plan found, marks it
  `not-guaranteed`, and says why in `stopped`. It returns the plan with
  per-step costs and every enumerated plan ranked.
- **`uxMetrics(plan, categories, { variants, cost })`** reports actions,
  page transitions, form fields, dialog interactions, confirmations, the
  witness context, variants and estimated effort, plus rule-based
  `hypotheses`. Examples:
  - more than one page transition;
  - five or more fields;
  - a confirmation on the cheapest path;
  - a path spanning several capabilities;
  - several variants that help and tests should cover.

  All are marked `meaning: "hypothesis"`.
- **CLI:** `pathcompiler reason optimize <goal> [directory] [--weight
  <category=n> …]` prints the recommended path, the variants ranked by their
  cheapest member (from enumeration with slack 1) and the metrics, and writes
  `reports/reasoning/optimize/<goal>.json`. It is gated by
  `reasoning.optimization`.

## Alternatives

- **An `optimize` operation in the solver provider.** It would need integer
  sums in the solver language and an OMT backend, which is unnecessary at
  current model sizes. It can be added behind the provider interface if
  enumeration becomes the bottleneck.
- **Costs on formal-model actions** (the existing optional `cost`). That
  fixes one cost model at extraction. Category weights let each query choose
  its own, and model costs remain the fallback.

## Consequences

O9 (path efficiency against observed behavior) and P2 have a cost model.
Heavy weights loosen the proof bound, so they can make the search slow and
end with `not-guaranteed` (ISSUES_LOG #28).
