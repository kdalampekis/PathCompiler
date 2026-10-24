# ADR 0044 — Semantic runtime event model

## Context

Phase O0 starts the observability track (mode 3, Observe). The track needs a
typed event model (reasoning spec §134–§139, §152, §156) that later phases
build on: the analytics SDK (O1), framework integrations (O2–O3), the observed
transition graph (O6) and reconciliation with the formal model (O8). Privacy
is a hard requirement: there is no raw user content by default, and analytics
never replace tests or formal reasoning (ADR 0032, ADR 0033).

## Decision

- **New `@pathcompiler/observability-core`.** It is browser-safe (Zod only,
  no Node imports) and has no transport.
- **Eight event types** (spec §135–§136, §152), forming a discriminated union
  `ProductRuntimeEvent`:
  - `workflow.started` (trigger: guide, assistant or organic);
  - `workflow.step_reached`;
  - `workflow.completed`;
  - `workflow.abandoned` (with a reason);
  - `semantic_target.activated` (interaction kind only);
  - `goal.reached` (a Formal Product Model goal ID);
  - `route.changed`;
  - `action.blocked` (permission, feature flag or precondition).

  Workflow events require `workflowId` and `workflowVersion` (C1). Explicit
  domain events (`track("client.created")`) belong to O4.
- **Common base (`RuntimeEventBase`).** `schemaVersion`, `eventId`,
  `timestamp`, `projectId`, `release` (§156), `workflowId`,
  `workflowVersion`, `semanticTarget`, `sessionId`, `anonymousUserId`,
  `route`, `role`, `locale`, a bounded `context`, and `privacy { pii,
  userIdHashed }`.
- **Privacy is in the schema, not only the SDK.**
  - Strict objects reject unknown fields, so raw values, DOM, coordinates and
    keystrokes cannot be attached.
  - Semantic targets must be semantic IDs.
  - Routes must be paths without query strings or fragments.
  - `validateEvent(event, policy)` adds the `PrivacyPolicy` rules (spec §139
    defaults: `enabled: false`, `collectPii: false`, `hashUserIds: true`, no
    context keys):
    - context keys must be allowlisted, and keys containing sensitive words
      (email, password, name, value, …) are refused even if allowlisted;
    - `privacy.pii` needs `collectPii`;
    - with `hashUserIds`, `anonymousUserId` must be a salted SHA-256
      (`hashUserId`, Web Crypto).
- **Deterministic serialization.** `serializeEvent` writes canonical JSON with
  sorted keys. `parseEvents` reads newline-delimited events, the storage format
  for the ingestion phases.
- **Release binding.** `createEventFactory({ projectId, sessionId, release,
  policy, now?, nextId? })` builds validated events with these bound. The
  clock and ID generator are injectable, so tests are deterministic.

## Alternatives

- **Generic `click` or `input` events with selectors.** That is session
  replay, which spec §135 rules out. Semantic targets are the anchor (§137).
- **Enforcing privacy only in the SDK.** Events from custom emitters or
  imports would bypass it. Rejected in favor of schema-level enforcement.

## Consequences

O1 can implement batching and transports on top of the factory and validator.
Event types carry no free-text field, so adding one later requires an ADR and a
schema version bump.
