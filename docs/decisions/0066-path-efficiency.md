# ADR 0066 — Path efficiency

## Context

Phase O9 implements reasoning spec §158 (Path Efficiency Ratio = observed path
cost ÷ minimum valid formal path cost) and §159 step 9. It is a UX-friction
signal, "not proof that the formally shortest path is always the best
experience". O6 and O7 provide the stored events, and R7 the cheapest formal
plan.

## Decision

- **`computePathEfficiency(model, events, solver, options)`** in
  `behavior-reconciliation`, next to the possible-vs-observed reconciliation
  (O8).
- **Observed cost:** for each `goal.reached`, the interactions (`route.changed`
  and `semantic_target.activated` events) in that session since the
  previous completion. Each completion is grouped by goal and observed role.
- **Formal cost:** `findCheapestPlan` with unit costs, so both sides count
  interactions, under the role's model context. Roles outside the model map
  to the catch-all value, as in O8.
- **Ratio:** median observed ÷ minimum formal. It is reported only with
  `minCompletions` (default 30) completions, matching O7's sample threshold,
  and only when a formal path exists; otherwise it is `null` with the reason.
  Goals at or above `frictionRatio` (default 1.5) are listed as friction. The
  report is `meaning: "hypothesis"`.
- **CLI:** `pathcompiler observe efficiency [directory] [--model]` writes
  `reports/path-efficiency.json`. It is gated by `modes.observe` and
  `reasoning.optimization`.

## Alternatives

- **Comparing guide runs (`workflow.step_reached`) instead of free
  sessions.** That measures the guide, not the product. Free sessions answer
  the friction question. A guided view can come with I-track experiments.
- **Mean instead of median.** One lost user would dominate the mean; the
  median, with min and max alongside, is robust.

## Consequences

Friction candidates (high ratios) can feed O10 (alternative routes around
high-friction transitions) and I0 findings. The ratio is only as good as the
event instrumentation: missing activation events lower the observed cost.
