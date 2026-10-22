# ADR 0007 — Repository-scoped GitHub PR evidence

Status: Accepted for Phase 5

## Context

Local Git establishes changes and commit identities. Pull requests add reviewable
development intent and group related commits, but their prose does not establish
current product behavior. PR branches, descriptions and file lists can change
during retrieval. Current graph nodes need explicit provenance when associated
with historical or proposed files.

## Decision

Keep the specified `GitProvider` interface in `git-intelligence`:

```ts
interface GitProvider {
  getPullRequest(id: string): Promise<PullRequestRecord>;
  findPullRequestForCommit(sha: string): Promise<PullRequestRecord | null>;
}
```

A provider is configured for one repository and accepts positive decimal PR
numbers. `adapter-github` implements the interface using Node's native fetch and a
caller-supplied token. It depends on the contract package; the contract package
does not depend on GitHub implementation code. No additional external dependency
is needed. The API version is pinned to `2026-03-10`.

Records preserve provider/repository/PR identity, a canonical HTTPS URL, title,
nullable body, state/merged status, base/head SHAs, actual merge SHA, update time,
changed files with status/previous rename paths and linked commit SHAs. Schemas
reject invalid paths, SHAs, duplicate files/commits and contradictory merge state.
Arrays are sorted for deterministic output. Unused API fields, authors, raw patches
and credentials are not retained. The body is untrusted Markdown stored as text.

The actual merge SHA is null until the PR is merged: GitHub also uses its
`merge_commit_sha` field for temporary test merges on open PRs. Commit lookup uses
the commit-associated-PR endpoint. Zero results means null; multiple results or a
next page means explicit ambiguity, never an arbitrary first result. A successful
lookup records `lookupCommitSha` separately. It need not appear in the original PR
commit list, which matters when GitHub associates a rewritten/rebased commit.

`associatePullRequest(sourceOrHistoryGraph, record, { repositoryPath })` clones the
input graph and adds a PullRequest node with identity, title and snapshot metadata.
The full body and record are kept in a separate versioned evidence-only report.
It never mutates existing source/commit nodes or creates approved workflows.

`SUPPORTED_BY` edges use:

- `pull-request-file-association`: current provenance paths intersect PR paths,
  including previous rename paths; confidence 0.5, heuristic.
- `pull-request-commit`: an existing Commit node matches the PR's commit list or
  actual merge SHA; confidence 1, not heuristic.
- `provider-commit-association`: an existing Commit node matches the SHA returned
  by the provider lookup, independently of the PR commit list; confidence 1 for
  that reported association, not a statement about current business behavior.

Edges retain the source snapshot SHA, PR base/head, merge state, source files,
matched commit and scan-directory prefix. Message text never creates edges.
Unmerged PRs and dirty working trees have explicit diagnostics. Existing PR nodes
are rejected on refresh; callers start from a source/history graph rather than
silently replacing previously captured evidence. Other PR evidence can coexist.

## Retrieval and CLI boundaries

All production requests are GETs to a fixed `https://api.github.com` origin with
Bearer authorization. Token input is validated without echoing it; tokens are
never command-line options. Redirects are disabled, response bodies are bounded to
4 MiB and each fetch uses a ten-second abort signal. API and transport errors are
sanitized. Authentication, missing resources, permission failures and rate limits
produce actionable failures; no automatic retries or response-body logging occur.
Injected transports must honor the supplied abort signal.

The adapter fetches metadata, all files and commits in pages of 100, then metadata
again. It validates expected page lengths, unexpected continuation, uniqueness and
the before/after metadata snapshot. It constructs every page URL itself and never
follows URLs from response bodies or Link headers. Counts beyond 3,000 files or 250
commits fail before collection, matching the REST endpoints' documented ceilings.
No partial record is returned when a limit, malformed response or snapshot change
is encountered. This bounds a direct PR read to 35 requests, or 36 with commit
lookup. Counts of zero skip the corresponding list request.

`github inspect [directory] --repo owner/name (--pr number | --commit sha)` reads
`GITHUB_TOKEN`, scans current source, retrieves PR evidence and writes
`reports/pr-evidence.json` and `graph/pr-graph.json` under `.pathcompiler` or
`--out`. `--exclude` is supported and existing source/history/test artifacts stay
intact. No matching PR means an explicit message and no artifact writes. The CLI
checks local commit/dirty state again before writing. Local Git supplies the scan
directory prefix for mapping repository-root PR paths in monorepos.

The caller supplies the matching GitHub repository explicitly. The adapter does
not inspect Git remotes or discover credentials. Source graphs do not currently
have a repository-provider identity, so this binding is a caller responsibility.
The CLI's fresh graph contains source nodes; library callers can pass a Phase 4
history graph to associate existing Commit nodes as well.

## Alternatives

- GitHub App/webhooks/OAuth installation: deferred to Phase 24 as specified. A
  read-scoped token and mockable provider meet the Phase 5 acceptance case.
- GitHub SDK: native fetch plus a few validated endpoints is sufficient; avoid a
  new dependency until broader API requirements justify it.
- Treat PR text as source facts or infer symbol changes from it: creates false
  certainty. Current-file associations stay labeled and reviewable.
- Silently truncate large PRs or select the first associated PR: would conceal
  missing evidence or ambiguity. Fail explicitly and let the caller narrow scope.

## Consequences and limits

Tests use injected GitHub responses and a temporary real Git/Next.js fixture. They
exercise authentication headers, pages, nullable bodies, merge semantics, rename
paths, commit lookup/ambiguity, snapshot drift, limits, errors and graph/source
immutability. The built CLI is tested with mocked fetch, including nested scope,
repeatable artifacts, exclusions and missing-token handling. No live token is
needed for tests and no hosted GitHub credential has been validated in this phase.

The initial adapter supports GitHub.com only. Comments are optional in the spec
and are deferred. Large PR fallback, Enterprise hosts, credential discovery,
caching and retries are not implemented. Metadata comparison reduces races but
does not make multiple REST calls transactional or guarantee server-side cache
consistency. Local commit/dirty checks also cannot detect every concurrent edit.
Associations do not establish that a PR is an ancestor of the current checkout.

PR reports can contain private text and repository paths. They are build-time
artifacts and must not be included in browser runtime manifests. All existing
approval rules for workflows continue to apply.

## API references

The official [pull request endpoints](https://docs.github.com/en/rest/pulls/pulls)
describe metadata, read permissions and the 250-commit/3,000-file list ceilings.
The [commit-associated PR endpoint](https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit)
defines the lookup relationship. API prose and PR bodies remain evidence, not
instructions for the compiler or agent.
