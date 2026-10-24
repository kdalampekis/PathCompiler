# ADR 0046 — React analytics capture rules

## Context

Phase O2 adds optional analytics to the existing `@pathcompiler/react`
provider (ADR 0032 §7: no second provider). Semantic targets are the anchor
for observation (reasoning spec §137). Capture must stay semantic and must not
read user content (§135, ADR 0044).

## Decision

- `PathCompilerProvider` accepts an optional `analytics` instance (from
  `@pathcompiler/analytics-sdk`) and a `targetAttribute`, which defaults to
  `data-pathcompiler`. Without `analytics`, nothing is attached or emitted.
- **Context.** The provider keeps the analytics context's `route`, `role` and
  `locale` current from its props.
- **Routes.** `route.changed` is emitted for the first route and for every
  change, with `previousRoute`.
- **Activations.** One capture-phase document listener for `click`, `change`
  and `submit` resolves the closest semantic target and emits
  `semantic_target.activated`:
  - `click` on a non-field element → `click`;
  - `change` on a `select` → `select`;
  - `change` on another field → `input`, once per committed change, never per
    keystroke;
  - `submit` → `submit`.

  Clicks on fields and forms are ignored: they are focus or the start of a
  submit, not activations.
- **Privacy.** The listener only reads the target attribute. No value, text,
  DOM snapshot or coordinates are read. Targets that are not semantic IDs are
  rejected by the event schema and reported through `onError`.
- `useAnalytics()` returns the configured instance or `null`, so components
  can emit domain-level events (O4) or lifecycle events (O3).

## Consequences

Applications that already annotate controls get semantic activation data with
one prop. Guide lifecycle telemetry is O3, and explicit domain events are O4.
