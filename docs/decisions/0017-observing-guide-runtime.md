# ADR 0017 — Observing guide runtime

## Context

Phase 15 needs a stateful, route-aware guide runtime with pausing, explicit
stopping, timeouts and a target-not-found fallback. It has to work without
React, with React as an adapter. Autonomous destructive execution is out of
scope (AGENTS.md).

## Decision

- `runtime-core` exports `createGuideRuntime({environment, context, clock, ...})`,
  a state machine over a `GuideEnvironment` interface (`route`, `query(target)`,
  `subscribe`). `createDomEnvironment` implements it with `data-pathcompiler`
  queries, a MutationObserver, capture-phase click/input/change listeners and
  popstate. The runtime **observes only**. It never performs actions, which keeps
  guidance separate from execution.
- Statuses: `idle`, `waiting-route`, `active`, `target-missing`,
  `awaiting-completion`, `paused`, `completed`, `stopped`, `timed-out`, `failed`.
- Steps advance on the user's own interaction with the step target (clicks; inputs
  on `change`, so typing does not jump ahead), on the expected condition becoming
  true, on the route for `navigate`, or on `next()` for `explain`, `wait` and
  `explicit_next`. An expectation that is already true when the step starts does
  not advance it without an interaction. This prevents stale success messages
  from skipping steps.
- After the last step the runtime awaits the terminal condition, matching the
  validator's semantics. Advances within one evaluation are bounded by step count.
- A target that has zero or several visible matches after `targetTimeoutMs` is
  reported as `target-missing` (with `none`/`many`). Instructions remain in state
  so hosts can fall back to text. The step recovers when the target resolves.
- Context-based conditions use provided permissions and feature flags.
  Unmet preconditions fail at start.
- The React adapter creates the runtime and DOM environment in an effect (SSR-safe),
  exposes state through `useSyncExternalStore`, refreshes on the `route` prop, and
  loads manifests through the SDK.

## Alternatives

- Drive the UI programmatically ("do it for me"): this is execution, deferred and
  requires authorization design.
- Patch `history.pushState` to detect SPA navigation: global side effects; the host
  router's route prop is explicit.
- Advance input steps on every keystroke: jumps ahead mid-typing.

## Consequences

The compiled `clients.create` manifest guides a real user path in the production
fixture (verified with Playwright), including client-side navigation and the
viewer fallback. Repeated targets (table rows) report `many` until scoped targets
are designed. Visibility is style-based (`display`, `visibility`, `hidden`), not
layout-based.
