# ADR 0085 — Improvement memory (I8)

## Context

Reasoning spec §214–§216 and §249: persist the complete improvement
lifecycle (finding → hypothesis → recommendation → candidate evaluation →
experiment → outcome → decision) as `ImprovementMemoryRecord`s with
reusable lessons. Use past outcomes as evidence for future recommendation
ranking. Do not treat one failed experiment as a universal law, and do not
train or fine-tune anything automatically.

## Decision

- **New `@pathcompiler/improvement-memory`.** `buildMemoryRecord`:
  - **Lineage:** one record per recommendation, linking the finding IDs,
    evaluation, experiment, outcome, decision and mutation IDs, with the
    hypothesis, intervention and outcome summaries.
  - **One lifecycle:** it refuses artifacts that belong to another
    recommendation.
  - **Lessons** come only from human-approved decisions: supported,
    rejected or not supported, scoped to the same subject and category.
  - **Closing:** `closedAt` is the approval time.
- **`historyFactor` and `rankWithMemory`:**
  - when earlier lessons for the same subject and category rejected the
    hypothesis more often than they supported it, the priority is halved,
    with the reason and the records it is based on;
  - with no history, or a supportive one, the factor is neutral;
  - several observations do not compound.

  `recommend` applies the factor as a visible `history` priority
  component.
- **CLI:**
  - `memory record <recommendation-id>` gathers the latest experiment for
    the recommendation, its outcome and its decision under the output
    directory, and writes `memory/<id>.json`;
  - `memory list` shows the records and lessons.

## Alternatives

- **Dropping recommendations whose hypothesis failed before.** That would
  treat one experiment as a law (§216). Halving the priority keeps them
  visible, with the history.
- **A knowledge graph of improvements** (§217). It is long-term, and no
  graph database is introduced (AGENTS.md).

## Consequences

- The improvement loop (modes 4 and 5) runs end to end:
  `findings` → `gate` → `recommend` → `evaluate --browser` →
  `experiment create/measure/decide/approve` → `memory record`.
- Only I2 and I9 (mode 6, harness) remain in the I track.
