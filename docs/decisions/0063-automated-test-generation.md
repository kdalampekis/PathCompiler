# ADR 0063 — Automated test generation

## Context

Phase R10 implements reasoning spec §36: formal traces generate positive test
candidates, and unreachability generates negative ones, written under
`.pathcompiler/generated-tests/` for human review. §37 adds that browser runs
are a consistency oracle for the model. The roadmap acceptance is that the
generated positive and negative Playwright candidates run against the
fixture.

## Decision

- **New `@pathcompiler/test-generator`:**
  - **`freshStateModel`** starts every plan from an empty product: existence
    variables (`<entity>_exists`, the formal-abstraction convention) are
    false, so plans create their prerequisites first.
  - **`generateTests({ reasoner, model, graph, setup?, terminals? })`.** For
    each capability goal it writes one **positive** test from the shortest
    plan. It writes one **negative** test for every role value, and every
    flag set to off, under which the reasoner proves the goal unreachable
    (the other context values come from the positive witness). A negative
    test replays the allowed plan and returns as soon as a control is
    missing, vanishes or is disabled. Otherwise it asserts that the
    completion signal is not shown.
  - **Steps** use `data-pathcompiler` targets, chosen per UI node: click,
    fill with sample values (email-shaped for email fields), or select (the
    option an enum action assigns, else the first).
  - **`TestSetupSchema`.** Context goes through a reviewed setup file that
    maps each context variable to a select (with model value → option value,
    e.g. the catch-all `unlisted` → Viewer) or a checkbox. The setup then
    waits for the page to settle. Contexts the setup cannot establish are
    skipped with a reason, never guessed.
  - **Completion assertions** come from test-backed workflow terminals (text,
    count or visibility; `all` asserts each). Without one, a test only checks
    that the dialog closed and is flagged `weakAssertion` with a review
    comment.

  Every file starts with a "candidate, review before adopting" marker.
- **CLI:** `pathcompiler tests generate [directory] --setup <json>` writes
  `<out>/generated-tests/*.spec.ts` and `reports/generated-tests.json`. It is
  gated by `reasoning.planning`.
- **Browser suite:** `@pathcompiler/test-generator test:browser` generates
  from the fixture, using `fixtures/next-demo/eval/test-setup.json`, then
  runs the candidates against a fresh build. It is part of `pnpm test:e2e`:
  15 tests, 6 positive and 9 negative.
- **The browser exposed a model gap**, as §37 intends. Create Plan stays
  disabled until a client exists, but the model allowed it, so the first
  generated plans failed. The formal abstraction now derives **enabling
  conditions from tests**: an entry observed disabled, then used after
  another capability created an entity in the same test, requires that
  entity to exist. This is reported as an `enabling-condition-from-tests`
  uncertainty; "active" versus merely "existing" is not modeled.

## Alternatives

- **Writing generated tests into the product's test directory.** Rejected:
  candidates must never join a suite without review.
- **Executing the setup through product APIs.** That is more robust, but
  product-specific code would live in PathCompiler. A declarative UI setup
  file keeps it reviewable.
- **Asserting "no alert" as the weak check.** Next.js renders a route
  announcer with `role="alert"`, so the check was always wrong. "Dialog
  closed" is used instead, and the weakness is flagged.

## Consequences

Generated candidates now double as a model/browser consistency check. A
failing candidate is a discrepancy to investigate, not a test to delete.
