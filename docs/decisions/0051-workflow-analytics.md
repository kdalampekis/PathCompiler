# ADR 0051 — Workflow analytics

## Context

Phase O7 computes per-workflow analytics (reasoning spec §145) from guide
lifecycle events (O3) and target activations (O2), with sample thresholds
(MASTER_ROADMAP §4: minimum sample sizes before any conclusion). Segmenting by
role or release must stay privacy-safe.

## Decision

- **`computeWorkflowAnalytics(events, { minRuns, minSegmentSize, release })`**
  in `@pathcompiler/observed-graph`. It sits next to the observed graph,
  because both aggregate observed behavior and neither depends on the formal
  model.
- **Runs.** Within a session, `workflow.started` opens a run for a workflow
  version, and `workflow.completed` or `workflow.abandoned` closes it. A
  restart, or the end of the session, closes an open run as **unfinished**.
  Unfinished is reported separately and is never counted as abandoned.
- **Per workflow version:**
  - starts by trigger;
  - completions;
  - abandonments by reason;
  - unfinished runs;
  - `completionRate`, which is completions divided by starts;
  - median and p95 duration (nearest rank; the reported `durationMs`, or the
    time since start);
  - the median number of semantic-target activations per completed run;
  - a step funnel: runs that reached each step, in first-seen order;
  - role and release segments.
- **Thresholds.**
  - Rates are `null` until a workflow version, or a segment, has `minRuns`
    starts (default 30). Raw counts are always reported.
  - Segments with fewer than `minSegmentSize` starts (default 5) are merged
    into `(suppressed)`, so small cohorts cannot be singled out.
- **CLI.** `pathcompiler observe workflows [--release]` writes
  `reports/workflow-analytics.json`.

## Alternatives

- **Counting an unfinished run as abandoned.** This inflates abandonment
  whenever sessions are cut off by tab closes or missing telemetry. Rejected.
- **Showing rates for any sample size.** That invites conclusions from
  anecdotes. Rejected.

## Consequences

O8–O10 can use these per-version measurements. Plan-tier and feature-flag
segments (§145) need allowlisted context keys and are left for when real
context exists.
