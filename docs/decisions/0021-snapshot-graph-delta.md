# ADR 0021 — Snapshot graph delta

## Context

Phase 19 computes changed files, symbols, routes, targets and APIs plus a
`GraphDelta` between a base and a head commit. Full re-scanning is acceptable if
the diff is correct. Graph nodes embed commit-bound provenance, so a naive
comparison would mark every node as changed.

## Decision

- Add `@pathcompiler/graph-delta`. `analyzeCommitRange` exports each commit's
  scoped tree with `git archive` through the new read-only
  `LocalGitRepository.exportCommit`, into a private temp directory that is always
  removed. It analyzes each export with
  `readSourceProject(dir, {snapshot: {commit}})`, plus Next.js analysis and
  Playwright mining.
- The new `snapshot` option binds provenance to the exported commit, because the
  export has no `.git`. An export holds exactly the commit's tracked files, the
  same set a clean working tree would scan.
- `computeGraphDelta` is pure. It matches by stable graph IDs and strips
  `repositoryCommit` and the repository node's `commit`/`dirty` before comparing.
  A changed node records its differing top-level `fields` and a `kind`
  (`location` when only `evidence` differs, otherwise `content`). This prepares the
  impact rules for moved files and copy-only edits.
- The output adds `changedEdges` and a `summary` to the spec's `GraphDelta`
  shape. Changed files come from content hashes of the two exports (exact, any
  file type, no 100-file diff limit). Routes, symbols/components, APIs and
  semantic targets (UI actions with a `semanticId`) are derived from node changes.
- `pathcompiler diff <base> <head> [directory]` writes `reports/graph-delta.json`.

## Alternatives

- `git worktree add`: writes `.git/worktrees`, which conflicts with the read-only
  Git contract.
- Use `getDiff` for files: refuses over 100 files or 8 MiB, and hunks are not
  needed.
- Incremental re-analysis of affected regions: faster, but risks missing
  cross-file effects (imports, render chains) before the analyzer models them.

## Consequences

Deltas are correct and deterministic but cost two full analyses. `tar` must be
available. Line-only moves don't create noise, because graph locators are
symbolic. Renames appear as removal plus addition. Impact analysis (Phase 20)
decides what that means for workflows.
