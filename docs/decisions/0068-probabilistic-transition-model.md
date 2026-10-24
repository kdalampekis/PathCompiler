# ADR 0068 — Probabilistic transition model

## Context

Phase O11 (reasoning spec §158) asks for estimates of empirical transition
probabilities, with sample thresholds. It is the input to P5 (probabilistic
model checking). The observed transition graph (O6) already counts
transitions and their shares, but has no uncertainty and no chain semantics.

## Decision

- **`buildTransitionModel(graph, { minTransitions })`** in `observed-graph`
  turns the observed graph into a discrete-time Markov chain:
  - per state, the outgoing transition probabilities (count ÷ the state's
    outgoing total), each with a **95% Wilson score interval**
    (`wilsonInterval`);
  - a state is `sufficient` with at least `minTransitions` (default 30)
    outgoing transitions;
  - `session:end` and states with no outgoing transitions are absorbing.
- **Goal reach estimates:** for each `goal:` state, the probability that a
  session starting at `session:start` eventually reaches it, by value
  iteration on the chain (cycles allowed). Each estimate is `sufficient`
  only when every state on a path to the goal is sufficient.
- The report is `meaning: "estimate"`: it describes observed users, never
  what the product allows (that is the formal model).
- **CLI:** `pathcompiler observe transitions [--release <id>]` writes
  `reports/transition-model.json`. It is gated by `modes.observe`.

## Alternatives

- **Bayesian (Dirichlet) posteriors per state.** These are richer, but need
  a prior choice. Wilson intervals are standard, prior-free and enough to
  flag thin data. P5 can add posteriors when it needs them.
- **Higher-order (history-dependent) chains.** They need far more data per
  state. First-order is the honest default, and history is visible in O6's
  paths.

## Consequences

P5 is unblocked: it can check probabilistic properties (for example
"P(reach goal) ≥ 0.8") against this chain. Release-specific chains come from
the `--release` filter, which O12 compares.
