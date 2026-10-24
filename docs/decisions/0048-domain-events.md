# ADR 0048 — Explicit domain events and goal checks

## Context

Phase O4 adds application-emitted business events (reasoning spec §138:
`track("client.created")`, `goalReached("clients.created")`). These can later
confirm formal goals and workflow terminal states (O8). ADR 0044 deferred them
to O4.

## Decision

- **A ninth event type, `domain.event`, in `observability-core`.** Its only
  field is `name`, a semantic ID such as `client.created`. There is no payload,
  so domain events cannot carry user content. The union grows additively under
  schema version 1, which is acceptable because no ingested event store exists
  yet.
- **`analytics.domainEvent(name)`** in the SDK.
- **Optional allowlists.**
  - `goals`: Formal Product Model goal IDs, for example
    `model.goals.map((goal) => goal.id)` from an extracted or hand-written
    model.
  - `domainEvents`: declared event names.

  When set, a `goal.reached` or `domain.event` outside the list is rejected,
  counted and reported through `onError`, so typos such as `clients.creatd`
  never pollute the data. Without the lists, only the semantic-ID schema
  applies.
- **No mapping from domain events to goals here.** Matching a domain event to
  a goal is reconciliation (O8).

## Consequences

Applications can report business outcomes alongside guide and target events.
The goal list ties observed events to the formal model's vocabulary. Delivering
those IDs to browser builds, for example in a compiled artifact, is left until
a real integration needs it.
