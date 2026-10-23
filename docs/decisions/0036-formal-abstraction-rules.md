# ADR 0036 — Formal abstraction rules

## Context

Phase R1 adds `@pathcompiler/formal-abstraction`. It derives a candidate Formal
Product Model (ADR 0035) from the Product Graph, capability report and mined
Playwright traces. Two later phases constrain the design:

- R-WI will compare reasoning-assisted discovery with test-backed discovery. The
  abstraction therefore must not read workflow candidates, or the comparison
  would only round-trip discovery's own output.
- R2 and R8 will draw formal conclusions from the model. Gaps must be visible
  and must lean toward sound `UNREACHABLE` claims, never silent ones.

## Decision

- **Inputs.** Only the graph, capabilities and traces are read, never
  `workflow-discovery`. The scan must be committed, and capabilities and traces
  must come from the same commit. Otherwise the call fails with an actionable
  error.
- **Context variables.** Role permissions (`role:<r>`) become one `role` enum
  plus `unlisted` for roles never checked in code. Named permissions become
  `can_<name>` booleans, and feature flags become `<flag>_enabled` booleans.
- **Areas.** `current_area` holds one value per capability route and per
  `NAVIGATES_TO` target of a UI control, plus `OTHER`. Each navigation link is a
  deterministic action that sets the area and closes every dialog.
- **Dialogs** are UI nodes tagged `dialog`, or tagged with the name of a
  component that exposes a `dialog` element (for example `Modal`). Elements that
  component exposes are dialog chrome, so clicking them cancels.
- **Test sessions.** A session starts with a click on a capability's entry (a
  semantic-target UI control from capability inference). It collects the
  following steps inside dialogs, and ends on navigation, reload, a new
  page/context, cancel (chrome or Escape), an interaction outside any dialog, or
  another entry. A session with an unresolved or ambiguous UI step is discarded
  and reported.
- **Session automaton per capability.** Each capability gets `<cap>_open`, plus
  `<cap>_confirming` when there are confirmation-stage buttons: dialog buttons
  that are only ever clicked right after a form submit or another
  confirmation-stage button. Step outcomes come from the observed sequences:
  - the final click of a session commits;
  - a submit followed by a confirmation-stage button asks for confirmation;
  - a confirmation-stage button followed by form interaction goes back;
  - a submit followed by a field edit was rejected.

  Text fields become `<field>_entered`. Selects whose observed values are all
  literal strings become enums. A capability with no committing session is not
  modeled and is reported.
- **Required fields** are fields entered before every commit that were also
  missing at a rejected submit. Without a rejection, no field is required.
- **Guards** come only from permission and flag edges on the capability's API
  handler or on a function it calls. Only actions that commit (and so call the
  API) carry them. UI-level component guards are reported as
  `ui-guard-not-modeled` and are not applied.
- **Over-approximation.** When the deciding condition is unknown, every observed
  outcome is modeled. For example, a submit that sometimes commits and sometimes
  asks for confirmation gets two actions. Entity existence (`<entity>_exists`)
  is unconstrained initially, and only row-scoped entries require it. A
  completion goal `<domain>.<qualifier_><past-tense verb>` is separate from
  existence, so it is false initially.
- **Report.** The call returns `{ model, coverage, uncertainties }`.
  - Coverage counts transitions by basis (deterministic, tests, runtime,
    semantic-only; reasoning spec §85), lists the rules behind each action, and
    shows which capabilities were or were not modeled and how many test sessions
    were used or discarded.
  - Each uncertainty names a kind, a subject and the graph nodes behind it.
  - Output is canonical and independent of input order.

## Comparison with the R0 hand model

For `fixtures/next-demo`, every hand-model action has an extracted counterpart
with the same semantic target and capability, and both goals match by ID. The
remaining differences are each reported:

- Entries carry no role or flag guard (`ui-guard-not-modeled`). For the same
  reason, the hand model's `security.viewer_cannot_edit` invariant has no
  extracted counterpart. Only the structural invariants are extracted.
- The weekly → simple confirmation rule is replaced by two outcomes for the
  submit (`outcome-condition-unknown`).
- The selected structure is not stored on the plan (`value-not-persisted`).
- Client and plan existence are separate from the creation goal.
- The extracted model also covers clients.edit, clients.deactivate and
  plans.create, plus the back and cancel paths and the home link.

## Alternatives

- Derive the model from workflow candidates. Rejected: R-WI could no longer
  compare the two discovery paths.
- Apply component-level permission/flag edges as preconditions. This restricts
  behaviour on heuristic evidence, which could turn real paths into
  `UNREACHABLE`. Rejected for R1, and reported instead.
- Infer the confirmation condition from the few observed values. This is
  overfitting to a single sample per branch. Optional semantic assistance (C5,
  C9) or a later data-flow pass can propose such conditions as uncertain
  evidence.

## Consequences

R2 can encode extracted models directly. Conclusions about the model must be
read alongside its coverage and uncertainties (reasoning spec §84–§86). Business
rules that live in handler bodies (validation, state-dependent branches, stored
values) remain uncertainty entries until a data-flow or semantic phase proposes
them. Repositories without tests produce only navigation transitions and
report every capability as not modeled.
