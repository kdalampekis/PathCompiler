# PathCompiler

Compile your codebase into executable product workflows.

PathCompiler will analyze source code, tests and Git history, discover workflows,
and compile reviewed workflows into versioned headless artifacts. The product graph
is a build-time representation; approved workflows are the runtime source of truth.

This repository implements **Phase 0 — Repository Foundation**,
**Phase 1 — Static Next.js Analyzer**, **Phase 2 — Semantic Targets**,
**Phase 3 — Playwright Test Mining**, **Phase 4 — Git Intelligence**,
**Phase 5 — GitHub PR Adapter**, **Phase 6 — Product Surface Graph**,
**Phase 7 — Capability Discovery**, **Phase 8 — Workflow Candidate Discovery** and
**Phase 9 — Workflow Validation**.
Browser verification, compilation, SDKs and
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

## Validate workflows

```sh
pnpm pathcompiler workflows discover ./fixtures/next-demo
pnpm pathcompiler workflows validate clients.create ./fixtures/next-demo
```

Validation reads the candidate under `.pathcompiler` (or `--out`), rescans source
and tests, and writes `reports/validation/<id>.json`. A failed validation writes
its report and exits nonzero. It does not change YAML or trust cached validation
labels. IDs must match the candidate filename. `--exclude` applies to the rescan.

```ts
import { validateWorkflow } from '@pathcompiler/workflow-validator';
const report = validateWorkflow(candidate.workflow, {
  graph: mined.graph,
  traces: mined.report, // optional; absence is reported as not-run
});
```

Reports contain `valid`, `errors`, `warnings` and explicit checks for schema,
structure, repository, evidence, test comparison and browser verification. Issues
include a code, actionable message and applicable step/evidence IDs. The validator
checks first-step reachability, explicit next/branch edges, impossible duplicate
guards and unbounded cycles. No implicit array-order edges are added. A reachable
step with no outgoing transition can wait for terminal completion; only the browser
can prove that completion actually occurs.

Targets must resolve to one source declaration, and their provenance must match
the current commit. Routes use the graph's canonical paths/templates; arbitrary
concrete dynamic URLs are not inferred. Evidence references must match their graph
type, location and snapshot; historical Git/PR refs retain their original commits.
Weak, low-confidence, dirty, external or runtime-dependent evidence is reported.

For supported linear workflows, static test comparison checks cited action order,
targets, transition assertions and completion within one continuous segment.
Failed form probes may be excluded only with an asserted error, correction and
retry. It cannot combine repetitions or later unrelated assertions. Branch guards,
wait/explain actions and unsupported conditions yield explicit partial/not-run
comparison. Missing tests never count as passing tests. Browser validation is
always `not-run` here. `valid: true` means the applicable static checks passed;
warnings still require review and it does not grant approval or execution authority.
See [ADR 0011](docs/decisions/0011-explicit-workflow-validation.md).

## Verify in the browser

```sh
pnpm test:e2e
```

`@pathcompiler/workflow-validator/browser` exports `verifyFixtureWorkflow`, a
deliberately narrow Playwright runner for the fixture's `clients.create` path. The
caller supplies the candidate, a loopback fixture URL, a `Page` carrying the
intended test session and explicit input values; values are never read from
evidence and never written to the report.

```ts
import { verifyFixtureWorkflow } from '@pathcompiler/workflow-validator/browser';
const evidence = await verifyFixtureWorkflow(candidate.workflow, {
  page,
  baseURL: 'http://127.0.0.1:3101',
  inputs: { 'client.form.name': 'Ada', 'client.form.email': 'ada@example.test' },
});
```

The runner refuses non-loopback origins, unsupported workflows, changed step
targets/order, branches, preconditions and unsupported conditions before opening
the app. It then opens `/clients`, requires each semantic target to resolve to
exactly one rendered element, performs only the allowed click/fill actions, checks
each expected transition and the terminal assertion, and stops on navigation away
from the fixture. The versioned report records per-step action/expectation status
and a structured failure (`target-not-found`, `ambiguous-target`, stage and step).
It is not a general browser automation engine.
See [ADR 0012](docs/decisions/0012-fixture-browser-verification.md).

## Review workflows

```sh
pnpm pathcompiler workflows list
pnpm pathcompiler workflows show clients.create
pnpm pathcompiler workflows approve clients.create ./fixtures/next-demo --by "Ana"
pnpm pathcompiler workflows reject plans.create --by "Ana" --reason "Covered elsewhere"
```

Approval rescans the repository, re-runs static validation (writing the report)
and refuses failed, stale or uncommitted candidates. It writes
`.pathcompiler/workflows/<id>.yaml` with `approvedBy`, `approvedAt` and
`approvedCommit`. Commit that file: it is the repository-visible runtime source
of truth. Rejection writes `.pathcompiler/workflows/rejected/<id>.yaml` with the
reviewer, time, candidate commit and optional reason. The reviewer comes from
`--by` or `PATHCOMPILER_USER`.

Decisions are never replaced: approving or rejecting an already reviewed ID fails,
and discovery leaves approved files untouched. Candidates stay under
`workflows/candidates/` as regenerable discovery cache. `list` shows each ID once
(approved over rejected over candidate); `list`/`show` accept `--json`. Changing an
approved workflow requires the later proposal/deprecation phases.
See [ADR 0013](docs/decisions/0013-file-based-workflow-review.md).

## Compile approved workflows

```sh
pnpm pathcompiler build
```

`build` reads only approved `.pathcompiler/workflows/<id>.yaml` records and writes:

| File | Contents |
| --- | --- |
| `generated/search-index.json` | ID, title, aliases, action/entity/qualifiers, roles, entry routes, required permissions/feature flags |
| `generated/runtime-manifest.json` | Browser-safe entrypoints, preconditions, steps (target, action, instruction, expected, next/branches) and terminal |
| `generated/documentation.json` | Readable step text, prerequisites, expected outcomes, completion and the bound commit |

```ts
import { compileWorkflows } from '@pathcompiler/workflow-compiler';
const { searchIndex, runtimeManifest, documentation } = compileWorkflows(approvedRecords);
```

Compilation is pure and deterministic: output is sorted by ID, contains no
timestamps and is byte-identical for the same approved content and
`COMPILER_VERSION`. Each record carries a `revision` (SHA-256 of the canonical
approved workflow), so reviewer metadata alone never changes it. The runtime
manifest and search index omit evidence, provenance, confidence, commits, file
paths and reviewer names. Candidates and rejected workflows are never compiled,
and the compiler does not re-validate approved files against newer commits.
Aliases are empty until alias generation exists.
See [ADR 0014](docs/decisions/0014-deterministic-workflow-compiler.md).

## Resolve product help

```ts
import { createResolver } from '@pathcompiler/resolver';
const resolver = createResolver(searchIndex); // generated/search-index.json
resolver.resolveProductHelp({
  query: 'How do I add a new client?',
  context: { route: '/clients', role: 'editor', permissions: [], featureFlags: {} },
});
// { type: 'workflow', workflow: { id: 'clients.create', ... }, confidence: 1, matched: {...} }
```

The resolver uses only the compiled search index, never the graph. It normalizes
text (case, diacritics, simple plurals, `set up`), matches approved aliases, then
requires the record's entity and a compatible action from a small generic verb
lexicon (create/change/delete groups). Product vocabulary such as entity synonyms
belongs in approved aliases, not in the lexicon. Results are `workflow`,
`ambiguous` (`multiple-matches`, or `action-unclear` when only the entity is
named) or `unsupported` (`empty-query`, `no-match`, `unavailable-in-context`).
Role, permission and feature-flag requirements exclude workflows only when the
caller supplies that context. The current route breaks ties but never excludes.
`confidence` is the share of action/entity/qualifier signals found, not a
probability. No embedding adapter is included.

`packages/resolver/eval/fixture-paraphrases.json` holds 20 paraphrases and 5
controls written before the matcher. The test compiles the approved fixture
workflows and requires the recorded 80% target: currently 17/20 (85%), with no
wrong-workflow answers. See [ADR 0015](docs/decisions/0015-lexical-product-help-resolver.md).

## Headless JS SDK

```ts
import { PathCompiler, createStaticTransport } from '@pathcompiler/sdk-js';
import searchIndex from './.pathcompiler/generated/search-index.json';
import runtimeManifest from './.pathcompiler/generated/runtime-manifest.json';
import documentation from './.pathcompiler/generated/documentation.json';

const client = new PathCompiler({
  project: 'next-demo',
  transport: createStaticTransport({ searchIndex, runtimeManifest, documentation }),
});
await client.resolve({ query: 'add a client', context: { route: '/clients' } });
await client.workflows.search('plan');               // [] | [one] | ambiguous options
await client.workflows.get('clients.create');        // readable steps, no commit
await client.workflows.getRuntimeManifest('clients.create');
```

`RuntimeTransport` has `resolve`, `getWorkflow` and `getRuntimeManifest`. The
client validates every request and every transport response, and throws
`PathCompilerError` (`invalid-request`, `workflow-not-found`, `invalid-response`).
Transport failures propagate unchanged. The static transport is offline. It
refuses incomplete artifacts or files from different builds, returns copies, and
strips the documentation commit from `workflows.get`. The SDK's module graph uses
no Node.js built-ins: compiler contracts come from the browser-safe
`@pathcompiler/workflow-compiler/schema` entry. An HTTP transport arrives with the
HTTP service. See [ADR 0016](docs/decisions/0016-headless-sdk-transports.md).

## React runtime

```ts
import {
  PathCompilerProvider, useProductHelp, useWorkflow,
  useGuideRuntime, useWorkflowProgress,
} from '@pathcompiler/react';

// Next.js: <PathCompilerProvider client={client} route={usePathname()} context={{ role }}>
const help = useProductHelp(query);            // { status, data: ProductHelpResult, error }
const details = useWorkflow('clients.create');
const guide = useGuideRuntime();               // { state, start(id), pause, resume, stop, next, emit }
const progress = useWorkflowProgress();        // { status, completed, total, fraction, step }
```

`@pathcompiler/runtime-core` holds the framework-independent guide engine
(`createGuideRuntime`) and a DOM observer (`createDomEnvironment`) for
`data-pathcompiler` targets. The runtime only observes. It never clicks, types or
navigates for the user. It waits for an entry route (`waiting-route`), tracks one
step at a time, and advances on the user's own interaction or the step's
expected condition. Inputs commit on `change`, `navigate` steps on the route, and
`explain`/`wait` steps on an explicit `next()`. An already-true expectation never
skips an untouched step. Branches, application events (`emit`) and
permission/feature-flag context are supported.

A target that does not resolve to exactly one visible element becomes
`target-missing` after a grace period, keeping the step's instruction available
as a fallback. It recovers when the target appears. `pause`/`resume` stop
observation and timers. `stop` is explicit. A step without progress becomes
`timed-out`. The React provider creates the runtime after mount, so server
rendering is safe and reports `idle`. Pass the router's route so SPA navigation
is observed. See [ADR 0017](docs/decisions/0017-observing-guide-runtime.md).

## Optional UI components

```tsx
import { GuideOverlay, ProductHelpCard, WorkflowChecklist, WorkflowSearch } from '@pathcompiler/ui';

<WorkflowSearch onSelect={setWorkflowId} />
<ProductHelpCard result={help.data} onSelect={setWorkflowId} />
<WorkflowChecklist workflowId="clients.create" />
<GuideOverlay />
```

`@pathcompiler/ui` is a convenience layer. The SDK, runtime and React adapter never
depend on it, and every component uses only public `@pathcompiler/react` hooks, so
an application can replace any of them. Components use semantic HTML: labelled
sections and headings, an ordered checklist with `aria-current="step"`, a labelled
`<search>` form that resolves on submit, live status regions, and a non-modal guide
panel with Pause/Resume/Stop/Next buttons. The overlay's highlight is
`aria-hidden` and pointer-transparent, and missing targets show a text fallback.
Theme with `className`, the `pathcompiler-*` classes or the CSS custom properties
`--pc-accent`, `--pc-surface`, `--pc-text`, `--pc-radius` and `--pc-z-index`.
Override any text (for example for translation) with `labels`. Only the overlay
sets inline styles, and only those its positioning needs.
See [ADR 0018](docs/decisions/0018-optional-ui-components.md).

## MCP server

```sh
pnpm pathcompiler build
pnpm pathcompiler mcp            # stdio; configure your MCP client to run this
```

Read-only tools: `pathcompiler.resolve_help`, `pathcompiler.search_workflows`,
`pathcompiler.get_workflow`, `pathcompiler.get_related_workflows` and
`pathcompiler.get_supported_actions`. Each tool makes exactly one SDK call
(`resolve`, `workflows.search/get/related/getSupportedActions`) and returns the
same data as structured content and JSON text. SDK errors (for example
`workflow-not-found`) come back as readable tool errors. `get_related_workflows`
returns workflows sharing the entity first, then the domain. `get_supported_actions`
reports explain/checklist/navigate/guide and always `execute: false`. Both are
implemented in `@pathcompiler/resolver`, not in the MCP package. Programmatic use:
`createPathCompilerMcpServer(client)` or `serveStdio(client)` from
`@pathcompiler/mcp-server`. Admin tools (impacted workflows, change evidence) wait
for impact analysis. See [ADR 0019](docs/decisions/0019-mcp-adapter-over-sdk.md).

## HTTP service

```sh
pnpm pathcompiler build
PATHCOMPILER_API_TOKEN=<secret, 16+ chars> pnpm pathcompiler serve --port 4310
```

| Endpoint | SDK call |
| --- | --- |
| `POST /v1/help/resolve` `{query, context?}` | `resolve` |
| `POST /v1/workflows/search` `{query, context?}` → `{workflows}` | `workflows.search` |
| `GET /v1/workflows/:id` | `workflows.get` |
| `GET /v1/workflows/:id/runtime` | `workflows.getRuntimeManifest` |
| `GET /v1/workflows/:id/related` | `workflows.related` |

Every request needs `Authorization: Bearer <token>`. Tokens are compared in
constant time. The service binds to `127.0.0.1` unless `--host` is given. Each
endpoint is one SDK call, so results, validation and error codes mirror the SDK.
A test compares HTTP and in-process results for every endpoint. Errors are
`{error: {code, message}}` with 400/401/404/405/413/415 statuses. Unexpected
failures return a generic 500 and are reported to the host (stderr in the CLI),
never to the client. Responses are `no-store`. Bodies are JSON only, up to 64 KiB.

```ts
import { PathCompiler, createHttpTransport } from '@pathcompiler/sdk-js';
const client = new PathCompiler({
  project: 'next-demo',
  transport: createHttpTransport({ baseUrl: 'http://127.0.0.1:4310', token }),
});
```

The token is a shared secret for local or server-to-server use. Do not embed it
in browser bundles. There is no CORS, user auth, rate limiting or billing yet.
See [ADR 0020](docs/decisions/0020-minimal-http-runtime-service.md).

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
| `@pathcompiler/workflow-validator` | `validateWorkflow`, `ValidationContext`, validation issue/check/report schemas and types; `./browser`: `verifyFixtureWorkflow`, browser verification report schema |
| `@pathcompiler/workflow-review` | `approveCandidate`, `rejectCandidate`, `reviewPaths`, approved/rejected record schemas, YAML serialize/parse, `ReviewError` |
| `@pathcompiler/workflow-compiler` | `compileWorkflows`, `workflowRevision`, `describeCondition`, `COMPILER_VERSION`, search/runtime/documentation schemas and types; `./schema`: browser-safe schemas only |
| `@pathcompiler/resolver` | `createResolver`, `resolveProductHelp`, `normalizeTokens`, `evaluateResolver`, `relatedWorkflows`, `supportedActions`, request/result schemas and types |
| `@pathcompiler/sdk-js` | `PathCompiler`, `RuntimeTransport`, `createStaticTransport`, `createHttpTransport`, `PathCompilerError`, `WorkflowDetailsSchema` and types |
| `@pathcompiler/runtime-core` | `createGuideRuntime`, `createDomEnvironment`, `routeMatches`, `idleGuideState`, environment/state types |
| `@pathcompiler/react` | `PathCompilerProvider`, `useProductHelp`, `useWorkflow`, `useGuideRuntime`, `useWorkflowProgress` |
| `@pathcompiler/ui` | `ProductHelpCard`, `WorkflowChecklist`, `GuideOverlay`, `WorkflowSearch`, `defaultLabels` |
| `@pathcompiler/mcp-server` | `createPathCompilerMcpServer`, `serveStdio`, `MCP_TOOL_NAMES` |
| `@pathcompiler/http-service` | `createHttpService`, `createRequestHandler`, `HttpServiceOptions` |
| `@pathcompiler/cli` | `pathcompiler scan`, `targets suggest`, `tests mine`, `git inspect`, `github inspect`, `surfaces discover`, `capabilities discover`, `workflows discover/validate/list/show/approve/reject`, `build`, `mcp`, `serve`, `runCli` |

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
