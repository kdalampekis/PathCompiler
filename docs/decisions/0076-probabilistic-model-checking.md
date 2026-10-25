# ADR 0076 — Probabilistic model checking (P5)

## Context

Reasoning spec §58–§59 asks four questions of observed behavior, once
meaningful telemetry exists:
- what is the probability of completion?
- how many actions does completion take, on average?
- what is the probability of abandonment?
- did a redesign increase completion probability?

O11 (ADR 0068) estimates the observed Markov chain, with 95% Wilson
intervals per transition and point reach probabilities. Point estimates
alone overstate certainty on small samples.

## Decision

- **`checkGoal(model, goal)` (observed-graph)** reports:
  - **reach and abandonment probability**, as a point estimate with lower
    and upper bounds. The bounds come from robust value iteration over the
    interval Markov chain defined by each state's Wilson intervals: the
    least and greatest reach probability that any distribution inside the
    intervals allows.
  - **expected transitions from session start to the goal**, given that it
    is reached (the conditioned chain).
  - **sufficiency**, taken from O11.
- **Unobserved transitions are not assumed impossible.** Each state gets a
  virtual successor whose probability is at most the Wilson upper bound for
  zero observations. It is worth 0 to the lower bound and 1 to the upper.
  Without it, a state with one observed successor had bounds of exactly 1
  even after one session.
- **`checkReachProperty`** decides `P(completion) ≥ p` or `≤ p` only when
  the whole interval is on one side of `p`; otherwise the verdict is
  `inconclusive`.
- **`compareReach(base, head, goal)`** reports a redesign's effect as
  increased or decreased only when the two releases' bounds do not overlap.
- **CLI.** `observe check <goal> [--at-least p | --at-most p] [--baseline
  <release>] [--release <id>]` writes `reports/probabilistic-check.json`.

## Alternatives

- **An external probabilistic model checker** (PRISM, Storm). Reachability
  and expected steps on a chain this small need only value iteration, and a
  native backend would add a heavy dependency.
- **Point estimates with a minimum-sample rule** (O11's approach). They
  give no way to decide a property, which bounds do.
- **Bayesian credible intervals** (Dirichlet posteriors with sampling). They
  are less transparent and not deterministic without a fixed seed; the
  interval chain is deterministic and conservative.

## Consequences

- The bounds use per-transition 95% intervals. They are conservative, but
  they are not a joint 95% confidence statement over the whole chain
  (ISSUES_LOG #41).
- Repeated identical states collapse (O6), so "transitions" counts state
  changes, not raw clicks.
- MDP-based guided assistance (§60) remains deferred.
