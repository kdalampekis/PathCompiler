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
- At Phase 7 delivery, eight phases were complete (0–7), leaving 23 (8–30).
  Phase 8 is delivered below.

## Phase 8 — Workflow Candidate Discovery

Complete — verified locally on 2026-10-22.

- Added `workflow-discovery` with deterministic test-backed candidate extraction,
  validated envelopes/reports and bounded YAML parsing/serialization. Each candidate
  retains commit, source/test evidence, confidence, ambiguities, observations and
  separate validation statuses. Only schema validation runs during discovery.
- Extracted capability action segments using resolved semantic targets, ordered
  click/fill/select actions, route context and positive completion assertions.
  Failed form probes require an asserted error, input correction and retry before
  exclusion. Cancellation, unsupported/scoped/conditional/cross-page operations
  stop extraction. Identical paths merge evidence; distinct paths stay separate.
- Extended Workflow V1 with text/count conditions to preserve observed assertions.
  Test values do not become runtime defaults, observed roles do not become policy,
  and static target annotations do not imply approval. No model/browser runs.
- Added `workflows discover` and required candidate YAML artifacts, a discovery
  report and enriched graph. Preflight refuses approved/malformed destination files
  before replacing any artifacts. Existing unrelated artifacts remain preserved.
- Documented decisions and supported limits in README and ADR 0010. Phase 7 was
  committed and pushed as `f8e5282` before this phase began.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 7 baseline lint/typecheck/tests | Passed before edits; 129 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 95 files |
| `pnpm typecheck` | Passed, including eleven package builds, root tests and fixture |
| `pnpm test` | 142 tests passed across fourteen suites |
| Built CLI fixture discovery | Three structurally valid candidate workflows |
| Candidate YAML round trip / repeat artifacts / reordered input | Passed; deterministic output |
| Approved artifact preflight | Refused replacement without changing any candidate/report |
| `git diff --check` | Passed |

Fixture major steps are verified for Create Client, Create Plan and Change Plan
Structure. Tests also cover negative/soft/conditional/skipped/scoped evidence,
unsupported actions, alternative paths, merged observations, source immutability,
stale snapshots, malformed YAML, aliases, limits and CLI exclusions/arguments.
The fixture UI did not change; browser execution remains Phase 10. Hosted CI was
not inspected from this session.

### Scope notes and limitations

- All Phase 8 acceptance criteria are implemented. The CLI is a delivery extension;
  additive IR text/count conditions are necessary to preserve real assertions.
- Edit/deactivate completion targets are unresolved and explicitly skipped. Change
  Plan Structure currently uses the simple-to-weekly path and a weak container
  disappearance terminal; confirmation/back paths are not flattened into it.
- Approval priority becomes applicable with the later registry. API/history/PR
  evidence supports provenance, not inferred missing UI order. Navigation and state
  transitions are limited to preceding routes and supported assertion conditions.
- Runtime input/row bindings, prerequisites, branches and arbitrary locator chains
  require later work/review. Confidence is rule strength, not execution success.
  Old candidate files are not pruned; the current report lists current candidates.
- Nine phases are complete (0–8), leaving 22 (9–30). Continue automatically through
  the next phases, committing and pushing each completed phase as authorized.

## Phase 9 — Workflow Validation

Complete — verified locally on 2026-10-22.

- Added `workflow-validator` with a pure public API and versioned structured reports.
  Schema, structure, repository, evidence, test comparison and browser checks each
  report passed/failed/not-run. Invalid schema never implies later checks ran.
- Checked explicit transitions, first-step reachability, unreachable steps, missing
  action targets, shadowed branch guards, terminal graph reachability and cycles.
  Cycles fail because the IR has no iteration bound. Runtime predicate truth remains
  outside static validation.
- Checked current route/target declarations, source provenance and commit binding.
  Evidence citations must match graph identity/type/location/commit; historical
  references preserve their own commits. Weak/external/low-confidence support and
  dirty snapshots remain explicit warnings.
- Compared supported linear workflows with cited active Playwright traces. Actions,
  expected assertions and terminal completion must share one continuous segment.
  Only demonstrated failed form probes can be excluded; repetitions cannot be
  stitched together. Branch/unsupported comparisons are explicitly partial/not-run.
- Added `workflows validate <id> [directory]`, fresh rescanning, JSON reports and
  nonzero failure exits. It preserves candidate YAML and ignores cached validation
  labels. Browser verification remains not-run as specified.
- Documented semantics and limits in README and ADR 0011. Phase 8 was committed and
  pushed as `b410d2e` before this phase began.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 8 baseline lint/typecheck/tests | Passed before edits; 142 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 100 files |
| `pnpm typecheck` | Passed, including twelve package builds, root tests and fixture |
| `pnpm test` | 153 tests passed across fifteen suites |
| All three discovered fixture workflows | Static checks and trace comparison passed |
| Built CLI validation of `clients.create` | Valid report; five explicit trace/probe warnings |
| CLI stale target regression | Failed with step/target issue, wrote report, preserved YAML |
| Repeat validation / input immutability / `git diff --check` | Passed |

Focused regressions cover invalid schema/references, missing evidence, stale
snapshots, ambiguous targets, missing routes/condition targets, cycles, unreachable
steps, shadowed guards, weak citations, missing/skipped/soft test evidence and
action/order/completion contradictions. A reordered workflow regression detected
and fixed false subsequence matches across repeated operations. No fixture UI
changed; browser verification starts in Phase 10. Hosted CI was not inspected.

### Scope notes and limitations

- All Phase 9 scope is implemented. The CLI is a small delivery extension.
- Routes require canonical graph paths/templates. State-only entrypoints, arbitrary
  dynamic URLs, branch guard truth, wait/explain actions and unsupported assertions
  are not silently simulated. Static reachability is not observed completion.
- Reports distinguish errors from review warnings. `valid` does not imply approval,
  passing browser execution, authorization or verified prerequisites/input bindings.
  The structure-change workflow retains a weak terminal warning.
- Ten phases are complete (0–9), leaving 21 (10–30). Phase 10 continues automatically.

## Phase 10 — Browser Verification

Complete — verified locally on 2026-10-22.

- Added `@pathcompiler/workflow-validator/browser` with `verifyFixtureWorkflow`, a
  Playwright runner limited to the fixture's four-step `clients.create` path.
  Playwright is an optional peer dependency; the static validator entry is unchanged.
- Inputs are the candidate workflow, a loopback fixture origin, a caller-owned `Page`
  carrying the test user/session and explicit name/email values. Values are never
  read from evidence or written to reports.
- Preflight rejects remote origins, invalid options, unsupported workflow IDs,
  changed targets/actions/order, branches, optional steps, preconditions and
  unsupported conditions before navigation.
- The runner opens `/clients`, resolves each semantic target to exactly one rendered
  element, performs only allowed click/fill actions, checks expected transitions and
  the terminal assertion, and aborts if the browser leaves the fixture route.
- Output is a versioned, schema-validated browser evidence report with per-step
  action/expectation status, terminal status and one structured failure.
- Added `test:browser` to the validator, chained it into `pnpm test:e2e` and CI
  artifact upload. Documented in README and ADR 0012.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 9 baseline lint/typecheck/tests | Passed before completion; 153 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 103 files |
| `pnpm typecheck` | Passed, including browser tests and Playwright config |
| `pnpm test` | 153 tests passed across fifteen suites |
| `pnpm test:e2e` | 7 fixture Chromium tests and 6 verification tests passed |
| `git diff --check` | Passed |

Browser coverage: automatically discovered and statically valid `clients.create`
passes end to end and persists across reload; evidence omits input values. A
removed target fails at `resolve` with `target-not-found` and a stale-annotation
hint; duplicated targets fail as `ambiguous-target` before clicking; a viewer
session stops before the hidden create control; failed expected transitions and
terminal assertions are reported separately; remote URLs, stale plans and missing
bindings are refused without opening the app.

### Scope notes and limitations

- All Phase 10 scope is implemented. The runner intentionally supports only
  `clients.create`; other workflows report unsupported rather than passing.
- `validateWorkflow` still reports browser verification as `not-run`; browser
  evidence is a separate report the caller attaches. Merging the two is left to the
  review/compiler phases if needed.
- The Codex session ended mid-phase; this phase was finished in Claude Code. The
  viewer-session test expectation was corrected (`resolve`, not `action`) because
  the fixture does not render the create control for viewers.
- Eleven phases are complete (0–10), leaving 20 (11–30).

## Phase 11 — Human Review Model

Complete — verified locally on 2026-10-22.

- Added `@pathcompiler/workflow-review`: pure `approveCandidate`/`rejectCandidate`,
  approved/rejected record schemas, strict YAML serialize/parse, `reviewPaths` and a
  typed `ReviewError`. File access stays in the CLI.
- Approved records live at `.pathcompiler/workflows/<id>.yaml` and record
  `approvedBy`, `approvedAt` and `approvedCommit` (equal to the workflow's
  repository commit). Rejections live at `workflows/rejected/<id>.yaml` with
  reviewer, time, candidate commit and optional reason.
- Added `workflows list`, `show`, `approve` and `reject`. `list`/`show` support
  `--json`. Approval rescans, re-runs static validation, writes the report and
  refuses mismatched reports, stale candidates, failed validation and dirty or
  unknown source state. The reviewer comes from `--by` or `PATHCOMPILER_USER`.
- Decisions are created atomically and never replaced; re-approving or rejecting
  a reviewed ID fails, and rediscovery leaves approved files byte-identical.
  Candidates remain as discovery cache.
- `workflows validate` now shares the candidate-loading/validation helper and
  gives an actionable error when the candidate file is missing.
- Documented in README and ADR 0013.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 10 baseline lint/typecheck/tests | Passed before edits; 153 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 107 files |
| `pnpm typecheck` | Passed, thirteen package builds, root tests and fixture |
| `pnpm test` | 159 tests passed across sixteen suites |
| `pnpm test:e2e` | 7 fixture and 6 verification Chromium tests passed |
| Manual built-CLI discover → approve → reject → list → show | Passed |
| `git diff --check` | Passed |

Focused regressions cover reviewer validation, missing reviewer, failed/mismatched/
stale/dirty approvals, non-candidate input, commit-binding refinements, YAML aliases
and extra keys, unsafe IDs, repeated decisions, rediscovery after approval, list
precedence and JSON/text show output.

### Scope notes and limitations

- All Phase 11 scope is implemented. No visual editor was built, as specified.
- `approvedBy` is a configured string, not authentication. Editing, merging and
  internal-only marking from the architecture's reviewer actions are not built.
- Changing or withdrawing an approved workflow is unsupported until proposals
  (Phase 21) and deprecation (Phase 23). Rejections are undone by deleting the record.
- Twelve phases are complete (0–11), leaving 19 (12–30).

## Phase 12 — Workflow Compiler

Complete — verified locally on 2026-10-22.

- Added `@pathcompiler/workflow-compiler` with pure `compileWorkflows`, producing
  versioned search index, runtime manifest and documentation documents from
  schema-valid approved records only.
- Output is sorted by ID, has no timestamps, rejects duplicates and carries
  `COMPILER_VERSION` plus a per-workflow `revision` (SHA-256 of canonical approved
  workflow content, excluding reviewer metadata).
- Search records follow the spec shape and add qualifiers, domain and
  permission/feature-flag requirements from preconditions for the resolver.
- The runtime manifest (and search index) omit evidence, provenance, confidence,
  commits, file paths and reviewer data. Documentation renders steps, conditions,
  prerequisites and completion as deterministic text and keeps the bound commit.
- Added `pathcompiler build`, writing `generated/search-index.json`,
  `generated/runtime-manifest.json` and `generated/documentation.json`.
- Documented in README and ADR 0014.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 11 baseline lint/typecheck/tests | Passed before edits; 159 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 111 files |
| `pnpm typecheck` | Passed, fourteen package builds, root tests and fixture |
| `pnpm test` | 165 tests passed across seventeen suites |
| `pnpm test:e2e` | 7 fixture and 6 verification Chromium tests passed |
| `git diff --check` | Passed |

Focused regressions cover all three fixture workflows, schema round-trips, leak
checks (commit, reviewer, evidence, confidence, test/component paths), input-order
independence, reviewer-independent and content-sensitive revisions, unapproved and
duplicate input, preconditions, branches, byte-identical CLI rebuilds, candidate/
rejected exclusion and invalid approved files.

### Scope notes and limitations

- All Phase 12 scope is implemented.
- `aliases` are empty; deterministic or model-generated aliases are not built.
- Revisions are content hashes, not the architecture's incrementing `@N`
  versions; a registry with history would be needed for those.
- `build` does not detect approved workflows that drifted from the current code;
  that belongs to impact analysis (Phase 20).
- Thirteen phases are complete (0–12), leaving 18 (13–30).

## Phase 13 — Runtime Resolver

Complete — verified locally on 2026-10-22.

- Added `@pathcompiler/resolver`: `createResolver(searchIndex)` validates the
  compiled index once and exposes deterministic `resolveProductHelp({query,
  context})`. No graph traversal, network or model access.
- Retrieval: lexical normalization, alias sequence matching, entity requirement,
  generic action-verb groups with action compatibility, qualifier scoring and a
  route tie-breaker. Results are `workflow`, `ambiguous` or `unsupported`, with
  schemas exported for the SDK.
- Role, permission and feature-flag filters apply only when the caller supplies
  that context. Fully excluded matches return `unavailable-in-context` with the
  unmet requirements.
- Added `evaluateResolver` and `eval/fixture-paraphrases.json` (20 paraphrases,
  5 controls, 80% target), saved before the matcher was written.
- Documented in README and ADR 0015.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 12 baseline lint/typecheck/tests | Passed before edits; 165 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 117 files |
| `pnpm typecheck` | Passed, fifteen package builds, root tests and fixture |
| `pnpm test` | 170 tests passed across eighteen suites |
| Paraphrase evaluation on compiled fixture workflows | 17/20 (85%) ≥ 80% target; 5/5 controls |
| `git diff --check` | Passed |

Manual review of the evaluation: the three misses were predicted before the first
run. "onboard a new customer" (no entity synonym) is unsupported. "restructure a
plan" and "rearrange how my plan is organized" (verbs outside the generic lexicon)
are ambiguous between the two plan workflows. No paraphrase returned a wrong
workflow. Synthetic tests separately cover verbs, action mismatch, aliases,
entity-only confirmation, context exclusions, route tie-breaks, normalization and
boundary validation. Browser suites were not rerun because no runtime or fixture
code changed.

### Scope notes and limitations

- All Phase 13 scope is implemented except the optional embedding adapter, which
  was not built.
- English only. Recall for product-specific phrasing depends on approved aliases,
  which are currently always empty.
- Fourteen phases are complete (0–13), leaving 17 (14–30).

## Phase 14 — Headless JS SDK

Complete — verified locally on 2026-10-22.

- Added `@pathcompiler/sdk-js` with `new PathCompiler({project, transport})`,
  `resolve`, `workflows.get`, `workflows.search` and `workflows.getRuntimeManifest`.
- `RuntimeTransport` matches the spec (`resolve`, `getWorkflow`,
  `getRuntimeManifest`). The client validates requests and every response, and
  throws a typed `PathCompilerError`. Transport failures propagate unchanged.
- Implemented the offline `createStaticTransport` over the three `pathcompiler build`
  outputs. It rejects incomplete or cross-build artifacts, returns copies and
  strips commits from workflow details. `search` derives from `resolve`.
- Split compiled-artifact schemas into the browser-safe
  `@pathcompiler/workflow-compiler/schema` entry and moved the resolver onto it,
  so the SDK module graph contains no Node.js built-ins (verified by test).
- Documented in README and ADR 0016.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 13 baseline lint/typecheck/tests | Passed before edits; 170 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 122 files |
| `pnpm typecheck` | Passed, sixteen package builds, root tests and fixture |
| `pnpm test` | 175 tests passed across nineteen suites |
| `git diff --check` | Passed |

Tests cover resolution/search/details/manifests on the compiled fixture, copy
isolation, unknown IDs, invalid requests and options, invalid transport responses,
propagated transport errors, incomplete and mismatched artifacts, and a built
module-graph walk with no Node built-ins. Browser suites were not rerun because no
runtime or fixture code changed.

### Scope notes and limitations

- All Phase 14 scope is implemented. The HTTP transport is deferred to Phase 18,
  as the spec says ("HTTP transport later").
- The SDK has not yet been loaded in a real browser bundle; the runtime phases will
  exercise it there.
- Fifteen phases are complete (0–14), leaving 16 (15–30).

## Phase 15 — React Runtime

Complete — verified locally on 2026-10-22.

- Added `@pathcompiler/runtime-core`: framework-independent `createGuideRuntime`
  over a `GuideEnvironment` interface, plus `createDomEnvironment` for
  `data-pathcompiler` targets (MutationObserver, capture-phase click/input/change,
  popstate). The runtime observes only and never acts for the user.
- The runtime is stateful (explicit statuses), route-aware (entry-route waiting,
  route templates, navigate steps, SPA route refresh) and page-to-page. It supports
  explicit stop, pause/resume (observation and timers suspended), step timeouts, and
  a `target-missing` fallback for zero or repeated matches that keeps instructions
  available and recovers when the target resolves.
- Steps advance on the user's interaction, on expected conditions (never from an
  already-true expectation without interaction), or on `next()` for
  explain/wait/explicit_next. Branches, app events and permission/flag context are
  supported. Unmet preconditions fail at start.
- Added `@pathcompiler/react`: `PathCompilerProvider`, `useProductHelp`,
  `useWorkflow`, `useGuideRuntime`, `useWorkflowProgress`. It is SSR-safe (runtime
  created after mount) and React is an adapter only.
- Added happy-dom (20.14.5) for DOM/React unit tests, plus a runtime browser suite
  that bundles the runtime with Vite and guides the compiled `clients.create` in the
  production fixture build. Chained into `pnpm test:e2e` and CI artifacts.
- Documented in README and ADR 0017.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 14 baseline lint/typecheck/tests | Passed before edits; 175 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 136 files |
| `pnpm typecheck` | Passed, eighteen package builds, root tests and fixture |
| `pnpm test` | 191 tests passed across twenty-three suites |
| `pnpm test:e2e` | 7 fixture, 6 verification and 3 runtime Chromium tests passed |
| `git diff --check` | Passed |

Real-browser coverage: the compiled `clients.create` guide completes on the
fixture with real user input and persisted client, waits for `/clients` and resumes
after client-side navigation, and falls back to `target-missing` for viewers before
an explicit stop. Unit coverage includes waiting routes, ordered advancement,
already-true expectations, missing/ambiguous recovery, pause/resume timers,
timeouts, stop, branches, navigation, explanations, events, preconditions, invalid
manifests, route templates, DOM snapshots/interaction capture/unsubscribe, React
hooks, provider requirement and server rendering.

### Scope notes and limitations

- All Phase 15 scope is implemented. The runtime never executes actions for users.
- Repeated row targets report `many` until scoped targets are designed. Visibility
  is style-based, not layout-based. No UI rendering (Phase 16).
- Sixteen phases are complete (0–15), leaving 15 (16–30).

## Phase 16 — Optional UI Components

Complete — verified locally on 2026-10-22.

- Added `@pathcompiler/ui` with `ProductHelpCard`, `WorkflowChecklist`,
  `GuideOverlay` and `WorkflowSearch`, built only from public `@pathcompiler/react`
  hooks (replaceable). React is a peer dependency. No SDK/runtime/adapter package
  depends on `ui` (enforced by test).
- Accessible: labelled sections and headings, ordered checklist with
  `aria-current="step"` and textual done/current state, labelled `<search>` form
  that resolves on submit, polite live regions, non-modal guide panel with
  Pause/Resume/Stop/Next, decorative `aria-hidden` highlight and a text fallback for
  missing targets.
- Themeable through class names, `className` and `--pc-*` CSS custom properties.
  All text is overridable through `labels`. Only the overlay sets positioning styles.
- `@pathcompiler/react` now re-exports `GuideState`, `GuideStatus`,
  `ProductHelpResult`, `ResolveContext` and `WorkflowDetails` types. The root test
  tsconfig enables `react-jsx` so tests can import TSX sources.
- Documented in README and ADR 0018.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 15 baseline lint/typecheck/tests | Passed before edits; 191 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 140 files |
| `pnpm typecheck` | Passed, nineteen package builds, root tests and fixture |
| `pnpm test` | 196 tests passed across twenty-four suites |
| `git diff --check` | Passed |

Tests (happy-dom with React 19) cover workflow/ambiguous/unsupported cards, guide
start from a card, checklist progress states, overlay step count, pause/resume,
custom labels, stop and dismiss, missing-target fallback and recovery, completion,
submit-only search with an associated label and announced results, and the
dependency boundary. Browser suites were not rerun because no runtime or fixture
behavior changed.

### Scope notes and limitations

- All Phase 16 scope is implemented.
- No automated axe audit and no real-browser visual check of overlay positioning.
- Seventeen phases are complete (0–16), leaving 14 (17–30).

## Phase 17 — MCP Server

Complete — verified locally on 2026-10-22.

- Added `@pathcompiler/mcp-server` (official `@modelcontextprotocol/sdk` 1.32.1)
  with read-only tools `pathcompiler.resolve_help`, `search_workflows`,
  `get_workflow`, `get_related_workflows` and `get_supported_actions`. Each tool
  makes one SDK call and returns its result unchanged, as structured content and
  JSON text. SDK errors become readable tool errors.
- Catalog logic lives in core `@pathcompiler/resolver` (`relatedWorkflows`,
  `supportedActions`, with `execute` always false) and is exposed by the SDK as
  `workflows.related` and `workflows.getSupportedActions`.
- Deviation: `RuntimeTransport` gains `getRelatedWorkflows(id)`, since the specified
  three methods cannot enumerate workflows (ADR 0019).
- Added `pathcompiler mcp`, serving stdio from `generated/*.json` through the
  static transport. Only MCP traffic goes to stdout.
- Raised the Vitest per-test timeout to 30 s. The first full run had four 5 s
  timeouts in untouched fixture-analysis suites at load average 24. With the
  machine idle, all tests passed before and after the change.
- Documented in README and ADR 0019.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 16 baseline lint/typecheck/tests | Passed before edits; 196 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 145 files |
| `pnpm typecheck` | Passed, twenty package builds, root tests and fixture |
| `pnpm test` | 203 tests passed across twenty-five suites |
| `git diff --check` | Passed |

Tests cover tool listing and annotations, equality of every tool's output with
direct SDK calls over a real MCP client/server link, not-found/oversized/extra-key
errors, related-workflow ranking and limits, supported actions for static and
templated routes and untargeted steps, SDK related/supported-action validation, and
the built CLI spawned as a stdio MCP server answering `resolve_help`. Browser suites
were not rerun because no runtime or fixture code changed.

### Scope notes and limitations

- All Phase 17 required tools are implemented. The optional admin tools
  (`get_impacted_workflows`, `get_change_evidence`) wait for Phase 20 services.
- Stdio only. No HTTP/SSE MCP transport yet.
- Eighteen phases are complete (0–17), leaving 13 (18–30).

## Phase 18 — HTTP Service

Complete — verified locally on 2026-10-22.

- Added `@pathcompiler/http-service` (Node `http`, no framework) with
  `POST /v1/help/resolve`, `POST /v1/workflows/search`, `GET /v1/workflows/:id`,
  `GET /v1/workflows/:id/runtime` and `GET /v1/workflows/:id/related`. Each endpoint
  is one SDK call, so behavior mirrors the SDK.
- Simple bearer API token (16+ characters, constant-time comparison). Structured
  JSON errors with 400/401/404/405/413/415/500 statuses. Unexpected errors are
  hidden from clients and reported to the host. `no-store`/`nosniff` headers;
  JSON-only bodies up to 64 KiB.
- Added the SDK's browser-safe `createHttpTransport` (new error codes
  `unauthorized`, `transport-failed`) and `pathcompiler serve` (loopback by default,
  requires `PATHCOMPILER_API_TOKEN`), sharing artifact loading with `mcp`.
- Documented in README and ADR 0020.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 17 baseline lint/typecheck/tests | Passed before edits; 203 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 150 files |
| `pnpm typecheck` | Passed, twenty-one package builds, root tests and fixture |
| `pnpm test` | 210 tests passed across twenty-six suites |
| `git diff --check` | Passed |

Tests compare HTTP-transport and in-process SDK results for every endpoint,
supported actions and error code. They also cover missing, wrong, non-bearer and
extended tokens, method/media-type/JSON/body-size/encoding/unknown-route errors,
hidden internal errors with host reporting, server-side invalid responses, HTTP
transport URL validation, and the built CLI `serve` answering authorized requests
and refusing unauthorized ones. Browser suites were not rerun because no runtime
or fixture code changed.

### Scope notes and limitations

- All Phase 18 scope is implemented, plus the related-workflows endpoint.
- No CORS, per-user or per-project keys, rate limiting, TLS termination or billing.
  The shared token is not for browsers.
- Nineteen phases are complete (0–18), leaving 12 (19–30).

## Phase 19 — Incremental Graph Diff

Complete — verified locally on 2026-10-22.

- Added `@pathcompiler/graph-delta`. `analyzeCommitRange({directory, base, head})`
  exports both commits read-only with `git archive` (new
  `LocalGitRepository.exportCommit`), fully re-analyzes each snapshot
  (Next.js plus Playwright evidence) and returns a versioned `GraphDelta`.
- Added a `readSourceProject(dir, {snapshot: {commit}})` option that binds
  provenance for exports without `.git` metadata.
- `computeGraphDelta` is pure. It strips commit binding before comparing, so
  unchanged facts never appear changed. Changed nodes carry differing `fields` and
  `kind` (`location` vs `content`).
- The delta includes the spec's node/edge lists plus `changedEdges` and a summary of
  exact changed files (content hashes of both exports), symbols/components, routes,
  semantic targets and APIs.
- Added `pathcompiler diff <base> <head> [directory]`, writing
  `reports/graph-delta.json`. Documented in README and ADR 0021.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 18 baseline lint/typecheck/tests | Passed before edits; 210 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 154 files |
| `pnpm typecheck` | Passed, twenty-two package builds, root tests and fixture |
| `pnpm test` | 218 tests passed across twenty-seven suites |
| `git diff --check` | Passed |

Tests build a temporary repository with the fixture in a subdirectory and commit a
copy-only label edit, a renamed semantic target, a new route and a non-source file.
The delta reports exactly the scoped changed files, the added route, the removed and
added targets, the new component, and the label as a content change. Out-of-scope
files are excluded, identical commits give an empty delta, evidence-only moves and
re-binding are classified correctly, unknown revisions fail without leftover temp
directories, and the built CLI writes the report and leaves the tree clean.

### Scope notes and limitations

- All Phase 19 outputs are implemented with full re-scans. There is no partial
  re-analysis yet, which the spec allows.
- Requires `tar`. Renames appear as removal plus addition. Capability/workflow
  graph layers are not diffed (impact analysis works from the source/test graph).
- Twenty phases are complete (0–19), leaving 11 (20–30).

## Phase 20 — Workflow Impact Analysis

Complete — verified locally on 2026-10-22.

- Added `@pathcompiler/impact-analysis` with pure, deterministic
  `analyzeWorkflowImpact(delta, approvedRecords)`, returning a versioned report of
  `{workflowId, severity, reasons, affectedSteps}` sorted by severity.
- Implemented the spec's rules by joining the delta against each workflow's step
  and condition targets, entry/navigate routes and evidence node IDs. Removed
  targets, workflow APIs, routes, route changes and permission/flag changes or guard
  edges are high. Target moves and copy-only label changes are low.
- Added medium rules (behavioral target change, API content change, removed
  implementation/test evidence, approval commit ≠ delta base) and low rules
  (implementation/test/route location changes, unexplained evidence-file edits with
  no step attribution).
- Added `pathcompiler impact <base> <head> [directory]`, writing
  `reports/graph-delta.json` and `reports/workflow-impact.json`. Approved files are
  never modified. Documented in README and ADR 0022.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 19 baseline lint/typecheck/tests | Passed before edits; 218 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 158 files |
| `pnpm typecheck` | Passed, twenty-three package builds, root tests and fixture |
| `pnpm test` | 223 tests passed across twenty-eight suites |
| `git diff --check` | Passed |

On real commits in a temporary fixture repository (workflows discovered and approved
at the base commit), renaming `plans.change_structure` is high on `step.1` only. The
Create Client label edit is low (`copy-changed`, `step.1`) without a redundant file
reason. `plans.create`, whose shared file changed but none of its elements did, is
low with no affected steps. Synthetic deltas cover removed APIs and routes, changed
routes, added permission guards, moved and behaviorally changed targets, baseline
mismatch, no impact, input-order independence and input validation. The built CLI
reports high impact and leaves the approved YAML byte-identical.

### Scope notes and limitations

- All Phase 20 rules are implemented deterministically. No model supplementation.
- Impact is evidence-based. Behavior changes in code not cited as evidence (for
  example an unreferenced helper) surface only as unexplained file changes.
- Twenty-one phases are complete (0–20), leaving 10 (21–30).

## Phase 21 — Workflow Update Proposals

Complete — verified locally on 2026-10-22.

- Added `@pathcompiler/workflow-proposals` (pure, validation injected):
  `generateProposals` for medium/high impacts, `acceptProposal`, `decideProposal`
  (reject or ignore for this change), `workflowDiff` and versioned YAML.
- Proposals (`.pathcompiler/proposals/<id>.<head-sha>.yaml`) carry impact reasons,
  the head-commit rediscovered workflow under the approved ID (matched by ID, intent
  or unique ≥50% step-target overlap), its validation against the head graph,
  changed files, commit subjects and a human-readable semantic diff.
- Approved workflows change only through `accept`. It requires a clean checkout at
  the proposal's head commit and a fresh valid validation, and records `accept` or
  `edit` (hand-edited) mode. Generation never overwrites proposals or approved files.
- Added `analyzeCommitRangeDetailed` to graph-delta (returns the head analysis) and
  `pathcompiler proposals generate/list/show/accept/reject/ignore`.
- Documented in README and ADR 0023.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 20 baseline lint/typecheck/tests | Passed before edits; 223 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 162 files |
| `pnpm typecheck` | Passed, twenty-five package builds, root tests and fixture |
| `pnpm test` | 229 tests passed across twenty-nine suites |
| `git diff --check` | Passed |

In a temporary fixture repository, renaming `plans.change_structure` in the
component and its tests produces exactly one high-impact proposal, matched by ID.
Its head-commit workflow is valid, keeps the approved ID, uses `plans.restructure`,
and the diff shows `- target: plans.change_structure` / `+ target: plans.restructure`.
Accept rebinds the approved record to the head commit. Hand edits record `edit`.
Stale, dirty, invalid, empty and ID-changing acceptances are refused. Reject and
ignore leave approvals untouched, and decisions are final. Through the built CLI:
generate, list, show, dirty-tree refusal, accept, final-decision refusal and
non-overwriting regeneration.

### Scope notes and limitations

- All Phase 21 scope is implemented. GitHub PR evidence is not fetched during
  generation (it needs a token; `github inspect` remains available).
- Commit evidence is file-history based and bounded by the base commit's date.
- Twenty-two phases are complete (0–21), leaving 9 (22–30).

## Phase 22 — New Workflow Detection

Complete — verified locally on 2026-10-22.

- Added pure `detectNewWorkflows` to `@pathcompiler/workflow-proposals`.
  Capabilities new at head (absent at base) with no approved or rejected workflow
  are scored from independent signals: new user action (0.30), new write API
  (0.25), new Playwright flow (0.20), new route or component (0.15) and a commit
  subject naming the verb and entity (0.10).
- No single signal is sufficient. Two or more signals plus a test-backed head
  candidate give `new-candidate`. Two or more without a test give `needs-evidence`.
  One signal gives `insufficient-evidence`, with no candidate.
- The write-API signal also follows newly added `CALLS_API` edges from the
  capability's component functions, because Phase 7 API association can attach an
  unrelated existing API.
- `analyzeCommitRangeDetailed` returns base and head analyses. Added
  `pathcompiler workflows detect <base> <head>`, writing
  `reports/new-workflows.json` and new candidate files (never replacing existing
  ones). Commit evidence gathering is shared with `proposals generate`.
- Made the graph-delta temp-cleanup test observe a private `TMPDIR`. It had
  raced with concurrent suites that legitimately create temp exports.
- Documented in README and ADR 0024.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 21 baseline lint/typecheck/tests | Passed before edits; 229 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 164 files |
| `pnpm typecheck` | Passed, twenty-five package builds, root tests and fixture |
| `pnpm test` | 232 tests passed across thirty suites |
| `git diff --check` | Passed |

In a temporary fixture repository with all base workflows approved, a Duplicate
Plan feature (button, handler, POST API, Playwright test, "Duplicate a plan from
its row") is the only detection: `new-candidate`, confidence 0.85, with a
test-backed `plans.duplicate` candidate. A lone new button is
`insufficient-evidence` with no candidate. A rejected candidate suppresses
detection. Pre-existing unapproved capabilities (`clients.edit`,
`clients.deactivate`) are not reported. The built CLI writes the candidate, it
approves normally, and re-detection then finds nothing.

### Scope notes and limitations

- All Phase 22 scope is implemented. PR titles are not read (the GitHub adapter
  needs a token). Commit subjects come from file histories in the range.
- Weights are fixed rule strengths, not calibrated probabilities.
- Twenty-three phases are complete (0–22), leaving 8 (23–30).

## Phase 23 — Workflow Deprecation

Complete — verified locally on 2026-10-22.

- Added the `workflow-deprecation-proposal` kind to `@pathcompiler/workflow-proposals`.
  It is generated instead of an update when a high impact includes lost critical
  support (removed step/condition target, API or route) and no head-commit
  workflow matches. It carries the lost support, an optional replacement (a new
  same-domain/entity capability at head) and a readable summary.
- Added `DeprecatedWorkflowSchema` (`workflows/deprecated/<id>.yaml`) to
  `@pathcompiler/workflow-review` and pure `acceptDeprecation`. It refuses if the
  approved workflow changed since generation.
- `proposals accept` on a deprecation writes the deprecated record, records the
  decision, then removes the approved file (only on explicit acceptance; never
  automatic). Reject/ignore keep the workflow approved. `proposals list` shows the
  kind; `show` prints the summary. `workflows list/show` include `deprecated`, and
  approve/reject refuse deprecated IDs.
- `proposals generate` passes capabilities new at head for replacement
  suggestions. Documented in README and ADR 0025.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 22 baseline lint/typecheck/tests | Passed before edits; 232 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 164 files |
| `pnpm typecheck` | Passed, twenty-five package builds, root tests and fixture |
| `pnpm test` | 236 tests passed across thirty suites |
| `git diff --check` | Passed |

Pure tests cover deprecation generation with a replacement, medium-only no-match
staying an update, acceptance into a deprecated record, approved-drift and
wrong-kind refusals, rejection and YAML round trips. Through the built CLI in a
temporary fixture repository, removing the Change Plan Structure control yields a
high-impact deprecation proposal. Accepting it writes the deprecated record,
removes the approved file, shows `deprecated` in `workflows show`, rebuilds with
only `plans.create`, and blocks re-approval.

### Scope notes and limitations

- All Phase 23 scope is implemented. Replacement detection only suggests
  same-domain, same-entity capabilities and never auto-links them.
- Rename-like changes with a matching successor produce updates, not deprecations.
- Twenty-four phases are complete (0–23), leaving 7 (24–30).

## Phase 24 — GitHub App

Complete for offline-verifiable scope — verified locally on 2026-10-22. Not yet
exercised against live GitHub (see limitations).

- Added `@pathcompiler/github-app` (Node crypto/http plus fetch; no Octokit):
  least-privilege manifest (`checks: write`, `contents/metadata/pull_requests: read`;
  `push`/`pull_request` events), constant-time `X-Hub-Signature-256` verification
  over the raw body, and normalization of push events (branch create/delete
  ignored) and PR opened/synchronize/reopened events.
- The webhook handler verifies, acknowledges with 202, and enqueues into an
  in-process sequential queue deduplicated by delivery ID. Processing is
  asynchronous, and failures are reported without stopping the queue.
- RS256 app JWTs and installation tokens scoped down to checks/contents/metadata,
  cached until near expiry. Check runs are published as `PathCompiler Workflow
  Check` in the spec's ✓/⚠/+ format (`neutral` for review, `success` when clean,
  `failure` with an actionable summary on errors).
- The worker fetches base/head into a configured local clone, with the token
  passed only through `GIT_CONFIG_*` env and Git stderr never relayed, then runs
  graph delta, impact and new-workflow detection against the clone's committed
  approved workflows.
- Added `pathcompiler github-app manifest` and `github-app serve --config`
  (`GITHUB_WEBHOOK_SECRET` from env, private key from a file path). Documented in
  README and ADR 0026.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 23 baseline lint/typecheck/tests | Passed before edits; 236 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 169 files |
| `pnpm typecheck` | Passed, twenty-six package builds, root tests and fixture |
| `pnpm test` | 244 tests passed across thirty-one suites |
| `git diff --check` | Passed |

Tests cover signature acceptance and tampering, event normalization and ignored
events, acknowledgement before processing on a real HTTP server, duplicate
deliveries, 401/400/405/413 handling and queue error isolation. They verify JWT
signatures against the generated public key, check token scoping/caching/refusal
and check-run payloads with a fake GitHub API, and check the manifest's HTTPS
webhook. An end-to-end worker run fetches a renamed-target commit from a local
origin into a clone and publishes "⚠ 1 workflow requires review / ✓ 2 workflows
unaffected" (neutral), without any token in recorded requests. A failure-check
path is covered, and the built CLI serves verified pings and rejects forged ones.

### Scope notes and limitations

- Not verified against GitHub.com: no real app registration, installation, public
  HTTPS endpoint or live token/check-run calls were possible here.
- The queue is in-memory (pending jobs are lost on restart; rely on redelivery).
  Repositories must be pre-cloned and configured. Proposals are not written by
  the app.
- Twenty-five phases are complete (0–24), leaving 6 (25–30).

## Phase 25 — Control Plane Dashboard

Complete — verified locally on 2026-10-22.

- Added `apps/dashboard` (Next.js App Router; `apps/*` joined the workspace) with
  Projects, Product Map, Workflows, Workflow Detail, Pending Changes, Evidence and
  Settings screens over each project's `.pathcompiler` directory.
- Workflow Detail shows state, current commit, approval/deprecation, confidence
  (with dimensions, labeled as rule strength), steps with expected outcomes and
  per-step source evidence, the validation report and pending diffs.
- The simple first editor offers approve/reject for candidates and
  accept/reject/ignore for proposals through server actions that run the same
  `runCli` commands, so rules are identical to the terminal. Results appear as
  status/alert messages.
- Reads use core parsers and CLI reports. IDs are validated (unknown or traversal
  paths return 404). The CLI loads at runtime and project paths are marked dynamic,
  so the production build has no warnings. There is no graph visualization, as
  specified.
- Projects are configured with `PATHCOMPILER_PROJECTS`. The dashboard is local-only
  with no authentication. Dashboard e2e is chained into `pnpm test:e2e` and CI
  artifacts. Documented in README and ADR 0027.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 24 baseline lint/typecheck/tests | Passed before edits; 244 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 187 files |
| `pnpm typecheck` | Passed, including dashboard route types |
| `pnpm test` | 244 tests passed across thirty-one suites |
| `pnpm test:e2e` | Fixture 7, verification 6, runtime 3, dashboard 7 Chromium tests passed |
| Dashboard production build | Compiled with no warnings |
| `git diff --check` | Passed |

The dashboard suite prepares a real project with the built CLI (discover, approve,
rename commit, validate, capabilities, tests, impact, proposals, detect, build). It
verifies project counts, product-map coverage, workflow detail content (steps,
evidence locator, expected outcome, confidence label, validation checks), the
pending diff, proposal acceptance by a named reviewer and the updated target,
candidate approval with ambiguities shown, removal of review controls once
decided, evidence and settings content, and 404s for unknown or traversal IDs.

### Scope notes and limitations

- All Phase 25 screens are implemented. Editing workflow content in the browser
  is not supported (edits happen in YAML; proposals record `edit` mode).
- Local single-user tool: no authentication, authorization or audit log.
- Twenty-six phases are complete (0–25), leaving 5 (26–30).

## Phase 26 — Static Export

Complete — verified locally on 2026-10-22.

- `pathcompiler build --format json,yaml,markdown` (repeatable or comma-separated;
  default `json`). JSON writes the three artifacts the SDK's static transport reads,
  YAML mirrors them, and Markdown writes the `generated/workflows.md` catalog.
- Added `exportArtifacts`, `renderWorkflowMarkdown`, `renderCatalogMarkdown`,
  `escapeMarkdown` and `GENERATED_MARKER` to `@pathcompiler/workflow-compiler`.
  Output is deterministic, and approved text is escaped so it renders literally.
- Static mode needs no PathCompiler server: built JSON loaded into the SDK resolves
  help with `fetch` disabled. Documented in README and ADR 0028.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 25 baseline lint/typecheck/tests | Passed before edits; 244 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 188 files |
| `pnpm typecheck` | Passed |
| `pnpm test` | 247 tests passed across thirty-one suites |
| `git diff --check` | Passed |

Tests cover format ordering, de-duplication and default JSON, input-order
determinism, YAML parsing to exactly the JSON documents, catalog structure and
marker, literal rendering of HTML/link/emphasis characters, optional steps and
branches, all seven files from the built CLI, offline SDK resolution and runtime
manifests from the built JSON, and invalid or misplaced `--format`. Browser suites
were not rerun because no runtime, fixture or dashboard behavior changed (default
build output is unchanged).

### Scope notes and limitations

- All Phase 26 scope is implemented. The SDK reads JSON only; YAML and Markdown are
  for people and tooling.
- Twenty-seven phases are complete (0–26), leaving 4 (27–30).

## Phase 27 — Documentation Export

Complete — verified locally on 2026-10-22.

- Added pure `renderHelpPages` to `@pathcompiler/workflow-compiler`: one escaped
  Markdown page per approved workflow (where, who, prerequisites, numbered steps
  with expectations and branches, completion) plus an index grouped by domain. All
  are derived from compiled documentation records.
- Every page carries the generated marker with workflow ID, revision and compiler
  version. Markdown is a renderer, never a source of truth.
- Added `pathcompiler docs export [--dir docs/help]`. It refuses to replace
  unmarked (hand-written) files before writing anything, writes pages atomically,
  removes only marked pages of workflows that are no longer approved, and leaves
  other files untouched. Documented in README and ADR 0029.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 26 baseline lint/typecheck/tests | Passed before edits; 247 tests |
| `pnpm lint` | Passed without warnings; 188 files |
| `pnpm typecheck` | Passed |
| `pnpm test` | 249 tests passed across thirty-one suites |
| `git diff --check` | Passed |

Tests cover page names and order, markers, index grouping and links, page
contents, the empty catalog, export of two pages beside a preserved hand-written
FAQ, byte-identical re-export, removal of a page after its approval is withdrawn,
refusal (with no changes) to overwrite a hand-written page, custom `--dir`, and a
misplaced `--dir`.

### Scope notes and limitations

- All Phase 27 scope is implemented. No localization or site-generator front matter.
- Twenty-eight phases are complete (0–27), leaving 3 (28–30).

## Phase 28 — Assistant Tool Adapters

Complete — verified locally on 2026-10-22.

- Added `@pathcompiler/assistant-tools` (depends only on the SDK and zod) with the
  provider-neutral core `resolveProductHelp(client, input)` and `parseToolInput`.
  Inputs may be JSON strings or objects, strict-mode nulls are dropped, and flag
  pairs become a map. Invalid input raises a typed `ToolInputError`.
- Adapters reshape one tool, `resolve_product_help`: the generic JSON Schema
  description, Anthropic `input_schema`, OpenAI `strict` function tools (Chat
  Completions and Responses shapes) with a strict-compatible schema, and a
  LangChain-style `{name, description, schema, invoke}` wrapper.
- A test asserts no workspace package depends on OpenAI, Anthropic or LangChain
  SDKs. Documented in README and ADR 0030.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 27 baseline lint/typecheck/tests | Passed before edits; 249 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 192 files |
| `pnpm typecheck` | Passed |
| `pnpm test` | 254 tests passed across thirty-two suites |
| `git diff --check` | Passed |

Tests cover each adapter shape, recursive strict-mode invariants (no open maps;
every object closed and fully required), argument normalization and rejection,
delegation through the SDK client (with recorded normalized requests) and the
LangChain wrapper's JSON output, and the workspace-wide provider SDK ban.

### Scope notes and limitations

- All Phase 28 scope is implemented. The adapters were not exercised against live
  model APIs (no provider credentials or SDKs, by design).
- Twenty-nine phases are complete (0–28), leaving 2 (29–30).

## Phase 29 — Example Existing Assistant

Complete — verified locally on 2026-10-22.

- Added `examples/custom-assistant` (`examples/*` joined the workspace; example
  tests run in the root Vitest suite). It is an existing assistant with its own
  chat loop and `ChatModel` interface that adds PathCompiler as one
  `resolve_product_help` tool call, then renders the structured result, workflow
  steps and supported actions with its own card UI.
- It uses only `@pathcompiler/sdk-js` and `@pathcompiler/assistant-tools` over
  static artifacts: no PathCompiler UI or React package and no server.
  `ScriptedModel` makes it run offline. The README shows where Anthropic or OpenAI
  calls plug in.
- `prepare-artifacts` discovers, approves and builds the fixture. `start` answers
  a question in the terminal. TypeScript runs directly on Node 22 (erasable syntax
  only).

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 28 baseline lint/typecheck/tests | Passed before edits; 254 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 199 files |
| `pnpm typecheck` | Passed, including the example |
| `pnpm test` | 258 tests passed across thirty-three suites |
| Documented `prepare-artifacts` and `start` | Rendered the Create Client card with Open/Show me/Checklist |
| `git diff --check` | Passed |

Tests build real artifacts with the CLI and check the full Create Client card
(steps, completion, actions; never execute), ambiguous clarification, the
unsupported answer, skipping the tool for small talk (with the tool calls
recorded), the standalone program answering a structure question, and the absence
of PathCompiler UI/React dependencies and imports.

### Scope notes and limitations

- All Phase 29 scope is implemented. The model is scripted. Real provider calls
  are documented but not exercised (no credentials or provider SDKs, by design).
- Thirty phases are complete (0–29), leaving 1 (30).

## Phase 30 — Full Reference Demo

Complete — verified locally on 2026-10-22.

- Added `examples/reference-demo`. It runs the full loop on a fresh Git copy of the
  fixture through the public CLI and SDK: (1) scan, (2) product graph, (3) workflow
  discovery, (4) approval, (5) compile, (6) resolver query, (7) custom assistant
  answer, (10) code change, (11) impacted workflow detected, (12) update proposal,
  (13) approval and (14) new runtime output. It records a transcript; `demo`
  prints the narrative.
- A Playwright suite serves the unchanged fixture and the changed copy as
  production builds. It verifies (8) the assistant's navigate action and (9) an
  interactive guide completing Create Client, and for (14) that the rebuilt
  manifest guides Change Plan Structure through the renamed target while the old
  manifest reports `target-missing`.
- The in-workspace copy sets `turbopack.root` so it builds with the fixture's
  dependencies. Chained into `pnpm test:e2e` and CI artifacts. Documented in
  README, the example README and ADR 0031.

### Verification

All checks passed with Node 22.23.3 and pnpm 10.34.7:

| Command / check | Result |
| --- | --- |
| Phase 29 baseline lint/typecheck/tests | Passed before edits; 258 tests |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 207 files |
| `pnpm typecheck` | Passed, including both examples and the dashboard |
| `pnpm test` | 258 tests passed across thirty-three suites |
| `pnpm test:e2e` | Fixture 7, verification 6, runtime 3, dashboard 7, reference demo 4 Chromium tests passed |
| `pnpm --filter @pathcompiler/reference-demo demo` | All fourteen steps printed |
| `git diff --check` | Passed |

### Scope notes and limitations

- All Phase 30 scope is implemented. The demo's code change is a semantic target
  rename. Other change classes are covered by their phase suites.
- All thirty-one phases (0–30) are complete.

## Overall status after Phase 30

All phases in `CODEX_BUILD_SPEC.md` are implemented and verified locally. Known
limitations, carried from the phase notes:

- **GitHub App (Phase 24):** never exercised against live GitHub. The job queue is
  in-memory.
- **Dashboard (Phase 25):** a local single-user tool with no authentication.
- **Assistant adapters (Phase 28) and custom assistant (Phase 29):** model calls
  are not exercised against live providers.
- **Resolver (Phase 13):** English-only lexical matching with empty aliases.
  Embeddings are not built.
- **Hosted CI:** not inspected in these sessions.
