# ADR 0065 — Generalized browser verification

## Context

Phase 10's `verifyFixtureWorkflow` replays only the fixture's four-step
Create Client path. C8 generalizes it to approved workflows, with:
- a safe action allowlist;
- explicit input bindings;
- candidate and preview origins;
- browser evidence as a distinct evidence class.

The acceptance has three parts: all fixture workflows verify, stale or
ambiguous targets fail clearly, and no destructive action runs outside the
declared allowlist. Mode 5, I4 and P3 need it.

## Decision

- **`verifyWorkflowInBrowser(workflow, { page, origin, inputs, policy,
  prepare, version })`** in `workflow-validator/browser` returns
  `BrowserVerificationReport` v2 (`evidenceClass: "browser"`). The Phase 10
  runner is unchanged.
- **Preflight runs before any action:**
  - schema and status checks (candidate or approved);
  - origins: loopback, or listed in `policy.origins` for candidate or preview
    deployments; no credentials, path, query or fragment;
  - one route entrypoint, and linear steps only (branches and optional steps
    are refused);
  - action kinds from `policy.actions` (default click, input, select,
    navigate; `explain` is a no-op and `wait` is refused);
  - an explicit binding for every input and select (values never come from
    evidence);
  - `DESTRUCTIVE_PATTERN` targets (delete, remove, deactivate, archive,
    revoke, disable…) must be listed in `policy.allowDestructive`;
  - a terminal the browser can observe (not `explicit_next`, events,
    permissions or flags).

  A refused workflow leaves the page untouched.
- **Run:**
  - optional `prepare(page)` establishes preconditions (records, role,
    flags);
  - then the entry route, each step on its unique `data-pathcompiler` target,
    expected conditions and the terminal (`all` and `any` supported);
  - leaving the origin aborts the run. Zero matches is `target-not-found` and
    several is `ambiguous-target`, each with the step and target, and nothing
    is clicked.
- **Evidence:** `browserEvidenceItem(report)` turns a report into a P0
  `EvidenceItem` of class `browser` (supports or contradicts).
- **Discovery fix (ISSUES_LOG #23).** An entry nested in another
  capability's dialog now starts with the test's click that opened that
  dialog, so the discovered Deactivate Client candidate replays.
- **Evaluation truth:** expected workflows may list `alternativeSteps`, and
  candidates are scored against the closest acceptable path. The fixture's
  Deactivate Client lists both of its paths.

## Alternatives

- **Inferring input values from test evidence.** Rejected, as in Phase 10:
  values must be explicit so verification never replays recorded personal
  data.
- **Blocking destructive actions by API method instead of target words.**
  The runner sees the UI, not the requests it causes. Target and instruction
  words are checked before acting, and an explicit allowlist is the
  override.

## Consequences

All five discovered fixture workflows verify in the browser, with
preconditions supplied by `prepare`. I4 (browser candidate verification) and
P3 (browser failure diagnosis) can build on the v2 report, and mode 5 can add
browser checks.
