# ADR 0079 — Improvement gate (IG)

## Context

ADR 0033 makes the improvement loop selective. A finding escalates only
through a gate that asks four questions in order:
1. Is the evidence sufficient?
2. Is the impact meaningful?
3. Is a recommendation actionable?
4. Is autonomous implementation enabled?

Each answer is explained by an Improvement Value Assessment, and
`improvement_policy` budgets apply. The roadmap's acceptance cases:
- a low-impact, low-confidence finding gives `log_only` or
  `collect_more_data`;
- a large high-confidence regression gives `recommend`;
- a niche feature with low usage but high completion gives `no_change`;
- budgets cap recommendations;
- nothing is `eligible_for_harness` while `autonomous_mutation` is false.

## Decision

- **New `@pathcompiler/improvement-gate`.** `gateFindings(report, policy,
  { usage })` decides per I0 opportunity, in priority order so budgets go to
  the most important:
  1. **Evidence:** the strongest finding confidence must reach
     `min_confidence`. Otherwise `collect_more_data`, suggesting browser
     verification or tests, the classes that make formal and static
     evidence high-confidence in P0.
  2. **Impact:**
     - low adoption with a completion rate of at least 80% among starters
       gives `no_change`;
     - without telemetry, only a high-severity regression is meaningful,
       and anything else is `log_only`;
     - with telemetry, `min_affected_users` and `min_expected_gain` (the
       affected share of eligible users) apply.
  3. **Actionable:** the kinds with I1 templates are regressions, friction
     and low adoption. Others (runtime/formal discrepancies) give
     `surface_finding`. An exhausted `max_recommendations_per_period` also
     gives `surface_finding`.
  4. **Autonomy:** `eligible_for_harness` only when `autonomous_mutation` is
     on and `max_autonomous_mutations` is not used up; otherwise
     `recommend`.
- **The assessment** lists impact, affected and eligible users, confidence,
  expected gain and estimated cost, each with a reason; unknown values are
  `null`. Its value is the product of the known components, labeled
  `ordering-not-probability`. The rationale records every question asked.
- **CLI `gate`** reads `reports/findings.json` and takes usage from stored
  guide-run events (starts, sessions, completion rate). It writes
  `reports/gate-decisions.json`.
  - With `pathcompiler.yaml` it needs `modes.recommend`.
  - The harness additionally needs `modes.self_improvement`, so mode 6 is
    opt-in twice.

## Alternatives

- **One weighted score with thresholds.** That is opaque and contradicts
  ADR 0033 §5. The ordered questions say why each decision was made.
- **Treating formally proven regressions as sufficient evidence.** P0 rates
  formal-only evidence medium by design, so it should be confirmed in a
  browser before it drives changes. The gate asks for that confirmation
  instead of overriding P0.

## Consequences

- **Estimated cost** is unknown until recommendations exist (I1), so it is
  `null`.
- **Affected users** are approximated by guide starts; there is no compute
  budget yet (ISSUES_LOG #44).
