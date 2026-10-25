# ADR 0074 — Browser failure diagnosis (P3)

## Context

C8 (ADR 0065) reports a failed browser run with a stage (preflight,
prepare, open, resolve, action, expected or terminal), a code and the
failing target. Reasoning spec §54 asks that failures be ranked by cause:
- stale target;
- permission mismatch;
- feature flag mismatch;
- backend behavior changed;
- formal model wrong;
- network issue.

The roadmap's acceptance is that seeded failures rank the true cause first.

## Decision

- **`diagnoseBrowserFailure` (workflow-validator, no Playwright).** Each
  cause is a binary `behavior` claim, "this cause explains the failure".
  Deterministic signals become evidence items for or against it, P0 fusion
  assesses each claim, and causes are ranked by:
  1. supported first;
  2. band;
  3. deciding tier;
  4. net support;
  5. the spec's order.

  `top` is null unless the first cause is supported. The result is labeled
  `hypothesis`.
- **Signals:**
  - **browser** (from the report): transport errors and `origin-unavailable`;
    a missing or ambiguous target; a blocked control (resolve or action
    stage); an outcome missing after every action succeeded (expected or
    terminal stage). Each signal supports the causes it fits and contradicts
    the others: a later failure means the targets resolved, and a reached
    page means transport worked.
  - **static:** whether the failing target is still in the candidate's
    source, and, when known, whether endpoints changed since the approved
    commit.
  - **formal:** the failing target's actions in the R1 model. Their
    preconditions' context guards (allowed roles, required flag values) are
    evaluated against the run's context. A guard that excludes the run's
    role or flags supports permission or flag mismatch. A model that
    allows the action where the page blocked it supports "formal model
    wrong".
- **Policy refusals** (preflight) contradict every cause: they are not
  product failures.
- **The report schema** moved to `browser-report.ts`, so diagnosis and the
  CLI can validate reports without loading Playwright. `browser-workflow.ts`
  re-exports it.
- **CLI.** `diagnose <browser-report.json> [directory] [--context name=value
  ...]` analyzes the directory for the model and targets, and writes
  `reports/diagnosis.json`.

## Alternatives

- **Solver-based diagnosis** (R2 reachability under each context). The
  failing target's guards answer the question directly, without a solver;
  R2 remains for whole-workflow questions.
- **Fixed rule priority** (if not found, then stale). That conflates causes:
  a role can hide a control just as a rename can. Fusing several signals is
  what separates them.
- **Information-gain test selection** (§55). It is deferred by the spec
  until basic diagnosis works.

## Consequences

- **Seeded browser failures on the fixture rank the true cause first:**
  editor role (permission), flag off (flag), renamed target (stale), closed
  port (network). Unit tests add outcome failures with and without changed
  endpoints (backend versus model).
- The CLI does not compute changed endpoints yet, so outcome failures stay
  undecided between backend and model there (ISSUES_LOG #38).
