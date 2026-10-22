# PathCompiler

Compile your codebase into executable product workflows.

PathCompiler will analyze source code, tests and Git history, discover workflows,
and compile reviewed workflows into versioned headless artifacts. The product graph
is a build-time representation; approved workflows are the runtime source of truth.

This repository implements **Phase 0 — Repository Foundation**,
**Phase 1 — Static Next.js Analyzer**, **Phase 2 — Semantic Targets**,
**Phase 3 — Playwright Test Mining**, **Phase 4 — Git Intelligence**,
**Phase 5 — GitHub PR Adapter**, **Phase 6 — Product Surface Graph**,
**Phase 7 — Capability Discovery** and **Phase 8 — Workflow Candidate Discovery**.
Workflow validation, compilation, SDKs and
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

## Discover product surfaces

```sh
pnpm build:packages
pnpm pathcompiler surfaces discover ./fixtures/next-demo
```

This promotes technical source nodes into candidate pages, panels, modals, forms
and user actions. The directory defaults to the current directory; `--out` and
`--exclude` work as with `scan`. It writes separate artifacts:

```text
.pathcompiler/reports/product-surfaces.json
.pathcompiler/graph/surface-graph.json
```

Rules use page routes, component names ending in `Panel`, `Modal`, `Dialog` or
`Form`, native/ARIA containers and interactive controls. Accessible names and
semantic IDs provide titles; unresolved names have explicit fallbacks. Source
labels are preserved: “Add Client” is not automatically renamed “Create Client”.
Native containers take precedence over duplicate component-name guesses.

Surfaces retain their anchor, supporting source/evidence IDs, routes, parent IDs,
rule, confidence and file/locator/commit provenance. IDs use
`surface:<kind>:<anchor-node-id>`, so annotated action identities survive label
changes and file moves. The graph adds `ProductSurface`, `CONTAINS` and
`SUPPORTED_BY` records without changing original nodes. Every surface remains
`status: "candidate"` and `heuristic: true`; no capabilities or workflows are approved.

```ts
import { scanNextRepository } from "@pathcompiler/adapter-nextjs";
import { discoverProductSurfaces } from "@pathcompiler/capability-engine";

const source = await scanNextRepository("./fixtures/next-demo");
const { graph, report } = discoverProductSurfaces(source.graph);
```

Library callers can supply a technical graph already enriched with test, Git or
PR evidence. The evidence package collects selected source nodes and two outward
hops of explicit `TESTED_BY`, `CHANGED_BY` and `SUPPORTED_BY` links to Test, Commit
and PullRequest nodes. Raw graph records preserve their provenance and uncertainty;
historical references retain their own commits. The CLI performs a fresh source
scan only. Neither API nor CLI executes code, calls a model or interprets PR prose.

Containment follows static component rendering and lexical JSX nesting. Shared
components are one declaration with multiple parents/routes. Conditional branches,
props/children projection, portal placement and modal opener/state relationships
are not resolved. Callback bodies do not inherit surrounding JSX containment.
The current analyzer does not connect implicit Next layouts to routes; unreachable
controls are omitted with diagnostics. Redirect-only routes remain page candidates
with an unresolved-render diagnostic. Static candidates do not prove live visibility.

The fixture yields 24 candidates: three pages, one shared modal, three forms and
17 actions, including all five primary workflow action anchors. Synthetic tests
also cover named/ARIA panels. See the [surface and evidence contract](docs/decisions/0008-product-surface-candidates.md).

`SemanticModel` defines optional `classifyCapabilities` and `summarizeEvidence`
provider methods, with schemas and output parsers that reject unknown citations.
No provider is installed or invoked. Future callers must select the evidence they
intend to send and validate returned data; raw evidence may contain private source
paths, test metadata or commit/PR text. These artifacts stay build-time only and
must not be shipped in browser runtime manifests.

## Discover candidate capabilities

```sh
pnpm build:packages
pnpm pathcompiler capabilities discover ./fixtures/next-demo \
  --expect ./fixtures/next-demo/capabilities.expected.json
```

The command reads source and statically mines Playwright tests, then writes:

```text
.pathcompiler/reports/capabilities.json
.pathcompiler/graph/capability-graph.json
```

The directory defaults to the current directory. `--out` and `--exclude` follow
the existing scan conventions, and previous scan/surface/test artifacts are
preserved. No tests, application code or model provider are executed.

Discovery recognizes semantic action IDs such as `clients.create` and
`plans.change_structure`, accessible business-action names and named action
components/containers. It normalizes Add/New to Create and Update/Modify to Edit.
Matching semantic keys merge into one capability with all contributing surfaces
and evidence retained. Save/Confirm/Cancel controls, inputs, observation anchors
and API-only code do not independently establish business capabilities.

Each candidate has a stable semantic ID, domain, verb, entity, optional qualifier,
routes, surfaces, source/evidence IDs and commit-bound provenance. IDs never include
file positions or commit hashes; explicit semantic IDs survive label/file moves.
Unannotated naming rules use regular English words and route context, so changes
to inferred meaning can change their IDs. These rules do not resolve arbitrary
synonyms, irregular nouns or multilingual product terminology.

API evidence distinguishes calls reachable from an explicit handler from matching
API calls elsewhere in the owning component. The latter is context, not proof that
the action invokes that endpoint. `roles` contains observed source comparisons,
with supporting permission nodes and `rolesAreAuthoritative: false`; a comparison
can also occur in a denial branch. Unknown roles remain empty.

Every capability requires review. Confidence is a rule-strength score, explicitly
not a probability: semantic targets start at 0.8, accessible names at 0.6 and
component names at 0.5. A mapped test-body UI action adds 0.1 and a handler API
association adds 0.05, capped at 0.95. Repeated evidence does not accumulate points.
Scores below 0.7 are flagged low-confidence; static test evidence never claims a
passing test run or verifies authorization.

`--expect` reads an evaluation-only JSON file with `schemaVersion: 1` and a unique
`capabilityIds` list. It does not guide inference. The report lists matched,
unexpected and missing IDs with false-positive/negative counts. Without an explicit
reference list, counts are null and the CLI says “not evaluated”. The fixture's
reviewed list produces all five intended capabilities with **0 false positives
and 0 false negatives**; this is a fixture result, not a general accuracy claim.

```ts
import { discoverCapabilities } from "@pathcompiler/capability-engine";

const { graph, report } = discoverCapabilities(technicalGraph);
// Optional evaluation: discoverCapabilities(technicalGraph, { expectedCapabilityIds });
```

Pass a fresh technical graph, optionally enriched with tests, Git or PR context.
The API adds surface and capability nodes to a clone; existing capability/surface
graphs must be rebuilt from technical evidence. Capability reports remain private
build-time artifacts. Workflow sequencing and compilation start in Phase 8.
See [capability identity, evidence and evaluation](docs/decisions/0009-capability-discovery.md).

## Discover candidate workflows

```sh
pnpm pathcompiler workflows discover ./fixtures/next-demo
# Supports --out <directory> and repeated --exclude <relative-path>.
```

Writes `workflows/candidates/*.yaml`, `reports/workflow-candidates.json` and
`graph/workflow-graph.json` under `.pathcompiler` or `--out`. The fixture produces
`clients.create`, `plans.create` and `plans.change_structure`. Edit/deactivate
remain explicitly skipped because their completion assertions cannot yet be
resolved to semantic observation targets.

Each YAML document is a versioned candidate envelope containing a Workflow V1,
confidence, evidence, commit, observed test segments, unresolved ambiguities and
individual validation statuses. Only schema validation has passed at discovery;
repository, evidence, test comparison and browser checks remain `not-run`.

```ts
import { discoverWorkflows, serializeCandidateYaml } from '@pathcompiler/workflow-discovery';
const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
const capabilities = discoverCapabilities(mined.graph);
const result = discoverWorkflows(capabilities.graph, capabilities.report, mined.report);
for (const candidate of result.report.candidates) {
  const yaml = serializeCandidateYaml(candidate);
}
```

Discovery uses ordered, nonconditional test-body segments whose click/fill/select
actions resolve to semantic targets. It preserves text/count assertions rather
than inventing application events. A repeated failed form submission followed by
an asserted error, corrected input and retry is omitted with a diagnostic.
Cancellation, cross-page behavior, unsupported actions and scoped locators stop a
segment. Identical paths merge evidence; different paths receive stable variants.
No branch guards, authorization rules or input defaults are inferred. Callers must
bind input values and establish prerequisites before future execution.

Shared-container disappearance is a weaker completion signal and is flagged for
review. Static annotations are not approvals; no approval registry exists yet.
API/history/PR evidence can support graph provenance but cannot invent missing
steps or completion. No model or browser is invoked. A committed snapshot is
required; dirty source is explicitly flagged. These are private build artifacts.

Rediscovery replaces valid candidate files only and preflights every destination
before writing. Approved or malformed files cause an actionable error. Old files
are not pruned; the current report lists the current candidates. YAML parsing
requires one YAML 1.2 document, unique keys, no aliases and a 2 MiB size limit.
See [ADR 0010](docs/decisions/0010-test-backed-workflow-candidates.md).

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
| `@pathcompiler/evidence` | `collectGraphEvidence`, `sourceProvenance`, evidence bundle/provenance schemas and shared workflow evidence references |
| `@pathcompiler/capability-engine` | `discoverProductSurfaces`, `discoverCapabilities`, `evaluateCapabilities`, surface/capability/evaluation schemas, `SemanticModel`, classification/summary schemas and output parsers |
| `@pathcompiler/workflow-discovery` | `discoverWorkflows`, candidate/report schemas, `serializeCandidateYaml`, `parseCandidateYaml` |
| `@pathcompiler/cli` | `pathcompiler scan`, `targets suggest`, `tests mine`, `git inspect`, `github inspect`, `surfaces discover`, `capabilities discover`, `workflows discover`, `runCli` |

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
