# ADR 0077 — Review prioritization and feedback (P-RV)

## Context

Reasoning spec §52 ranks review priority by uncertainty × business impact ×
usage × change severity, so that high-usage uncertain workflows are reviewed
first. §53 stores review decisions (accepted, edited, rejected, merged,
renamed) as future evaluation and calibration data.

Candidates, approved, rejected and deprecated records, and proposals
(accepted as-is or edited, rejected, ignored) are already stored, with
reviewer and time. O7 gives guide-run counts per workflow.

## Decision

- **New `@pathcompiler/review-priority`:**
  - **`prioritizeReviews`** queues pending candidates and pending proposals.
    Each factor is in (0, 1] with a reason:
    - **uncertainty:** 1 − confidence, at least 0.05;
    - **business impact:** given per workflow ID or domain; neutral 0.5
      when absent;
    - **usage:** O7 runs relative to the busiest workflow, at least 0.1;
      neutral 0.5 without telemetry;
    - **severity:** high proposals 1, medium proposals 0.6, new candidates
      0.5.

    A proposal without a matched candidate has confidence 0, because
    nothing vouches for the change. The priority is the product, labeled
    `ordering-not-probability`, with ties broken by ID.
  - **`collectReviewFeedback`** reads decisions from the stored records:
    - first approvals become accepted candidates (later versions came from
      proposals);
    - rejections become rejected;
    - proposal reviews become accepted, edited (`mode: edit`), rejected or
      ignored.

    Each record carries the reviewed confidence and its band. `merged` and
    `renamed` are in the vocabulary for C9 hypothesis review, which nothing
    records yet.
  - **`calibrationFromReviews`** builds a P0 calibration table: only
    accepted-as-proposed counts as correct, and ignored decisions are left
    out.
- **CLI:**
  - `review queue [--impact <json>]` writes `reports/review-queue.json`;
    usage comes from stored events when present;
  - `review feedback` writes `reports/review-calibration.json`.

## Alternatives

- **A separate append-only decision log.** The decisions are already in
  versioned, committed records. Deriving feedback from them is reproducible
  and cannot drift from what was decided.
- **Business impact in `pathcompiler.yaml`.** It is a per-run judgment that
  can change often. A JSON file passed with `--impact` keeps configuration
  stable, and it can move into config later if teams ask.

## Consequences

- No calibration is usable until a band has 30 decisions; the report says so.
- Merged and renamed decisions are not produced yet (ISSUES_LOG #42).
