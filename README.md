# PathCompiler

Compile your codebase into executable product workflows.

PathCompiler will analyze source code, tests and Git history, discover workflows,
and compile reviewed workflows into versioned headless artifacts. The product graph
is a build-time representation; approved workflows are the runtime source of truth.

This repository implements **Phase 0 — Repository Foundation**,
**Phase 1 — Static Next.js Analyzer**, **Phase 2 — Semantic Targets**,
**Phase 3 — Playwright Test Mining**, **Phase 4 — Git Intelligence** and
**Phase 5 — GitHub PR Adapter**.
Workflow discovery, compilation, SDKs and
runtime guidance are future phases.

## Development

Use Node.js 22.12+ and the pinned pnpm version. With nvm and Corepack installed:

```sh
nvm install
nvm use
corepack enable
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`packageManager` pins pnpm; `pnpm-lock.yaml` pins dependencies. CI installs with
`--frozen-lockfile`. If Corepack is unavailable, install `pnpm@10.34.7` using your
preferred Node tool manager.

## Reference fixture

```sh
pnpm dev
```

Open <http://127.0.0.1:3000>. The fixture contains Create Client, Edit Client,
Deactivate Client, Create Plan and Change Plan Structure. Create an active client
before adding a plan. Expanding a plan to Weekly saves immediately; switching back
to Simple asks for confirmation. The controls at the top exercise role and feature
gates, which are also enforced by the API.

This is a local demo with fictional data and simulated roles. Each browser session
stores a small dataset in a cookie. Clear site cookies to reset it. It is not a
production authorization or persistence implementation.

Run Chromium tests against a fresh production build:

```sh
pnpm --filter @pathcompiler/next-demo exec playwright install chromium
pnpm test:e2e
```

The test runner builds and starts the fixture on port 3100, then shuts it down.
Tests use independent browser contexts. Linux may require Playwright's
`install --with-deps chromium`, as used in CI.

## Scan a Next.js repository

```sh
pnpm build:packages
pnpm pathcompiler scan ./fixtures/next-demo
```

The built CLI is named `pathcompiler`; the workspace script above invokes the same
binary. It writes these artifacts under the current working directory:

```text
.pathcompiler/graph/source-graph.json
.pathcompiler/reports/scan-summary.json
```

Use `--out <directory>` to change the artifact directory and repeat
`--exclude <relative-path>` to exclude source files/directories. Exclusions use path
prefixes, not globs. Use `pnpm pathcompiler --help` for usage.

The scanner reads local source without executing the app or contacting model
providers. It extracts files, functions/hooks, candidate React components, App Router
pages/HTTP handlers, imports, UI actions, navigation, API calls and permission/flag
observations. The report includes counts, commit/working-tree metadata and unresolved
analysis diagnostics. Repeated scans of the same inputs produce identical output.

Root `app/` and `src/app/`, dynamic segments, route groups and parallel slots are
supported. Intercepting routes, inherited aliases, conditional package exports and
arbitrary wrappers are not fully analyzed; see [analysis boundaries](docs/decisions/0003-static-analysis-boundaries.md).
Heuristic relationships carry confidence and provenance. They are not approved
workflows or authoritative permission rules.

## Semantic targets

Give each source declaration a stable product ID:

```tsx
<button data-pathcompiler="clients.create" onClick={openCreateClient}>
  Create Client
</button>
```

The analyzer uses `ui:clients.create` as the graph identity, preserving it across
file moves and label changes. Source location and commit remain in provenance.
Explicit annotations have target confidence 1.0; literal `data-testid` (0.8) and
static accessible role/name (0.6) provide fallback evidence. CSS structure is never
a suggested semantic target.

```sh
pnpm build:packages
pnpm pathcompiler targets suggest ./fixtures/next-demo
pnpm pathcompiler targets suggest ./fixtures/next-demo --json
```

`targets suggest` defaults to the current directory, supports `--exclude`, and
prints annotated targets, reviewable suggestions and diagnostics without writing
files. JSON reports include `schemaVersion`, repository metadata and `targets`
with source provenance, target evidence and nullable `suggestedTarget`. No model
calls or automatic source edits are made. `targets apply` is not implemented.

Use literal IDs starting with a letter, followed by letters, digits, `_`, `.`, `:`
or `-`. Different source declarations must use different IDs. Dynamic annotations,
conflicting IDs and unverified component forwarding are reported for review.
Place attributes on native elements (or Next `Link`), after spread props.

Repeated rows may share an action ID from a single declaration. Scope the action
to the selected row before resolving it; the fixture uses `clients.row` with
`data-client-id` and `plans.row` with `data-plan-id`. Static confidence does not
prove DOM uniqueness or availability. See the [target contract and limits](docs/decisions/0004-semantic-target-contract.md).

## Mine Playwright evidence

```sh
pnpm build:packages
pnpm pathcompiler tests mine ./fixtures/next-demo
```

This command statically reads tests and source together, producing:

```text
.pathcompiler/reports/test-traces.json
.pathcompiler/graph/test-graph.json
```

Use `--out` and `--exclude` as with `scan`; the directory defaults to the current
working directory. Source scan artifacts are preserved. Mining does not run tests,
load repository configuration or launch a browser.

Each trace has a start route, ordered actions/assertions, target hints, provenance
and a terminal assertion when the last extracted test-body event is an assertion.
The shared `order` field interleaves actions and assertions. Setup and teardown are
marked separately. Same-file helpers such as `createClient` are expanded with
call-site evidence. Direct API calls remain request actions, and negative/soft
assertions retain their meaning. Unique source-target matches add `TESTED_BY`
edges; ambiguous matches remain candidates.

The fixture produces seven traces. Two workflow tests are fully extracted; five
are partial because some setup/data-processing/control-flow code is unsupported.
The API-only test has a null start route. All seven retain terminal assertions,
and the client creation sequence is recoverable from semantic targets and its
feedback assertion. These are test observations, not approved workflows or test
pass results. See [mining boundaries](docs/decisions/0005-static-playwright-evidence.md).

## Inspect local Git evidence

```sh
pnpm build:packages
pnpm pathcompiler git inspect ./fixtures/next-demo --node ui:clients.create
```

The command scans current source, follows the selected node's provenance files,
and reads up to 20 commits per file. It writes:

```text
.pathcompiler/reports/git-evidence.json
.pathcompiler/graph/history-graph.json
```

Use graph IDs from `scan` or `targets suggest --json`. The directory defaults to
the current directory; `--limit <1-100>`, `--out` and `--exclude` are supported.
Existing scan/test artifacts are preserved. Git must support `--no-lazy-fetch`
(verified with Git 2.55.0), and the working tree must have an initial commit.
No remote is contacted.

The report contains commit SHAs, full messages, UTC author dates, parent SHAs,
selected changed paths, structured unified diff hunks and truncation/shallow
diagnostics. Messages describe intent, not verified behavior. `CHANGED_BY` edges
confirm changed files; links to current components, symbols and actions are
explicit file associations with heuristic confidence 0.5. They do not establish
that the historical commit changed that particular declaration.

The package also supports direct queries:

```ts
import { openGitRepository } from "@pathcompiler/git-intelligence";

const git = await openGitRepository("./fixtures/next-demo");
const head = await git.getCurrentCommit();
const defaultBranch = await git.getDefaultBranch();
const history = await git.getCommitsForPath("components/clients.tsx", { limit: 10 });
const blame = await git.getBlame("components/clients.tsx", { startLine: 1, limit: 50 });
// git.getDiff(base, head, { paths: [...] }); git.getCommitMessage(sha);
```

Paths are relative to the opened directory, including nested projects. Blame reads
committed lines, returns line/SHA attribution without source content, and marks
partial ranges and shallow history. Default branch resolution uses cached
`origin/HEAD`, then existing `main`/`master` branches marked as convention guesses.
It returns null when unresolved. Queries fail on resource limits instead of
silently returning partial data; bounded history/range results have explicit flags.

History uses exact paths without rename following; renames appear as delete/add
changes. Evidence diffs compare each commit to its first parent. A missing shallow
parent produces a null diff and diagnostic. Dirty working trees are marked, and
source/Git commit and dirty-state mismatches are rejected. Reports include private
messages and source patches and must stay out of browser runtime manifests.
See [Git evidence decisions and limits](docs/decisions/0006-local-git-evidence.md).

## Add GitHub PR context

Set `GITHUB_TOKEN` in your environment with read access to the repository's pull
requests, then inspect an explicit PR or find the PR associated with a commit:

```sh
pnpm build:packages
pnpm pathcompiler github inspect ./path/to/repository --repo OWNER/REPO --pr 123
pnpm pathcompiler github inspect ./path/to/repository --repo OWNER/REPO --commit FULL_COMMIT_SHA
```

The directory defaults to the current directory. The repository is explicit;
choose the GitHub repository corresponding to your local checkout. `--out` and
`--exclude` follow the scan conventions. Nested scan directories are mapped to
repository-relative PR paths automatically. The command writes:

```text
.pathcompiler/reports/pr-evidence.json
.pathcompiler/graph/pr-graph.json
```

The original source/history/test artifacts are preserved. Records capture the PR
title, nullable Markdown body, changed and previous rename paths, linked commit
SHAs, actual merge SHA, base/head SHAs, state and provider update time. An open PR's
temporary test merge is excluded. Commit lookup returns no match explicitly and
asks for a PR number when multiple PRs match. Provider-confirmed lookup SHAs are
retained separately from the original commit list, including rebased commits.

`SUPPORTED_BY` edges associate current file/component/action nodes with reported
PR paths. These are heuristic associations (0.5), not proof of current behavior or
merge ancestry. A history graph passed to the API can also link existing Commit
nodes through exact PR commit/merge membership or the provider's commit lookup.
Bodies remain in the separate evidence report, with `evidenceOnly: true`; no source
facts or approved workflows are overwritten. PR prose is untrusted input.

`@pathcompiler/git-intelligence` exports the two-method `GitProvider` interface,
`PullRequestRecordSchema`, `PullRequestEvidenceReportSchema` and
`associatePullRequest(graph, record, { repositoryPath })`.
`@pathcompiler/adapter-github` exports
`createGitHubProvider({ owner, repo, token, fetch? })`; the returned provider supports
`getPullRequest("123")` and `findPullRequestForCommit(fullSha)`. The optional fetch
transport supports offline tests. Production requests use GitHub.com only.

Reads are paginated, bounded and authenticated, with no automatic retries or
redirects. PRs above 250 commits or 3,000 files fail explicitly; response limits and
changing PR snapshots also fail rather than silently returning partial evidence.
Tokens stay out of reports and errors. No GitHub App, webhook, write API, comment
collection or source upload is involved. See the
[PR adapter contract and boundaries](docs/decisions/0007-github-pr-evidence.md).

## Packages

| Package                     | Public API                                                                        |
| --------------------------- | --------------------------------------------------------------------------------- |
| `@pathcompiler/workflow-ir` | Zod schemas, inferred types, `parseWorkflow(unknown)`                             |
| `@pathcompiler/graph-core`  | `ProductGraph`, graph schemas/types, `createNodeId`, `createEdgeId`, `diffGraphs` |

Analysis packages:

| Package | Public API |
| --- | --- |
| `@pathcompiler/source-model` | `readSourceProject`, source/diagnostic schemas and exclusion defaults |
| `@pathcompiler/adapter-nextjs` | `analyzeNextProject`, `scanNextRepository`, `discoverRoute`, `suggestTargets`, scan/target schemas and types |
| `@pathcompiler/test-miner-playwright` | `minePlaywrightTests`, trace/action/assertion/target schemas and types |
| `@pathcompiler/git-intelligence` | `openGitRepository`, `enrichNodeHistory`, `GitProvider`, `associatePullRequest`, Git/PR schemas and types |
| `@pathcompiler/adapter-github` | `createGitHubProvider`, `GitHubProviderOptions`, `GITHUB_API_VERSION` |
| `@pathcompiler/cli` | `pathcompiler scan`, `targets suggest`, `tests mine`, `git inspect`, `github inspect`, `runCli` |

Packages export ESM JavaScript and declarations from `dist/` after
`pnpm build`. They are private until release contracts are ready. Tests run against
source; typechecking includes tests and the Next.js route types.
`pnpm test` and `pnpm typecheck` build package dependencies first, so both commands
also work immediately after a fresh installation.

Graph APIs support `addNode`, `addEdge`, `getNode`, `nodesByType`, `neighbors`,
`traverse`, `toJSON`, `serialize`, `fromJSON` and `deserialize`. Traversal is bounded,
cycle-safe and excludes the starting node. Diff results distinguish added, removed
and changed nodes/edges. Inputs must use unique IDs and existing edge endpoints.

## Project documents

- [Build specification](CODEX_BUILD_SPEC.md)
- [Product architecture](PRODUCT_ARCHITECTURE.md)
- [Phase status](docs/phases/STATUS.md)
- [Workflow and graph decisions](docs/decisions/0001-foundation-contracts.md)
- [Fixture state decision](docs/decisions/0002-fixture-session-state.md)

The small monorepo uses a single `vitest.config.ts`, with explicit package-test
discovery; it does not need a separate workspace config. The [current Vitest
configuration](https://vitest.dev/guide/migration.html) also uses `projects` instead
of the older `workspace` API when multiple test projects are needed.
