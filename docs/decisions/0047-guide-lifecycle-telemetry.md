# ADR 0047 — Guide lifecycle telemetry

## Context

Phase O3 turns guide state transitions into workflow lifecycle events
(reasoning spec §158) for workflow analytics (O7). `runtime-core` is a small,
framework-independent browser engine. It should not depend on analytics.

## Decision

- **Guide state.** `GuideState` gains `version` (the manifest's workflow
  version, from C1), so events carry `workflowId` and `workflowVersion`.
- **`instrumentGuide(guide, analytics, { now? })`** in
  `@pathcompiler/analytics-sdk`. It depends only on a structural `GuideLike`
  type (`getState` and `subscribe`), so the SDK takes no dependency on
  `runtime-core`. Transitions map to events as follows:
  - the first non-idle, unfinished state of a run → `workflow.started`
    (trigger `guide`);
  - each new current step → `workflow.step_reached`, with the index equal to
    the number of completed steps;
  - `completed` → `workflow.completed`, with the duration;
  - `stopped`, `timed-out` or `failed` after the start →
    `workflow.abandoned`, with that reason and the last step;
  - `start` on a running guide returns it to `waiting-route`, which is
    recorded as abandoning the first run and starting a new one;
  - a guide that fails before starting (invalid manifest, unmet precondition,
    manifest mismatch) emits nothing, since it never started.
- **React.** `PathCompilerProvider` instruments its runtime automatically when
  `analytics` is configured.

## Bug found and fixed

Testing the full lifecycle showed that a workflow whose **terminal** condition
is `explicit_next` could never complete. `next()` only handled active steps,
so after the last step the guide stayed in `awaiting-completion`, and only
`stop` got the user out (spec §68: "never trap the user"). `next()` now
completes such runs. A regression test covers it.

## Consequences

O7 can compute completion, abandonment and duration per workflow version from
these events. Abandonment caused by navigation away is not distinguished yet:
the guide runtime keeps waiting rather than failing.
