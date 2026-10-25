# ADR 0082 — Experiment specification (I5)

## Context

Reasoning spec §200–§203 and §246: when a recommendation is best validated
behaviorally, PathCompiler specifies an experiment. That covers:
- the hypothesis;
- control and treatment;
- the population and allocation;
- the primary and secondary metrics and the guardrails;
- the success criteria, the observation window and the stop conditions.

Everything is defined before measurement, to avoid evaluation bias, and
nothing is deployed automatically. Deployment and experiment providers stay
external (§202–§205).

## Decision

- **New `@pathcompiler/experiment-core`.** `createExperimentSpec` takes a
  recommendation, its candidate evaluation, and the control and treatment
  releases.
  - **Only IMPROVE and PROMOTE recommendations** get experiments. FIX is
    validated by its acceptance checks.
  - **The evaluation must have passed** (`pass` or `pass_with_warnings`),
    and it must belong to the same recommendation when it names one.
  - **The I3 `eligibleForExperiment` flag is not required.** It needs a
    declared reachability change, and behavioral improvements usually have
    none.
- **The spec:**
  - **Metrics:** the primary metric is the first desired outcome that is
    not "hold"; the rest are secondary.
  - **Guardrails:** held hypothesis effects, the completion of every other
    approved workflow (protected behaviors), and no unexpected observations
    on the subject (zero tolerance). The default maximum degradation is
    0.02.
  - **Allocation:** 50/50 by session.
  - **Success:** at least 10% relative improvement, at least 30 sessions per
    arm, and 95% intervals that do not overlap.
  - **Stop conditions:** a guardrail breach, or a formal/runtime
    discrepancy.
  - **Deployment:** `not-automated`.
- **Freezing:** `frozenAt`, and `frozenHash`, a sha256 of the canonical
  criteria. `parseExperimentSpec` refuses a spec whose criteria were edited
  after freezing.
- **CLI.** `experiment create <recommendation-id> <evaluation.json>
  <control-release> <treatment-release>` writes `experiments/<id>.json`.

## Alternatives

- **Integrating an experiment platform now** (LaunchDarkly, Statsig,
  GrowthBook). This is deferred by the spec (I10). The spec is
  provider-neutral, so an adapter can map it later.
- **Letting reviewers set the criteria after the release.** That is the bias
  §201 forbids. The hash makes post-hoc edits detectable.

## Consequences

- I6 measures control and treatment against a frozen spec.
