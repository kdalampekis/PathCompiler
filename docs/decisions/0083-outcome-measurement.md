# ADR 0083 — Outcome measurement (I6)

## Context

Reasoning spec §206–§210 and §247 ask for an `OutcomeAssessment` that
compares control with treatment, or before with after, using existing
observability data:
- primary and secondary metrics, and guardrails;
- an outcome of improved, neutral, worse or inconclusive;
- formal and behavioral improvement kept separate. Formal success with
  worse completion is not an improvement.

## Decision

- **New `@pathcompiler/outcome-analysis`.** `measureOutcome({ spec, events,
  evaluationStatus })`:
  - it parses the I5 spec and refuses edited criteria;
  - the arms are the control and treatment releases, filtered to the
    population's roles;
  - concurrent arms and before/after cannot be told apart from events, so
    the design is `release-comparison`.
- **Metrics measurable from events:**
  - **completion and reach metrics:** the share of arm sessions that
    reached the goal, or, for guided workflows, completions ÷ guide starts.
    Each comes with a 95% Wilson interval.
  - **everything else** (path efficiency, unexpected observations) needs the
    formal model, so it is listed as an evidence gap and never guessed.
  - **For each metric:** relative change, significance (the intervals do
    not overlap) and sufficiency (both arms reach `minSessionsPerArm`).
- **Guardrails** are breached only when the treatment is significantly
  worse, by more than `maxDegradation`, on sufficient samples.
- **Outcome, in order:**
  1. any breached guardrail gives worse;
  2. an unmeasurable or under-sampled primary metric gives inconclusive;
  3. a significant change in the wrong direction gives worse;
  4. a significant change at least as large as the frozen minimum gives
     improved;
  5. a change below the minimum gives neutral;
  6. otherwise (a large change with overlapping intervals) inconclusive.
- **The formal side** is reported separately (`formal.status`, from the
  candidate evaluation), as §210 requires.
- **CLI.** `experiment measure <experiment.json> [evaluation.json]` reads the
  stored events and writes `reports/outcomes/<experiment>.json`.

## Alternatives

- **Frequentist tests with p-values.** The interval non-overlap rule is
  conservative and consistent with O11, O12 and P5. Sequential testing can
  come with an experiment-platform adapter (I10).
- **Estimating unmeasurable metrics.** That would turn gaps into fabricated
  evidence.

## Consequences

- I7 turns the outcome into an adoption recommendation that a human
  approves.
- Guardrails that need the formal model are not yet measured (ISSUES_LOG
  #47).
