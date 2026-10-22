# ADR 0006 — Bounded local Git evidence and file associations

Status: Accepted for Phase 4

## Context

Current source identifies the files relevant to a product node. Local history can
explain development intent and show concrete changes, but commit messages can be
inaccurate and old declarations need not match current declarations. The source
graph currently has structural locators, not historical line ranges. Loading or
summarizing an entire repository history would add unrelated evidence and cost.

## Decision

Use the installed Git executable through argument-array `execFile` calls in
`@pathcompiler/git-intelligence`. No Git library, model provider or remote adapter
is needed. `openGitRepository(directory)` returns a repository object supporting
`getCurrentCommit`, `getDefaultBranch`, `getDiff`, `getCommitsForPath`, `getBlame`
and `getCommitMessage`, plus commit metadata and snapshot helpers. Zod validates
inputs and structured output. SHAs support both Git SHA-1 and SHA-256 formats.

The public scope is a working tree or an existing subdirectory. Paths are
normalized, literal and relative to that scope; command arguments use the full
repository prefix internally. Revision arguments are resolved to commit SHAs
before subsequent queries. Unborn HEAD returns null. Nonrepositories and missing
revisions/objects produce actionable errors. Default branch resolution is local:
cached `refs/remotes/origin/HEAD` first, then existing local `main`/`master` with
`source: convention`, otherwise null. Detached HEAD is supported.

`enrichNodeHistory(repository, sourceGraph, nodeId, { limit })` starts with a
current graph node and its evidence files. It loads bounded path history, dedupes
relevant commits and compares each commit to its first parent for those selected
paths only. It returns a new graph and a versioned evidence-only report. The input
graph is unchanged. Commit nodes retain SHA, parents, full message and UTC author
date. Scoped changed paths, binary markers and unified hunks live in the report;
commit messages have `messageRole: intent-evidence` in the graph.

`CHANGED_BY` edges point from current source nodes to Commit nodes. Their evidence
includes associated files, current repository SHA, historical commit SHA,
comparison mode, working-tree state, basis and confidence:

- File nodes with a confirmed diff: `file-change`, confidence 1, not heuristic.
- Other declarations sharing a changed file: `file-association`, confidence 0.5,
  heuristic. This score labels association strength, not a probability.
- Missing-parent diffs: `path-history`, confidence 0.5, heuristic, with diagnostic.

The package never claims a hunk changed a particular symbol or action merely
because that declaration now occupies the file. Message text does not create
graph links. No approved workflow is generated or changed.

## Bounds and interpretation

- History defaults to 20 commits per path, maximum 100. One extra SHA determines
  the `limited` flag; only retained commits get metadata. Optional revision and
  ISO `since` filters use Git log semantics (the date filter is a committer-date
  filter, while reported author dates come from the raw commit object).
- Node enrichment accepts at most five provenance files and 100 unique commits.
- Diff queries accept at most 100 selected paths/changed files. They parse NUL
  separated statuses, then load individual patches, bounded to 8 MiB cumulatively.
- Blame defaults to 200 lines, maximum 1,000, and an explicit revision defaults to
  HEAD. An 8 MiB bounded blob read determines line count. Empty text files return
  no lines; binary files are rejected. Attribution returns SHA, original line and
  current line, not source text. Native Git blame may follow whole-file renames;
  original line numbers alone are not historical file locators.
- Each Git process has a 10-second timeout and an 8 MiB output limit. Exceeding a
  process/diff/aggregate limit fails explicitly. Limits bound returned evidence;
  Git may traverse older history internally before finding relevant path commits.

Exact-path history uses Git's normal path-history simplification, without rename
following. Renames are represented as deletion and addition. Merges are not
interpreted as combined semantic diffs; returned commit evidence uses the first
parent, and path simplification may omit a merge identical to one parent. Root
commits use a null base. Raw commit parents remain visible in shallow clones, so
a missing parent yields a null diff instead of pretending the commit added every
file. Shallow reports and blame explicitly disclose incomplete ancestry. Nothing
is fetched to fill gaps. Non-UTF-8 declared commit message encodings are rejected.

External diff drivers, text conversion, signature display and filesystem monitor
execution are disabled for package commands. Inherited `GIT_*` overrides are
removed; prompts, lazy fetching, replace objects and optional index writes are
disabled. Commands use literal pathspecs and no shell. Errors do not echo raw Git
stderr, which can contain private URLs or credentials. Local Git attributes still
determine text/binary classification and hunk function context.
The explicit `--no-lazy-fetch` option makes older Git versions that lack this
capability fail rather than silently ignoring an unfamiliar environment variable.
Source ingestion also disables fsmonitor so the CLI's initial scan stays read-only.

Source graph commit/dirty metadata must match the opened scope before enrichment;
commit/dirty/shallow state is checked again afterward. This is not an atomic
filesystem snapshot: concurrent edits that leave the dirty boolean unchanged are
not detectable. Callers must use a graph from the same directory and avoid editing
during analysis. Uncommitted declarations are associated with committed file
history only, with a diagnostic.

The small `git inspect` CLI extension scans current source and writes
`reports/git-evidence.json` plus `graph/history-graph.json` under `.pathcompiler`
or `--out`. It preserves scan/test artifacts and honors source exclusions.
Reports contain private source patches and commit messages; they are build-time
artifacts, never browser runtime manifests.

## Alternatives

- Load all commits into the graph: unnecessary for node-specific evidence and
  unbounded for long-lived repositories.
- Add a Git library or hosted service now: more dependencies or credentials
  without improving this local-only acceptance case. GitHub PRs remain Phase 5.
- Infer exact symbol changes from file history or commit prose: misleading without
  historical symbol identity. Add range/move analysis when an actual use needs it.
- Follow renames automatically: introduces similarity thresholds and cross-path
  associations. Exact paths are predictable; explicit rename support can follow
  when needed, with its own provenance contract.

## Consequences

A temporary Git fixture changes `AddClientModal` and proves the resulting commit
links to its File, Component and UIAction nodes, while unrelated files remain
unlinked. Tests also cover bounded results, repeatability, graph immutability,
literal special paths, nested scopes, binary/empty files, type changes, merges,
renames, shallow boundaries, blame ranges, dirty/stale snapshots, read-only
commands and built-CLI artifacts. No repository history is rewritten for tests.

## API references

Parsing follows the official [Git diff](https://git-scm.com/docs/git-diff),
[Git log](https://git-scm.com/docs/git-log) and
[Git blame porcelain](https://git-scm.com/docs/git-blame) contracts. Branch
resolution uses [Git symbolic-ref](https://git-scm.com/docs/git-symbolic-ref).
The [Git command options](https://git-scm.com/docs/git) define the local-only
`--no-lazy-fetch` behavior.
