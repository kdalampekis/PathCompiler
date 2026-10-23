# ADR 0022 — Deterministic workflow impact

## Context

Phase 20 maps a `GraphDelta` and approved workflows to
`{workflowId, severity, reasons, affectedSteps}` using the spec's rules: removed
semantic target, removed terminal API, changed route and changed permission are
high; a moved file with a stable target and a copy-only change are low or none.
Models may supplement the rules but not replace them.

## Decision

- Add `@pathcompiler/impact-analysis` with pure `analyzeWorkflowImpact`.
  Workflow evidence already uses graph node IDs, so the rules join the delta
  against each workflow's step targets, expected/branch/terminal/precondition
  targets, entry and navigate routes (`route:<path>`), and evidence IDs.
- The "terminal API" rule is applied to any API in the workflow's evidence. The
  write API is cited there, and a removed API breaks completion either way.
- A target is removed only if its semantic ID does not reappear in the head.
  Location-only target changes are `target-moved` (low). Label-only changes are
  `copy-changed` (low), with the target's derived `name` ignored. Other UI changes
  are `target-changed` (medium).
- Added or removed `REQUIRES_PERMISSION`/`GUARDED_BY_FLAG` edges touching
  evidence nodes, and changed or removed permission/flag nodes, are high.
- If the approved commit differs from the delta base, a medium
  `baseline-mismatch` reason states that earlier history was not analyzed.
- A file-level `source-file-changed` (low) applies only when an evidence file
  changed but no node-level reason explains it. It attributes no steps.
- Output is sorted (severity, then ID, then reason) and validated.
  `pathcompiler impact <base> <head>` writes the delta and the impact report.

## Alternatives

- Treat every file change as medium: buries real breakage in noise.
- Graph reachability from changed nodes: needs both full graphs, and the explicit
  evidence links already identify the dependent workflow elements.
- Model-scored impact: non-deterministic, and model use is optional by policy.

## Consequences

The fixture's renamed target is high on exactly the affected step, and its label
edit is low. Unexplained edits inside a shared component are low with no step
attribution, so a reviewer may need to inspect them. Proposals (Phase 21) consume
medium/high impacts.
