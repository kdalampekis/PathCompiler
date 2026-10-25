# ADR 0080 — Recommendation model (I1)

## Context

Reasoning spec §178–§183 and §242 describe recommendations: categories
(FIX, IMPROVE, PROMOTE, BUILD, DEPRIORITIZE, INVESTIGATE), an explicit
falsifiable hypothesis, desired outcomes, protected behaviors, acceptance
criteria, and finding confidence kept separate from intervention
confidence. Only gate decisions `recommend` and `eligible_for_harness`
(ADR 0079) may become recommendations.

## Decision

- **New `@pathcompiler/recommendation-engine`.** `recommend({ findings,
  gate, approvedWorkflows, properties })` applies deterministic templates
  per opportunity, with stable IDs `recommendation:<subject>:<category>`.
  - **FIX** (release or permission regressions):
    - required checks: `formal-reachable` for lost reachability, and
      `formal-unreachable` for access a role newly gained (R11 evidence
      `formal:new:`), with "confirm the access was not intended" in the
      hypothesis;
    - intervention prior: medium.
  - **IMPROVE** (friction):
    - desired outcomes: completion up, path efficiency ratio down;
    - outcome check: `observe check --baseline` after release;
    - prior: low.
  - **PROMOTE** (low adoption):
    - desired outcomes: reach probability up, completion held;
    - prior: low (low demand is an alternative explanation).
  - **INVESTIGATE** for anything else.
- **Protected behaviors:** the given R8 properties, and every other approved
  workflow.
- **Required acceptance checks:** each property holds, each approved
  workflow validates, and the target workflow is browser-verified when it
  is approved. Outcome checks are measured after release (I5/I6) and never
  replace the required ones.
- **Confidence:**
  - *finding confidence* is the strongest P0 confidence among the findings;
  - *intervention confidence* is a template prior, labeled
    `template-prior-not-probability`, with its reason.
- **Lineage:** finding IDs, the opportunity ID, and each finding's report
  sources. `harnessEligible` mirrors the gate.
- **CLI.** `recommend [--property <json>]` reads `findings.json` and
  `gate-decisions.json`, and writes `reports/recommendations.json`. With a
  config it needs `modes.recommend`.

## Alternatives

- **Model-written recommendations.** The templates are deterministic and
  reviewable. A provider could later phrase hypotheses, but the structure
  and checks stay template-driven.
- **One confidence number.** That conflates "the problem is real" with "this
  fix works" (§182).

## Consequences

- BUILD and DEPRIORITIZE templates are not produced: there is no workaround
  or demand evidence yet (ISSUES_LOG #45).
- I2 can turn `harnessEligible` recommendations into `HarnessTaskSpec`s;
  I3 (✅) and I4 evaluate candidates against the acceptance criteria.
