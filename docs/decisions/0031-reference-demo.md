# ADR 0031 — Reference demo as the MVP definition of done

## Context

Phase 30 requires the fixture to demonstrate the full loop: scan, graph,
discovery, approval, compile, resolver, custom assistant answer, navigate action,
interactive guide, code change, impacted workflow, update proposal, approval and
new runtime output. That is the first true MVP definition of done.

## Decision

- `examples/reference-demo` runs every non-browser step through the public CLI
  (`runCli`) and SDK on a fresh Git copy of the fixture. It reuses the
  custom-assistant example and records a JSON transcript.
  `pnpm --filter @pathcompiler/reference-demo demo` prints the narrative.
- The copy lives inside the workspace (`examples/reference-demo/.work`, ignored)
  with the fixture's `node_modules` linked, and `turbopack.root` is set to the
  repository. As its own Git repository the copy can be committed and changed, and
  it can still be built: Turbopack refuses dependencies outside its root, and
  stops its root search at a Git boundary.
- A Playwright suite serves the unchanged fixture (base) and the changed copy
  (head) as production builds. On base it verifies the navigate action and
  guides Create Client to completion with the compiled runtime manifest. On head it
  verifies that the rebuilt manifest guides Change Plan Structure through the
  renamed target, and that the previous manifest reports `target-missing` instead
  of misguiding.

## Alternatives

- Modify the committed fixture in place: tests would race, and history would
  churn.
- Copy outside the repository with symlinked dependencies: Turbopack rejects it.
- Verify only artifacts, not browsers: steps 8, 9 and 14 are user-facing
  behavior.

## Consequences

`pnpm test:e2e` now proves the MVP loop end to end, at the cost of two extra
production builds. The demo's code change is a rename. Other change classes are
covered by the impact, proposal and deprecation suites.
