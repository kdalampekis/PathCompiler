# ADR 0054 — Evaluation harness and golden tests

## Context

Phase C3 implements CODEX spec §54 (evaluation harness) and §55 (golden
tests). Until now, the only quality measures were capability expectations
(`--expect`) and a resolver paraphrase set under `packages/resolver/eval/`.
There was no reviewed ground truth for workflows or impact, and no
regression-visible output for graphs or manifests. R-WI must compare
reasoning-assisted discovery against the baseline (§117), and P0 needs
calibration data. Both need a shared harness.

## Decision

- **Ground truth lives with the fixture** in `fixtures/next-demo/eval/`:
  - `capabilities.json` (the existing expectations format);
  - `workflows/*.yaml` (`id`, `entrypoint`, `steps` as target and action, and
    `terminal`);
  - `impact-cases/*.json` (text edits plus the expected severity per
    workflow);
  - `queries.json` (the resolver set, moved from `packages/resolver/eval/`).

  The truth describes the product, not what discovery currently produces.
  Workflows the baseline cannot find (Edit and Deactivate Client have no
  traces) stay in the truth and show up as recall below 1.
- **New `@pathcompiler/evaluation`** exposes `loadGroundTruth`,
  `analyzeFixture` and one report per metric family, each tagged with
  `family`:
  - `evaluateCapabilityExtraction`: precision, recall, false positives and
    false negatives;
  - `evaluateWorkflowDiscovery`: precision and recall, entrypoint accuracy,
    mean major-step score and terminal accuracy. The major-step score is the
    LCS of target sequences over expected steps; adjacent input/select steps
    are compared as a set, because field order is not part of the process.
    It also counts invented steps and lists unexpected candidates. It takes an
    optional `DiscoveryFunction` and strategy name for comparisons (§117);
  - `evaluateResolverAccuracy`: top-1, ambiguity and unsupported accuracy,
    and controls;
  - `evaluateImpact`: affected-workflow recall, false-positive rate and
    severity accuracy.
- **Impact cases run on temporary Git copies.** The harness copies the
  fixture's Git-tracked files and approves every discovered candidate at a
  base commit. It then applies the case's edits as a second commit and runs
  the same `analyzeCommitRange` and `analyzeWorkflowImpact` as `impact`. The
  real fixture is never modified.
- **CLI:** `pathcompiler eval capabilities|workflow-discovery|resolver|impact
  [directory]` reads `<directory>/eval`, prints a summary with each miss, and
  writes `reports/eval/<family>.json` (`--json` prints it). It is not gated by
  `pathcompiler.yaml`: it measures PathCompiler and changes no product
  behavior.
- **Golden files** are plain, reviewable JSON and text under
  `packages/*/test/golden/`, compared with `toMatchFileSnapshot`:
  - the graph summary (node and edge counts by type, UI action IDs);
  - the candidate summary;
  - the runtime manifest, with revisions redacted;
  - the four reports;
  - the CLI `eval` text.

  Biome ignores `test/golden` so formatting cannot drift from what the tests
  write.

## Alternatives

- **Writing truth to match current output.** That would hide the gaps the
  harness exists to show. Rejected: wrong terminals and missing workflows are
  recorded as such (ISSUES_LOG #17, #18).
- **Exact step-sequence equality.** This penalizes harmless field-order
  differences. LCS with order-free input runs keeps real omissions and
  inventions visible.
- **Vitest inline snapshots of whole graphs.** They are unreadable and churn
  with every evidence change. Summaries keep reviews meaningful (§55: "Do not
  use snapshots to hide unclear behavior").

## Consequences

Quality changes now show up as golden diffs and metric changes. R-WI can pass
its strategy to `evaluateWorkflowDiscovery`. Adding cases means adding files,
not code. Several tests that approve workflows read the fixture's Git state,
so any uncommitted change under `fixtures/next-demo/` makes them fail
(ISSUES_LOG #19).
