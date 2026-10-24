# ADR 0069 — Release behavior diff

## Context

Phase O12 (reasoning spec §158) compares formal and observed behavior across
releases. Events carry their `release` (C1 and O0), R11 computes the formal
semantic diff between two commits, and O11 provides Wilson intervals. A
behavior change without a code change, or the reverse, is a question for the
team, never an automatic bug.

## Decision

- **`compareReleaseBehavior(events, baseRelease, headRelease, {
  formalChanges?, minSessions? })`** in `observed-graph`:
  - a session belongs to the release on its events. Per goal, it compares
    the share of sessions reaching the goal in each release, with 95% Wilson
    intervals. `up` or `down` is called only when the intervals do not
    overlap and each release has `minSessions` (default 30) sessions;
    otherwise `no-change` or `insufficient-data`;
  - **formal changes** are given as `{ goal, direction }` (added or removed
    reachability, from R11). A goal changed both ways is `changed`
    (applicability shifted);
  - **classes:**
    - expected change: formal and observed agree, or formal `changed` with
      any observed change;
    - unexplained behavior change: observed only, which could be UX,
      content, operations or instrumentation;
    - formal change not observed: not yet adopted, or not exercised;
    - stable;
    - insufficient data.

  The report is `meaning: "hypothesis"`.
- **CLI:** `pathcompiler observe release-diff <base-release> <head-release>
  [directory] [--commits <base>..<head>]` writes
  `reports/release-behavior.json`. With `--commits` it runs R11's semantic
  diff between the commits the releases were built from (gated by
  `reasoning.semantic_diff`). Without it, only behavior is compared.

## Alternatives

- **Comparing O11 reach probabilities instead of session shares.** The
  chain's estimates have no simple interval. Session shares do, and are
  easier to explain.
- **Storing a release → commit map.** Nothing records it yet (CI or deploy
  integration is deferred), so the caller passes the commits.

## Consequences

Release reviews can see which behavior changes the code explains, and which
code changes users have not yet felt. I5–I7 (experiments and outcomes) can
reuse the comparison.
