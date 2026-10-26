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
Deactivate Client, Create Plan, Change Plan Structure and Archive Plan. Create an
active client before adding a plan. Expanding a plan to Weekly saves immediately;
switching back to Simple asks for confirmation. Clients can also be deactivated
from the Edit Client dialog (an intentional alternative path).

The controls at the top switch the role (Admin, Editor or Viewer) and two
feature flags (plan structure, and plan archive, which is off by default). Admins
can do everything editors can, and only admins can archive plans. The API
enforces all of these gates.

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

The fixture produces nine traces. Three tests are fully extracted; six are
partial because some setup, data-processing or control-flow code is
unsupported. The API-only test has a null start route. All nine retain terminal
assertions,
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

The fixture yields 26 candidates: three pages, one shared modal, three forms and
19 actions, including all six primary workflow action anchors. Synthetic tests
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
reviewed list produces all six intended capabilities with **0 false positives
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
`clients.create`, `clients.deactivate` (through its alternative-path test),
`plans.archive`, `plans.create` and `plans.change_structure`. Edit Client stays
explicitly skipped, because its completion assertion cannot yet be resolved to a
semantic observation target.

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

`@pathcompiler/workflow-validator/browser` exports `verifyWorkflowInBrowser`
(C8, report v2) for any linear workflow:
- it checks everything before acting: an origin (loopback or a listed
  preview), allowed actions, explicit input bindings, and an allowlist for
  destructive-looking controls such as delete, deactivate or archive;
- a `prepare` hook can set up records, role and flags;
- stale or ambiguous targets fail with the step, and `browserEvidenceItem`
  turns a report into `browser` evidence for evidence fusion.

See [ADR 0065](docs/decisions/0065-generalized-browser-verification.md). It
also exports `verifyFixtureWorkflow`, a
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

### Static export formats

```sh
pnpm pathcompiler build --format json,yaml,markdown
```

`json` (the default) writes the three artifacts the SDK's
`createStaticTransport` reads, ready to import into an application bundle. `yaml`
writes the same data as `.yaml`. `markdown` writes `generated/workflows.md`, a
readable catalog. Approved text is escaped so it renders literally. Every format is
deterministic, and nothing in static mode calls a PathCompiler server: a test
resolves help from the built JSON with `fetch` disabled.
See [ADR 0028](docs/decisions/0028-static-export-formats.md).

## Export help documentation

```sh
pnpm pathcompiler docs export            # docs/help/<id>.md and docs/help/index.md
pnpm pathcompiler docs export --dir site/help
```

Each approved workflow becomes a help page (where, who, prerequisites, numbered
steps with expected outcomes and branches, completion), plus an index grouped by
domain. The pages come only from compiled documentation records, so business
knowledge is not duplicated by hand. Markdown is never the source of truth: every
page starts with a generated-file marker naming the workflow and revision. Export
replaces only marked files and removes marked pages of workflows that are no longer
approved. It refuses to overwrite hand-written Markdown and leaves other files
alone. Output is deterministic.
See [ADR 0029](docs/decisions/0029-generated-help-documentation.md).

## Assistant tool adapters

```ts
import {
  anthropicTool, openAITool, jsonSchemaTool, langChainTool,
  resolveProductHelp, toolResultText,
} from '@pathcompiler/assistant-tools';

tools: [anthropicTool()]                 // Anthropic: {name, description, input_schema}
tools: [openAITool()]                    // OpenAI Chat Completions; openAITool({ api: 'responses' })
const tool = langChainTool(client);      // {name, description, schema, invoke(input) → JSON string}

// When the model calls the tool (OpenAI passes a JSON string, Anthropic an object):
const result = await resolveProductHelp(client, toolCall.arguments ?? toolUse.input);
reply(toolResultText(result));
```

There is one provider-neutral tool, `resolve_product_help`, described by a single
JSON Schema. `resolveProductHelp` validates the arguments and calls the SDK
client, so every adapter returns exactly what the SDK returns. The OpenAI variant
uses a strict-mode schema (all properties required, optional values nullable,
feature flags as name/value pairs), and the handler maps it back. No provider SDK
is a dependency of any package, and a test enforces that.
See [ADR 0030](docs/decisions/0030-provider-neutral-assistant-tools.md).

A complete example of an existing assistant that adds PathCompiler as one tool
call and renders answers with its own UI, without any PathCompiler UI package or
server, is in [examples/custom-assistant](examples/custom-assistant/README.md).

## Full reference demo

```sh
pnpm --filter @pathcompiler/reference-demo demo
```

This runs the whole loop on a Git copy of the fixture: scan, product graph,
discovery, approval, compile, resolver query, custom assistant answer, code change,
impact detection, update proposal, approval, and new runtime output. The browser
suite (`test:browser`, part of `pnpm test:e2e`) also verifies the navigate action
and the interactive guide on the original app. It then shows that the rebuilt
manifest guides the changed app while the old manifest fails safely. See
[examples/reference-demo](examples/reference-demo/README.md) and
[ADR 0031](docs/decisions/0031-reference-demo.md).

## Resolve product help

```ts
import { createResolver } from '@pathcompiler/resolver';
const resolver = createResolver(searchIndex); // generated/search-index.json
resolver.resolveProductHelp({
  query: 'How do I add a new client?',
  context: { route: '/clients', role: 'editor', permissions: [], featureFlags: {} },
});
// { type: 'workflow_help', workflowId: 'clients.create', workflowVersion: 1, revision: 'sha256:…',
//   confidence: 1, content: { title: 'Create Client', steps: [{ id: 'step.1', text: 'Click Create Client' }, …] },
//   entrypoint: { route: '/clients' },
//   capabilities: { explain: true, checklist: true, navigate: true, guide: true, execute: false }, matched: {...} }
```

The resolver uses only the compiled search index, never the graph. It normalizes
text (case, diacritics, simple plurals, `set up`), matches approved aliases, then
requires the record's entity and a compatible action from a small generic verb
lexicon (create/change/delete groups). Product vocabulary such as entity synonyms
belongs in approved aliases, not in the lexicon.

Results follow Runtime Result v1 (spec §63–65):
- `workflow_help`: the workflow ID, its version (an integer, `workflowVersion`)
  and content hash (`revision`), plus `content.steps`, `entrypoint` and
  `capabilities`.
- `ambiguous`: `candidates[{ workflowId, workflowVersion, title, confidence }]`,
  with reason `multiple-matches`, or `action-unclear` when only the entity is
  named.
- `unsupported`: reason `no_matching_workflow`, `not_available_for_context` or
  `workflow_not_verified`. The last one is reserved and not yet produced.

The context is the full `RuntimeContext`: `route`, `locale`, `role`,
`permissions`, `featureFlags`, `tenant` and `productRelease`. `locale`,
`tenant` and `productRelease` are accepted and passed through, but do not
change resolution yet. See ADR 0043 for the migration from the earlier shapes.
Role, permission and feature-flag requirements exclude workflows only when the
caller supplies that context. The current route breaks ties but never excludes.
`confidence` is the share of action/entity/qualifier signals found, not a
probability. No embedding adapter is included.

`fixtures/next-demo/eval/queries.json` holds 20 paraphrases and 5
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
`timed-out`.

`start(workflow, { revision, version })` takes the revision and version from a
`workflow_help` result. If the loaded manifest differs, the guide fails with
`manifest-mismatch` instead of guiding through stale steps. The UI card and
`useGuideRuntime().start(id, expected)` pass these values automatically. The
React provider creates the runtime after mount, so server
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

## Graph delta between commits

```sh
pnpm pathcompiler diff <base> <head> ./fixtures/next-demo
```

`diff` exports each commit's tracked files for the selected directory with
`git archive`, which leaves the repository and working tree untouched. It fully
re-analyzes each snapshot (source plus Playwright evidence) and writes
`reports/graph-delta.json`:

- `addedNodes`, `removedNodes`, `changedNodes`, `addedEdges`, `removedEdges`, and
  `changedEdges` (same edge, different data);
- `summary.files` (exact tracked-file changes by content hash, any file type),
  plus added/removed/changed `symbols`, `routes`, semantic `targets` and `apis`.

Commit binding (`repositoryCommit`, the repository node's commit) is ignored, so
unchanged facts never appear as changes. Each changed node lists the data
`fields` that differ and a `kind`: `location` when only evidence locations moved,
otherwise `content`. A label edit is a `content` change on `label`. A renamed
semantic target is a removal plus an addition. `computeGraphDelta(base, head)` is
the pure core. Correctness is preferred over incremental speed: there is no
partial re-analysis yet.
See [ADR 0021](docs/decisions/0021-snapshot-graph-delta.md).

## Workflow impact analysis

```sh
pnpm pathcompiler impact <approved-commit> HEAD ./fixtures/next-demo
```

`impact` computes the graph delta and applies deterministic rules to every
approved workflow. It writes `reports/workflow-impact.json` with
`{workflowId, severity, reasons, affectedSteps}` per workflow, highest severity
first. Approved files are never changed.

| Severity | Rules |
| --- | --- |
| high | step/condition semantic target removed; workflow API removed; entry/navigate route removed or changed; permission/feature-flag node or guard edge changed |
| medium | target behavior changed (not copy-only); API content changed; evidence implementation or test removed; approved commit differs from the delta base |
| low | target moved (evidence location only); copy-only label change; implementation, test or route location changed; an evidence file changed with no specific element affected (no step attribution) |

Rules match the delta against the workflow's step targets, condition targets,
routes and evidence node IDs. No model is used; models may later supplement these
rules but not replace them. `analyzeWorkflowImpact(delta, approvedRecords)` is the
pure core. See [ADR 0022](docs/decisions/0022-deterministic-workflow-impact.md).

## Workflow update proposals

```sh
pnpm pathcompiler proposals generate <approved-commit> HEAD ./fixtures/next-demo
pnpm pathcompiler proposals list
pnpm pathcompiler proposals show plans.change_structure.<head-sha>
pnpm pathcompiler proposals accept plans.change_structure.<head-sha> ./fixtures/next-demo --by "Ana"
pnpm pathcompiler proposals reject|ignore plans.change_structure.<head-sha> --by "Ana" --reason "…"
```

For each medium/high impact, `generate` rediscovers workflows at the head commit
and matches the approved workflow: by the same ID, then the same intent, then a
unique best match with at least 50% shared step targets. It writes
`.pathcompiler/proposals/<id>.<head-sha>.yaml` containing the impact reasons, the
proposed workflow (approved ID kept, `status: candidate`, bound to the head
commit), its validation against the head graph, changed files, date-bounded
commits touching them, and a human-readable diff of approved versus proposed
semantics (evidence summarized as counts). Existing proposal files are never
overwritten. If nothing matches, `proposed` is null and the reviewer writes it by
hand.

Review modes: `accept` re-validates the proposal on a clean checkout of its head
commit and only then replaces the approved record (new
`approvedBy/approvedAt/approvedCommit`). The mode is recorded as `edit` when
`proposed` was changed by hand. `reject` and `ignore` (ignore for this change)
record the decision and leave the approved workflow untouched. Decided proposals
cannot be decided again. Generation never modifies approved files.
See [ADR 0023](docs/decisions/0023-reviewed-workflow-update-proposals.md).

## Detect new workflows

```sh
pnpm pathcompiler workflows detect <base> HEAD ./fixtures/next-demo
```

`detect` compares capabilities discovered at both commits. A capability that is
new at head and has no approved or rejected workflow (by ID or intent) is scored
from independent signals: a new user-facing action (0.30), a new write API, either
in its evidence or newly called from its component (0.25), a new Playwright flow
(0.20), a new route or component such as a dialog (0.15), and a commit subject
naming its verb and entity (0.10). No single signal is enough:

- `new-candidate`: two or more signals and a test-backed candidate. The candidate
  YAML is written (existing files are kept) for normal validation and approval.
- `needs-evidence`: two or more signals, but no supported test flow yet.
- `insufficient-evidence`: one signal. Reported only; no candidate.

The report is `reports/new-workflows.json`. Confidence is rule strength, not
probability. See [ADR 0024](docs/decisions/0024-multi-signal-new-workflow-detection.md).

## Deprecate workflows

`proposals generate` writes a **deprecation** proposal (same file naming,
`kind: workflow-deprecation-proposal`) instead of an update when two things hold:
a high impact includes lost critical support (a removed step or condition target,
a removed API, or a removed route), and no head-commit workflow matches. The
proposal lists the lost support, a possible replacement (a capability new at head
in the same domain and entity) and a readable summary. `proposals show` prints
the summary.

```sh
pnpm pathcompiler proposals accept plans.change_structure.<head-sha> --by "Ana"
```

Accepting is an explicit reviewed decision. It verifies the approved workflow is
unchanged since generation, writes `.pathcompiler/workflows/deprecated/<id>.yaml`
(the full workflow with `status: deprecated`, reasons, replacement and commit),
and removes the approved file so `build` no longer compiles it. Git keeps the
history. Nothing is deleted automatically. `reject` and `ignore` keep the workflow
approved. `workflows list/show` report the `deprecated` state, and approving the
same ID again requires removing the deprecated record.
See [ADR 0025](docs/decisions/0025-reviewed-workflow-deprecation.md).

## GitHub App

```sh
pnpm pathcompiler github-app manifest --name PathCompiler --url https://… --webhook https://…/hook
GITHUB_WEBHOOK_SECRET=… pnpm pathcompiler github-app serve --config github-app.json --port 4320
```

`github-app.json` contains `{"appId": "123", "privateKeyPath": "app.pem",
"repositories": {"owner/repo": {"path": "./clone", "appDirectory": "."}}}`. Paths
are relative to the config file. The secret and private key are never stored in
it.

| Concern | Behavior |
| --- | --- |
| Permissions | Manifest requests `checks: write`, `contents: read`, `metadata: read`, `pull_requests: read`; events `push`, `pull_request` only |
| Webhooks | `X-Hub-Signature-256` HMAC over the raw body, constant-time; 1 MiB limit; ping answered |
| Flow | verify → 202 acknowledgement → in-process queue (deduplicated by delivery) → asynchronous analysis → check run |
| Events | push (branch create/delete ignored); pull requests opened/synchronize/reopened |
| Tokens | RS256 app JWT → installation token scoped down to checks/contents/metadata, cached until near expiry |
| Analysis | fetches base/head into the configured clone (token via `GIT_CONFIG_*` env, never argv/URL/logs), then delta, impact and new-workflow detection against the clone's committed `.pathcompiler/workflows` |

The check run is named `PathCompiler Workflow Check`. Its summary reads
`✓ N workflows unaffected / ⚠ N workflows require review / + N possible new
workflows`, with details per workflow. Review needs are `neutral` (they don't block
merging). Analysis errors publish a `failure` check with an actionable message.
Approved workflows are never changed by the app. The queue is in-process: a
restart drops pending jobs, and GitHub redelivery is the recovery path.
See [ADR 0026](docs/decisions/0026-github-app-workflow-checks.md).

## Control plane dashboard

```sh
pnpm --filter @pathcompiler/dashboard build
PATHCOMPILER_PROJECTS='{"demo":{"root":"/path/to/repo"}}' pnpm --filter @pathcompiler/dashboard start --port 3000
```

`apps/dashboard` is a local Next.js app over each project's `.pathcompiler`
directory. Its screens: **Projects**; **Product map** (capabilities by domain,
with routes and workflow coverage); **Workflows**; **Workflow detail** (state,
current commit, approval or deprecation, confidence with dimensions, steps with
expected outcomes and per-step source evidence, the validation report, pending
diffs); **Pending changes** (update and deprecation proposals with diffs, the
latest impact, possible new workflows); **Evidence** (references behind approved
workflows, Playwright traces); and **Settings**.

The first editor is deliberately simple. It offers approve/reject for candidates
and accept/reject/ignore for proposals, and these run the same `pathcompiler`
commands as the terminal, so validation and never-replace rules are identical. The
dashboard has no authentication: bind it to `127.0.0.1` for local review. There is
no graph visualization yet.
See [ADR 0027](docs/decisions/0027-local-control-plane-dashboard.md).

## Configuration (`pathcompiler.yaml`)

```bash
pnpm pathcompiler init        # writes pathcompiler.yaml with every default spelled out
pnpm pathcompiler config show # what is on
```

Without a `pathcompiler.yaml`, nothing is gated and the CLI behaves as it
always has. With one, capabilities are opt-in:
- `reason` commands need `reasoning.enabled` plus their own flag;
- `observe` needs `modes.observe`, and `evaluate` needs `modes.evaluate`;
- `reasoning.impact` adds reasoning findings to `impact` and proposals;
- `analytics.ingest` turns on event ingestion in `serve` with the analytics
  privacy policy.

Analytics is privacy-first by default: no PII, hashed user IDs, no context
keys. API keys are never stored in the file; `model_provider.api_key_env`
names an environment variable. `improvement_policy.autonomous_mutation` is
`false`. `graph inspect` and `capabilities list` summarize existing artifacts.
See [ADR 0053](docs/decisions/0053-configuration-and-flags.md).

## Evaluation harness (`pathcompiler eval`)

```bash
pnpm pathcompiler eval capabilities fixtures/next-demo
pnpm pathcompiler eval workflow-discovery fixtures/next-demo
pnpm pathcompiler eval resolver fixtures/next-demo
pnpm pathcompiler eval impact fixtures/next-demo
```

Each command scores PathCompiler against the reviewed ground truth in
`<directory>/eval/`, which holds `capabilities.json`, `workflows/*.yaml`,
`impact-cases/*.json` and `queries.json`. It prints the misses and writes
`reports/eval/<family>.json`. The metrics are:
- capability precision and recall;
- workflow discovery: recall, entrypoints, major-step order (input fields
  order-free), terminals and invented steps;
- resolver top-1, ambiguity and unsupported accuracy;
- impact: affected-workflow recall, false positives and severity.

Impact cases edit a temporary Git copy of the fixture. Results are
deterministic. `evaluateWorkflowDiscovery` in `@pathcompiler/evaluation`
takes an alternative discovery function for comparisons. Readable golden
files under `packages/*/test/golden/` cover the graph summary, candidates,
the runtime manifest and the reports.
See [ADR 0054](docs/decisions/0054-evaluation-harness-and-golden-tests.md).

`pnpm pathcompiler eval workflow-discovery fixtures/next-demo --compare` also
runs reasoning-assisted discovery (`@pathcompiler/reasoning-discovery`). It
plans each capability goal in the formal model, derives roles and flag
preconditions from reachability, and takes terminals from the tests. It then
reports both strategies side by side, with invented-step rate, applicability
accuracy and edit distance. On the fixture, reasoning reaches recall 1
against 0.6, but its terminals are weaker, so the baseline remains the default.
See [ADR 0055](docs/decisions/0055-reasoning-assisted-workflow-discovery.md).

## Minimal enablement (`reason enable`)

```bash
pnpm pathcompiler reason enable clients.created fixtures/next-demo --context role=unlisted
```

`reason enable` lists every smallest set of policy changes that would make an
unreachable goal reachable: a context value (run as another role, turn a flag
on), or a role, flag or permission guard to drop. Each set comes with a
witness and source evidence. On the fixture, a viewer can be enabled to
create a client in two ways: change the role, or drop the submit handler's
role guard. It is diagnostic only and changes nothing. Library:
`findMinimalEnablement` in `@pathcompiler/reasoner-core`. See
[ADR 0059](docs/decisions/0059-minimal-correction-sets.md).

## Alternative paths (`reason alternatives`)

```bash
pnpm pathcompiler reason alternatives clients.deactivated fixtures/next-demo --context role=editor
```

`reason alternatives` enumerates every plan up to one step (`--slack`) longer
than the shortest. Each plan reaches the goal only at its last step, and
`@pathcompiler/trace-clustering` groups the plans into business variants by
entry capability, route family and major actions; navigation links, field
order and abandoned dialogs do not make a new variant. On the fixture,
Deactivate Client has two variants: the row button, and the button inside
Edit Client. See
[ADR 0060](docs/decisions/0060-plan-enumeration-and-trace-clustering.md).

## Cheapest paths and UX metrics (`reason optimize`)

```bash
pnpm pathcompiler reason optimize clients.deactivated fixtures/next-demo --context role=editor --weight entry=2
```

`reason optimize` ranks plans by per-category costs:
- categories are navigation, entry, field, submit, confirmation, back, cancel
  and other;
- each costs 1 unless `--weight` changes it.

The cheapest plan is proven optimal when every plan that could beat it was
enumerated; otherwise it is marked `not-guaranteed`. The variants are ranked
by cost. UX metrics (actions, page transitions, form fields, dialog
interactions, confirmations) are reported as hypotheses, not redesign
instructions. See
[ADR 0061](docs/decisions/0061-cost-optimal-plans-and-ux-metrics.md).

## Dead features (`reason dead-features`)

```bash
pnpm pathcompiler reason dead-features fixtures/next-demo
```

`reason dead-features` checks every capability goal (with any context) and
every capability action. It flags three kinds of candidate:
- an unreachable capability, with the proving constraints and possible
  causes (an impossible permission combination, a stale flag, dead code, or
  an incomplete model);
- an action that can never be performed;
- a capability whose button and API exist but which no formal trace
  connects (a potential model or product gap).

Findings are candidates for review. See
[ADR 0062](docs/decisions/0062-dead-features-and-missing-transitions.md).

## Generated tests (`tests generate`)

```bash
pnpm pathcompiler tests generate fixtures/next-demo --setup fixtures/next-demo/eval/test-setup.json
```

`tests generate` writes candidate Playwright tests to
`.pathcompiler/generated-tests/`:
- a positive test per reachable capability goal, planned from an empty
  product, so it creates its own prerequisites;
- a negative test per role value or flag that the reasoner proves blocks the
  goal.

The setup file maps context variables (role, flags) to UI controls; contexts
it cannot set are skipped. Completion assertions come from test-backed
workflow terminals, and tests without one are flagged as weak. Every file is
a candidate to review, never added to your suite automatically. On the
fixture, the 15 generated tests run green as part of `pnpm test:e2e`. See
[ADR 0063](docs/decisions/0063-automated-test-generation.md).

## Path efficiency (`observe efficiency`)

```bash
pnpm pathcompiler observe efficiency fixtures/next-demo
```

For each goal and observed role, `observe efficiency` reports the Path
Efficiency Ratio: the median of observed interactions per completion,
divided by the cheapest formal plan. It needs 30+ completions, and lists
friction at 1.5× or more. It is a hypothesis about friction, not proof that
the shortest path is the best experience. See
[ADR 0066](docs/decisions/0066-path-efficiency.md).

## Transition model (`observe transitions`)

`pnpm pathcompiler observe transitions` estimates a Markov chain from
observed sessions: per-state transition probabilities with 95% Wilson
intervals, and the probability of eventually reaching each goal from session
start. States with fewer than 30 outgoing transitions are flagged. These are
estimates of what users do, not of what the product allows. See
[ADR 0068](docs/decisions/0068-probabilistic-transition-model.md).

## Release behavior (`observe release-diff`)

`pnpm pathcompiler observe release-diff r1 r2 --commits <base>..<head>`
compares, per goal, the share of sessions reaching it in two releases (95%
intervals; 30+ sessions per release). With the commits, it sets the result
against the formal semantic diff between them, and classifies each goal as an
expected change, an unexplained behavior change, a formal change not yet
observed, stable, or insufficient data. See
[ADR 0069](docs/decisions/0069-release-behavior-diff.md).

## Drop-offs (`observe drop-offs`)

`pnpm pathcompiler observe drop-offs fixtures/next-demo` counts, per goal and
observed role, sessions that started a goal (activated one of its controls)
but never reached it, and where they stopped. A point where 20% or more of
30+ attempts end is friction, listed with the valid formal routes that avoid
it. On the fixture, editors who leave after the row Deactivate button are
offered the Edit Client route. See
[ADR 0067](docs/decisions/0067-drop-offs-and-alternative-paths.md).

## Developer reasoning (`/v1/reason/*`, `mcp-reasoning`)

```bash
PATHCOMPILER_API_TOKEN=… PATHCOMPILER_DEVELOPER_TOKEN=… pnpm pathcompiler serve
pnpm pathcompiler mcp-reasoning fixtures/next-demo     # developer MCP on stdio
```

Coding agents and developers can ask product-semantic questions:
- reachability, and why a goal is unreachable;
- the shortest plan, and the alternative paths;
- properties, minimal enablement and dead features.

Ask through `POST /v1/reason/<operation>` or the separate reasoning MCP
(`pathcompiler.check_reachability`, `explain_unreachable`, `find_plan`,
`list_alternative_paths`, `verify_product_property`, `minimal_enablement`,
`dead_features`). The reasoning endpoints accept only the developer token,
which is refused on every product endpoint, so end-user tokens never reach
reasoning. Results contain no solver statistics. See
[ADR 0064](docs/decisions/0064-developer-reasoning-surfaces.md).

## Reasoning evaluation cases (`fixtures/reasoning/`)

```bash
pnpm pathcompiler eval reasoning fixtures/reasoning
```

`fixtures/reasoning/` holds reviewed cases in seven categories: reachable,
unreachable, permissions, feature flags, alternative plans, counterexamples and
commit diffs. Each case runs one query against the model extracted from a
fixture: reachability, a plan, an unreachability explanation, a property, or a
diff against the unedited fixture. Seeded bugs (a removed editor or admin check,
a removed flag check, a renamed role) are applied to a temporary copy. The
report gives verdict accuracy, plan accuracy, diff accuracy and the unknown rate
(reasoning spec §89). See
[ADR 0058](docs/decisions/0058-reasoning-fixture-enrichment.md).

## Diagnostics

`scan` prints a counts table (files, routes, components, UI actions, API
endpoints, tests, capabilities, candidate workflows, warnings) and phase
durations. It caches repository analysis by content hash under
`.pathcompiler/cache/` (`--no-cache` to bypass); a cached result is always
identical to a fresh one. Every analyzing command (`capabilities discover`,
`workflows discover`, `reason`, `analyze`, `diagnose` and others) shares that
cache. Set `PATHCOMPILER_LOG=json` for structured logs on
stderr; they never include source contents. Errors use a named taxonomy
(`ConfigurationError`, `RepositoryAnalysisError`,
`UnsupportedFrameworkError`, `GitProviderError` and others) from
`@pathcompiler/diagnostics`. See
[ADR 0070](docs/decisions/0070-diagnostics-hardening.md).

## Model provider boundary (`@pathcompiler/model-provider`)

```bash
pnpm pathcompiler scan fixtures/next-demo --explain-model-context   # dry run; nothing is sent
```

Models are optional. Every call goes through `guardModelProvider`:
- the request is validated and obvious secrets are redacted;
- the context sent is recorded: size, evidence counts, paths and redaction
  counts;
- the response is validated against its schema and may cite only evidence
  from its request.

Requests are evidence packets, never file contents, hidden files (`.env`),
binaries or excluded paths. The default `NoopModelProvider` infers nothing,
and `FixtureModelProvider` replays recorded responses for tests. See
[ADR 0057](docs/decisions/0057-model-provider-boundary.md).

### Provider adapters and semantic analysis (`pathcompiler analyze`)

```yaml
# pathcompiler.yaml
model_provider:
  provider: anthropic        # none (default) | anthropic | openai | local
  model: claude-opus-5       # required for openai and local
  api_key_env: ANTHROPIC_API_KEY
  # base_url: http://localhost:11434/v1   # openai or local (OpenAI-compatible)
```

```bash
export ANTHROPIC_API_KEY=...            # keys only ever come from the environment
pnpm pathcompiler analyze fixtures/next-demo
pnpm pathcompiler analyze <dir> --model-fixtures answers.json   # replay recorded answers
```

`analyze` runs deterministic rules first. They select the capabilities they
could not name with confidence:
- low confidence;
- no semantic target;
- label conflicts;
- the same domain and verb under different qualifiers.

Ambiguous capabilities that share a domain or a page form a cluster. Only a
cluster's surfaces and graph evidence are sent, through the guarded
boundary. The model's answers become `SemanticHypothesis` records (`confirm`,
`rename`, `merge`) that are checked against that evidence. A hypothesis is
rejected when:
- its title uses a capability verb the evidence lacks;
- it names an entity the evidence lacks;
- it cites another surface's evidence;
- it merges different entities.

Rejected hypotheses are never applied, and capabilities are never changed.
The report (`reports/semantic-hypotheses.json`) includes:
- the clusters and hypotheses;
- per-cluster failures (refusals and invalid answers);
- the invention rate;
- the exact context that was sent.

With `provider: none` nothing is sent. On the demo fixture nothing is
ambiguous, so nothing is sent either.

Adapters:
- **Anthropic** (`@pathcompiler/model-provider-anthropic`, the only package
  with a vendor SDK; default model `claude-opus-5`). It uses structured
  outputs and enables server-side refusal fallbacks (`fallbacks: "default"`).
- **OpenAI and local OpenAI-compatible servers**
  (`@pathcompiler/model-provider-openai`, plain HTTP). Examples: Ollama, LM
  Studio, vLLM.

See [ADR 0071](docs/decisions/0071-provider-adapters-and-semantic-interpretation.md).

`analyze` then interprets each ambiguous capability probabilistically (P1).
The candidate meanings are the rule's capability ID plus each hypothesis's
title, parsed to an ID. A candidate is removed when a hard constraint, a
deterministic fact, rules it out:
- the handler's endpoint cannot perform the verb (e.g. PATCH cannot create;
  `/archive` only archives; POST rules nothing out);
- its entity appears in no route, endpoint or capability;
- it is another action's ID with a different handler.

The remaining candidates are re-scored (relative weights, not
probabilities) and fused by evidence tier, so code outranks models. A
contested result is left unresolved rather than guessed. The output goes to
`reports/semantic-interpretations.json`. See
[ADR 0072](docs/decisions/0072-probabilistic-semantic-interpretation.md).

Finally, a joint selection (P2) chooses one meaning per capability with
weighted soft constraints, solved by Z3's optimizer. Two actions whose
handlers call different endpoints never get the same meaning, and evidence
tiers dominate the weights. `SolverProvider.optimize` is the solver-neutral
interface for this. See
[ADR 0073](docs/decisions/0073-weighted-soft-constraints.md).

## Browser failure diagnosis (`pathcompiler diagnose`)

```bash
pnpm pathcompiler diagnose report.json fixtures/next-demo --context role=editor --context plan_archive_enabled=true
```

Given a failed browser verification report (C8), `diagnose` ranks the likely
causes:
- stale target;
- permission mismatch;
- feature flag mismatch;
- backend changed;
- formal model wrong;
- network issue.

Each cause is a claim with evidence for and against it:
- **from the failure:** its stage and code;
- **from the source:** whether the target still exists;
- **from the formal model:** the failing target's role and flag guards,
  evaluated against the run's context.

P0 fusion assesses each claim. A policy refusal supports no cause. The
result (`reports/diagnosis.json`) is a hypothesis for a developer. See
[ADR 0074](docs/decisions/0074-browser-failure-diagnosis.md).

## Commit risk (`pathcompiler impact`)

`impact` also writes `reports/commit-risk.json` and prints a change-risk
line, for example "Change risk: HIGH (definite 2, probable 1, uncertain 3)".
Each impact is classified by how it is known:
- **definite:** removed targets, routes, endpoints or access conditions, and
  R11 reachability changes with `--reasoning`;
- **probable:** content changes to what a step uses;
- **uncertain:** moved targets, copy changes, shared files, unanalyzed
  history and unknown solver results.

The level is a rule over those classes, not an incident probability. A
probability appears only with a calibration of reviewed outcomes. See
[ADR 0075](docs/decisions/0075-commit-risk-scoring.md).

## Probabilistic model checking (`pathcompiler observe check`)

```bash
pnpm pathcompiler observe check clients.created --at-least 0.6 --baseline r1 --release r2
```

On the observed Markov chain (O11), `observe check` reports for a goal:
- the probability of completion and of abandonment, with bounds built from per-transition 95% intervals (conservative, not a joint confidence level);
- the expected transitions to completion.

The bounds treat each state's Wilson intervals, including a small mass for
never-observed transitions, as an interval Markov chain. Small samples
therefore give wide bounds, not false certainty.

`--at-least` and `--at-most` decide a property only when the whole interval
agrees; otherwise the verdict is inconclusive. `--baseline` reports
whether completion increased only when the bounds do not overlap. The
results are estimates about observed users, not about what the product
allows. See [ADR 0076](docs/decisions/0076-probabilistic-model-checking.md).

## Review queue and feedback (`pathcompiler review`)

```bash
pnpm pathcompiler review queue --impact impact.json   # {"plans": 1, "clients.create": 0.2}
pnpm pathcompiler review feedback
```

`review queue` orders pending candidates and proposals by uncertainty ×
business impact × usage × change severity. Each factor is explained, and a
missing input is neutral. Usage comes from stored guide-run events.

`review feedback` turns the stored decisions into labeled data and a
confidence calibration: approvals, rejections, and proposals that were
accepted, edited, rejected or ignored. Only acceptance as proposed counts
as correct. See
[ADR 0077](docs/decisions/0077-review-prioritization-and-feedback.md).

## Findings (`pathcompiler findings`)

```bash
pnpm pathcompiler impact <base> <head> app --reasoning
pnpm pathcompiler findings            # or: findings clients.create
```

`findings` derives product findings from the reports already written:
- **release and permission regressions:** from R11 and impact;
- **workflow friction:** from efficiency and drop-offs;
- **low adoption and runtime/formal discrepancies:** from reconciliation;
- **observed regressions between releases:** from release-diff.

Each finding has fused confidence that it is real, and lineage to its report
entries. Findings are grouped into improvement opportunities, each with an
explained priority. They are hypotheses, not recommendations. See
[ADR 0078](docs/decisions/0078-finding-model.md).

## Improvement gate (`pathcompiler gate`)

`gate` decides, per finding opportunity, what to do. The possible
decisions:
- collect more data;
- log only;
- surface the finding;
- recommend;
- offer to a harness;
- no change.

It asks four questions in order: is the evidence sufficient, is the impact
meaningful, is a recommendation actionable, and is autonomy enabled. It
applies `improvement_policy` and its budgets. Each decision carries an
explained value assessment (impact, affected and eligible users,
confidence, expected gain, cost) and the reason for each question. Nothing
is offered to a harness unless `improvement_policy.autonomous_mutation` and
`modes.self_improvement` are both on. With `pathcompiler.yaml`, `gate`
needs `modes.recommend`. See
[ADR 0079](docs/decisions/0079-improvement-gate.md).

## Recommendations (`pathcompiler recommend`)

`recommend` turns the gate's `recommend` decisions into structured
recommendations from deterministic templates:
- **FIX** for regressions: restore lost reachability, or remove access a
  role newly gained;
- **IMPROVE** for friction;
- **PROMOTE** for low adoption.

Each recommendation has:
- a falsifiable hypothesis, whose intervention confidence is a template
  prior, separate from the finding's confidence;
- desired outcomes;
- protected behaviors: the R8 properties given with `--property`, and the
  other approved workflows;
- acceptance criteria: required formal, property, validation and browser
  checks, plus outcome metrics measured after release.

Recommendations are for human review. See
[ADR 0080](docs/decisions/0080-recommendation-model.md).

## Browser candidate verification (`evaluate --browser`)

In a Playwright job against a candidate's preview build, call
`verifyCandidateWorkflows(workflows, { page, origin, candidateCommit,
select })` from `@pathcompiler/workflow-validator/browser`, and save the
reports. Then run:

```bash
pnpm pathcompiler evaluate <base> <candidate> app --browser browser-reports.json
```

A workflow that fails in the browser fails the candidate, and the failure
is reported with its diagnosed likely cause. Reports for another commit
are ignored. Workflows needing review without a run are flagged. See
[ADR 0081](docs/decisions/0081-browser-candidate-verification.md).

## Experiment specification (`pathcompiler experiment create`)

```bash
pnpm pathcompiler experiment create <recommendation-id> evaluation.json r1 r2
```

For an IMPROVE or PROMOTE recommendation whose candidate passed evaluation,
this command specifies an experiment. It does not deploy anything. The spec
covers:
- control and treatment releases, population, and 50/50 session
  allocation;
- primary and secondary metrics, from the desired outcomes;
- guardrails: other approved workflows keep completing, and nothing
  unexpected is observed;
- success criteria and stop conditions.

The criteria are frozen with a hash before anything is measured. See
[ADR 0082](docs/decisions/0082-experiment-specification.md).

`experiment measure <experiment.json> [evaluation.json]` compares the
control and treatment releases in the stored events against the frozen spec.
It reports goal reach shares or guided-run completion rates with 95%
intervals, guardrail breaches and sample thresholds. The outcome is
improved, neutral, worse or inconclusive. Metrics that events cannot measure
are listed as gaps, and the candidate's formal evaluation is reported
separately from behavior. See
[ADR 0083](docs/decisions/0083-outcome-measurement.md).

`experiment decide <outcome.json>` turns the outcome into an adoption
decision:
- **adopt:** improved, and the candidate passed;
- **rollback:** worse; the hypothesis is rejected;
- **iterate:** neutral;
- **reject:** the candidate failed;
- **extend_experiment:** not enough data;
- **inconclusive:** otherwise.

Every decision waits for `experiment approve|decline <decision.json> --by
<name>`. PathCompiler never deploys or rolls back. See
[ADR 0084](docs/decisions/0084-adoption-decision.md).

## Improvement memory (`pathcompiler memory`)

`memory record <recommendation-id>` links a recommendation's lifecycle
(experiment, outcome, decision) into `memory/`. Lessons come only from
approved decisions, and `memory list` shows them. When an earlier
experiment rejected the same kind of change for the same capability,
`recommend` halves that recommendation's priority, with the reason. That is
one observation, never a rule, and nothing is trained. See
[ADR 0085](docs/decisions/0085-improvement-memory.md).

## Harness contract (mode 6 only; `pathcompiler harness task`)

When mode 6 is enabled twice (`improvement_policy.autonomous_mutation` and
`modes.self_improvement`), `harness task <recommendation-id> <base-commit>`
writes a provider-neutral `HarnessTaskSpec` for an external coding harness.
The task carries:
- the objective and the intended semantic changes;
- the protected behaviors;
- the acceptance criteria;
- lineage back to the findings.

The harness returns a `MutationResult`. The schemas and examples are in
[examples/harness-contract/](examples/harness-contract/). The harness's
claims are never trusted: the candidate is evaluated independently. See
[ADR 0086](docs/decisions/0086-harness-contract.md).

`harness import <MutationResult.json> [directory]` brings a harness's
result back. It checks the result against the exported task, stores it,
and evaluates the candidate commit against the task's base, with criteria
frozen from the task. The harness's claim is checked, never trusted. A
blocked result is recorded with its questions. PathCompiler never runs the
harness itself. See
[ADR 0087](docs/decisions/0087-external-harness-integration.md).

## Evidence fusion (`@pathcompiler/probabilistic-evidence`)

`fuseEvidence(claim, items)` combines supporting and contradicting evidence
(browser, observed, test, formal, static, PR, commit, docs, historical prose,
model hypotheses):
- the most reliable tier for the claim type decides, and each class counts
  once, so evidence is never averaged;
- disagreement becomes an explicit conflict, for example old docs saying
  "Archive Client" become a likely stale artifact;
- the score is rule strength; a probability is reported only from a
  calibration table with enough labeled samples.

See [ADR 0056](docs/decisions/0056-probabilistic-evidence-model.md).

## Formal Product Model (reasoning track)

```ts
import { f, parseFormalModel, serializeFormalModel, formalModelHash } from '@pathcompiler/formal-model';
```

`@pathcompiler/formal-model` is the solver-independent foundation for formal
reasoning (`docs/phases/MASTER_ROADMAP.md`, phase R0). It defines typed state
variables (`context` such as role or flags, versus mutable `state`), an expression
AST, actions with preconditions and simultaneous-assignment effects, invariants,
goals and admissible initial states. Every object carries `EvidenceRef`
provenance to graph nodes. Validation type-checks every expression and effect,
and serialization and hashing are canonical. There is no solver yet, and nothing
changes discovery or runtime behavior.
See [ADR 0035](docs/decisions/0035-formal-product-model-semantics.md).

```ts
import { buildFormalModel } from '@pathcompiler/formal-abstraction';
const { model, coverage, uncertainties } = buildFormalModel(graph, capabilityReport, testTraceReport);
```

`@pathcompiler/formal-abstraction` (phase R1) derives a candidate model from the
Product Graph, capabilities and mined tests. It never reads workflow candidates.
It builds the following:
- navigation from `NAVIGATES_TO` edges;
- an automaton for each capability's dialog, inferred from test sessions
  (open, fields, submit, confirmation, back, cancel);
- guards from the permission and flag checks the API handler enforces;
- completion goals.

Where evidence is missing, the model over-approximates. The coverage report
counts transitions by evidence basis. Each uncertainty names the graph nodes
behind it, for example UI-only guards, an unknown confirmation condition, or
required fields inferred from tests.
See [ADR 0036](docs/decisions/0036-formal-abstraction-rules.md).

```bash
pnpm pathcompiler reason reachable clients.created fixtures/next-demo --context role=editor
pnpm pathcompiler reason reachable clients.created --model model.json --context role=viewer --json
pnpm pathcompiler reason plan plans.structure_changed fixtures/next-demo --context role=editor
pnpm pathcompiler reason why-not clients.created fixtures/next-demo --context role=unlisted
pnpm pathcompiler reason diff <base> <head> [directory]
pnpm pathcompiler proposals generate <base> <head> [directory] --reasoning
pnpm pathcompiler reason verify fixtures/next-demo --property properties.json
pnpm pathcompiler evaluate <base> <candidate> [directory] --criteria criteria.json --tests results.json
```

`@pathcompiler/reasoner-core` (phase R2) answers "can goal G be reached under
context C?":
- `reachable`: a shortest witness trace, replayed and validated, where each step
  carries its semantic target, capability and evidence;
- `unreachable`: a k-induction proof;
- `unknown`: insufficient bound, timeout or solver unknown. It is never
  reported as unreachable.

The solver sits behind `@pathcompiler/solver-provider`, a neutral term
language with no Z3 types. The first backend is `@pathcompiler/solver-z3`
(Z3 WASM). The CLI writes `reports/reasoning/<goal>.json`. For an extracted
model, that report includes the model's coverage and uncertainties, because an
unreachable answer holds only within the model.
See [ADR 0037](docs/decisions/0037-solver-backend-and-reachability.md).

`findPlan` (phase R3) returns the shortest plan. Among equally short plans it
picks the one with the lexicographically smallest action sequence, so plans
stay stable across solver versions. Each plan reports its total cost and
whether it is the cheapest. `evaluatePlan` replays a plan and compares its major
steps with a reviewed workflow. `reason plan` writes
`reports/reasoning/plans/<goal>.json`, and compares the plan with the approved
`workflows/<capability>.yaml` when one exists.
See [ADR 0038](docs/decisions/0038-planning-semantics.md).

`explainUnreachable` (phase R4) answers "why not?" with a minimal set of
product constraints the unreachability proof needs: context values,
precondition conjuncts and initial facts. For example: "clients.create.submit
requires role = editor". Each constraint carries source evidence, such as
`symbol:lib/session.ts#requireEditor` and the API handler, never solver labels.
`reason why-not` writes `reports/reasoning/why-not/<goal>.json`.
See [ADR 0039](docs/decisions/0039-unsat-explanations.md).

`compareModels` and `@pathcompiler/semantic-change` (phase R11) diff the models
of two commits. Each goal is checked under every enumerable context, giving
reports such as:
- "clients.created is no longer reachable for role=editor:
  clients.create.submit requires role = owner (changed in lib/session.ts)";
- "clients.created is newly reachable for role=owner".

`reason diff` writes `reports/semantic-change.json`. With `--reasoning`,
`impact` and `proposals generate` add these findings as impact reasons, and
lost reachability is high severity. The GitHub App config's `"reasoning": true`
adds a "Product logic" section to the check. All of this is opt-in.
See [ADR 0040](docs/decisions/0040-semantic-change-reasoning.md).

`verifyProperty` (phase R8) checks safety properties by bounded model checking.
The kinds are:
- `never`: a goal or condition is never reached;
- `always`: a condition holds in every reachable state;
- `invariant`: a declared model invariant holds;
- `via`: every path to the goal passes through one of the given actions.

Each property comes back as holds (with a proof), violated (with a canonical
counterexample trace), or unknown. `reason verify` checks the model's
invariants plus `--property` files, writes
`reports/reasoning/verification.json`, and exits nonzero on a violation.
See [ADR 0041](docs/decisions/0041-property-verification.md).

`@pathcompiler/candidate-evaluator` (phase I3, mode 5: Evaluate) judges any
candidate commit independently of who made it. It checks four things:
- intended versus observed reachability changes;
- protected properties and invariants on both commits;
- approved-workflow impact;
- business-level test coverage, plus supplied test results.

The result is `pass`, `pass_with_warnings`, `fail` or `inconclusive`, with the
next step and whether the candidate is eligible for an experiment.
`pathcompiler evaluate` writes `reports/evaluation/<candidate>.json` and exits
nonzero on failure. A candidate's claimed outcome is recorded but never
trusted.
See [ADR 0042](docs/decisions/0042-candidate-evaluation.md).

## Observability event model (mode 3, foundation)

`@pathcompiler/observability-core` (phase O0) defines the privacy-first
semantic events that later observability phases build on:
- workflow started, step reached, completed and abandoned, bound to
  `workflowId` and `workflowVersion`;
- semantic target activated;
- goal reached;
- route changed;
- action blocked.

The schemas reject raw values, DOM, coordinates and query strings.
`validateEvent` enforces the privacy policy, which by default has analytics
off, no PII, hashed user IDs and no context keys. Events serialize canonically
as NDJSON, and `createEventFactory` binds project, session and release. The
core package has no transport; the SDK below adds one.
See [ADR 0044](docs/decisions/0044-semantic-event-model.md).

```ts
import { createAnalytics, ConsoleTransport } from '@pathcompiler/analytics-sdk';
const analytics = createAnalytics({
  projectId: 'next-demo',
  release: process.env.APP_RELEASE,
  policy: { enabled: true }, // off by default
  transport: new ConsoleTransport(),
});
analytics.workflowStarted({ workflowId: 'clients.create', workflowVersion: 1 }, 'guide');
analytics.goalReached('clients.created');
```

`@pathcompiler/analytics-sdk` (phase O1) is opt-in. It batches events, retries
failed sends within a bounded queue, and validates every event against the
privacy policy. A rejected event is reported through `onError`, never thrown.
Transports are in-memory (the default) or console; nothing touches the network.
See [ADR 0045](docs/decisions/0045-analytics-sdk.md).

With React, pass the instance to the existing provider:
`<PathCompilerProvider client={client} route={route} analytics={analytics}>`.
The provider then reports route changes and activations of
`data-pathcompiler` targets (click, committed input, select, submit), without
reading values, and `useAnalytics()` exposes the instance (phase O2).
See [ADR 0046](docs/decisions/0046-react-analytics-capture.md).
The provider also instruments its guide runtime (phase O3). Guides emit
`workflow.started`, `workflow.step_reached`, `workflow.completed` and
`workflow.abandoned` with workflow ID and version. Without React, call
`instrumentGuide(runtime, analytics)`.
See [ADR 0047](docs/decisions/0047-guide-lifecycle-telemetry.md).
Applications report business outcomes with `analytics.domainEvent('client.created')`
and `analytics.goalReached('clients.created')`. Domain events carry no payload.
Pass `goals` (Formal Product Model goal IDs) and `domainEvents` to reject
unknown names (phase O4).
See [ADR 0048](docs/decisions/0048-domain-events.md).

`pathcompiler serve --events` enables `POST /v1/events/batch` (phase O5).
Every event is validated against the privacy policy, and invalid events are
rejected individually. Events for other projects are refused. Batch size and
rate are limited, and accepted events are stored as NDJSON under
`<out>/events/<project>/<day>.ndjson`. `PATHCOMPILER_INGEST_TOKEN` sets an
optional token that can only post events. The SDK's
`new FetchTransport({ url, token })` sends to this endpoint. For an app on
another origin, add `--allow-origin https://app.example.com` (repeatable).
Exact origins only; `*` is refused, because requests carry tokens.
See [ADR 0049](docs/decisions/0049-event-ingestion.md).

`pathcompiler observe graph [--release <id>]` (phase O6) aggregates the
stored events into the observed transition graph, written to
`reports/observed-graph.json`. It records transition counts, sessions,
frequencies, median times, role and release segments and top session paths.
Edges taken by fewer than 30 sessions are flagged as not sufficient. The graph
is kept separate from the formal model: it shows what happened, not what is
possible.
See [ADR 0050](docs/decisions/0050-observed-transition-graph.md).

`pathcompiler observe workflows [--release <id>]` (phase O7) reconstructs
guide runs per workflow version. It reports starts, completions, abandonments,
unfinished runs, the completion rate (only with 30 or more runs), median and
p95 duration, actions per run, a step funnel, and role and release segments
(segments under 5 runs are suppressed). The report is written to
`reports/workflow-analytics.json`.
See [ADR 0051](docs/decisions/0051-workflow-analytics.md).

`pathcompiler observe reconcile [directory] [--model <json>]` (phase O8)
compares the formal model with the stored events for each observed role.
Goals and semantic targets are classified as possible and observed, possible
but unobserved (only with enough sessions), or observed although the model
says they cannot happen. The last class is a high-priority discrepancy, listed
with the model's reasons and candidate causes (authorization or business-rule
bug, extraction error, wrong role, event-mapping error), and never labeled a
bug. The report is written to `reports/reconciliation.json`.
See [ADR 0052](docs/decisions/0052-behavior-reconciliation.md).

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
| `@pathcompiler/workflow-validator` | `validateWorkflow`, `ValidationContext`, validation issue/check/report schemas and types, `diagnoseBrowserFailure` and `BrowserVerificationReportV2Schema` (P3); `./browser`: `verifyFixtureWorkflow`, `verifyWorkflowInBrowser`, `verifyCandidateWorkflows` (I4), `browserEvidenceItem` |
| `@pathcompiler/workflow-review` | `approveCandidate`, `rejectCandidate`, `reviewPaths`, approved/rejected/deprecated record schemas, YAML serialize/parse, `ReviewError` |
| `@pathcompiler/workflow-compiler` | `compileWorkflows`, `workflowRevision`, `describeCondition`, `exportArtifacts`, `renderWorkflowMarkdown`, `renderCatalogMarkdown`, `renderHelpPages`, `escapeMarkdown`, `COMPILER_VERSION`, search/runtime/documentation schemas and types; `./schema`: browser-safe schemas only |
| `@pathcompiler/resolver` | `createResolver`, `resolveProductHelp`, `normalizeTokens`, `evaluateResolver`, `relatedWorkflows`, `supportedActions`, request/result schemas and types |
| `@pathcompiler/sdk-js` | `PathCompiler`, `RuntimeTransport`, `createStaticTransport`, `createHttpTransport`, `PathCompilerError`, `WorkflowDetailsSchema` and types |
| `@pathcompiler/runtime-core` | `createGuideRuntime`, `createDomEnvironment`, `routeMatches`, `idleGuideState`, environment/state types |
| `@pathcompiler/react` | `PathCompilerProvider` (optional `analytics`), `useProductHelp`, `useWorkflow`, `useGuideRuntime`, `useWorkflowProgress`, `useAnalytics` |
| `@pathcompiler/ui` | `ProductHelpCard`, `WorkflowChecklist`, `GuideOverlay`, `WorkflowSearch`, `defaultLabels` |
| `@pathcompiler/mcp-server` | `createPathCompilerMcpServer`, `serveStdio`, `MCP_TOOL_NAMES` |
| `@pathcompiler/http-service` | `createHttpService`, `createRequestHandler`, `HttpServiceOptions`, `EventSink`, `InMemoryEventSink`, `createFileEventSink` (`POST /v1/events/batch`) |
| `@pathcompiler/graph-delta` | `computeGraphDelta`, `analyzeCommitRange`, `analyzeCommitRangeDetailed`, `GraphDeltaSchema`, `GraphNodeChangeSchema` and types |
| `@pathcompiler/impact-analysis` | `analyzeWorkflowImpact`, impact reason/impact/report schemas and types, `scoreCommitRisk`, `RISK_CLASS`, `CommitRiskReport` (P4) |
| `@pathcompiler/workflow-proposals` | `generateProposals`, `acceptProposal`, `acceptDeprecation`, `decideProposal`, `detectNewWorkflows`, `workflowDiff`, `proposalFileName`, proposal/detection schemas and YAML serialize/parse, `ProposalError` |
| `@pathcompiler/github-app` | `verifyWebhookSignature`, `parseWebhookEvent`, `createWebhookHandler`, `createJobQueue`, `createAppAuth`, `publishCheckRun`, `summarizeWorkflowCheck`, `createWorkflowCheckWorker`, `createLocalRepositoryProvider`, `githubAppManifest`, `APP_PERMISSIONS` |
| `@pathcompiler/assistant-tools` | `resolveProductHelp`, `parseToolInput`, `toolResultText`, `jsonSchemaTool`, `anthropicTool`, `openAITool`, `langChainTool`, `INPUT_SCHEMA`, `STRICT_INPUT_SCHEMA`, `ToolInputError` |
| `@pathcompiler/config` | `loadConfig`, `parseConfig`, `PathCompilerConfigSchema`, `featureFlags`, `reasoningEnabled`, `analyticsPolicy`, `defaultConfigYaml`, `ConfigError` |
| `@pathcompiler/formal-model` | `FormalProductModelSchema`, `parseFormalModel`, `normalizeFormalModel`, `serializeFormalModel`, `formalModelHash`, `collectFormalEvidence`, `f` constructors, variable/expression/action/goal schemas and types |
| `@pathcompiler/formal-abstraction` | `buildFormalModel`, `FORMAL_ABSTRACTION_VERSION`, `interpretCapabilities` (P1), `selectCapabilityInterpretations` (P2), `FormalAbstraction`, `ModelCoverage`, `AbstractionUncertainty` types |
| `@pathcompiler/solver-provider` | `SolverProvider` (assumptions, unsat cores, `optimize`), `SolverProblem`, `OptimizationProblem`, `OptimizationResult`, `SolverTerm`, `SolverCheckResult`, `SolverProblemSchema`, `parseSolverProblem`, `parseOptimizationProblem` |
| `@pathcompiler/solver-z3` | `createZ3SolverProvider` (only package importing Z3) |
| `@pathcompiler/reasoner-core` | `createProductReasoner`, `ProductReasoner.checkReachability`, `ProductReasoner.findPlan`, `ProductReasoner.explainUnreachable`, `ProductReasoner.compareModels`, `ProductReasoner.verifyProperty`, `ProductPropertySchema`, `PropertyResult`, `propertiesFromInvariants`, `ModelComparison`, `ReachabilityChange`, `ExplanationResult`, `UnreachableExplanation`, `ConstraintProvenance`, `describeFormalExpr`, `evaluatePlan`, `PlanResult`, `Plan`, `PlanEvaluation`, `ReachabilityResult`, `ReasoningTrace`, `sliceFormalModel`, `evaluateFormalExpr`, `applyFormalAction`, `formalExprVariables`, `ReasoningQueryError` |
| `@pathcompiler/semantic-change` | `analyzeSemanticChange`, `buildCommitModel`, `summarizeSemanticChange`, `collapseContexts`, `describeContext`, `SemanticChangeReport`, `SemanticWorkflowImpact` |
| `@pathcompiler/observability-core` | `ProductRuntimeEventSchema` (nine semantic event types, including `domain.event`), `RuntimeEventBaseSchema`, `PrivacyPolicySchema`, `DEFAULT_PRIVACY_POLICY`, `validateEvent`, `hashUserId`, `serializeEvent`, `parseEvents`, `createEventFactory`, `EventPolicyError` |
| `@pathcompiler/analytics-sdk` | `createAnalytics` (`track`, lifecycle helpers, `setContext`, `flush`, `shutdown`, `stats`), `instrumentGuide`, `FetchTransport`, `AnalyticsTransport`, `InMemoryTransport`, `ConsoleTransport` |
| `@pathcompiler/observed-graph` | `buildObservedGraph`, `computeWorkflowAnalytics`, `observedState`, `readEventDirectory`, `ObservedGraph`, `SESSION_START`, `SESSION_END`, `checkGoal`, `checkReachProperty`, `compareReach` (P5) |
| `@pathcompiler/behavior-reconciliation` | `reconcileBehavior`, `ReconciliationReport`, `ReconciliationItem`, `BehaviorDiscrepancy` |
| `@pathcompiler/model-provider` | `PathCompilerModelProvider`, `NoopModelProvider`, `FixtureModelProvider`, `fixtureKey`, `guardModelProvider`, `semanticModelFromProvider`, `redactSecrets`, `redactValue`, `describeModelRequest`, `ModelProviderError`, `createStructuredModelProvider`, `structuredTask`, `findAmbiguousClusters`, `interpretAmbiguities`, `SemanticHypothesis` |
| `@pathcompiler/model-provider-anthropic` | `createAnthropicModelProvider`, `DEFAULT_ANTHROPIC_MODEL` (Anthropic SDK; ADR 0071) |
| `@pathcompiler/findings` | `deriveFindings`, `ProductFinding`, `ImprovementOpportunity`, `PriorityAssessment`, `FindingEvidenceBundle` (I0) |
| `@pathcompiler/improvement-gate` | `gateFindings`, `GateDecision`, `ImprovementValueAssessment`, `ImprovementPolicy` (IG) |
| `@pathcompiler/recommendation-engine` | `recommend`, `ImprovementRecommendation`, `ImprovementHypothesis`, `AcceptanceCriteria`, `ProtectedBehavior` (I1) |
| `@pathcompiler/experiment-core` | `createExperimentSpec`, `parseExperimentSpec`, `criteriaHash`, `ExperimentSpecSchema` (I5) |
| `@pathcompiler/outcome-analysis` | `measureOutcome`, `OutcomeAssessment`, `MetricComparison`, `GuardrailAssessment` (I6); `decideAdoption`, `recordApproval`, `AdoptionDecision` (I7) |
| `@pathcompiler/improvement-memory` | `buildMemoryRecord`, `historyFactor`, `rankWithMemory`, `ImprovementMemoryRecordSchema` (I8) |
| `@pathcompiler/harness-contracts` | `HarnessTaskSpecSchema`, `MutationResultSchema`, `createHarnessTask`, `parseMutationResult`, `evaluationCriteria`, `runFixtureHarness`, `contractJsonSchemas` (I2) |
| `@pathcompiler/review-priority` | `prioritizeReviews`, `collectReviewFeedback`, `calibrationFromReviews`, `confidenceBand` (P-RV) |
| `@pathcompiler/model-provider-openai` | `createOpenAIModelProvider`, `createLocalModelProvider`, `createOpenAICompatibleModelProvider` (plain HTTP) |
| `@pathcompiler/probabilistic-evidence` | `fuseEvidence`, `interpretCandidates` (P1), `selectInterpretations`, `candidateWeight` (P2), `ConfidenceAssessment`, `EvidenceClaim`, `EvidenceItem`, `EvidenceConflict`, `RELIABILITY`, `calibrate`, `graphEvidenceItems` |
| `@pathcompiler/reasoning-service` | `createReasoningService`, `REASONING_OPERATIONS`, `ReasoningRequestError`, `createReasoningMcpServer`, `serveReasoningStdio`, `REASONING_MCP_TOOL_NAMES` |
| `@pathcompiler/diagnostics` | error taxonomy (`ConfigurationError` … `GitProviderError`), `errorKind`, `createJsonLogger`, `timed`, `PERFORMANCE_TARGETS_MS`, `contentKey`, `createFileCache` |
| `@pathcompiler/test-generator` | `generateTests`, `renderPositiveTest`, `renderNegativeTest`, `freshStateModel`, `TestSetupSchema`, `GENERATED_TEST_MARKER` |
| `@pathcompiler/trace-clustering` | `traceSignature`, `clusterTraces`, `TraceClustering`, `TraceVariant` |
| `@pathcompiler/reasoning-discovery` | `discoverWorkflowsByReasoning`, `ReasoningDiscoveryReport`, `ReasoningCandidate` |
| `@pathcompiler/evaluation` | `loadGroundTruth`, `analyzeFixture`, `evaluateCapabilityExtraction`, `evaluateWorkflowDiscovery` (`DiscoveryStrategy`, `baselineStrategy`, `reasoningStrategy`), `compareDiscoveryStrategies`, `evaluateResolverAccuracy`, `evaluateImpact`, `approveAllCandidates`, `loadReasoningCases`, `evaluateReasoningCases` |
| `@pathcompiler/candidate-evaluator` | `evaluateCandidate`, `CandidateEvaluation`, `EvaluationCriteriaSchema`, `ExpectedChangeSchema`, `TestRunSchema`, `testRunFromPlaywrightJson` |
| `@pathcompiler/cli` | `pathcompiler init`, `config show`, `scan` (`--explain-model-context`, `--no-cache`), `analyze`, `diagnose`, `findings`, `gate`, `recommend`, `experiment create/measure/decide/approve/decline`, `memory record/list`, `harness task/import`, `review queue/feedback`, `graph inspect`, `capabilities list`, `targets suggest`, `tests mine/generate`, `git inspect`, `github inspect`, `surfaces discover`, `capabilities discover`, `workflows discover/detect/validate/list/show/approve/reject`, `diff`, `impact`, `proposals generate/list/show/accept/reject/ignore`, `build`, `docs export`, `eval`, `evaluate`, `observe graph/workflows/transitions/reconcile/efficiency/drop-offs/release-diff`, `reason reachable/plan/why-not/enable/alternatives/optimize/dead-features/diff/verify`, `github-app manifest/serve`, `mcp`, `mcp-reasoning`, `serve`, `runCli` |

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
