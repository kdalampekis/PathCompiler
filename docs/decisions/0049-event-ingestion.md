# ADR 0049 — Event ingestion endpoint

## Context

Phase O5 gives semantic runtime events (ADR 0044) a destination: an
ingestion endpoint in `http-service`, as roadmap O5 specifies. The endpoint
must validate, filter for privacy, isolate projects and rate-limit. Hosted
multi-tenant ingestion is deferred (MASTER_ROADMAP §5).

## Decision

- **`POST /v1/events/batch`**, with the body `{ "events": [...] }`. The
  endpoint is off unless `HttpServiceOptions.events` is configured: it answers
  `404 ingestion-disabled`.
- **Per-event validation and privacy filtering.** Every event goes through
  `validateEvent` with the configured `PrivacyPolicy`, which defaults to no
  context keys, no PII and hashed user IDs. Invalid events are rejected
  individually and the rest are accepted. The response is
  `{ accepted, rejected: [{ index, issues }] }`, and rejected events are never
  stored.
- **Project isolation.** One service serves one project (`client.project`).
  Events for another `projectId` are rejected per event. Each sink keys its
  storage by project.
- **Limits.**
  - Up to `maxBatch` events per request (default 500), otherwise
    `413 batch-too-large`.
  - A fixed-window rate limit per project (default 10 000 events per 60 s),
    otherwise `429` with `retry-after`.
  - The existing body-size limit still applies.
- **Auth.** The API token works as before. An optional `ingestToken`
  (at least 16 characters) is accepted only on the events endpoint, so a
  browser build never holds the API token.
- **Sinks.** `EventSink { append(projectId, events) }`, `InMemoryEventSink`,
  and `createFileEventSink(directory)`, which appends canonical NDJSON to
  `<directory>/<project>/<UTC day>.ndjson`. O6 reads this format.
- **SDK.** `FetchTransport` in `analytics-sdk` posts batches to the endpoint.
  - 429 and 5xx responses throw, so the SDK retries.
  - Other client errors and per-event rejections go to `onRejected` and are
    not retried.
  - `keepalive` is available for page unload.
- **CLI.** `pathcompiler serve --events` enables a file sink under
  `<out>/events`. `PATHCOMPILER_INGEST_TOKEN` optionally sets the ingest-only
  token.

## Alternatives

- **Rejecting a whole batch when one event is invalid.** One bad event would
  then lose the valid ones. Rejected in favor of per-event results.
- **A database sink.** No real requirement justifies one yet (AGENTS.md).
  NDJSON files are inspectable and replayable.

## Consequences

The local loop now works end to end: SDK → endpoint → stored events → O6.
Cross-origin browser posting needs CORS, which the service does not send yet
(ISSUES_LOG #15). Same-origin proxies work today.
