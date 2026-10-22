# Phase status

## Phase 0 — Repository Foundation

Complete — verified locally on 2026-10-21.

- Preserved the existing Git repository and supplied product/specification documents.
  The initial repository had no implementation or runnable baseline checks.
- Created a pinned pnpm workspace, strict TypeScript configuration, Biome and Vitest.
- Implemented `@pathcompiler/workflow-ir`: versioned Zod schemas, inferred public
  types, evidence/provenance, conditions, branches and cross-step reference checks.
- Implemented `@pathcompiler/graph-core`: deterministic IDs, validated snapshots,
  stable serialization, type queries, directed neighbors, bounded traversal and
  added/removed/changed diffs. Reads do not expose mutable internal state.
- Implemented the Next.js App Router fixture with Create Client, Edit Client,
  Deactivate Client, Create Plan and Change Plan Structure. Includes modals,
  validation, API handlers, server-enforced demo roles/flags and a confirmation branch.
- Added GitHub Actions for locked installation, lint, typechecking, package tests,
  package builds and Chromium tests against a fresh production fixture build.
- Recorded contract and fixture-state decisions in `docs/decisions/`.

### Verification

All checks below passed with Node 22.23.3 and pnpm 10.34.7:

| Command | Result |
| --- | --- |
| `pnpm install` | Passed |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed for root tests, both core packages and fixture routes/tests |
| `pnpm test` | 34 tests passed across two suites |
| `pnpm --filter './packages/*' build` | Both ESM/declaration builds passed |
| `pnpm test:e2e` | Production fixture build passed; all six Chromium tests passed |

Browser coverage includes all five flows, invalid forms/API bodies, cancellation,
both structure branches, direct API permission/flag/confirmation enforcement,
reload persistence and independent browser sessions. CI is configured but has not
been run on GitHub from this session.

### Scope notes and limitations

- A single `vitest.config.ts` replaces the suggested legacy workspace filename;
  no separate test projects are needed yet. No Phase 0 acceptance scope was dropped.
- Zod is the schema source of truth. Optional JSON Schema export is deferred;
  cross-step references still require runtime refinements.
- The fixture intentionally simulates authorization and uses bounded cookie state.
  Its 3,500-byte limit and same-session concurrent-write limitation are documented
  in ADR 0002; it is not production storage or authentication.
- The machine's default shell has Node 20 and its unpinned pnpm launcher initially
  failed. Verification used an isolated Node 22/pnpm toolchain under
  `/tmp/pathcompiler-toolchain` via PATH, without changing global defaults. Use the
  Node 22 setup in `README.md` for normal development; no repository script depends
  on this temporary toolchain path.

## Phase 1 — Static Next.js Analyzer

Complete — verified locally on 2026-10-21.

- Added `source-model` for validated local ingestion, default/explicit exclusions,
  Git ignore rules, commit binding and scanned-subtree working-tree metadata.
- Added `adapter-nextjs` using the TypeScript compiler API. Extracts source files,
  functions, hooks, candidate React components, App Router pages/API endpoints,
  local imports/re-exports, rendering relationships, UI actions/handlers,
  navigation, API calls, role observations and feature flags.
- Supports root and `src/app`, route groups, parallel slots and normalized dynamic
  segments. Resolves relative imports, root aliases and direct source package entries.
- Supports a single URL/method-forwarding fetch wrapper, including the fixture's
  shared save helper, and explicit server-action declarations/calls.
- Added the built `pathcompiler scan` CLI and workspace `pnpm pathcompiler` command.
  Writes the required source graph and scan summary, with actionable error exits.
- Preserved source provenance, deterministic IDs and explicit heuristic confidence.
  No model access, target-code execution or Phase 2 semantic-target support added.
- Documented contracts, supported forms and limitations in ADR 0003 and README.
- Phase 0 was committed and pushed as `cca31b3`; phase delivery instructions in
  `AGENTS.md` now require a commit and push after every completed phase.

### Verification

All checks below passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 0 baseline lint/typecheck/tests | Passed; 34 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed, including all package builds and tests |
| `pnpm test` | 56 tests passed across five suites |
| `pnpm pathcompiler scan ./fixtures/next-demo` | 19 files, 98 nodes, 205 edges |
| Repeat scans and built-CLI artifact comparison | Byte-identical graph and summary |
| Formatting/comment/input-order regression | Identical graph and summary; empty graph diff |

Tests cover route discovery, components, alias/workspace imports, button/event and
handler extraction, Link/router navigation, API relationships, source isolation,
ignored files, Git binding, malformed input and CLI exit behavior. Regression cases
include anonymous default components, re-exported handlers, shadowed globals,
dynamic request options and shared fetch wrappers. The fixture UI was unchanged;
its six Phase 0 browser tests were not rerun during this phase. Hosted CI was not
inspected from this session.

### Scope notes and limitations

- All Phase 1 acceptance criteria are covered. The fixture reports one explicit
  diagnostic because inherited tsconfig aliases are not expanded; its actual local
  imports resolve without inherited aliases.
- Permission/flag observations are heuristic and must not enforce authorization.
  Conditional URL/method alternatives do not prove branch correlation.
- Intercepting routes, HOCs/classes, conditional package exports, inherited aliases
  and arbitrary request wrappers remain documented static-analysis limits.
- Git metadata reads identify the source snapshot; commit-history analysis remains
  Phase 4. Graph artifacts are build-time data, not approved runtime manifests.

## Phase 2 — Semantic Targets

Complete — verified locally on 2026-10-21.

- Added literal `data-pathcompiler` support to the Next.js adapter. Supported,
  unique annotations use stable `ui:<semantic-id>` identities while retaining
  file/structural-locator/commit provenance and existing graph relationships.
- Added ranked target evidence: explicit annotations, existing test IDs, static
  accessible role/name, or unresolved. Noninteractive observation anchors are
  represented alongside actions. No structural CSS selectors are generated.
- Added diagnostics for duplicate/invalid/dynamic annotations, possible spread
  overrides and custom components whose attribute forwarding is unverified.
- Added `pathcompiler targets suggest [directory]`, including readable and
  versioned JSON reports. Suggestions are deterministic, avoid existing IDs and
  do not modify source or write artifacts. `--exclude` is supported.
- Added 34 explicit fixture targets covering all five workflows, their inputs,
  confirmations, feedback, navigation, row scopes and shared dialog controls.
- Updated browser tests to drive workflows through semantic annotations and added
  a two-client/two-plan case proving actions resolve within the selected row.
- Documented the public API, CLI and confidence/scoping boundaries in README and
  ADR 0004. No new package or dependency was needed.
- Phase 1 was committed and pushed as `6160bd9` before Phase 2 began.

### Verification

All checks below passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 1 baseline lint/typecheck/tests | Passed immediately before phase work; 56 tests |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed, including package builds, root tests and fixture |
| `pnpm test` | 66 tests passed across six suites |
| `pnpm test:e2e` | Fresh production fixture build; seven Chromium tests passed |
| `pnpm pathcompiler scan ./fixtures/next-demo` | 19 files, 108 nodes, 215 edges |
| Built CLI `targets suggest ... --json` | 40 target records, 34 annotated, no annotation issues |
| Repeat target reports | Byte-identical output |
| CLI read-only regression | Source contents and directory entries unchanged |
| `git diff --check` | Passed |

Focused tests cover identity stability after file/owner/label/order changes,
handler/navigation edges, evidence precedence, accessible labels, ambiguity,
annotation conflicts, dynamic/spread/custom-component boundaries, deterministic
suggestion collisions and fixture anchor coverage. Existing role, feature-flag,
validation, cancellation and session-isolation browser coverage continues to pass.
Hosted CI was not inspected from this session.

### Scope notes and limitations

- All Phase 2 acceptance scope is implemented. The optional React wrapper and
  explicitly deferred `targets apply` command remain unimplemented as specified.
- Accessible evidence is a conservative static subset, not the full browser
  accessibility tree. Scores rank evidence and do not establish live DOM
  uniqueness, visibility or authorization. The six unannotated fixture records
  are unresolved custom-component props and demo error feedback.
- One declaration may render many instances. Browser guidance must scope repeated
  actions to a selected row; distinct source declarations cannot reuse an ID.
- Target reports are private build-time analysis, not runtime manifests. Runtime
  guidance, Playwright mining and workflow compilation remain future phases.
- The inherited-tsconfig diagnostic from Phase 1 remains; the fixture's actual
  local imports resolve. No new scan diagnostic is emitted by its annotations.

## Phase 3 — Playwright Test Mining

Complete — verified locally on 2026-10-21.

- Added `@pathcompiler/test-miner-playwright` with a source-only TypeScript parser
  and validated, versioned trace/action/assertion/target/provenance schemas.
- Extracts literal test declarations, import aliases, nested suite names/modes,
  beforeEach/afterEach phases, straight-line Playwright actions and assertions,
  simple locator aliases and bounded same-file helper calls with argument/default
  binding and call-site evidence.
- Preserves action/assertion ordering, initial route, locator scopes/hints,
  negative/soft assertions, API requests, terminal assertions and explicit gaps.
  Dynamic values are not guessed. Request bodies are not retained.
- Maps exact semantic targets, test IDs, static role/name or labels and local
  routes to source graph nodes. Ambiguous candidates remain unresolved as edges.
  Adds Test nodes and uniquely mapped `TESTED_BY` edges without mutating the input
  graph or generating approved workflows.
- Added `pathcompiler tests mine [directory]` with existing output/exclusion
  conventions. Writes a trace report and separate test-evidence graph, preserving
  source-scan artifacts. No test runner, config or target code is executed.
- The fixture yields seven traces, 121 actions (including explicit unsupported
  events), 70 assertions and 70 `TESTED_BY` edges. The create-client helper exposes
  the route, create/name/email/save target sequence and successful feedback
  assertion needed to reconstruct `clients.create` from test evidence.
- Added CLI/package regression coverage and documented contracts and limits in
  README and ADR 0005. No new external dependency versions were introduced.
- Phase 2 was committed and pushed as `f7b5737` before Phase 3 began.

### Verification

All checks below passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 2 baseline lint/typecheck/tests | Passed; 66 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed, including six package builds, root tests and fixture |
| `pnpm test` | 79 tests passed across seven suites |
| `pnpm pathcompiler tests mine ./fixtures/next-demo` | Seven traces; two fully extracted and five explicitly partial |
| Fixture trace acceptance | All seven have terminal assertions; UI traces have starting routes |
| Repeat reports/graphs and reversed source input | Deterministic output |
| Built CLI output/exclusion regression | Separate artifacts, valid JSON, exclusion and argument checks passed |
| `git diff --check` | Passed |

Tests also verify helpers/defaults/call-site provenance, source graph immutability,
aliased/shadowed imports, setup/teardown separation, skipped modes, direct API
shortcuts, negative assertions, recursion/control-flow limits, ambiguous/dynamic
locators, scoped semantic mappings, stale-value avoidance, absent terminal
assertions after later actions, malformed input and snapshot mismatch rejection.

The fixture application and its seven browser tests were unchanged; their Phase 2
browser results remain applicable and the tests were consumed as parser input in
this phase. Browser execution was not repeated. Hosted CI was not inspected.

### Scope notes and limitations

- All Phase 3 acceptance scope is implemented for the specified straightforward
  syntax. The added CLI is a small delivery extension for inspecting the evidence.
- Five fixture traces are deliberately partial because setup/data-processing calls,
  loops or try/finally exceed the supported subset. Their extracted events and
  gaps remain visible. The API-only test has a null browser start route.
- Imported/page-object helpers, custom test.extend fixtures, generated tests,
  concurrent calls and general JavaScript/control-flow interpretation are deferred.
  Config/project expansion is not executed; test-ID mapping assumes data-testid.
- Static target matches identify declarations, not live DOM uniqueness. Reports
  contain build-time provenance and literal test data and are not runtime manifests.
- Test traces are evidence only, with execution marked not-run. Negative cases,
  setup shortcuts and terminal assertions do not automatically become workflows
  or establish that the tests passed. Workflow compilation remains a later phase.

## Phase 4 — Git Intelligence

Complete — verified locally on 2026-10-21.

- Added `@pathcompiler/git-intelligence` with local Git methods for current commit,
  default branch, diffs, path history, blame and full commit messages. Structured
  schemas preserve SHAs, raw parent identities, UTC author dates, selected changed
  paths, binary markers and unified diff hunks.
- Implemented current-node-first enrichment: provenance files → bounded path
  history → relevant commit metadata/diffs → Commit nodes and `CHANGED_BY` edges.
  The source graph is unchanged. Confirmed file changes and heuristic associations
  to current components/actions are distinguished explicitly.
- Added `pathcompiler git inspect [directory] --node <node-id>`, with history
  limits, output and source exclusions. Writes separate Git evidence and history
  graph artifacts while preserving existing scan/test outputs.
- Supports nested scan directories, detached/unborn repositories, cached default
  branch evidence, shallow boundaries, literal special paths, binary/empty files,
  deletions, type changes, root diffs and first-parent merge comparisons.
- Queries are local, read-only and bounded by process time/output, commit counts,
  selected paths and blame ranges. External diff/text conversion/fsmonitor commands
  and lazy fetches are disabled. Source ingestion also disables fsmonitor so the
  complete CLI scan/history path preserves its no-target-code-execution contract.
- Documented public contracts, confidence, rename/merge/shallow behavior and
  snapshot limits in README and ADR 0006. No new external dependency versions.
- Phase 3 was committed and pushed as `b288e38` before Phase 4 began.

### Verification

All checks passed with Node 22.23.3, pnpm 10.34.7 and Git 2.55.0:

| Command / check | Result |
| --- | --- |
| Phase 3 baseline lint/typecheck/tests | Passed; 79 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 68 files |
| `pnpm typecheck` | Passed, including seven package builds, root tests and fixture |
| `pnpm test` | 89 tests passed across eight suites |
| `pnpm pathcompiler git inspect ./fixtures/next-demo --node ui:clients.create` | Two relevant local commits; scoped to `components/clients.tsx` |
| AddClientModal acceptance fixture | Changed commit linked to File, Component and UIAction nodes; unrelated files unlinked |
| Repeat graph/report and built-CLI artifacts | Deterministic output; original graph/source/artifacts preserved |
| `git diff --check` | Passed |

Focused tests cover metadata and author-date normalization, bounded history,
explicit revisions/date filters, blame ranges, unusual Unicode/newline/glob-like
paths, missing final newlines, binary/empty files, file limits, rename/delete/type
changes, merge parents, default branch fallback, detached/unborn/nonrepositories,
shallow missing parents, dirty/stale graph rejection, input validation and disabled
external diff/textconv/fsmonitor execution. Temporary repositories provide actual
Git history without changing this repository's history for tests.

The fixture application and its seven browser tests were unchanged. Browser
execution was not repeated; hosted CI was not inspected from this session.

### Scope notes and limitations

- All Phase 4 acceptance scope is implemented. The inspection CLI is a small
  delivery extension. The single source-model Git option is necessary to keep
  source ingestion read-only when used by that command.
- File associations do not prove historical symbol/action changes. Commit messages
  remain intent evidence. No model inference, workflow approval or runtime artifact
  generation was added.
- History uses exact paths and normal Git path simplification; it does not follow
  renames. Diffs represent renames as delete/add and compare commits to their first
  parent. Shallow missing parents produce null diffs and diagnostics. Native blame
  may follow whole-file renames; original line numbers are not historical locators.
- Default branches use cached origin metadata or explicitly labeled main/master
  conventions. No remote fetch occurs. Git must support `--no-lazy-fetch`.
- Process limits are 10 seconds/8 MiB; large queries fail actionably. Blame reads a
  bounded committed blob, not the working tree. Non-UTF-8 declared commit message
  encodings are rejected. Commit/dirty checks are not atomic filesystem snapshots.
- Evidence reports contain private patches/messages and stay build-time only.
  The existing inherited-tsconfig diagnostic remains. GitHub PR integration is
  delivered in Phase 5 below.

## Phase 5 — GitHub PR Adapter

Complete — verified locally on 2026-10-21.

- Added the specified `GitProvider` interface, validated PR record/report schemas
  and graph association API to `git-intelligence`. Source-file provenance is shared
  with the existing Git enrichment through one internal helper.
- Added `@pathcompiler/adapter-github`, using native fetch with token authentication
  and the pinned GitHub REST API version `2026-03-10`. No new external dependency
  versions were introduced.
- Captures title, nullable body, changed/previous rename paths, linked commits,
  actual merge SHA, base/head SHAs, state and update time. Temporary open-PR test
  merges are excluded. Commit lookup handles no match and ambiguity explicitly;
  provider lookup SHAs are kept separately to support rewritten/rebased commits.
- Retrieves all supported file/commit pages, checks counts and uniqueness, and
  rereads PR metadata to detect snapshot changes. Requests have time/output bounds,
  sanitized errors and explicit rate-limit/permission failures. Tokens stay out of
  records, logs and command-line arguments; redirects and automatic retries are disabled.
- Associates mock PR evidence with current File, Component and UIAction nodes and
  existing Commit nodes through `SUPPORTED_BY`. Source nodes and original graphs
  remain unchanged; PR bodies stay in a separate evidence report. Path associations
  are explicitly heuristic, and unmerged PRs remain proposed evidence.
- Added `pathcompiler github inspect [directory] --repo owner/name` with either
  `--pr number` or `--commit sha`, using `GITHUB_TOKEN`. Supports nested scopes,
  output directories and exclusions; preserves existing scan/history/test artifacts.
- Documented the provider contract, operation and limits in README and ADR 0007.
  Phase 4 was committed and pushed as `a9a6b17` before this phase began.

### Verification

All checks passed with Node 22.23.3, pnpm 10.34.7 and Git 2.55.0:

| Command / check | Result |
| --- | --- |
| Phase 4 baseline lint/typecheck/tests | Passed; 89 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 75 files |
| `pnpm typecheck` | Passed, including eight package builds, root tests and fixture |
| `pnpm test` | 108 tests passed across ten suites |
| Mock PR acceptance | Changed AddClientModal linked to File, Component and UIAction nodes; unrelated declarations unlinked |
| Provider pagination | 101-file/101-commit fixture read completely; unexpected continuation, duplicates and count drift rejected |
| Built CLI with mocked GitHub transport | Direct PR and commit lookup, nested scopes, exclusions and missing-token handling passed |
| Repeat artifacts and source preservation | Byte-identical output; source graph and checkout preserved |
| `git diff --check` | Passed |

Focused tests also cover nullable bodies, rename provenance, actual/test merge
distinction, provider-confirmed lookup SHAs, ambiguous/absent PRs, invalid inputs,
wrong repositories, changing PR metadata, response and API count limits, malformed
JSON/data, transport interruption, HTTP authentication/permission/not-found/rate
errors, credential-safe errors and refusal to follow response URLs.

Verification used injected API responses, a mock provider and temporary Git/Next.js
repositories. No live GitHub token or hosted API access was exercised. The fixture
application/browser tests were unchanged, so browser execution was not repeated.
Hosted CI was not inspected from this session.

### Scope notes and limitations

- All required Phase 5 acceptance scope is implemented. The CLI is a small delivery
  extension; optional comments are deferred. No GitHub App, webhooks or write API
  were added.
- GitHub.com is the initial host. PRs above 250 commits or 3,000 files fail
  explicitly. Each response is limited to 4 MiB with a ten-second fetch timeout;
  API metadata changes or inconsistent pages require a retry by the caller.
- The caller explicitly binds the local checkout to `owner/name`; graph snapshots
  do not yet encode provider identity. Metadata rereads and local commit/dirty
  checks reduce races but are not transactional snapshots.
- Path associations and PR prose do not prove changed symbols, current behavior
  or merge ancestry in the checkout. PR reports remain private build-time evidence.
- At Phase 5 delivery, six of the 31 numbered phases (0–30) were complete,
  leaving 25 (6–30). Phase 6 is delivered below.

## Phase 6 — Product Surface Graph

Complete — verified locally on 2026-10-22.

- Added `@pathcompiler/evidence` with validated, deterministic selected-node
  packets, bounded test/history/PR support, source snapshot checks and reused
  workflow evidence references. Preserves raw graph provenance and historical
  commits; unborn source never receives an invented commit reference.
- Added `@pathcompiler/capability-engine` with deterministic candidate page,
  panel, modal, form and action rules. Preserves anchors, source locations,
  routes, nearest container parents, evidence IDs, rule/title source and confidence.
  All surfaces remain heuristic candidates; no capabilities/workflows are approved.
- Extended the Next.js adapter with lexical JSX containment and unannotated native
  dialog extraction, which supply the missing structural evidence for nesting.
- Supports native/ARIA containers, component suffixes and interactive controls.
  Shared declarations retain multiple routes/parents. Custom callback props and
  observation anchors do not become actions. Unreachable candidates, unresolved
  labels/page renders and recursive containment have explicit diagnostics.
- Added the required optional `SemanticModel` interface and validated request/result
  contracts with citation checks. No provider implementation, model SDK, network
  invocation or automatic capability classification was added.
- Added `pathcompiler surfaces discover [directory]` with output/exclusion options
  and separate surface report/graph artifacts. Original source and scan artifacts
  are preserved. Documented the API, CLI and limits in README and ADR 0008.
- Phase 5 was committed and pushed as `faa2c37` before this phase began.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 5 baseline lint/typecheck/tests | Passed before edits; 108 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 85 files |
| `pnpm typecheck` | Passed, including ten package builds, root tests and fixture |
| `pnpm test` | 120 tests passed across twelve suites |
| Built CLI fixture discovery | 24 candidates: three pages, one modal, three forms and 17 actions |
| Fixture enriched graph | 132 nodes, 382 edges; all five primary action anchors present |
| Input reorder / repeat artifacts | Identical graph/report bytes; source graph and files unchanged |
| `git diff --check` | Passed |

Focused tests cover native/ARIA and named containers, nested controls, shared
modals, callback/custom-component boundaries, navigation isolation, recursion,
stable semantic IDs after label/file changes, stale/unknown evidence, unborn
snapshots, historical commit/PR references, model output validation and CLI
arguments/exclusions. Panel rules are tested synthetically because the fixture
has no separately annotated or named panel. No browser UI changed, so the existing
seven Chromium tests were not rerun. Hosted CI was not inspected from this session.

### Scope notes and limitations

- All required Phase 6 scope is implemented. The CLI is a small delivery extension;
  the source containment/dialog additions are necessary analyzer support for this
  phase. Phase 7 business capability discovery remains unimplemented.
- Containment is static and declaration-based. It does not project custom children,
  resolve portals, visibility, state transitions or modal opener relationships.
  Shared dialog children can stay under their source page. Candidate confidence
  is rule strength, not verified runtime behavior.
- Implicit Next layout rendering is still unresolved: the fixture's five layout
  controls are omitted with diagnostics. Its redirect-only root route remains a
  page candidate with an unresolved-render diagnostic. The inherited-tsconfig
  diagnostic remains from Phase 1.
- CLI discovery uses a fresh source graph. Library callers may pass graphs already
  enriched with tests/history/PRs. Evidence follows two explicit support hops;
  graph packets remain private build-time artifacts, not browser manifests.
- At Phase 6 delivery, seven phases were complete (0–6), leaving 24 (7–30).
  Phase 7 is delivered below.

## Phase 7 — Capability Discovery

Complete — verified locally on 2026-10-22.

- Extended `capability-engine` with deterministic business capability discovery,
  validated schemas and explicit evaluation. Semantic targets, accessible action
  names and named components generate stable `domain.verb[_qualifier]` IDs.
  Duplicate keys merge surfaces, rule citations and evidence without score inflation.
- Candidates retain domain, verb, entity, qualifier, routes, surfaces, source
  locations, repository commit and linked test/history/PR evidence. Added Capability
  nodes, surface `IMPLEMENTS` links and provenance `SUPPORTED_BY` links to cloned
  graphs. Existing source/surface/test records are preserved.
- API associations distinguish handler reachability from owning-component context.
  Conventional context methods exclude create endpoints from state-change evidence.
  Roles remain observed comparisons with permission evidence, explicitly not an
  authorization policy. No unknown roles are invented.
- Confidence explicitly measures rule strength rather than probability. Duplicate
  evidence, assertions, skipped tests and contextual APIs do not inflate scores.
  Every candidate requires review; low scores and unresolved evidence are flagged.
- Added `capabilities discover [directory]` with output/exclusion options and an
  explicit evaluation-only `--expect` file. It scans source and mines Playwright
  evidence without executing code/tests or invoking models. Reports and graphs
  use separate artifacts, preserving prior scan/surface/test outputs.
- Added the fixture's five expected IDs and exact-ID evaluation with matched,
  unexpected and missing lists. Missing ground truth reports null error counts,
  not a fabricated zero. Tests prove expectations never influence discovery.
- Documented identity, merging, scoring, evidence limits and evaluation in README
  and ADR 0009. Phase 6 was committed and pushed as `ccc93cc` before this phase.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 6 baseline lint/typecheck/tests | Passed before edits; 120 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 90 files |
| `pnpm typecheck` | Passed, including ten package builds, root tests and fixture |
| `pnpm test` | 129 tests passed across thirteen suites |
| Built CLI fixture evaluation | All five expected capabilities; 0 false positives, 0 false negatives |
| Alternative expectations regression | 4 false positives and 1 false negative; identical inferred graph |
| No ground truth / excluded tests | Explicit not-evaluated status; source-only discovery still finds five candidates |
| Repeat artifacts / reordered inputs | Byte-identical results; original source/surface artifacts preserved |
| `git diff --check` | Passed |

The fixture discovers `clients.create`, `clients.edit`, `clients.deactivate`,
`plans.create` and `plans.change_structure`. Each retains source locations,
mapped test evidence, an observed editor role and a matching API context record.
Its score of 0.9 reflects a semantic target plus a mapped test-body UI action,
not an executed workflow or verified authorization.

Focused tests cover annotation/name/component merging, verb aliases, identity
after label/file changes, conflicting labels, low-confidence review, unrelated
controls/APIs/prose, skipped/assertion-only tests, historical provenance, malformed
reports/evaluation counts and CLI arguments/exclusions. The fixture application UI
did not change; browser execution was not repeated. Hosted CI was not inspected.

### Scope notes and limitations

- All required Phase 7 scope is implemented. The CLI and explicit expectation file
  are delivery extensions. The surface implementation moved behind the unchanged
  public API to avoid a circular import; no unrelated refactoring was performed.
- Naming uses a finite verb vocabulary and conservative regular English rules.
  Arbitrary synonyms, irregular nouns, localization and differing semantic domains
  are not automatically reconciled. Explicit IDs survive source/label changes;
  inferred IDs can change when inferred meaning changes.
- Static surface limitations remain. Role comparisons can occur in denial branches,
  and component-context APIs do not prove which action or form branch invokes them.
  Static test evidence does not establish passing execution. All candidates remain
  subject to review and private build-time artifacts.
- Error counts are measured against the supplied reference list. The fixture's
  zero-error result is not a general accuracy guarantee.
- Eight phases are complete (0–7), leaving 23 (8–30). Phase 8 — Workflow Candidate
  Discovery is next and has not started.
