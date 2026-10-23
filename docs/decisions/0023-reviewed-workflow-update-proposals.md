# ADR 0023 — Reviewed workflow update proposals

## Context

Phase 21 turns medium/high impacts into proposed workflow updates, built from the
old approved workflow, the new graph, diff evidence, new tests and commit/PR
evidence. Proposals are stored as `.pathcompiler/proposals/<id>.<head-sha>.yaml`
with a human-readable diff and the review modes accept, edit, reject and
ignore-for-this-change. Approved workflows must never be overwritten directly.

## Decision

- Add `@pathcompiler/workflow-proposals` with pure `generateProposals`,
  `acceptProposal`, `decideProposal` and `workflowDiff`. Validation is injected,
  so the package does not scan.
- The proposed workflow is the head-commit rediscovery: test-backed candidates
  from the head graph and traces. It is matched to the approved workflow by ID,
  then by unique domain/action/entity, then by a unique best step-target overlap
  of at least 0.5. The approved ID is kept. No match gives `proposed: null`
  (manual).
- Proposals carry impact reasons, match method, validation summary, changed
  files, commit subjects (file histories up to head, bounded by the base commit
  date), the generated revision and a semantic line diff with two lines of
  context. Removals are listed before additions.
- `accept` requires a pending proposal with a proposed workflow, a clean checkout
  at exactly the proposal's head commit, and a fresh valid validation. It writes
  a new approved record bound to the head commit. "Edit" is detected when the
  proposed revision differs from the generated one. `reject`/`ignore` only record
  decisions. A decided proposal is final.
- `pathcompiler proposals generate/list/show/accept/reject/ignore`. Generation
  never replaces existing proposal files or approved files.

## Alternatives

- Patch the approved workflow step by step from the delta: brittle, and it would
  invent steps the tests don't support.
- Model-synthesized updates: allowed later as a supplement; deterministic
  rediscovery comes first.
- Keep both approved versions side by side: Git history already versions the
  approved file.

## Consequences

The fixture's renamed action yields a high-impact, validated proposal whose diff
shows exactly the target change, and accepting it rebinds the approved workflow to
the new commit. PR evidence is not fetched (it needs a GitHub token). Commit
evidence is limited to the first 50 changed files and 20 commits per file.
