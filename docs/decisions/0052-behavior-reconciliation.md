# ADR 0052 — Possible-vs-observed reconciliation

## Context

Phase O8 compares what the Formal Product Model says can happen with what the
stored events show did happen (reasoning spec §131, §142–§144). Observed
behavior that the model rules out is a high-priority discrepancy. It can be an
authorization bug, but it can equally be an extraction error, a wrong role
report or an event-mapping error. It must never be labeled a bug or a
vulnerability automatically, and minimum sample sizes apply.

## Decision

- **New `@pathcompiler/behavior-reconciliation`.**
  `reconcileBehavior(model, events, solver, options)` works per observed role.
  Events without a role form `(none)`. A role the model lacks maps to
  `otherRole` (default `unlisted`) when the model has it. Otherwise the role,
  like every other context variable, stays free, so "impossible" means
  impossible for every value of the free context.
- **Two units are compared:**
  - **Goals.** The formal side is R2 reachability, with R4 reasons when
    unreachable. The observed side is `goal.reached` sessions.
  - **Semantic targets.** The formal side asks whether any action on the target
    can be enabled: R8 checks that its precondition is reachable, and the
    counterexample gives the witness. The observed side is
    `semantic_target.activated` sessions. An activation is an attempt, not
    proof of success.
- **Classes** (spec §142):
  - `possible-observed`;
  - `possible-unobserved`, only when the role has at least `minSessions`
    sessions (default 30), otherwise `insufficient-data`;
  - `unexpected-observed`;
  - `impossible-unobserved`;
  - `unknown`.
- **Discrepancies.**
  - `unexpected_observed` is high priority. It carries the observed counts, the
    model's product-semantic reasons, and candidate causes (authorization or
    business-rule bug, extraction error, role or context error, event-mapping
    error). It is reported from a single occurrence, because rare unexpected
    behavior matters.
  - `unobserved_reachable` is low priority. It carries a witness path and
    candidate explanations (hard to discover, rare cohort, new functionality,
    instrumentation gap, over-approximation).
  - Neither ever asserts which cause is true.
- **CLI.** `pathcompiler observe reconcile [directory] [--model]` reconciles
  the extracted (or given) model with the stored events. It writes
  `reports/reconciliation.json`, which for extracted models includes model
  coverage and uncertainties.

## Alternatives

- **Comparing observed transitions edge by edge with formal actions.**
  Observed sequences skip uninstrumented states, so edge-level mismatches
  would mostly be instrumentation noise. Rejected for now in favor of
  goal-level and target-level reconciliation.
- **Requiring `minSessions` before reporting unexpected behavior.** A handful
  of forbidden actions is exactly what must surface. Rejected for that class.

## Consequences

Mode 3 (Observe) now closes the loop from events to formal-model
discrepancies. O9 and O10 (efficiency, drop-off with formal alternatives) need
R7 and R6. Model repair from runtime contradictions (§148) stays a human,
proposal-based action.
