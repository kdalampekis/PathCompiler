# ADR 0045 — Lightweight analytics SDK

## Context

Phase O1 adds the framework-independent analytics SDK (reasoning spec §134,
§140, §158) on top of the O0 event model (ADR 0044). The SDK must:
- be opt-in;
- send nothing over the network by default;
- enforce the privacy policy on every event;
- never break the host application;
- leave the customer's existing analytics stack in place.

## Decision

- **New `@pathcompiler/analytics-sdk`**, which depends only on
  `observability-core`. `createAnalytics(options)` returns:
  - `track(type, fields)` for any of the eight event types;
  - lifecycle helpers: `workflowStarted`, `workflowStepReached`,
    `workflowCompleted`, `workflowAbandoned`, `targetActivated`,
    `goalReached`, `routeChanged`, `actionBlocked`;
  - `setContext` for sticky route, role, locale, hashed user ID and allowlisted
    context; the call's own fields win;
  - `flush`, `shutdown` and `stats`.
- **Off by default.** Unless `policy.enabled` is true, every call is a no-op:
  nothing is queued, no timer starts, and the transport is never called.
- **Privacy.** Every event is built by the O0 factory with the configured
  policy, which binds project, session and release. A rejected event is
  counted and reported through `onError` (default `console.warn`). It is never
  thrown into the application, and it is never sent.
- **Batching.**
  - A full batch (`batchSize`, default 20) is sent at once.
  - A partial batch is sent after `flushIntervalMs` (default 5 s).
  - One send runs at a time.
  - A failed send keeps its events for the next attempt, which waits for the
    timer rather than retrying in a loop.
  - The queue is bounded (`maxQueue`, default 1000); the oldest events are
    dropped and counted.
  - Clock, IDs and timers are injectable, so tests are deterministic.
- **Transports.** `AnalyticsTransport { send(events) }` with
  `InMemoryTransport` (the default) and `ConsoleTransport` (canonical JSON
  lines). Hosted ingestion is O5, and adapters for Segment, PostHog and similar
  come later. Customers wrap their own stack in a custom transport.

## Alternatives

- **Throwing on invalid events.** Analytics would then break product flows.
  Rejected; errors are reported through `onError`, and AGENTS.md's "do not
  swallow errors" is met by reporting.
- **A network transport in O1.** Out of scope: the spec says no hosted
  ingestion yet.

## Consequences

O2 (React semantic-target events), O3 (guide lifecycle telemetry) and O4
(domain events) can emit through this SDK. Nothing changes for applications
that do not create an analytics instance.
