# ADR 0025 — Reviewed workflow deprecation

## Context

Phase 23 generates a deprecation proposal when a workflow loses critical
implementation support: semantic targets missing, API gone, route gone, or a
replacement capability detected. Approved workflow files must not be deleted
automatically.

## Decision

- Deprecation is a second proposal kind in `@pathcompiler/workflow-proposals`
  (`workflow-deprecation-proposal`). It shares file naming and review states
  with update proposals.
- It is generated instead of an update when a high impact contains a
  support-loss reason (`target-removed`, `condition-target-removed`,
  `api-removed`, `route-removed`) **and** no head-commit candidate matches. If a
  candidate matches, support moved, and an update is proposed (ADR 0023).
  Medium-only no-match cases stay manual update proposals.
- A replacement is suggested, not assumed: a capability new at head (absent at
  base) in the same domain and entity, chosen by stable ID order.
- `DeprecatedWorkflowSchema` (`workflows/deprecated/<id>.yaml`) keeps the full
  workflow with `status: deprecated` plus `deprecatedBy/At/Commit`, reasons,
  replacement and note.
- `acceptDeprecation` (pure) refuses if the approved workflow's revision changed
  since generation. The CLI writes the deprecated record exclusively, records
  the decision, and only then removes the approved file. This happens only on
  explicit acceptance, so the runtime source of truth stops serving the workflow.
  Reject and ignore change nothing.
- Listing precedence: approved > deprecated > rejected > candidate. Re-approval
  of a deprecated ID requires removing its record, like a rejection.

## Alternatives

- Keep the approved file and filter deprecated IDs at build time: two
  contradictory sources of truth.
- Mark `status: deprecated` inside the approved record: breaks the
  approved-record invariant that its workflow is approved.
- Deprecate whenever a target disappears: renames and moves would wrongly
  deprecate workflows that have a matching successor.

## Consequences

Removing the Change Plan Structure control yields a deprecation proposal.
Accepting it moves the workflow to `deprecated/`, and the next build serves only
the remaining approved workflows. The replacement heuristic only reports
same-domain, same-entity capabilities.
