# Phase status

## Current state (updated 2026-10-25, after I9)

| Item | State |
| --- | --- |
| Original phases (`CODEX_BUILD_SPEC.md` 0–30) | ✅ all complete against phase acceptance criteria. Baseline re-verified 2026-10-22: lint, typecheck, 258 unit tests, 27 Chromium tests. |
| Original cross-cutting contracts (§§43–96) | ⚠ partial: Runtime Result v1, RuntimeContext, versioning, config/`init`, the eval harness/golden tests, the model provider boundary and its adapters are aligned (C1–C5, C7–C9); alpha validation (C6) remains. Tracked as C1–C9. |
| New architecture tracks | C (original-spec conformance), R (formal reasoning), P (probabilistic), O (observability), I (improvement loop incl. IG gate) |
| Product shape | Three planes (Product Intelligence, Experience, Improvement); six operating modes (Understand, Guide, Observe, Recommend, Evaluate, Self-improvement), each usable on its own. Self-improvement is opt-in. See ADR 0033. |
| AI channels | A: internal model providers on targeted evidence (optional; deterministic by default). B: PathCompiler MCP for external agents. C: external harness for mutation (mode 6 only). See ADR 0034. |
| Unblocked | C6 (needs the user's repositories) |
| Blocked | None (mode 6 phases run only when enabled); see the roadmap §5 |
| Deferred | O13, I10, MDP assistance, information-gain diagnostics, review editor/graph UI, hosted control plane, billing/SSO, graph/vector DB, CI/CD platform, `analysis_backend: external_harness`, autonomous mutation by default |
| New-track phases complete | R0, R1, R2, R3, R4, R11, R8 (reasoning MVP), R-WI, R5, R6, R7, R9, R10, R12; P0–P5, P-RV; I0–I9 and IG (mode 5, Evaluate); C1, C2, C3, C4, C5, C7, C8, C9; O0–O12 (mode 3, Observe). 2026-10-23 to 2026-10-24; details per phase below. |
| Next recommended phase | All planned phases except C6 are complete. Next: fix the open issues, review the documentation, then C6 on real repositories (`MASTER_ROADMAP.md` §7). Known issues and deferred items: [ISSUES_LOG.md](ISSUES_LOG.md). |

Roadmap: [MASTER_ROADMAP.md](MASTER_ROADMAP.md). Reconciliation decisions:
ADR 0032, ADR 0033, ADR 0034. Per-phase records follow.

---

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
| `pnpm lint` | Passed without warnings; 245 files |
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
| `pnpm lint` | Passed without warnings; 245 files |
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
| `pnpm lint` | Passed without warnings; 245 files |
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
| `pnpm lint` | Passed without warnings; 245 files |
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

## Roadmap reconciliation — reasoning, observability and improvement extensions

Planning only — 2026-10-23. No implementation phase was started.

- Read `REASONING_ENGINE_BUILD_SPEC.md` (R0–R11, P0–P5, O0–O13, I0–I10) and
  `HARNESS_ENGINEERING_HANDOFF.md` in full, and re-read `CODEX_BUILD_SPEC.md`
  §§43–96. Those sections had not been reconciled during the phase build.
- Re-verified the baseline and inspected packages, tests, the dependency graph
  and the fixture's authorization model. Phases 0–30 meet their acceptance
  criteria. Cross-cutting gaps are recorded as C1–C9 rather than reopening
  completed phases.
- Wrote `docs/phases/MASTER_ROADMAP.md`. It is dependency-ordered: every phase
  states its objective, prerequisites, packages, interfaces, acceptance criteria,
  tests/evals, runtime impact, what it unblocks and its status. It also has
  parallel lanes and a deferred list.
- ADR 0032 reconciles the specs:
  - Insertion is additive, with no renumbering.
  - §164's build order is not applied retroactively.
  - Test-backed discovery remains the baseline until the R-WI evaluation.
  - Integer `workflowVersion` sits alongside the content-hash revision.
  - The Runtime Result v1 alignment is scheduled as C1.
  - Flags require configuration (C2).
  - There is no second `PathCompilerProvider`.
  - Workflow IR stays unchanged.
  - Evidence classes are distinct, and `UNKNOWN` never becomes `UNREACHABLE`.
  - The two MCP surfaces stay separate, as do the proposal namespaces.
  - The harness boundary holds, and browser verification is generalized in C8.
- ADR 0033 sets out the planes and operating modes. Mode 5 evaluates human PRs
  without the harness contract, so I3 no longer depends on I2. Also: the four
  trigger classes, the escalation gate (new phase IG), an explained value
  assessment, budgets, `autonomous_mutation: false` and `no_change` as an outcome.
- ADR 0034 separates the three AI channels. The original evidence-first,
  provider-API semantic analysis is kept (C5 boundary, new C9 adapters). No
  customer needs a coding harness. The enterprise harness-backed analysis mode is
  deferred.
- Conflicts found: build order (§164); Runtime Result v1 divergence; numeric vs
  hash workflow versions; strict RuntimeContext; feature flags without a config
  file; duplicate React provider name; applicability vs Workflow IR v1; the
  mismatched discovery baseline; the fixture-only browser verifier blocking I4;
  and the Phase 28 provider-SDK ban vs future adapters.
- Next recommended phase: **R0 — Formal Model Foundation**.

## Phase R0 — Formal Model Foundation

Complete — verified locally on 2026-10-23.

- Added `@pathcompiler/formal-model` (depends only on `workflow-ir` for
  `EvidenceRef`, and `zod`; no solver). It provides typed state variables
  (`boolean`, `enum`, `integer`, `string`) with `context` or `state` scope, a
  typed `FormalExpr`/`FormalTerm` AST, actions with preconditions and
  simultaneous-assignment effects, invariants, goals, an admissible-initial-state
  constraint, and versioning metadata (§82).
- Validation enforces unique IDs, known variables, enum membership,
  integer-only ordering, integer bounds, compatible comparison types, no
  assignment of context variables, at most one assignment per variable per
  action, an expression depth limit, and mandatory evidence on every object.
- `normalizeFormalModel`, `serializeFormalModel` and `formalModelHash` are
  canonical and independent of authoring order. `collectFormalEvidence` lists
  provenance by owner. `f` constructors keep hand-encoded models readable.
- Hand-encoded the fixture reference model (`test/next-demo-model.ts`): 13
  variables (role and `planStructure` flag as context), 12 actions covering
  Create Client and Change Plan Structure including the weekly → simple
  confirmation branch, 3 invariants, and the goals `clients.created` and
  `plans.structure_changed`.
- Documented semantics in ADR 0035 and the README. No change to discovery,
  compiled artifacts or runtime behavior.

### Verification

| Command / check | Result |
| --- | --- |
| Baseline before edits | lint, typecheck, 258 tests passed |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 212 files |
| `pnpm typecheck` | Passed, including the new package |
| `pnpm test` | 266 tests passed across 34 suites (8 new formal-model tests) |
| `git diff --check` | Passed |

Tests check that:
- the fixture model validates;
- shuffled authoring order gives byte-identical serialization and an identical
  hash, and serialization round-trips;
- every one of the model's evidence references resolves to a node in the mined
  fixture graph, at the scanned commit, with a locator present in that node's own
  evidence;
- every semantic target exists as a UI node, and every capability link is a
  discovered capability;
- every step target of the discovered `clients.create` and
  `plans.change_structure` workflows is covered by a formal action;
- all variable types and typed comparisons are accepted;
- each validation rule rejects bad input with an actionable message;
- provenance, strict keys, the schema version, the ID format and the depth limit
  are enforced.

### Scope notes and limitations

- All R0 scope is implemented. Reachability, planning and invariant checking
  start in R2, R3 and R8.
- The model is single-entity and unparameterized (for example "a plan exists",
  not per-plan state). Richer constructs need an ADR and a schema bump.
- Next recommended phase: R1 — Formal Abstraction Builder.

---

## Phase R1 — Formal Abstraction Builder

Complete — verified locally on 2026-10-23.

- Added `@pathcompiler/formal-abstraction` with
  `buildFormalModel(graph, capabilities, traces) → { model, coverage, uncertainties }`.
  It never reads workflow candidates, so R-WI can still compare
  reasoning-assisted discovery against test-backed discovery.
- The extractor builds the following:
  - **Context variables:** a `role` enum (roles checked in code plus
    `unlisted`), `can_<permission>` booleans and `<flag>_enabled` booleans.
  - **Navigation:** `current_area` from capability routes and `NAVIGATES_TO`
    targets, plus a deterministic action per navigation link.
  - **Dialog automata:** one per capability, inferred from test sessions.
    Sessions start at the entry control and end at navigation, reload, cancel,
    or a step outside the dialog. The automaton covers open, fields (`entered`
    booleans or string-literal enums), commit, submit-for-confirmation, back
    and cancel.
  - **Required fields:** only when a test shows a rejected submit.
  - **Guards:** only the permission and flag checks reachable from the API
    handler, applied to committing actions.
  - **Entity existence:** checked only for entries inside list rows.
  - **Goals:** completion goals named `<domain>.<qualifier_><past tense>`.
  - **Invariants:** structural ones (dialog only on its route, confirmation
    only inside its dialog).
- Coverage counts transitions by basis (deterministic, tests, runtime,
  semantic-only; reasoning spec §85). It lists the rules behind each action,
  which capabilities were modeled and which test sessions were used. There are
  ten uncertainty kinds, and each cites graph nodes.
- For `fixtures/next-demo`: 25 actions (3 deterministic, 22 from tests),
  5 of 5 capabilities modeled, and 0 test sessions discarded. All 12
  hand-model actions map to extracted actions with the same semantic target
  and capability, and both goal IDs match. ADR 0036 records each remaining
  difference, and each one appears as an uncertainty entry.
- Rules are recorded in ADR 0036 and documented in the README. No change to
  discovery, compiled artifacts or runtime behavior.

### Verification

| Command / check | Result |
| --- | --- |
| Baseline before edits | lint, typecheck, 266 tests passed |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 216 files |
| `pnpm typecheck` | Passed, including the new package |
| `pnpm test` | 273 tests passed across 35 suites (7 new formal-abstraction tests) |
| `git diff --check` | Passed |

Tests check:
- metadata and context variables are bound to the commit;
- equivalence with the hand model (action mapping, semantic targets,
  capabilities, goals), with every guard difference backed by an uncertainty;
- that every extra action is a cancel or back path, a navigation link, or an
  out-of-scope capability;
- provenance: every evidence reference and every uncertainty node resolves to a
  graph node, with a matching locator;
- the coverage totals and the rules behind each action;
- byte-identical output when graph, capability and trace order are reversed;
- that unresolved steps discard sessions and report capabilities as not
  modeled;
- that unbound or mismatched scans are rejected.

### Scope notes and limitations

- C5 semantic assistance is not used (it does not exist yet). The `semantic`
  and `runtime` bases are always 0.
- Business rules in handler bodies are reported, not modeled: validation, the
  weekly → simple confirmation condition, stored values, and enabling
  conditions such as plans.create needing a client.
- UI gating of entries is reported, not applied. A security invariant such as
  "viewers never hold an editing form open" therefore has no extracted
  counterpart.
- Session inference assumes modal dialogs and the session-ending events above.
  Inline forms are modeled as if they were modal.
- Next recommended phase: R2 — SMT Reachability.

---

## Phase R2 — SMT Reachability

Complete — verified locally on 2026-10-23.

- Added `@pathcompiler/solver-provider`: a solver-neutral, sort-checked term
  language (bool/int, `not`/`and`/`or`/`eq`/`lt`/`le`) and the
  `SolverProvider { check, close }` interface. `enumerate` and `optimize` are
  deferred to R6 and R7.
- Added `@pathcompiler/solver-z3`, the only package that imports Z3 (`z3-solver`
  5.2.0, WASM). It creates a fresh solver per check with a timeout, releases the
  solver and model eagerly, and terminates worker threads on `close`.
- Added `@pathcompiler/reasoner-core`. `createProductReasoner(provider)
  .checkReachability(model, { goal, context, maxDepth, timeoutMs })` works as
  follows:
  - **Slicing:** the model is cut to the cone of influence of the goal and the
    context.
  - **Encoding:** state variables are per step and context variables fixed.
    Enum values and strings share a code table, integers keep their bounds, and
    effects are simultaneous, with the frame rule.
  - **Bounded model checking (BMC)** finds shortest witnesses.
  - **k-induction** proves unreachability. It uses simple-path constraints and
    strengthening from frozen variables.
  - **Unknown answers:** insufficient bound, timeout and solver unknown each
    give `unknown`.

  Witnesses are replayed with an independent evaluator before they are
  returned. Results carry the model's ID, hash, commit and source, plus stats:
  bound, solver calls, constraint count, duration and slice size.
- Added `pathcompiler reason reachable <goal> [directory]` with `--context`,
  `--max-depth`, `--timeout-ms`, `--model` and `--json`. It writes
  `reports/reasoning/<goal>.json`, which includes model coverage and
  uncertainties for extracted models. An unreachable answer on an extracted
  model is labeled as holding in the model only. It is not exposed through MCP
  or HTTP.
- Recorded in ADR 0037 and documented in the README. No change to discovery,
  compiled artifacts or runtime behavior.

### Verification

| Command / check | Result |
| --- | --- |
| Baseline before edits | lint, typecheck, 273 tests passed |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 229 files |
| `pnpm typecheck` | Passed, including the three new packages |
| `pnpm test` | 289 tests passed across 39 suites (16 new: 2 solver-provider, 3 solver-z3, 8 reasoner-core, 3 CLI) |
| CLI binary | `reason reachable` answers on the fixture in about 1.2 s and exits cleanly |
| `git diff --check` | Passed |

Fixture results (hand-encoded and extracted models):

| Query | Result |
| --- | --- |
| Editor creates a client | Reachable with a 5-step shortest witness (navigation, open, name, email, submit), with evidence on each step |
| Viewer (or `unlisted`) creates a client or changes a plan structure | Unreachable by k-induction |
| Editor changes a plan structure with the flag on (extracted model) | Reachable in 3 steps; the solver chose `plan_exists = true` |
| Same, with the flag off | Unreachable |
| `maxDepth` 3 | Unknown (insufficient bound), not unreachable |

Further tests:
- stubbed solvers that time out, return unknown, or run past the budget all
  produce `unknown`;
- malformed queries get actionable errors;
- slicing drops irrelevant actions.

Cross-check against explicit-state breadth-first search: 40 seeded random
models with booleans, enums, bounded integers and a context flag, each under
three contexts, gave 120 queries. All 77 reachable and 43 unreachable answers
agreed with the reference, every witness had the shortest length, and there
were 0 unknown answers.

### Scope notes and limitations

- Reachability holds in the model. Extracted-model conclusions must be read
  with R1's coverage and uncertainties.
- The extracted model slices poorly: 20 of 21 variables remain, because every
  dialog entry requires "no dialog open". This does not matter at fixture size.
  Larger models may need a finer slice or incremental solving.
- No unsat explanations yet (R4), and no plan enumeration or optimization (R6,
  R7).
- `z3-solver` adds about 30 MB of WASM to installs that include the CLI.
- Next recommended phase: R3 — Planning.

---

## Phase R3 — Planning

Complete — verified locally on 2026-10-23.

- Added `ProductReasoner.findPlan(model, query)` → `found` (plan), `impossible`
  (k-induction proof) or `unknown`.
  - Plans are shortest by length. Among those, the result is the
    lexicographically smallest action sequence in normalized (ID) order, found
    by binary search per step, so plans do not depend on solver choices.
  - Each plan reports its total cost. It is marked cheapest only when the
    slice's action costs are uniform; cost optimization is R7.
- Added `evaluatePlan(model, plan, workflow?)`. It replays the plan and
  reports `goalReached` and `invalidActionCount`. Given a workflow, it compares
  major steps:
  - navigation is excluded, because it maps to workflow entrypoints;
  - adjacent input/select steps are order-insensitive;
  - the result has a longest-common-subsequence score plus missing and extra
    targets.
- Added `pathcompiler reason plan <goal> [directory]`, which writes
  `reports/reasoning/plans/<goal>.json`. When the approved
  `workflows/<capability>.yaml` exists, the CLI compares the plan with it.
- **Z3 backend amended (ADR 0037).** Each check now runs in its own low-level
  Z3 context, deleted afterwards. Planning's extra solver calls exhausted the
  2 GB WASM heap under the high-level API, whose AST nodes are freed only by GC
  finalizers. The failure appeared as an OOM abort followed by bogus sort
  errors. A stress run of 680 checks now stays at about 250 MB RSS.
- Recorded in ADR 0038 and documented in the README. Default discovery,
  compiled artifacts and runtime are unchanged.

### Verification

| Command / check | Result |
| --- | --- |
| Baseline before edits | lint, typecheck, 289 tests passed |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 230 files |
| `pnpm typecheck` | Passed |
| `pnpm test` | 295 tests passed across 40 suites (5 planning, 1 CLI plan) |
| CLI binary | `reason plan plans.created fixtures/next-demo --context role=editor` gives a 5-step plan in about 1.2 s |
| `git diff --check` | Passed |

Planning metrics (spec §89) on the fixture. Goal reached is true and the
invalid action count is 0 for every plan.

| Goal (model) | Plan | Major steps vs. discovered workflow |
| --- | --- | --- |
| clients.created (hand) | nav.open_clients → open_create_form → enter_email → enter_name → submit_create | 4/4 |
| clients.created (extracted) | navigate.nav_clients → clients.create.open → enter_email → enter_name → submit | 4/4 |
| plans.structure_changed (hand) | nav.open_plans → open_structure_editor → select_weekly → save_structure | 3/3 |
| plans.structure_changed (extracted) | navigate.nav_plans → open → submit | 2/3, missing `plan.structure.selector` (ADR 0036, value-not-persisted) |
| plans.created (extracted) | navigate.nav_plans → open → enter_client → enter_title → submit | 4/4 |
| clients.created as a viewer | Impossible (k-induction) | — |

Further tests:
- `maxDepth` 2 gives unknown (insufficient bound);
- with non-uniform costs, cost optimality is "not guaranteed";
- tampered plans are detected (goal not reached, invalid steps counted);
- CLI plan output, the comparison with an approved workflow, and the report
  shape are checked.

### Scope notes and limitations

- Plans are not cost-optimized (R7). Free initial and context values come from
  the solver model: deterministic for a given Z3 version, but not canonical.
- The extracted model's shortcut plans show where the abstraction is too loose.
  R-WI must report such gaps rather than turn shortcut plans into workflows.
- Next recommended phase: R4 — UNSAT Explanation.

---

## Phase R4 — UNSAT Explanation

Complete — verified locally on 2026-10-23.

- **Solver boundary.**
  - `SolverProblem.assumptions` lists boolean variables assumed true for one
    check. For an `unsat` answer with assumptions, the result includes a
    `core`, an unsatisfiable subset of them. The boundary validates that
    assumptions are declared booleans.
  - The Z3 backend uses `solver_check_assumptions` and `solver_get_unsat_core`,
    and maps core entries back to names by AST handle.
- **`ProductReasoner.explainUnreachable(model, query)`.** It labels three kinds
  of constraint: context assignments (`context:<v>`), each top-level
  precondition conjunct of each sliced action (`precondition:<action>#<n>`),
  and each initial conjunct (`initial#<n>`).
  - Domains, frame, effects and the goal stay hard.
  - After the k-induction proof, the cores of all proof checks are combined and
    then minimized by deletion against every check. The result is minimal for
    the certificate; it is not a global MUS, which is R5.
  - Each constraint has a product description, its action, capability and
    semantic target, its variables, and evidence: the action's evidence plus
    that of the context variables it mentions. The explanation also names the
    goal-setting actions and a summary.
  - A reachable or unknown answer is returned unchanged.
- **Helpers and CLI.** Added `describeFormalExpr` for product-term rendering.
  `pathcompiler reason why-not <goal>` prints the reasons and the source
  evidence per constraint, then writes
  `reports/reasoning/why-not/<goal>.json`.
- Recorded in ADR 0039 and documented in the README. Discovery, compiled
  artifacts and runtime are unchanged.

### Verification

| Command / check | Result |
| --- | --- |
| Baseline before edits | lint, typecheck, 295 tests passed |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 232 files |
| `pnpm typecheck` | Passed |
| `pnpm test` | 302 tests passed across 41 suites (1 new Z3 core test, 5 explanation tests, 1 CLI why-not test) |
| CLI binary | `reason why-not clients.created fixtures/next-demo --context role=unlisted` answers in about 220 ms |
| `git diff --check` | Passed |

Explanation precision on the fixture:

| Question | Minimal explanation | Source trace |
| --- | --- | --- |
| Viewer creates a client (hand model) | role = viewer; `clients.submit_create` requires role = editor; initially no client | `symbol:lib/session.ts#requireEditor`, `permission:role:editor` |
| Unlisted role creates a client (extracted model) | role = unlisted; `clients.create.submit` requires role = editor; initially not created | `symbol:lib/session.ts#requireEditor`, `symbol:app/api/clients/route.ts#POST`, `api:POST:/api/clients` |
| Editor with the flag off changes a plan structure (extracted model) | flag = false; both `confirm` and `submit` require `plan_structure_enabled`; initially not changed | `flag:planStructure`, the PATCH handler |

Provenance check: over 40 seeded random models (more than 30 unreachable
queries), keeping only the explained constraints still makes the goal
unreachable under explicit-state search, and every explanation is minimal.

### Scope notes and limitations

- Explanations are minimal for the k-induction certificate at the proof depth.
  MUS/MCS enumeration and "minimal change that enables it" are R5.
- Evidence per constraint is the action's evidence plus that of its context
  variables; the conjunct is not mapped to a single source line. The extracted
  model's guard evidence covers every guard on the API handler.
- Next recommended phase: R11 — Commit semantic reasoning.

---

## Phase R11 — Commit semantic reasoning

Complete — verified locally on 2026-10-23.

- **`ProductReasoner.compareModels(before, after, options)`** checks every goal
  in both models under every enumerable context: booleans, and enums as the
  union of both models' values. A value one model lacks maps to its
  `otherValue` (default `unlisted`). At most 64 combinations are checked per
  goal.
  - **New reachability** comes with the witness.
  - **Lost reachability** comes with the R4 explanation on the after model,
    its **root cause** (the explanation constraints the before model does not
    contain) and any goal-setting actions that disappeared.
  - The comparison also reports changed applicability, a structural model diff
    that ignores evidence, invariant changes (checked in R8) and uncertainty
    for unknown answers.
- **New `@pathcompiler/semantic-change`.** `analyzeSemanticChange({ delta,
  base, head }, solver)` extracts both commits' models (R1) and compares them.
  It traces root causes to changed files (`changedAt`) and groups findings per
  goal into `affectedWorkflows`, collapsing context lists to the variables
  that matter. `summarizeSemanticChange` renders the §42 "Product Logic"
  format.
- **Impact analysis (opt-in).** `analyzeWorkflowImpact(delta, approved,
  { semantic })` adds the reasons `reachability-removed` (high),
  `reachability-added` (medium) and `applicability-changed` (medium) to the
  workflows of the affected capability, including variants. The report's
  method becomes `deterministic-rules+bounded-smt`.
- **CLI.** Added `pathcompiler reason diff <base> <head> [directory]`, which
  writes `reports/semantic-change.json`. `impact` and `proposals generate`
  accept `--reasoning`.
- **GitHub App.** The config's `"reasoning": true` adds a "Product logic"
  section to the check. The solver is injected, so `github-app` does not
  import Z3, and the deterministic summary is unchanged.
- Recorded in ADR 0040 and documented in the README. Default behavior is
  unchanged: reasoning is opt-in everywhere.

### Verification

| Command / check | Result |
| --- | --- |
| Baseline before edits | lint, typecheck, 302 tests passed |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 236 files |
| `pnpm typecheck` | Passed, including the new package |
| `pnpm test` | 309 tests passed across 42 suites (4 semantic-change, 1 impact, 1 GitHub check section, 1 CLI end to end) |
| `git diff --check` | Passed |

Reasoning-MVP steps 6–10 (§94) on the fixture. In a temporary repository, a
commit changes `requireEditor` from `editor` to `owner`:

- `reason diff` reports, among others: "clients.created is no longer reachable
  for role=editor: clients.create.submit requires role = owner (changed in
  lib/session.ts)" and "clients.created is newly reachable for role=owner".
- True-change recall: all five editor-guarded capabilities (`clients.create`,
  `clients.edit`, `clients.deactivate`, `plans.create`,
  `plans.change_structure`) lose reachability for editors. Each root cause is
  traced to `symbol:lib/session.ts#requireEditor` and `lib/session.ts`, at the
  head commit.
- `proposals generate --reasoning` writes the `clients.create` proposal with a
  high-severity `reachability-removed` reason.
- False-positive rate: a copy-only commit ("Create Client" → "Add Client")
  produces no semantic findings.

### Scope notes and limitations

- Conclusions hold in the extracted models. Each report carries both models'
  transition coverage and uncertainty counts.
- Invariants are diffed structurally only; checking them is R8.
- Reasoning is opt-in until C2 adds project-level configuration. A comparison
  costs two extractions plus about 6 queries per goal: about 10 s for the
  fixture.
- Next recommended phase: R8 — Bounded model checking.

---

## Phase R8 — Bounded model checking

Complete — verified locally on 2026-10-23.

- **`ProductPropertySchema`** is a safety-property language with four kinds:
  `never` (a goal or condition), `always` (a condition), `invariant` (a
  reference to a declared invariant) and `via` (every path to a goal performs
  one of the listed actions). Each property has an ID, a description and an
  optional fixed context. `propertiesFromInvariants` lifts every declared
  invariant into a property.
- **`ProductReasoner.verifyProperty(model, property)`** reduces every kind to
  reachability of a type-checked synthetic target on a copy of the model; for
  `via`, the copy has the listed actions removed.
  - **holds** comes with a k-induction proof. A `via` property that holds only
    because the goal is unreachable is marked `vacuous`.
  - **violated** comes with a canonical shortest counterexample.
  - **unknown** keeps its reason.
- **`pathcompiler reason verify [directory]`** checks the invariants plus any
  `--property` file, with `--context` defaults. It writes
  `reports/reasoning/verification.json` and exits nonzero on a violation, also
  with `--json`. For extracted models it notes that a violation may be an
  extraction error.
- Recorded in ADR 0041 and documented in the README. No runtime change.

### Verification

| Command / check | Result |
| --- | --- |
| Baseline before edits | lint, typecheck, 309 tests passed |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 237 files |
| `pnpm typecheck` | Passed |
| `pnpm test` | 315 tests passed across 43 suites (5 verification, 1 CLI verify) |
| CLI binary | `reason verify fixtures/next-demo`: 6 of 6 extracted invariants hold, exit 0 |
| `git diff --check` | Passed |

Acceptance on the fixture:

| Model | Property | Result |
| --- | --- | --- |
| Hand model | 3 declared invariants, including `security.viewer_cannot_edit` | Hold |
| Hand model | Never `clients.created` (role viewer) | Holds |
| Hand model | Always confirmation implies the structure dialog | Holds |
| Hand model | `plans.structure_changed` via save or confirm | Holds, not vacuous |
| Hand model | `plans.structure_changed` via confirm only | Violated; the counterexample ends in `plans.save_structure` |
| Hand model | `clients.created` via submit (role viewer) | Holds, vacuous |
| Extracted model | 6 structural invariants, and never `clients.created` (role unlisted) | Hold |
| Extracted model, seeded bug (`requireEditor` removed from POST `/api/clients`) | Never `clients.created` (role unlisted) | Violated: `navigate.nav_clients → clients.create.open → enter_email → enter_name → submit` |

Malformed properties (an empty `never`, an unknown goal, an unknown action, an
ill-typed condition) are rejected with actionable errors.

### Deviations and limitations

- The roadmap lists C7 (seeded-violation fixtures) as a prerequisite. The
  acceptance bug is seeded in a temporary fixture copy inside the test; C7 will
  turn such cases into shared fixtures.
- Only safety properties are covered. Liveness ("eventually") needs lasso or
  fairness reasoning and is deferred until required.
- Next recommended phase: I3 — Candidate Evaluation, mode 5.

---

## Phase I3 — Candidate Evaluation (mode 5)

Complete — verified locally on 2026-10-23.

- Added `@pathcompiler/candidate-evaluator`. `evaluateCandidate({ delta, base,
  head }, solver, { criteria?, approved?, tests? })` returns a
  `CandidateEvaluation` that answers handoff §18 A–D:
  - **Intended change.** R11's reachability changes, one per goal and context,
    are compared with `criteria.expectedChanges`. Omitted means no declared
    intent: changes become a review warning. `[]` means none intended. When
    intent is declared, unexpected changes and unmet expectations are risks.
  - **Protected behavior.** The invariants of both commits plus
    `criteria.protectedProperties` are checked on base and candidate (R8). A
    violated or unverifiable protected property is a risk, a new violation of
    any other property is a regression risk, and a violation already present at
    base is a warning.
  - **Unexpected workflow change.** Impact analysis runs with the semantic
    findings. Medium or high impact is a warning unless declared, expected
    changes explain it.
  - **Does it work.** Test coverage per capability, base vs. candidate:
    decreased coverage and untested affected capabilities are warnings.
    Ingested Playwright JSON or `{ tests }` results are mapped to capabilities,
    and any failure is a risk.

  The decision is `fail` on any risk, then `inconclusive` on an unknown
  answer, then `pass_with_warnings`, then `pass`. The next step is `reject`,
  `revise_candidate`, `experiment` or `human_review`, and
  `eligibleForExperiment` is set only for a `pass` with declared expectations.
  A mutation's claimed outcome is recorded and checked, never trusted. Evidence
  gaps (browser verification in I4, missing test results) are listed.
- `analyzeSemanticChange` accepts prebuilt models, so each commit is extracted
  only once.
- Added `pathcompiler evaluate <base> <candidate> [directory] [--criteria]
  [--tests]`, which writes `reports/evaluation/<candidate>.json` and exits
  nonzero on `fail`.
- Recorded in ADR 0042 and documented in the README. No runtime change.

### Verification

| Command / check | Result |
| --- | --- |
| Baseline before edits | lint, typecheck, 315 tests passed |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 241 files |
| `pnpm typecheck` | Passed, including the new package |
| `pnpm test` | 322 tests passed across 44 suites (6 evaluator, 1 CLI end to end) |
| `git diff --check` | Passed |

Acceptance on the fixture:

| Candidate | Criteria | Result |
| --- | --- | --- |
| Human PR: copy-only rename | None | `pass` → `human_review`; invariants hold; no observed changes |
| Human PR: `requireEditor` checks `owner` | None | `pass_with_warnings` (18 observed changes) → `human_review` |
| Same change | Exactly those expectations (`rec_owner_only`) | `pass`, eligible for an experiment → `experiment` |
| §254: rename that also drops `requireEditor` from PATCH `/api/clients/:id`; mutation claims success | `expectedChanges: []`, protected "viewer never deactivates a client" | `fail` → `reject`; an unexpected-reachability risk and a protected-property counterexample ending in `clients.deactivate.confirm`; the claim is marked contradicted |
| Copy-only rename with a failed Playwright test | None | `fail` → `revise_candidate`; the failure maps to `clients.create` and the other capabilities that test covers |

### Deviations and limitations

- The GitHub check section and dashboard view listed for I3 are deferred. They
  need C2 (configuration) and dashboard support for stored evaluations; the
  report artifact and CLI deliver mode 5 now.
- Only reachability changes are matched against expectations. Cost or path
  expectations ("minimum workflow cost 6 → 5") need R7.
- Browser verification is I4, which also needs C8.
- Next recommended phase: C1 — Runtime contract alignment.

---

## Phase C1 — Runtime contract alignment

Complete — verified locally on 2026-10-23.

- **Workflow versions.** `approval.version` is a monotonic integer per
  workflow ID: `approveCandidate` writes 1, and `acceptProposal` writes the
  current version + 1. `acceptProposal` now takes the current approved record
  and refuses a stale one (`approved-changed`); the CLI supplies it. Records
  approved before versioning count as 1 (`approvalVersion`).
- **Compiler 1.1.0.** Search records and runtime workflows carry `version`.
  Search records also carry plain-text `steps` and `capabilities`, and
  `supportedActions` moved to the browser-safe compiler schema (the resolver
  re-exports it). Artifacts built by 1.0.0 must be rebuilt.
- **Runtime Result v1** (spec §63–65): `workflow_help` (`workflowId`,
  `workflowVersion`, `revision`, `confidence`, `content.title/summary/steps`,
  `entrypoint.route`, `capabilities`, `matched`), `ambiguous.candidates[]`
  and the spec's `unsupported` reasons. `workflow_not_verified` is reserved
  and not produced yet.
- **`RuntimeContextSchema`** (spec §75) accepts `locale`, `tenant` and
  `productRelease`. These pass through and do not affect resolution.
  `ResolveContext` remains as a deprecated alias.
- **Guide `manifest-mismatch`** (spec §68): `GuideRuntime.start(workflow,
  { revision, version })` fails when the manifest differs from the resolved
  result. React's `start(id, expected)` and the UI card pass these values. The
  UI card renders `content.steps` directly and shows "Show me" only when
  guiding is supported.
- **Other consumers.** SDK `search` returns `{workflowId, workflowVersion,
  title}`. The assistant tool description and schemas follow v1 (with
  `locale`). The examples, the reference demo browser test and the dashboard
  e2e test now use the v1 shapes and the compiler-version constant.
- Recorded in ADR 0043, including a migration table, and documented in the
  README. Added [ISSUES_LOG.md](ISSUES_LOG.md) to track errors, bugs and
  deferred items.

### Verification

| Command / check | Result |
| --- | --- |
| Baseline before edits | lint, typecheck, 322 tests passed |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 241 files |
| `pnpm typecheck` | Passed, including examples and browser tests |
| `pnpm test` | 323 tests passed across 44 suites. Fixtures and expectations were updated to v1; new tests cover the version lineage, the full `RuntimeContext` and manifest mismatch |
| `pnpm test:e2e` | 27 Chromium tests passed: next-demo 7, validator 6, runtime-core 3, dashboard 7, reference demo 4 |
| Resolver paraphrase evaluation | Unchanged: target met, with no wrong-workflow answers |
| `git diff --check` | Passed |

### Errors found during the phase

- The dashboard e2e test hardcoded compiler version `1.0.0`. It now reads
  `COMPILER_VERSION`, so future bumps don't break it.
- The auto-mode safety classifier returned no verdict for several tool calls
  and paused the phase midway (ISSUES_LOG #9). No code impact; the phase
  resumed from the same state.

### Scope notes and limitations

- Breaking for pre-C1 consumers; see the migration table in ADR 0043.
- `locale`, `tenant` and `productRelease` are accepted but not yet used to
  select workflows.
- Next recommended phase: O0 — Event Model.

---

## Phase O0 — Event Model

Complete — verified locally on 2026-10-23.

- Added `@pathcompiler/observability-core` (browser-safe, no transport). It
  defines eight semantic event types as the union `ProductRuntimeEvent`:
  `workflow.started`, `workflow.step_reached`, `workflow.completed`,
  `workflow.abandoned`, `semantic_target.activated`, `goal.reached`,
  `route.changed` and `action.blocked`. Workflow events require `workflowId`
  and `workflowVersion`.
- `RuntimeEventBase` holds the schema version, event ID and time, project,
  release, session, optional workflow, semantic target, route, role, locale and
  a bounded context, plus privacy metadata.
- **Privacy in the schema.** Strict objects reject raw values, DOM and
  coordinates. Semantic targets must be semantic IDs, and routes may not carry
  query strings or fragments.
- **Privacy in `validateEvent(event, policy)`.** The default policy has
  analytics off, no PII, hashed user IDs and no context keys. Context keys must
  be allowlisted, and keys containing sensitive words are refused even if
  allowlisted. PII needs `collectPii`. `hashUserId` produces salted SHA-256
  pseudonyms via Web Crypto.
- `serializeEvent` writes canonical JSON and `parseEvents` reads
  newline-delimited events. `createEventFactory` binds project, session and
  release, with an injectable clock and ID generator.
- Recorded in ADR 0044. No runtime change.

### Verification

| Command / check | Result |
| --- | --- |
| Baseline before edits | lint, typecheck, 323 tests passed |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings; 245 files |
| `pnpm typecheck` | Passed, including the new package and its tests |
| `pnpm test` | 328 tests passed across 45 suites (5 new) |
| `git diff --check` | Passed |

Tests cover:
- every event type, and required workflow fields;
- rejection of raw values, coordinates, DOM, query strings and non-semantic
  targets;
- the context allowlist and sensitive-key refusal (a key like `domain` is
  allowed, `userEmail` is refused);
- PII, user-ID hashing (deterministic, salt-dependent, a salt is required);
- canonical serialization and NDJSON round trips;
- release binding in the factory.

### Errors found during the phase

- The sensitive-key check first matched substrings, so `domain` was refused
  because it contains "dom". It now matches whole words.
- The event-schema helper first spread base and type shapes generically, so
  TypeScript typed overridden fields such as `workflowId` as `never`. It now
  uses Zod `extend`. Both are listed in ISSUES_LOG #10 and #11.

### Scope notes

- Explicit domain events (`track("client.created")`) are O4. Batching and
  transports are O1.
- Next recommended phase: O1 — Lightweight Analytics SDK.

---

## Phase O1 — Lightweight Analytics SDK

Complete — verified locally on 2026-10-23.

- Added `@pathcompiler/analytics-sdk`. `createAnalytics({ projectId, release,
  policy, transport, batchSize, flushIntervalMs, maxQueue, onError })`
  provides `track`, lifecycle helpers for all eight event types, `setContext`
  (sticky fields), `flush`, `shutdown` and `stats`.
- It is off unless `policy.enabled`. Then every call is a no-op: no queue, no
  timer and no transport call.
- Each event passes the O0 privacy validation with release binding. A rejected
  event is counted and reported through `onError`, never thrown into the host
  app and never sent.
- **Batching:** full batches are sent at once, and partial ones after the
  interval. One send runs at a time. A failed batch is kept and retried on the
  next flush or timer, not in a tight loop. The queue is bounded, and the
  oldest events are dropped and counted.
- **Transports:** `AnalyticsTransport`, `InMemoryTransport` (the default) and
  `ConsoleTransport` (canonical JSON lines). Nothing touches the network.
- `observability-core` now exports `EventInput`.
- Recorded in ADR 0045 and documented in the README. Opt-in only.

### Verification

| Command / check | Result |
| --- | --- |
| Baseline before edits | lint, typecheck, 328 tests passed |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 333 tests passed across 46 suites (5 new) |
| `git diff --check` | Passed |

Tests cover: disabled-by-default no-ops; batching by size and by timer;
release, sticky-context and override rules; privacy rejections reported
without throwing (and accepted once allowlisted); send failures kept and
retried, with the queue bound and drop counts; console output in canonical
form; shutdown flushing and then ignoring calls.

### Errors found during the phase

- First draft: after one failed send, the full-batch re-flush condition read a
  global failure counter, which would have disabled automatic flushing
  permanently. It now depends on whether that send was delivered. Fixed before
  the tests ran; logged as ISSUES_LOG #12.

### Scope notes

- No network transport (O5 adds ingestion), and no React wiring (O2).
- Next recommended phase: O2 — React integration.

---

## Phase O2 — React integration

Complete — verified locally on 2026-10-23.

- `PathCompilerProvider` accepts optional `analytics` and `targetAttribute`
  (default `data-pathcompiler`). No second provider was added (ADR 0032 §7).
- **Routes and context.** The provider keeps the analytics context's route,
  role and locale current, and emits `route.changed` for the first route and
  for each change (with `previousRoute`).
- **Activations.** One capture-phase document listener emits
  `semantic_target.activated` for the closest semantic target: `click`
  (non-field), `input` (committed change), `select` and `submit`. Field and
  form clicks are ignored. It never reads values, text or coordinates.
- `useAnalytics()` returns the instance or `null`.
- `@pathcompiler/react` now depends on `@pathcompiler/analytics-sdk`, for
  types; it does nothing unless an instance is passed.
- Recorded in ADR 0046.

### Verification

| Command / check | Result |
| --- | --- |
| Baseline before edits | lint, typecheck, 333 tests passed |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 335 tests passed across 47 suites (2 new React analytics tests) |
| `pnpm test:e2e` | 27 Chromium tests passed (React provider changed) |
| `git diff --check` | Passed |

Tests check the exact event sequence: initial route, button click through a
child element, committed input change, select change, form submit, plus route
change. They also check that an unannotated element and a field click emit
nothing, that the typed value ("Ada Lovelace") appears in no event, that
role and release are bound, and that nothing happens without analytics.

### Errors found during the phase

- None.

### Scope notes

- Guide lifecycle telemetry is O3, and domain events are O4.
- Next recommended phase: O3 — Workflow runtime telemetry.

---

## Phase O3 — Workflow runtime telemetry

Complete — verified locally on 2026-10-23.

- `GuideState` gains `version`, the manifest's workflow version.
- **`instrumentGuide(guide, analytics)`** (`@pathcompiler/analytics-sdk`, using
  a structural `GuideLike` type, with no `runtime-core` dependency) maps guide
  transitions to `workflow.started` (trigger `guide`),
  `workflow.step_reached` (with the step index), `workflow.completed` (with
  the duration) and `workflow.abandoned` (`stopped`, `timed-out` or
  `failed`, with the last step). Restarting a running guide counts as
  abandoning the first run and starting a new one. A guide that fails before
  starting emits nothing.
- `PathCompilerProvider` instruments its runtime automatically when
  `analytics` is set.
- Recorded in ADR 0047.

### Verification

| Command / check | Result |
| --- | --- |
| Baseline before edits | lint, typecheck, 335 tests passed |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 339 tests passed across 47 suites (2 telemetry unit tests, 1 React lifecycle test, 1 runtime regression test) |
| `pnpm test:e2e` | 27 Chromium tests passed |
| `git diff --check` | Passed |

### Errors found during the phase

- **Bug, fixed (ISSUES_LOG #13):** a workflow whose terminal condition was
  `explicit_next` could never complete. After the last step, `next()` was
  ignored in `awaiting-completion`, which trapped the user until `stop`. Found
  by the React lifecycle test. `next()` now completes such runs, with a
  regression test.

### Scope notes

- Abandonment by navigating away is not distinguished yet (logged as
  ISSUES_LOG #14).
- Next recommended phase: O4 — Domain events.

---

## Phase O4 — Domain events

Complete — verified locally on 2026-10-23.

- `observability-core` gains `domain.event` (`name`: a semantic ID, with no
  payload), added to the union under schema version 1.
- `analytics.domainEvent(name)`, plus optional `goals` (Formal Product Model
  goal IDs) and `domainEvents` allowlists. Names outside a set list are
  rejected and reported through `onError`. Without the lists, the semantic-ID
  schema still applies.
- Recorded in ADR 0048.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 340 tests passed across 47 suites (1 new SDK test; core event-type coverage extended) |
| `git diff --check` | Passed |

### Errors found during the phase

- None. Behavior note: with an allowlist set, a non-semantic name is reported
  as an unknown domain event rather than as a schema error.

### Scope notes

- Reconciling domain events with goals is O8.
- Next recommended phase: O5 — Event ingestion.

---

## Phase O5 — Event ingestion

Complete — verified locally on 2026-10-23.

- **`POST /v1/events/batch`** in `http-service`, off unless `events` is
  configured (`404 ingestion-disabled`).
  - Each event passes `validateEvent` with the configured privacy policy.
    Events are rejected individually: the response is `{ accepted,
    rejected: [{ index, issues }] }`, and rejected events are never stored.
  - Project isolation: events for a project other than the served one are
    rejected.
  - Limits: `maxBatch` (default 500, otherwise 413) and a fixed-window rate
    limit per project (default 10 000 per minute, otherwise 429 with
    `retry-after`).
  - An optional ingest-only token is valid on this endpoint only.
- **Sinks:** `EventSink`, `InMemoryEventSink`, and `createFileEventSink`
  (canonical NDJSON under `<dir>/<project>/<UTC day>.ndjson`).
- **SDK:** `FetchTransport` posts batches. 429 and 5xx responses are retried;
  rejections are reported through `onRejected` and not retried. `keepalive` is
  supported.
- **CLI:** `pathcompiler serve --events` stores events under `<out>/events`,
  with `PATHCOMPILER_INGEST_TOKEN` as the optional ingest token.
- Recorded in ADR 0049.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 345 tests passed across 48 suites (5 ingestion tests, including SDK → server end to end; CLI `serve --events` round trip) |
| `pnpm test:e2e` | 27 Chromium tests passed |
| `git diff --check` | Passed |

### Errors found during the phase

- The CLI test first posted events for `next-demo`, but `serve` names the
  project after the output directory's parent, so the events were (correctly)
  refused. The test now uses the served project ID. No product bug.
- **Limitation (ISSUES_LOG #15):** the service sends no CORS headers, so a
  browser on another origin cannot post events directly. Same-origin proxies
  work today.

### Scope notes

- Hosted multi-tenant ingestion, a database sink and analytics-vendor adapters
  are deferred.
- Next recommended phase: O6 — Observed Transition Graph.

---

## Phase O6 — Observed Transition Graph

Complete — verified locally on 2026-10-23.

- Added `@pathcompiler/observed-graph`, which depends only on
  `observability-core` and never on the formal model (spec §131).
- **States:** routes, `target:<id>:<interaction>`, workflow steps and
  outcomes (per version), goals, domain events, blocked actions, and session
  start and end.
- **Session paths:** events are ordered by timestamp, then event ID. A
  repeated state is not a transition.
- **Edges:** count, sessions, frequency among the source state's outgoing
  edges, median time, counts by role and release, and `sufficient` (at least
  `minSessions` sessions, default 30). Nodes carry entry counts; top session
  paths are listed.
- **Filters:** project, release, role, workflow ID and version.
- `readEventDirectory` reads the O5 NDJSON files. `pathcompiler observe graph
  [--release]` writes `reports/observed-graph.json` for the served project.
- Recorded in ADR 0050. No runtime change.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 348 tests passed across 49 suites (3 new graph tests; CLI serve → ingest → observe round trip) |
| `git diff --check` | Passed |

Tests check:
- exact counts, frequencies (2/3 vs. 1/3 from the Clients page), medians
  (1000 ms; 1500 ms with a repeated click), role and release segments, and
  sufficiency;
- the top path;
- independence from input order;
- release and workflow filters;
- lifecycle states per version;
- NDJSON directory reading, where missing directories and non-NDJSON files
  are ignored.

### Errors found during the phase

- None.

### Scope notes

- A repeated state is measured from its first entry; an uninstrumented page
  appears as a direct transition (an instrumentation gap, not impossibility).
- Next recommended phase: O7 — Workflow analytics (O8 in parallel).

---

## Phase O7 — Workflow analytics

Complete — verified locally on 2026-10-23.

- Added `computeWorkflowAnalytics` to `@pathcompiler/observed-graph`. It
  reconstructs guide runs per session and workflow version. Restarts and
  session ends close open runs as **unfinished**, never as abandoned.
- **Per version:** starts by trigger, completions, abandonments by reason,
  unfinished runs, completion rate, median and p95 duration (nearest rank),
  the median number of actions per completed run, a step funnel, and role and
  release segments.
- **Thresholds:** rates are `null` below `minRuns` (default 30), and segments
  under `minSegmentSize` starts (default 5) are merged into `(suppressed)`.
- `pathcompiler observe workflows [--release]` writes
  `reports/workflow-analytics.json`.
- Recorded in ADR 0051.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 351 tests passed across 50 suites (3 new analytics tests; CLI round trip extended) |
| `git diff --check` | Passed |

Tests check the exact counts on five sessions (3 completed, 1 abandoned,
1 unfinished), the completion rate, median and p95 duration (including a run
without a reported duration), actions per run, the step funnel, segment
suppression, withheld rates under the default threshold, release filtering,
and restart handling.

### Errors found during the phase

- One lint error in a test helper (an assignment inside an expression). Fixed.
- A CLI edit script did not apply because Biome had reformatted the target
  text. It was rerun against the current text; no product impact.

### Scope notes

- Plan-tier and feature-flag segments need allowlisted context keys.
- Next recommended phase: O8 — Possible-vs-Observed Reconciliation.

---

## Phase O8 — Possible-vs-Observed Reconciliation

Complete — verified locally on 2026-10-23.

- Added `@pathcompiler/behavior-reconciliation`.
  `reconcileBehavior(model, events, solver)` works per observed role. Unknown
  roles map to `unlisted` when the model has it; otherwise the role stays free.
  - **Goals:** R2 reachability, with R4 reasons, against `goal.reached`
    sessions.
  - **Targets:** whether any action on the target can be enabled (an R8
    reachability check), against activation sessions.
- **Classes:** possible+observed, possible+unobserved (only with at least 30
  sessions for the role; otherwise insufficient data), observed but formally
  unexpected, impossible+unobserved, and unknown.
- **Discrepancies:** `unexpected_observed` is high priority, with the model's
  reasons and candidate causes, and is never labeled a bug.
  `unobserved_reachable` is low priority, with a witness and candidate
  explanations.
- `pathcompiler observe reconcile [directory] [--model]` writes
  `reports/reconciliation.json`.
- Recorded in ADR 0052.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 354 tests passed across 51 suites (3 reconciliation tests; CLI round trip extended) |
| `git diff --check` | Passed |

Fixture (hand model) with 31 editor sessions, 1 viewer and 1 unknown `admin`
role:

- **Editors:** `clients.created` is possible+observed. `plans.structure_changed`
  is possible+unobserved, with a witness ending in `plans.save_structure`.
- **Viewers:** reaching `clients.created` and activating `clients.create`
  are both **observed but formally unexpected**. The reason given is "Context
  fixes role = viewer. clients.submit_create requires role = editor.", with
  candidate causes and no bug label.
- **`admin`:** the role stays free, so the result is "insufficient data", not
  "unexpected".

### Errors found during the phase

- One wrong expectation in a test: I assumed the unknown `admin` role was
  blocked, but a free role makes the behavior possible. The code was right;
  the test was fixed.

### Scope notes

- Reconciliation works at the goal and target level, not edge by edge (see
  ADR 0052). Model repair from contradictions (§148) stays a human,
  proposal-based action.
- Next recommended phase: C2 — Configuration and feature flags.

---

## Phase C2 — Configuration and feature flags

Complete — verified locally on 2026-10-23.

- Added `@pathcompiler/config`: a strict `pathcompiler.yaml` schema covering
  modes, reasoning and probabilistic flags, analytics privacy, the model
  provider (keys only from the environment) and `improvement_policy`
  (`autonomous_mutation: false`). Its API: `loadConfig` (`null` without a
  file), `parseConfig` (issues by key path), `featureFlags`,
  `reasoningEnabled`, `analyticsPolicy`, `defaultConfigYaml`.
- **Safety rules:** text that looks like a key is rejected,
  `max_autonomous_mutations` must be 0 while autonomous mutation is off, and
  `source_upload` can only be `false`.
- **CLI.** The file in the working directory gates capabilities: `reason *`
  needs `reasoning.enabled` plus its flag, `observe` needs `modes.observe`
  (`reconcile` also needs reachability), and `evaluate` needs
  `modes.evaluate`. `reasoning.impact` turns on `--reasoning` (an explicit
  `--reasoning` is refused when it is off), and `analytics.ingest` turns on
  `serve` ingestion with the configured privacy policy. Without the file,
  nothing changes.
- **New commands:** `init`, `config show [--json]`, `graph inspect` and
  `capabilities list`.
- Recorded in ADR 0053.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 362 tests passed across 53 suites (5 config schema tests, 3 CLI configuration tests) |
| `pnpm test:e2e` | 27 Chromium tests passed |
| `git diff --check` | Passed |

CLI output was compared with and without the file: `reason reachable` produces
identical output without a file and with reasoning enabled in the file, and is
refused with an actionable message when the file disables it. The CLI tests
also cover gating for `observe` and `--reasoning`, `init` (written once, then
refused), `config show` (text and JSON), an invalid key reported by path,
`graph inspect` (text and JSON) and `capabilities list` on the fixture.

### Errors found during the phase

- Putting `init` first in the help text broke an existing help test, which
  expects `Usage: pathcompiler scan`. `scan` is the first usage line again.
- Doc-update and CLI edit scripts twice failed to match text that had been
  reformatted, and were rerun. The STATUS summary rows had accumulated
  duplicates over earlier phases and were rewritten cleanly.
- **Open (ISSUES_LOG #16):** the GitHub App's JSON config is not derived from
  each repository's `pathcompiler.yaml`.

### Scope notes

- Spec §44 fields that nothing reads yet (analysis include globs, sources,
  runtime modes, auto-propose) are left out until a phase uses them.
- C3 followed.

---

## Phase C3 — Evaluation harness and golden tests

Complete — verified locally on 2026-10-23.

- **Ground truth** in `fixtures/next-demo/eval/` (spec §54):
  - `capabilities.json`: 5 capabilities;
  - `workflows/*.yaml`: 5 reviewed workflows with entrypoint, steps and
    terminal;
  - `impact-cases/*.json`: a target rename and a copy change;
  - `queries.json`: the resolver set, moved from `packages/resolver/eval/`.
- **New `@pathcompiler/evaluation`.** It provides `loadGroundTruth` (strict
  schemas, errors with file and key) and one report per metric family:
  capabilities, workflow discovery, resolver and impact. The discovery
  report takes an alternative `DiscoveryFunction` for comparisons
  (spec §117). Impact cases run on temporary Git copies of the fixture with
  every candidate approved at the base.
- **CLI:** `pathcompiler eval
  capabilities|workflow-discovery|resolver|impact [directory]` prints the
  metrics and misses, and writes `reports/eval/<family>.json` (`--json`).
- **Golden files** (spec §55, readable JSON and text): the graph summary, the
  candidate summary, the runtime manifest (revisions redacted), the four
  reports and the CLI text. Biome ignores `test/golden`.
- Recorded in ADR 0054.

### Baseline metrics on the fixture

| Family | Result |
| --- | --- |
| Capabilities | Precision 1, recall 1 |
| Workflow discovery | Precision 1, recall 0.6. Entrypoints 1, major steps 1, terminals 0.667, 0 invented steps |
| Resolver | Top-1 0.85, ambiguity 1, unsupported 1, controls pass |
| Impact | Affected recall 1, false-positive rate 0.25, severity accuracy 1 |

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 371 tests passed across 55 suites (7 evaluation tests, 2 CLI eval tests), with the fixture committed |
| `git diff --check` | Passed |

Reports are deterministic: the tests compute them twice and compare them with
the goldens. A mutated discovery strategy (a dropped step, swapped fields and
an invented step) scores lower than the baseline. No runtime or browser code
changed, so the e2e suite was not rerun.

### Errors found during the phase

- Biome reformatted the generated golden JSON, so the snapshots no longer
  matched what the tests write. `test/golden` is now excluded from Biome.
- The graph summary test read `nodes` from a `ProductGraph` instance; it now
  uses `toJSON()`.
- **Open (ISSUES_LOG #19):** six CLI tests and the custom-assistant example
  failed with `dirty-repository` while the new fixture ground-truth files
  were uncommitted. They pass once the files are committed.
- **Open (ISSUES_LOG #17, #18):** found by the harness. Discovery recall is
  0.6: Edit and Deactivate Client are not emitted, and Change Plan
  Structure's terminal is wrong. Impact also reports a `low` file-level false
  positive for Create Plan.

### Scope notes

- The truth records the product as reviewed, not current output, so the gaps
  stay visible. Cases were not tuned to pass.
- `eval` is not gated by `pathcompiler.yaml`: it measures PathCompiler and
  changes no product behavior.
- R-WI followed.

---

## Phase R-WI — Reasoning-assisted workflow discovery

Complete — verified locally on 2026-10-23.

- **New `@pathcompiler/reasoning-discovery`:** `discoverWorkflowsByReasoning`
  takes the formal model, finds the shortest plan per capability goal and
  turns it into a workflow candidate:
  - steps come from the plan's capability actions, and navigation becomes the
    route entrypoint;
  - roles come from reachability per role, and flag preconditions from
    unreachability with the flag off;
  - terminals come from test assertions after the planned path, or
    `explicit_next` with a `terminal-not-derived` ambiguity.

  Inconclusive planning is reported as `skipped`, never as impossible.
- **`@pathcompiler/evaluation`** gains:
  - `DiscoveryStrategy`, `baselineStrategy`, `reasoningStrategy` and
    `compareDiscoveryStrategies`;
  - an async `evaluateWorkflowDiscovery`;
  - invented-step rate, applicability accuracy (new `roles`/`flags` in the
    ground truth) and step edit distance.
- **CLI:** `pathcompiler eval workflow-discovery --compare`, gated by
  `reasoning.planning` when `pathcompiler.yaml` exists.
- The baseline stays the default discovery. Reasoning candidates are not
  written to the review queue.
- Recorded in ADR 0055.

### Comparison on the fixture

| Metric | Baseline | Reasoning |
| --- | --- | --- |
| Precision / recall | 1 / 0.6 | 1 / 1 |
| Major-step score (found) | 1 | 0.867 |
| Terminal accuracy (found) | 0.667 | 0.4 |
| Invented steps | 0 | 0 |
| Applicability accuracy | 0 | 1 |
| Mean edit distance (all reviewed) | 1 | 0.4 |

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 377 tests passed across 56 suites (4 reasoning-discovery tests, a reasoning comparison test, a CLI `--compare` test) |
| `git diff --check` | Passed |

The tests cover:
- candidates for all five capabilities, with evidence on every step;
- navigation becoming the entrypoint;
- roles and the `planStructure` precondition;
- derived and not-derived terminals;
- determinism (two runs compared);
- `maxDepth: 1` reported as inconclusive skips;
- the golden comparison report;
- the CLI `--compare` output and its configuration gate.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- The first terminal search stopped at the first activation of the last
  target. Fixture tests submit invalid input first and see a validation
  alert, so Create Plan's terminal was missed. The search now tries every
  activation before the path restarts.
- The mean edit distance first averaged only found workflows, which
  flattered the baseline. It now covers every reviewed workflow.
- A check chain piped `pnpm lint` and `pnpm typecheck` through `tail`, which
  hid their exit codes: a local commit was made with a lockfile formatting
  error and a test tuple type error. Both were fixed and the commit amended
  before pushing. Check chains now use `set -o pipefail`.
- **Open (ISSUES_LOG #20, #21):** reasoning terminals and prefilled-form
  steps, and the baseline omitting roles.

### Scope notes

- The strategy lives in a new package, not in `workflow-discovery` as the
  roadmap suggested, to keep baseline discovery solver-free and avoid a
  package cycle (ADR 0055).
- P0 followed.

---

## Phase P0 — Probabilistic Evidence Model

Complete — verified locally on 2026-10-23.

- **New `@pathcompiler/probabilistic-evidence`:**
  - `EvidenceClaim` (existence, behavior, naming or permission; binary or
    categorical) and `EvidenceItem` (class, stance or value, `current`,
    reference);
  - `fuseEvidence`, which returns a `ConfidenceAssessment` with status,
    canonical value, band, a rule-strength score, a separate probability,
    the deciding tier, conflicts and rationale;
  - `calibrate` and `graphEvidenceItems`.
- **Reliability.** Ten evidence classes, each with a tier per claim type.
  Fusion takes the strongest tier and counts each class once; it never
  averages. Conflicts are first-class objects: likely stale artifact,
  unsupported hypothesis, unexplained contradiction (caps the band at
  medium), or unresolved.
- **Probability.** It is reported only from a calibration table with enough
  labeled samples for the band, and is otherwise `null` with the reason.
- Recorded in ADR 0056.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 384 tests passed across 57 suites (7 evidence-fusion tests) |
| `git diff --check` | Passed |

The tests cover:
- the spec's deactivate-vs-archive example on the fixture's graph evidence,
  plus a PR and old docs: canonical `clients.deactivate`, high, with a
  stale-artifact conflict;
- no averaging: twenty model items do not outvote a test, and twenty docs
  items do not outvote a contradicting test;
- one class counted once;
- contested, unexplained and non-current contradictions;
- claim-type-dependent reliability;
- calibration thresholds;
- order independence and input validation.

### Errors found during the phase

- A contested categorical claim first listed every item as supporting. The
  split now follows stance for binary claims and value for categorical ones.

### Scope notes

- No CLI surface, and `probabilistic.evidence_fusion` is not read yet. The
  first consumer is P1 or I0.
- No calibration table is built from the fixture: five capabilities are too
  few samples (ADR 0056).
- C5 followed.

---

## Phase C5 — Model provider boundary

Complete — verified locally on 2026-10-23.

- **New `@pathcompiler/model-provider`** (no vendor SDK):
  - `PathCompilerModelProvider`, with infer capabilities, synthesize
    workflow, explain impact, generate aliases and summarize evidence, and
    strict request and response schemas;
  - `NoopModelProvider` (the default) and `FixtureModelProvider` (replay by
    canonical request key; fails rather than guesses);
  - `guardModelProvider`, which redacts and validates requests, records a
    `ModelContextEntry` and validates responses against their schema and
    citable evidence;
  - `semanticModelFromProvider`, `redactSecrets` and `redactValue`.
- **CLI:** `pathcompiler scan <directory> --explain-model-context [--json]`
  writes the exact redacted `inferCapabilities` payload and its description
  to `reports/model-context.json`. Nothing is sent.
- Recorded in ADR 0057.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 393 tests passed across 59 suites (7 model-provider tests, 2 CLI dry-run tests) |
| `git diff --check` | Passed |

The tests cover:
- no-op determinism;
- fixture replay and a missing fixture;
- redaction before the provider sees a request, and the recorded context;
- forged citations, unknown reason codes and invalid shapes rejected as
  `invalid-response`;
- `SemanticModel` routing;
- the secret patterns, with ordinary text left alone;
- a contract that no package depends on a vendor SDK;
- the CLI dry run on the fixture (payload size matches, no source text), a
  planted `.env` that is never read, and a secret in a UI label that is
  redacted.

### Errors found during the phase

- A GitHub token in an assignment was counted twice: the assignment pattern
  matched the `[REDACTED]` placeholder. The pattern now skips redacted
  values.
- `scan --explain-model-context --json` was refused by the CLI's general
  `--json` check, which ran before the scan branch. The dry run is now routed
  first.
- Test stubs spread a class instance, which drops its prototype methods; the
  typecheck caught it. They now use an explicit stub helper.

### Scope notes

- No vendor adapter (C9). Nothing calls a model unless a caller passes a
  provider.
- C7 followed.

---

## Phase C7 — Reasoning and harness fixture enrichment

Complete — verified locally on 2026-10-24.

- **Fixture app (`fixtures/next-demo`):**
  - an `admin` role that keeps editor rights;
  - an admin-only Archive Plan behind a second flag, `planArchive` (off by
    default);
  - an alternative Deactivate Client path from the Edit Client dialog;
  - demo controls for the new role and flag;
  - two new Playwright tests (alternative path; archive permissions and
    flag). Ground truth adds `plans.archive`, and roles are now
    `[admin, editor]`.
- **Pipeline fixes the enrichment exposed (ADR 0058):**
  - capability API association prefers action sub-resource endpoints;
  - formal abstraction models one-click (direct) actions, gives alternative
    entries distinct IDs, and requires the observed host dialog for in-dialog
    entries;
  - the resolver separates deactivate/archive from delete.
- **`fixtures/reasoning/`.** There are 15 reviewed cases across the seven
  spec §88 categories, including seeded bugs (missing editor and admin
  checks, a removed flag check, a renamed role). `loadReasoningCases` and
  `evaluateReasoningCases` in `@pathcompiler/evaluation` run them, and so
  does `pathcompiler eval reasoning <cases directory>`. All 15 pass, with
  unknown rate 0.
- **Harness fixtures** are deferred to I2 (ISSUES_LOG #27).

### Metrics after enrichment

| Family | Result |
| --- | --- |
| Capabilities | Precision 1, recall 1 (6 capabilities) |
| Discovery, baseline | Recall 0.833, terminals 0.8, 1 invented step (the in-dialog start of Deactivate), applicability 0, mean edit distance 0.667 |
| Discovery, reasoning | Recall 1, terminals 0.333, no invented steps, applicability 1, mean edit distance 0.333 |
| Resolver | Top-1 0.85, controls pass |
| Impact | Affected recall 1, false-positive rate 0.375, severity accuracy 1 |
| Reasoning cases | 15/15; verdicts 1, plans 1, diffs 1, unknown rate 0 |

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed (including the fixture) |
| `pnpm test` | 397 tests passed across 60 suites (3 reasoning-case tests, a CLI `eval reasoning` test) |
| `pnpm test:e2e` | 29 Chromium tests passed (9 fixture tests, 2 of them new) |
| `git diff --check` | Passed |

### Errors found during the phase

- **Fixture-wide expectation changes.** Many tests hard-coded five
  capabilities, seven traces, 25 actions, the `editor` role and button
  locators. They were updated after reviewing each diff, not bulk-accepted.
- **A spurious capability.** The first label of the in-dialog button,
  "Deactivate Instead", produced `insteads.deactivate`. It was relabeled
  "Deactivate Client", which merges it into the capability as a second
  surface.
- **Real bugs found and fixed** (ISSUES_LOG #24–#26):
  - the archive endpoint was associated with the wrong API;
  - one-click actions were not modeled;
  - duplicate entry action IDs crashed model extraction;
  - an in-dialog entry was modeled without its host dialog, at first
    resolving the host to Create Client because both share a form dialog;
  - "delete a client" resolved to Deactivate Client.
- **Ground-truth controls.** The resolver dataset's "plan" control now
  includes Archive Plan, because the product gained a third plan workflow.
  The impact cases now list the two new workflows as unaffected.
- **Open (ISSUES_LOG #22, #23, #27):** component-level capability roles,
  baseline discovery missing the dialog-opening step, and harness fixtures.

### Scope notes

- The demo approves three of the five candidates, as before (its story is
  unchanged).
- R5 followed.

---

## Phase R5 — MUS / MCS (minimal enablement)

Complete — verified locally on 2026-10-24.

- **MUS.** R4's deletion-minimized core is the MUS (minimal, not
  necessarily minimum; documented).
- **MCS.** `findMinimalEnablement` in `reasoner-core` runs a core-guided
  breadth-first search over policy constraints: fixed context values, and
  action guards on roles, flags and permissions. It applies each candidate
  set to a copy of the model and returns every minimum-size correction set
  with a witness, evidence and a product-decision suggestion. Statuses are
  `already-reachable`, `enableable`, `not-enableable` or `unknown`, and the
  result is always `diagnosticOnly`.
- **CLI:** `pathcompiler reason enable <goal> [directory] --context …`
  (gated by `reasoning.unsat_explanations`).
- **Reasoning cases** gain an `enablement` kind and two cases; 17/17 pass.
- Recorded in ADR 0059.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 402 tests passed across 61 suites (4 enablement tests, a CLI `reason enable` test, 2 new reasoning cases) |
| `git diff --check` | Passed |

The tests cover:
- the roadmap acceptance question (a viewer creating a client): two minimum
  sets, change the role or drop the submit guard, with `requireEditor`
  evidence and the model unchanged;
- a flag-only block for admins;
- a two-change case (an editor with the flag off);
- an already-reachable goal and a structurally blocked one;
- the CLI text and report.

No runtime code changed, so the e2e suite was not rerun.

### Errors found during the phase

- The first draft of the two-change case's ground truth was wrong: it
  listed a size-1 set. It was re-derived from the product (the role and the
  flag are independent guards, so four minimum pairs) before it was run, and
  the run confirmed it.
- Two guards on the same action produced identical labels in case results.
  Labels now include the guarded variables, deduplicated.
- The small hand-written blocked model failed schema validation (evidence
  must be non-empty). The blocked case now removes the only goal setter from
  the extracted model instead.

### Scope notes

- No solver-internal MaxSAT: that belongs to R7 (optimization), and the
  model-level search is provider-neutral.
- R6 followed.

---

## Phase R6 — Plan enumeration and trace clustering

Complete — verified locally on 2026-10-24.

- **`ProductReasoner.enumeratePlans`.** It returns every plan from the
  shortest length up to `slack` more steps (default 1), stopping at `limit`
  (default 50). Plans come in deterministic order through canonical
  minimization and blocking clauses, and each reaches the goal only at its
  last step. The canonical binary search is now shared with `findPlan`.
- **New `@pathcompiler/trace-clustering`.** `traceSignature` and
  `clusterTraces` group plans by goal, entry capability, route family and
  major actions. Navigation links, form-field order and detours are ignored;
  hand-overs between capabilities are kept.
- **CLI:** `pathcompiler reason alternatives <goal> [directory] [--slack]
  [--limit]`, gated by `reasoning.enumeration`.
- **Reasoning cases** gain an `alternatives` kind (18/18 pass).
- Recorded in ADR 0060.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 407 tests passed across 62 suites (4 clustering and enumeration tests, a CLI alternatives test, 1 new reasoning case) |
| `git diff --check` | Passed |

The tests cover:
- signature invariance under navigation links, field order and abandoned
  dialogs;
- hand-overs and separate route families;
- the duplicate rate;
- the fixture's two Deactivate variants with their shortest
  representatives;
- determinism, length order, first-reach and uniqueness;
- the limit, impossible results and argument validation;
- the CLI output and option checks.

### Errors found during the phase

- The first enumeration returned plans that reached the goal and then kept
  acting, and split the same route by the link used (10 "variants" for 2
  real ones). A first-reach constraint and route families from navigation
  state fixed both.
- The first detour rule kept dialogs abandoned by navigating away, and
  treated variables unknown to the trace as changed. It now looks at the
  navigation after a segment, and defaults unknown booleans to false.
- The determinism test first compared solver stats, which include timing.
  It now compares everything else.
- A doc-edit script failed against Biome-wrapped code and wrote nothing. It
  was rerun against the current text.

### Scope notes

- At slack 2 a third, genuine but pointless variant appears (fill in the
  name, then deactivate instead). The default slack stays 1.
- R7 followed.

---

## Phase R7 — Optimization (cost-optimal plans, UX metrics)

Complete — verified locally on 2026-10-24.

- **Costs.** `actionCategories` (formal-abstraction) maps coverage rules to
  navigation, entry, field, submit, confirmation, back, cancel and other.
  `costsFromCategories` applies weights; the default is 1 each, and weights
  must be positive.
- **`findCheapestPlan`** (reasoner-core) enumerates plans one length at a
  time. It is proven optimal once the best cost ÷ the cheapest action is
  within the searched length. Otherwise it returns the best plan found as
  `not-guaranteed`, with the reason. Plans come with per-step costs and the
  full ranking. `enumeratePlans` gained `minLength` for incremental runs.
- **`uxMetrics`** reports actions, page transitions, fields, dialog
  interactions, confirmations, witness context, variants and effort, with
  rule-based hypotheses (`meaning: "hypothesis"`).
- **CLI:** `pathcompiler reason optimize <goal> [directory] [--weight
  category=n …]`, gated by `reasoning.optimization`.
- Recorded in ADR 0061.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 412 tests passed across 63 suites (4 optimization tests, a CLI optimize test) |
| `git diff --check` | Passed |

The tests cover:
- categories of extracted actions, and weight validation;
- unit costs: the cheapest plan is the shortest and proven optimal;
- an expensive row button: the longer Edit Client path wins (cost 4) and is
  proven optimal;
- the ranking order;
- UX metrics for Create Plan (5 actions, 1 transition, 2 fields) and the
  two-variant hypothesis for Deactivate;
- the CLI output, the report and option errors.

### Errors found during the phase

- The first `findCheapestPlan` enumerated up to the full cost bound in one
  pass and timed out (`unknown`). It now enumerates one length at a time and
  stops as soon as the optimum is proven.
- On a timeout at longer lengths, it first returned `unknown` although good
  plans were already known. It now keeps the best plan as `not-guaranteed`.
- Ranked plan steps carried the model's default cost, not the weighted cost.
- `reason optimize` first listed only the cheapest variant (the proof stops
  early). It now also enumerates alternatives with slack 1 for the ranking.
- Two edit scripts failed against Biome-reformatted code and wrote nothing.
  Both were rerun against the current text.
- **Open (ISSUES_LOG #28):** heavy weights make the proof bound loose and
  slow.

### Scope notes

- No solver-side OMT: the solver language has no integer sums, and
  enumeration is exact at current sizes (ADR 0061).
- R9 followed.

---

## Phase R9 — Dead features and missing transitions

Complete — verified locally on 2026-10-24.

- **`detectDeadFeatures`** (reasoner-core) reports three kinds of candidate:
  - unreachable capability goals (free context, with R4 constraints and
    inferred possible causes);
  - capability actions that can never be performed (an R8 `never` check);
  - capabilities with UI and API evidence but no formal transitions
    ("potential model or product gap").

  Solver `unknown` results are reported, not dropped.
- **CLI:** `pathcompiler reason dead-features [directory]`, gated by
  `reasoning.reachability`.
- **Reasoning cases** gain a `dead-features` kind and `all` edits. Two cases:
  the clean fixture, and a seeded orphan (the Archive Plan test renamed
  away). All 20 pass.
- Recorded in ADR 0062.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 416 tests passed across 64 suites (3 dead-feature tests, a CLI test, 2 new reasoning cases) |
| `git diff --check` | Passed |

The tests cover:
- no findings on the fixture (6 goals, every capability action);
- a contradictory archive guard: an unreachable capability with
  "impossible permission combination", plus its dead action;
- a removed goal, reported as a missing transition with UI and API
  evidence;
- the CLI report;
- the code-seeded orphan through the reasoning cases.

### Errors found during the phase

- None in the new code. The reasoning-case runner had to return capability
  evidence alongside the model, and gained `all` edits so a test target can
  be renamed everywhere.

### Scope notes

- Product dead ends (§71: reachable states from which a goal is lost) need a
  reach-then-cannot-reach query and are deferred.
- R10 followed.

---

## Phase R10 — Automated test generation

Complete — verified locally on 2026-10-24.

- **New `@pathcompiler/test-generator`:**
  - `freshStateModel` plans from an empty product;
  - `generateTests` writes one positive test per capability goal and one
    negative test per role value or flag proven to block it, each marked as
    a candidate;
  - `TestSetupSchema` is a declarative mapping of context variables to UI
    controls. Contexts it cannot set are skipped.
- **Completion assertions** come from test-backed workflow terminals.
  Otherwise a weak "dialog closed" check is used and flagged.
- **CLI:** `pathcompiler tests generate [directory] --setup <json>` writes
  `<out>/generated-tests/` (gated by `reasoning.planning`). The fixture setup
  is in `fixtures/next-demo/eval/test-setup.json`.
- **Browser suite:** `test-generator test:browser` generates from the
  fixture and runs the 15 candidates (6 positive, 9 negative) against a
  fresh build. It is part of `pnpm test:e2e`.
- **Formal abstraction:** enabling conditions are derived from tests
  (`enabling-condition-from-tests`).
- Recorded in ADR 0063.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 422 tests passed across 66 suites (5 generator tests, a CLI generate test) |
| `pnpm test:e2e` | 44 Chromium tests passed (including the 15 generated candidates) |
| `git diff --check` | Passed |

The generated suite was also run three times in a row (15/15 each time) after
the race fix.

### Errors found during the phase

- **The browser exposed a model gap** (ISSUES_LOG #29). The first generated
  positive tests for Create Plan, Archive Plan and Change Plan Structure
  timed out: the model allowed Create Plan with no client, but the button is
  disabled. This is the kind of model/browser discrepancy spec §37 asks for.
  It was fixed in the abstraction with enabling conditions from tests.
- **The weak "no alert" check always failed:** Next.js renders a route
  announcer with `role="alert"`. It now checks that the dialog closed.
- **A generated negative test raced the context re-render:** a control
  counted as present disappeared before `isEnabled`. The setup now waits for
  the network to go idle, and vanishing controls count as blocked.
- **Workflow terminals can be `all`/`any` combinations;** the typecheck
  caught the narrower type. `all` asserts each condition; `any` falls back.
- **The first CLI draft analyzed the repository twice;** it was simplified
  to one pass.
- **A local commit carried a lockfile formatting error.** A check chain used
  `;`, so a failed `pnpm lint` did not stop the commit. The lockfile was
  reformatted and the commit amended before pushing.
- **Open (ISSUES_LOG #30, #31):** "exists" versus "active" enabling
  conditions, and weak assertions.

### Scope notes

- Context is set through UI controls from a reviewed setup file, not product
  APIs (ADR 0063).
- R12 followed.

---

## Phase R12 — Developer reasoning surfaces

Complete — verified locally on 2026-10-24.

- **New `@pathcompiler/reasoning-service`:** reachability, why-unreachable,
  plan, alternatives, verify-property, minimal-enablement and dead-features,
  with validated inputs, actionable request errors and no solver statistics
  in results.
- **`http-service`:** `POST /v1/reason/<operation>` accepts only a separate
  developer token, required even without an API token. The developer token
  is refused on all product endpoints, and weak or shared tokens are
  rejected at startup.
- **Developer MCP:** `createReasoningMcpServer` and `serveReasoningStdio`
  provide the seven spec §74 tools. The product-help MCP is unchanged.
- **CLI:** `serve` with `PATHCOMPILER_DEVELOPER_TOKEN` (over the working
  directory or `--model`), and `pathcompiler mcp-reasoning [directory]
  [--model]`. Both need `reasoning.enabled` when `pathcompiler.yaml` exists.
- Recorded in ADR 0064.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 431 tests passed across 69 suites (4 HTTP reasoning tests, 3 service and MCP tests, 2 CLI tests) |
| `git diff --check` | Passed |

The tests cover:
- token separation both ways, the developer token without an API token,
  weak and shared tokens, 400 and 405 mapping;
- operations on the fixture (reachable, why-unreachable with the admin
  guard, two Deactivate variants, no dead features);
- request errors;
- the MCP tool list and calls, including an error;
- `serve` with a developer token over a model file;
- `mcp-reasoning` over stdio and its configuration gate.

The new endpoints are HTTP-only and are covered by integration tests that
spawn the CLI; no browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- None. The CLI's shared `--model` option check had to allow `serve` and
  `mcp-reasoning`.

### Scope notes

- `compare-releases` (§73) is not served: it needs two commits, and
  `reason diff` and the GitHub check cover it.
- C8 followed.

---

## Phase C8 — Generalized browser verification

Complete — verified locally on 2026-10-24.

- **`verifyWorkflowInBrowser`** (`workflow-validator/browser`) replays any
  linear candidate or approved workflow:
  - preflight before any action: origin (loopback, or a listed preview),
    action allowlist, explicit input bindings, destructive-target allowlist,
    an observable terminal;
  - an optional `prepare` hook for preconditions;
  - unique-target resolution, so stale or ambiguous targets fail with the
    step;
  - an origin guard.

  It returns report v2 (`evidenceClass: "browser"`), and
  `browserEvidenceItem` turns that into a P0 evidence item. The Phase 10
  runner is unchanged.
- **Discovery (ISSUES_LOG #23 resolved):** an entry nested in another
  capability's dialog gets the dialog-opening step, so the discovered
  Deactivate Client starts at Edit Client.
- **Evaluation:** ground-truth workflows can list `alternativeSteps`, and
  Deactivate Client lists both paths. Baseline discovery now scores major
  steps 1, with no invented steps.
- Recorded in ADR 0065.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 431 tests passed across 69 suites |
| `pnpm test:e2e` | 48 Chromium tests passed (10 workflow-validator tests, 4 of them new) |
| `git diff --check` | Passed |

The new browser suite (4 tests) covers:
- all five discovered fixture workflows verifying, with prepared records,
  role and flag;
- a destructive control refused in preflight (page untouched);
- stale and ambiguous targets;
- a non-allowed origin, a missing input binding, and a seeded terminal
  regression.

### Errors found during the phase

- **An amend hit a pushed commit.** A work-in-progress commit command fell
  back to `git commit --amend` and amended the already-pushed R12 commit
  locally. It was caught before any push: a soft reset to `origin/main` kept
  the changes, and they were committed fresh. Nothing was force-pushed.
- **A swallowed error.** The first `any`-terminal implementation had an
  empty `catch {}`. It now reports each alternative's failure.
- **A test type error under `exactOptionalPropertyTypes`.** An optional
  `prepare` hook was passed as `undefined`. The typecheck stopped the commit
  chain, as intended.
- **A valid alternative scored as wrong.** After the discovery fix, the
  baseline's (correct) alternative-path Deactivate was scored against the
  row path only. The ground truth now lists both acceptable paths.

### Scope notes

- Branching workflows are refused, not replayed.
- Preconditions come from the caller's `prepare` hook; the runner does not
  infer setup.
- O9 followed.

---

## Phase O9 — Path efficiency

Complete — verified locally on 2026-10-24.

- **`computePathEfficiency`** (`behavior-reconciliation`) computes the Path
  Efficiency Ratio per goal and observed role:
  - the median of observed interactions per completion (navigations plus
    target activations since the previous completion);
  - divided by the cheapest formal plan (R7, unit costs);
  - with min and max alongside;
  - reported only with 30+ completions and an existing formal path.

  Friction (≥ 1.5×) is listed, and the report is `meaning: "hypothesis"`.
- **CLI:** `pathcompiler observe efficiency [directory] [--model]`, gated by
  `modes.observe` and `reasoning.optimization`.
- Recorded in ADR 0066.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 433 tests passed across 70 suites (2 efficiency tests, a CLI check) |
| `git diff --check` | Passed |

The tests cover:
- 35 simulated editor sessions (15 direct at cost 5, 20 with detours at
  cost 9): median 9, minimum 5, ratio 1.8, listed as friction, with the
  formal path;
- 2 viewer sessions: too few and formally impossible, so no ratio;
- the CLI on ingested events (one completion, too few).

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- None.

### Scope notes

- The guide-run view (`workflow.step_reached`) is not compared; free
  sessions measure the product (ADR 0066).
- O10 followed.

---

## Phase O10 — Drop-off and alternative paths

Complete — verified locally on 2026-10-24.

- **`analyzeDropOffs`** (`behavior-reconciliation`), per goal and observed
  role:
  - an attempt starts at the first activation of one of the goal's
    capability targets, and ends at `goal.reached` or at the session's end
    (the drop-off point is the last activated target);
  - it counts attempts, completions, drop-offs, the rate (30+ attempts) and
    points with their shares;
  - friction points (≥ 20%) come with the R6 variants that avoid them.
- **CLI:** `pathcompiler observe drop-offs [directory] [--model]`, gated by
  `modes.observe` and `reasoning.enumeration`.
- Recorded in ADR 0067.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 435 tests passed across 71 suites (2 drop-off tests, a CLI check) |
| `git diff --check` | Passed |

The tests cover:
- 35 editor attempts at Deactivate Client on the extracted fixture model
  (20 completed, 15 left after the row button): rate 0.429, friction at
  `clients.deactivate`, and the Edit Client route suggested;
- a single attempt: no rate and no friction;
- the CLI on ingested events.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- None. **Open (ISSUES_LOG #32):** shared targets start attempts for
  several capabilities.

### Scope notes

- O11 followed.

---

## Phase O11 — Probabilistic transition model

Complete — verified locally on 2026-10-24.

- **`buildTransitionModel`** (`observed-graph`) builds a first-order Markov
  chain from the observed graph:
  - per-state transition probabilities with 95% Wilson intervals
    (`wilsonInterval`);
  - sufficiency at 30+ outgoing transitions, and absorbing session end;
  - goal reach probabilities from session start (value iteration), each
    flagged when a state on a path to the goal is thin.

  The report is `meaning: "estimate"`.
- **CLI:** `pathcompiler observe transitions [--release <id>]`.
- Recorded in ADR 0068.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 437 tests passed across 72 suites (2 transition-model tests, a CLI check) |
| `git diff --check` | Passed |

The tests cover:
- 40 sessions (30 reach the goal): target transitions 0.75 and 0.25 with
  Wilson bounds, and P(reach) 0.75, sufficient;
- 5 sessions: P(reach) 0.8, flagged insufficient;
- the empty-sample interval;
- the CLI on one ingested event.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- A test expected the state ID `target:clients.create`; observed target
  states include the interaction (`target:clients.create:click`). A `sed`
  fix first missed the Biome-wrapped line, and the fix was made with an
  exact edit.

### Scope notes

- First-order chain with frequentist intervals (ADR 0068); Bayesian
  posteriors are left to P5 if needed.
- O12 followed.

---

## Phase O12 — Release behavior diff

Complete — verified locally on 2026-10-24.

- **`compareReleaseBehavior`** (`observed-graph`) compares, per goal, the
  share of sessions reaching it in two releases, with Wilson intervals (a
  change needs non-overlapping intervals and 30+ sessions each). Against
  formal changes (added, removed, or `changed` when both), each goal is
  classified as:
  - expected change;
  - unexplained behavior change;
  - formal change not observed;
  - stable;
  - insufficient data.
- **CLI:** `pathcompiler observe release-diff <base> <head> [directory]
  [--commits <base>..<head>]`. The formal side runs R11, gated by
  `reasoning.semantic_diff`.
- Recorded in ADR 0069.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 440 tests passed across 73 suites (3 release-diff tests, CLI checks) |
| `git diff --check` | Passed |

The tests cover:
- every class on simulated releases;
- the mixed formal direction (`changed`);
- behavior-only comparison and thin samples;
- the CLI end to end on a real commit pair (the editor → owner guard
  rename): goal share 0.875 → 0.125, formal `changed`, `expected-change`.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- The first mapping from the semantic diff kept only the last direction per
  goal. A guard rename removes reachability for one role and adds it for
  another, so mixed directions now mean `changed`.

### Scope notes

- There is no stored release → commit map; the caller passes `--commits`
  (ADR 0069).
- C4 followed.

---

## Phase C4 — Diagnostics hardening

Complete — verified locally on 2026-10-24.

- **New `@pathcompiler/diagnostics`:**
  - the nine spec §51 error classes and `errorKind` (which also classifies
    other packages' public error classes);
  - `createJsonLogger`, which drops source-like fields unless debugging;
  - `timed` phase timings and `PERFORMANCE_TARGETS_MS` (§83);
  - `contentKey` and an atomic `createFileCache`, where a corrupt entry is a
    reported miss.
- **Adopted at boundaries:** configuration, model provider, source reading
  (missing directories now get an actionable message), Git and GitHub, and
  unsupported frameworks.
- **Cached analysis:** `analysisCacheKey` and `analyzeNextProjectCached`
  (adapter-nextjs).
- **`scan`:** the analysis cache (`--no-cache`), the §53 counts table, phase
  durations against the fixture target, and JSON logs with
  `PATHCOMPILER_LOG`.
- Recorded in ADR 0070.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 448 tests passed across 76 suites (diagnostics, cache, performance and CLI scan tests) |
| `git diff --check` | Passed |

The tests cover:
- the taxonomy and foreign-error classification;
- log redaction and levels, and timings of failing phases;
- cache round-trip, miss, corruption and key validation;
- the adapter cache: a hit equals a fresh analysis, the key changes with
  content, and unusable entries are recomputed;
- CLI `scan`: the table, a cached second run with identical artifacts,
  `--no-cache`, `UnsupportedFrameworkError` and the missing-directory
  `RepositoryAnalysisError`;
- §83 targets on the fixture: scan, compile and resolver lookup.

On the fixture the cache cuts the analysis phase from about 114 ms to 16 ms.
No browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- An import edit failed against reformatted code and was redone.
- The adapter already rejected a project without App Router pages, with a
  plain `Error`. That check now throws `UnsupportedFrameworkError` with an
  actionable message, and a duplicate CLI check was removed.
- **Uncommitted sources broke `scan`:** the new counts table ran workflow
  discovery, which requires a commit. The table now shows `n/a` with the
  reason instead of failing the scan, and two existing CLI tests caught it.
- **Open (ISSUES_LOG #33):** only `scan` uses the cache.

### Scope notes

- Packages with public error classes keep them (classified by name), to
  avoid breaking APIs (ADR 0070).
- Next recommended phase: C9 — Provider adapters and semantic
  interpretation.

---

## Phase C9 — Provider adapters and semantic interpretation

Complete — verified locally on 2026-10-24.

- **One adapter primitive in core:** `createStructuredModelProvider` maps
  the five provider methods onto a single call. That call receives
  instructions (evidence is data, never instructions), the guarded request
  as JSON, and a JSON Schema generated from the response's Zod schema.
- **`@pathcompiler/model-provider-anthropic`:**
  - the official SDK, `@anthropic-ai/sdk` 0.133.0, with default model
    `claude-opus-5`;
  - structured outputs and server-side refusal fallbacks
    (`fallbacks: "default"`);
  - refusals, truncation, non-JSON answers and HTTP failures become typed
    `ModelProviderError`s.
- **`@pathcompiler/model-provider-openai`:** plain HTTP chat completions
  with a JSON schema, for `openai` and `local` (OpenAI-compatible servers,
  default `http://localhost:11434/v1`). Error bodies are never repeated.
- **Configuration:** provider `local` and `base_url` were added. Keys come
  only from the environment (`api_key_env` or the vendor default variable),
  and a missing key or model is an actionable error.
- **Semantic interpretation:**
  - `findAmbiguousClusters` flags capabilities with low confidence, weak
    naming, label conflicts or possible duplicates, and clusters them by
    shared domain or route;
  - `interpretAmbiguities` sends one request per cluster: its surfaces and
    their graph evidence only;
  - each answer becomes a `SemanticHypothesis` (confirm, rename, merge),
    supported or rejected by deterministic checks: unsupported verb or
    entity, evidence of other surfaces, merge across entities;
  - a refused or invalid answer is recorded per cluster.

  Hypotheses never change capabilities.
- **CLI `analyze [directory]`:** writes `reports/semantic-hypotheses.json`
  (clusters, hypotheses, failures, invention rates and the exact context
  sent); `--model-fixtures` replays recorded answers.
- **Both vendor-ban tests were narrowed** (model-provider and the Phase 28
  test in assistant-tools). Only `model-provider-anthropic` may depend on a
  vendor SDK, and only `cli` may depend on it, loading it lazily.
- Recorded in ADR 0071.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 464 tests passed across 79 suites (semantic interpretation, structured tasks, both adapters, CLI `analyze`, configuration) |
| `git diff --check` | Passed |

The tests cover:
- ambiguity selection, including none on the demo fixture, so nothing is
  sent there;
- the targeted context: other domains' evidence is never sent;
- each validation rule, and per-cluster failures;
- fixture-provider reproducibility, and the inert `none` provider;
- the structured task;
- both adapters against mocked HTTP (request shape, fallbacks, keys, error
  mapping, guard rejection);
- CLI `analyze` with no provider, with recorded answers, and with a missing
  key or model;
- the `base_url` configuration check.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- **Initialization order:** the task table was first a module constant, but
  `index.ts` re-exports the module, so its schemas would not have been
  initialized yet. It is now built lazily.
- **Clusters by domain alone** missed same-page ambiguity: "Add Client"
  and "Add Contact" landed in different requests, so a merge could never be
  checked. Clusters now join on shared routes too.
- **Ambiguity rule:** "not high confidence" first flagged medium-confidence
  capabilities that already have an explicit semantic name. The rule is now
  the low band.
- **Fatal bad answers:** one invalid answer aborted the whole analysis. It
  is now a per-cluster failure; transport and key errors still stop the run.
- **The older vendor ban:** the Phase 28 test in assistant-tools also
  banned SDKs and failed once the adapter existed. It was narrowed with the
  same ADR.
- A fixture-type mismatch under `exactOptionalPropertyTypes` was fixed in
  `ModelFixture`.
- **Open:**
  - #34: no real-provider evaluation, because it needs a key;
  - #35: real providers' acceptance of the generated JSON Schemas is
    unverified;
  - #36: lexical verb checks miss synonyms.

### Scope notes

- **Deviations:**
  - the local adapter lives in `model-provider-openai`, because local
    servers speak the OpenAI-compatible API;
  - Anthropic uses the SDK rather than plain HTTP, with the explicit
    decision the roadmap required (ADR 0071);
  - hypotheses are not fused or applied yet; P1 consumes them.
- Next recommended phase: P1 — Probabilistic semantic interpretation.

---

## Phase P1 — Probabilistic semantic interpretation

Complete — verified locally on 2026-10-24.

- **`interpretCandidates` (probabilistic-evidence):**
  - candidates with the same value are pooled;
  - any hard-constraint violation makes a candidate impossible, with weight
    0, whatever its evidence;
  - consistent candidates are re-scored by conditioning (prior ÷ the sum of
    consistent priors, a relative weight, not a probability);
  - P0 fusion over consistent evidence picks the best; contested or empty
    gives `null`.
- **`interpretCapabilities` (formal-abstraction):**
  - **candidates:** the rule's capability ID (static evidence from the
    naming node) and each C9 hypothesis title, parsed with the
    accessible-name rule (`capabilityMeaning`, newly exported by
    capability-engine without changing discovery);
  - **hard constraints:** the handler's endpoint versus the verb (verb-named
    sub-resources; only clear method contradictions, and POST rules nothing
    out), unknown entities, another action's ID with a different handler,
    C9 rejections and unparseable titles.
- **CLI `analyze`** writes `reports/semantic-interpretations.json` and prints
  changed, rule-impossible and unresolved subjects.
- Recorded in ADR 0072.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 471 tests passed across 81 suites (interpretation engine, capability interpretation, CLI `analyze`) |
| `git diff --check` | Passed |

The tests cover:
- the engine: removal, re-scoring (0.72 / 0.21 / 0.07 becomes 0.774 / 0.226
  / 0), hard constraints winning over browser evidence, pooling, contests,
  empty results and prior validation;
- capabilities:
  - no change on the demo fixture;
  - a mislabeled "Add Client" whose PATCH handler rules out create, so a
    model's "Edit Client" wins and invented entities and rejected
    hypotheses are impossible;
  - unresolved without a model;
  - POST ruling nothing out;
  - a merge into another action's ID;
- CLI `analyze`, which writes the interpretations.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- **Hard constraints that were not facts:** discovery's verb-to-method
  association table (everything other than create and delete is
  PATCH/PUT) was first reused as a hard constraint. It would rule out
  "Invite Client" over POST. It was replaced by a narrower table of clear
  contradictions, with a regression test.
- **Open (#37):** the API constraint never fires on the fixture, which has
  no direct handler calls.

### Scope notes

- **Deviation:** "formal consistency" uses deterministic facts rather than
  the R1 formal model. The model's actions and goals are derived from the
  capability names, so checking names against it would be circular
  (ADR 0072).
- Next recommended phase: P2 — Weighted soft constraints (MaxSAT).

---

## Phase P2 — Weighted soft constraints (MaxSAT)

Complete — verified locally on 2026-10-24.

- **`SolverProvider.optimize`** (solver-provider): hard assertions plus
  weighted soft terms with positive integer weights. The result is
  `optimal` (model, satisfied IDs, cost), `unsat` or `unknown`. The problem
  is validated like `check`'s.
- **Z3 backend:** `Z3_optimize` in a fresh context per call; term
  translation is shared with `check`.
- **`selectInterpretations`** (probabilistic-evidence):
  - one boolean per consistent P1 candidate;
  - hard constraints: at most one meaning per subject, and exclusive pairs
    never share one;
  - soft weights: evidence tier × 1000 + the scaled P1 weight, so code still
    outranks models;
  - each assignment is marked when the joint optimum differs from the
    per-subject best.
- **`selectCapabilityInterpretations`** (formal-abstraction): capabilities
  whose handlers call different endpoints are exclusive.
- **`analyze`** adds `joint` to `reports/semantic-interpretations.json` and
  prints the meanings the joint constraints changed.
- Recorded in ADR 0073.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 477 tests passed across 82 suites (Z3 optimize, joint selection, capability exclusivity, CLI `analyze`) |
| `git diff --check` | Passed |

The tests cover:
- Z3 `optimize`: the optimum under a hard constraint, unsatisfiable hard
  constraints, duplicate soft IDs, undeclared variables;
- joint selection:
  - exclusive subjects kept apart, with the higher total chosen;
  - non-exclusive subjects merging;
  - tier dominance in weights;
  - nothing to choose;
  - unknown solver answers;
- capabilities: two mislabeled actions with different PATCH handlers both
  prefer "Edit Client" alone, and jointly get edit and archive;
- CLI `analyze` writes the joint selection.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- None beyond iteration on the test design (finding two capabilities with
  different handlers whose rule meanings are both impossible).
- The R7 heavy-weight bound (#28) can now use `optimize`; noted in the
  issues log.

### Scope notes

- `SolverProvider` gained a required method; the two test stubs in
  reasoner-core were updated.
- Next recommended phase: P3 — Browser failure diagnosis.

---

## Phase P3 — Browser failure diagnosis

Complete — verified locally on 2026-10-24.

- **`diagnoseBrowserFailure`** (workflow-validator, Playwright-free):
  - the six spec §54 causes, each a binary claim fused with P0;
  - **browser signals:** transport, missing target, blocked control,
    missing outcome;
  - **static signals:** whether the target is still in the source, and
    changed endpoints when known;
  - **formal signals:** the failing target's role and flag guards in the R1
    model, evaluated against the run's context;
  - ranking: supported, band, tier, net support, then the spec's order. A
    policy refusal supports no cause.
- **The browser report schema** moved to `browser-report.ts`, so reports
  validate without Playwright.
- **CLI `diagnose <report.json> [directory] [--context name=value ...]`**
  writes `reports/diagnosis.json`.
- Recorded in ADR 0074.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 485 tests passed across 84 suites (diagnosis unit tests, CLI `diagnose`) |
| workflow-validator browser suite | 11 passed (Chromium), including the new seeded-diagnosis test |
| `git diff --check` | Passed |

The tests cover:
- **real seeded failures on the running fixture:** editor role, Archive
  flag off, renamed target and a closed port each rank their true cause
  first, and a policy refusal yields none;
- **unit:** the same causes on the fixture's formal model, the formal model
  ranked first when it allowed what the page blocked, backend versus model
  for outcome failures with endpoint evidence, passing runs, and runs
  without context;
- **CLI:** the ranking output, the report file, an unreadable report, and
  the option guard.

### Errors found during the phase

- **The renamed-target seed** (`plans.archive_old`) was refused by the
  destructive-control policy before running. The refusal is correct; the
  test now allows that target and also asserts that a refusal supports no
  cause.
- **Moving the schema** left `browser-workflow.ts` referencing the stage
  enum; it now uses the exported `BrowserVerificationStage` type.
- **A transient Vitest crash:** one full run exited 2 after "cleanupThread
  command from terminated worker" and did not count two suites. The rerun
  passed every suite (ISSUES_LOG #39).
- **Open (#38):** the CLI does not compute changed endpoints.

### Scope notes

- **Deviation:** guards are read from the R1 model directly, not through an
  R2 solver call per failure (ADR 0074).
- Information-gain diagnostics (§55) remain deferred.
- Next recommended phase: P4 — Commit risk scoring.

---

## Phase P4 — Commit risk scoring

Complete — verified locally on 2026-10-24.

- **`scoreCommitRisk`** (impact-analysis): every impact reason is classified
  as definite, probable or uncertain, by an exhaustive code table. R11
  findings are `formal`, and R11 uncertainty entries are uncertain.
- **The level is a rule:**
  - high: a definite high-severity impact;
  - medium: another definite impact, or a medium or high probable one;
  - low: anything else found;
  - none: nothing found.

  It is labeled `rule-level-not-probability`.
- **The incident probability** comes only from a sufficient calibration of
  reviewed outcomes; otherwise it is `null`, with the reason.
- **`impact`** writes `reports/commit-risk.json` and prints
  "Change risk: … (definite n, probable n, uncertain n; a rule level, not an
  incident probability)".
- Recorded in ADR 0075.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 488 tests passed across 85 suites (risk classification, levels, calibration, CLI `impact`) |
| `git diff --check` | Passed |

The tests cover:
- classification, order and counts, with R11 uncertainty;
- each level rule;
- a calibrated probability, and an insufficient calibration;
- the CLI `impact` risk line and report on a real renamed-target commit.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- One test expectation had the wrong order within a class. Sorting is by
  severity, then workflow or goal, then code; the expectation was fixed.
- **Open (#40):** risk is not yet in the GitHub check or proposals, and no
  calibration data exists.

### Scope notes

- Next recommended phase: P5 — Probabilistic model checking.

---

## Phase P5 — Probabilistic model checking

Complete — verified locally on 2026-10-24.

- **`checkGoal`** (observed-graph): completion and abandonment probability,
  as a point with lower and upper bounds, and expected transitions to
  completion (conditioned chain). The bounds come from robust value
  iteration over the interval Markov chain defined by the O11 Wilson
  intervals.
- **Unobserved transitions** get a mass of at most the zero-observation
  Wilson bound, worth 0 to the lower bound and 1 to the upper.
- **`checkReachProperty`** returns satisfied or violated only when the whole
  interval agrees, and inconclusive otherwise. **`compareReach`** reports a
  direction only when the bounds do not overlap.
- **CLI `observe check <goal> [--at-least|--at-most p] [--baseline
  <release>]`** writes `reports/probabilistic-check.json`.
- Recorded in ADR 0076.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 491 tests passed across 86 suites (all 86 test files; interval bounds, properties, release comparison, CLI `observe check`) |
| `git diff --check` | Passed |

The tests cover:
- bounds that contain the point and narrow with more sessions, and one
  session deciding nothing;
- abandonment as the complement;
- expected transitions;
- property verdicts on both sides and inconclusive;
- release comparison: up, down and noise;
- unknown goals;
- the CLI `observe check` output, its bound validation and the option
  guard.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- **Overconfident bounds:** with unobserved transitions assumed impossible,
  a state with one observed successor gave bounds of exactly 1 after a
  single session. The CLI test caught it. A zero-observation Wilson mass
  for unobserved outcomes fixes it, and the unit tests were rescaled to
  sample sizes that can decide.
- **#39 recurred:** a full `pnpm test` again exited 2 with one suite missing
  from the totals and no error printed. A rerun with the JSON reporter ran
  every file (exit 0).
- **Open (#41):** the bounds use per-transition intervals, not a joint
  confidence level.

### Scope notes

- Value iteration is native; no external probabilistic model checker is
  used (ADR 0076).
- MDP guided assistance (§60) remains deferred.
- Next recommended phase: P-RV — Review prioritization and feedback.

---

## Phase P-RV — Review prioritization and feedback

Complete — verified locally on 2026-10-24.

- **New `@pathcompiler/review-priority`:**
  - `prioritizeReviews` multiplies explained factors (uncertainty, business
    impact, usage, severity) for pending candidates and proposals. Missing
    inputs are neutral.
  - `collectReviewFeedback` turns the stored decisions into labeled data
    with the reviewed confidence and its band.
  - `calibrationFromReviews` builds a P0 calibration table.
- **CLI:**
  - `review queue [--impact <json>]` writes `reports/review-queue.json`,
    with usage from stored events;
  - `review feedback` writes `reports/review-calibration.json`.
- **Roadmap statuses corrected:** I0, I4 and I5 had all their prerequisites
  done but were still marked blocked.
- Recorded in ADR 0077.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 495 tests passed across 88 suites (all 88 test files; prioritization, feedback, calibration, CLI `review`) |
| `git diff --check` | Passed |

The tests cover:
- factor products and order, with domain impact, usage relative to the
  busiest workflow, proposals without a candidate, and decided proposals
  excluded;
- neutral factors, and impact validation;
- feedback from approvals (first versions only), rejections and proposal
  reviews;
- calibration with ignored decisions left out;
- CLI: queue order by impact, a rejected candidate leaving the queue and
  appearing in feedback, and the option guards.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- **A type error:** the `Proposal` union has no `proposed` field on
  deprecations; the code now narrows on the kind first.
- **Name collision:** I0's planned human trigger `analyze <workflow>`
  collides with C9's `analyze`. Recorded in the roadmap.
- **Open (#42):** merged and renamed decisions are not produced yet.

### Scope notes

- Feedback is derived from the stored records, not from a new log
  (ADR 0077).
- Next recommended phase: I0 — Finding Model.

---

## Phase I0 — Finding Model

Complete — verified locally on 2026-10-24.

- **New `@pathcompiler/findings`.** `deriveFindings` classifies findings
  deterministically from existing reports:
  - release regressions: R11 lost reachability, definite impact breaks, and
    observed release drops;
  - permission regressions: role-specific reachability changes, and removed
    access conditions;
  - workflow friction: efficiency and drop-offs;
  - low adoption and runtime/formal discrepancies: reconciliation.
- **Each finding** has a stable ID, P0 evidence items with lineage to its
  report entries, a severity, and a fused confidence that it is real.
- **Opportunities** group findings by capability, with an explained
  priority (severity × confidence × regression × corroboration).
- **CLI `findings [subject]`** reads the six reports when present, validates
  them, and writes `reports/findings.json`.
- Recorded in ADR 0078.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 498 tests passed across 89 suites (all 89 test files; classifiers, opportunities, end-to-end findings) |
| `git diff --check` | Passed |

The tests cover:
- each classifier, with lineage, evidence joining and low-severity reasons
  ignored;
- opportunity grouping and priority components;
- determinism, and empty input;
- end to end on a real commit pair: the editor check renamed to owner. The
  findings, derived from the `impact --reasoning`, `reason diff` and
  `observe release-diff` reports of the fixture copy, show editor and owner
  permission regressions and an observed release regression, all grouped
  under Create Client.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- **Duplicate findings:** keying permission findings by the full context
  produced 18 near-duplicates (role × flag values) for one role rename. They
  are now keyed by role, with flag contexts kept as evidence.
- **Duplicate sources:** impact sources were listed twice; they are now
  deduplicated.
- **A missing import** (`WorkflowImpactReportSchema` in the CLI) was fixed.
- **Open (#43):** threshold triggers are not automatic, and diagnosis and
  model-check reports are not inputs yet.

### Scope notes

- **Deviation:** the human trigger is `findings <subject>`, because C9
  already uses `analyze`.
- Next recommended phase: IG — Improvement gate.

---

## Phase IG — Improvement gate

Complete — verified locally on 2026-10-24.

- **New `@pathcompiler/improvement-gate`.** `gateFindings` asks the ADR 0033
  questions in order for each I0 opportunity, highest priority first:
  1. evidence against `min_confidence`;
  2. impact against `min_affected_users` and `min_expected_gain`, giving
     `no_change` for niche features that work, and `log_only` without
     telemetry unless the finding is a high-severity regression;
  3. actionability, through the I1 template kinds and the recommendation
     budget;
  4. autonomy, through `autonomous_mutation` and its budget.
- **Each decision** carries an Improvement Value Assessment (six components
  with reasons; unknown values are null) and one rationale line per
  question.
- **CLI `gate`** reads `reports/findings.json`, takes usage from stored
  guide-run events, and writes `reports/gate-decisions.json`. With a
  config it needs `modes.recommend`; the harness also needs
  `modes.self_improvement`.
- Recorded in ADR 0079.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 502 tests passed across 90 suites (all 90 test files; decision table, end-to-end gate, config gating) |
| `git diff --check` | Passed |

The decision table is tested against the roadmap's acceptance cases:
- **recommend:** a large, high-confidence regression (formal and observed
  evidence);
- **log_only:** few affected users;
- **collect_more_data:** an observed-only discrepancy;
- **no_change:** low adoption with 95% completion;
- **budget:** one recommendation, then surface;
- **autonomy:** off by default, and eligible only when enabled and within
  budget.

End to end, the R11 role-rename regression (formal-only evidence) gives
`collect_more_data`, which asks for browser verification. The CLI config
test checks that `gate` needs `modes.recommend`.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- A type error (an index into a `Record<string, number>` read as possibly
  undefined) was fixed with a literal-typed table.
- **Open (#44):** the usage approximations, no compute budget, and an
  estimated cost that is always null.

### Scope notes

- Formal-only regressions are medium confidence in P0, so they need
  corroboration before they become recommendations (ADR 0079).
- Next recommended phase: I1 — Recommendation Model.

---

## Phase I1 — Recommendation Model

Complete — verified locally on 2026-10-24.

- **New `@pathcompiler/recommendation-engine`.** `recommend` turns only
  `recommend` and `eligible_for_harness` gate decisions into
  recommendations, from deterministic templates:
  - **FIX** for regressions: lost reachability must come back, and access a
    role newly gained must go, unless it is intended;
  - **IMPROVE** for friction;
  - **PROMOTE** for low adoption;
  - **INVESTIGATE** otherwise.
- **Each recommendation** has a falsifiable hypothesis with a template-prior
  intervention confidence, separate from finding confidence. It also has
  desired outcomes, protected behaviors (R8 properties and the other
  approved workflows), required and outcome acceptance checks, lineage, and
  the gate's harness eligibility.
- **CLI `recommend [--property <json>]`** writes
  `reports/recommendations.json`; it needs `modes.recommend` with a config.
- Recorded in ADR 0080.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 506 tests passed across 91 suites (all 91 test files; templates, end-to-end recommend, config gating) |
| `git diff --check` | Passed |

The tests cover:
- FIX with reachability, property, validation and browser checks, and
  protected behaviors that exclude the target;
- FIX for newly gained access;
- IMPROVE and PROMOTE outcomes and metric checks;
- only escalated decisions becoming recommendations;
- end to end on the role rename: nothing escalates, so nothing is
  recommended;
- config gating.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- **Friction checks in a mixed opportunity:** friction findings were being
  treated as lost regressions and given reachability checks. "Lost" is now
  restricted to regression kinds.
- **Imports:** a `GateReport` import was lost when the formatter rewrote an
  import block, and was restored.
- **Open (#45):** BUILD and DEPRIORITIZE templates are deferred.

### Scope notes

- Next recommended phase: I4 — Browser candidate verification.

---

## Phase I4 — Browser candidate verification

Complete — verified locally on 2026-10-24.

- **`verifyCandidateWorkflows`** (workflow-validator/browser) runs the
  selected workflows against a candidate build, clears cookies between
  runs and applies preconditions per workflow. It stamps the candidate
  commit on each report.
- **`verifyWorkflowInBrowser` gains `candidateCommit`:** the build under
  test, instead of the workflow's approval commit.
- **`evaluateCandidate` gains section E (`browser`):** reports are
  validated; stale ones are ignored with a warning; failed runs are risks
  carrying a P3 diagnosis on the candidate's model; and affected workflows
  without a run are warned about. The `browserResults` summary is added,
  and the browser evidence gap closes once reports are supplied.
- **CLI `evaluate --browser <json>`.**
- Recorded in ADR 0081.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 507 tests passed across 91 suites (all 91 test files; evaluator browser section, CLI `evaluate --browser`) |
| workflow-validator browser suite | 12 passed (Chromium), including the new candidate runner test |
| `git diff --check` | Passed |

The tests cover:
- **evaluator on real commits:** a candidate with one verified workflow, one
  failed run (diagnosed as a stale target) and one stale report fails with
  `revise_candidate`;
- **CLI:** a browser failure fails an otherwise passing candidate, and the
  option guard;
- **browser:** two selected fixture workflows pass against the running app
  with the candidate commit stamped, and their reports round-trip through
  the Playwright-free schema.

### Errors found during the phase

- **Wrong candidate commit:** `report.candidateCommit` held the workflow's
  approval commit, which would have made every approved workflow's report
  look stale on a candidate. The new option fixes it.
- **Open (#46):** there is no CLI browser runner and no check section.

### Scope notes

- Next recommended phase: I5 — Experiment Specification.

---

## Phase I5 — Experiment Specification

Complete — verified locally on 2026-10-24.

- **New `@pathcompiler/experiment-core`.** `createExperimentSpec` specifies
  an experiment, and never deploys one.
  - **Inputs:** an IMPROVE or PROMOTE recommendation whose candidate
    evaluation passed.
  - **Arms:** control and treatment releases (the treatment bound to the
    evaluated commit), the population, and 50/50 session allocation.
  - **Metrics:** primary and secondary, from the desired outcomes.
  - **Guardrails:** held effects, the other approved workflows, and no
    unexpected observations.
  - **Criteria:** success criteria (10% relative, 30+ sessions per arm, 95%)
    and stop conditions.
- **Frozen criteria:** a canonical sha256 is stored, and
  `parseExperimentSpec` refuses edited criteria.
- **CLI `experiment create`** writes `experiments/<id>.json`.
- Recorded in ADR 0082.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 510 tests passed across 93 suites (all 93 test files; spec creation, freezing, refusals, CLI) |
| `git diff --check` | Passed |

The tests cover:
- a spec from a real I1 IMPROVE recommendation: metrics, guardrails,
  criteria, round-trip, and detection of an edit after freezing;
- refusals for FIX, failing candidates and mismatched evaluations;
- CLI creation and actionable errors.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- None. One design point is recorded: I3's `eligibleForExperiment` needs a
  declared reachability change, which behavioral improvements lack, so I5
  requires a passing evaluation instead (ADR 0082).

### Scope notes

- Next recommended phase: I6 — Outcome Measurement.

---

## Phase I6 — Outcome Measurement

Complete — verified locally on 2026-10-24.

- **New `@pathcompiler/outcome-analysis`.** `measureOutcome` measures a
  frozen spec on stored events, and refuses an edited spec.
  - **Arms:** the control and treatment releases, filtered by the
    population's roles.
  - **Metrics:** goal reach shares, or guided completion rates, with 95%
    Wilson intervals, relative change, significance and sufficiency.
  - **Guardrails** are breached only when the treatment is significantly
    worse beyond `maxDegradation`.
  - **Outcome:** worse, inconclusive, improved or neutral, by ordered rules
    on the frozen criteria.
  - **Not measured:** metrics events cannot measure are listed as gaps.
  - **Formal side:** the formal status is reported separately.
- **CLI `experiment measure <spec> [evaluation]`** writes
  `reports/outcomes/<id>.json`.
- Recorded in ADR 0083.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 514 tests passed across 94 suites (all 94 test files; outcome rules, guardrails, CLI measure) |
| `git diff --check` | Passed |

The tests cover:
- **improved:** 0.5 → 0.75 on 200 sessions per arm;
- **worse:** a breached guardrail (another approved workflow's completion
  fell) despite an improving primary metric, and a primary metric that
  fell;
- **neutral:** below the 10% criterion;
- **inconclusive:** small samples;
- **gaps:** path efficiency is a gap;
- **freezing:** an edited spec is refused;
- **CLI:** create, then measure from stored events.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- **Optional fields:** an `exactOptionalPropertyTypes` error on optional
  session fields was fixed.
- **A test edit** failed against Biome-formatted text and was redone from
  the current file.
- **Dependencies:** the CLI test needed `observability-core`, added as a
  devDependency.
- **Open (#47):** metrics that need the formal model are not measured yet.

### Scope notes

- Next recommended phase: I7 — Adoption Decision.

---

## Phase I7 — Adoption Decision

Complete — verified locally on 2026-10-25.

- **`decideAdoption`** (outcome-analysis) applies ordered rules:
  - reject: the candidate failed;
  - rollback: worse, with iterate as the alternative and the hypothesis
    rejected;
  - adopt: improved and the candidate passed (inconclusive without a
    passing evaluation);
  - iterate: neutral;
  - extend_experiment: under-sampled or overlapping intervals;
  - inconclusive: otherwise.

  Each decision carries its lineage and requires human approval.
- **`recordApproval`** records one approval or refusal, with reviewer, time
  and note.
- **CLI:** `experiment decide` writes `decisions/<id>.json`, pending, and
  never overwrites one; `experiment approve|decline --by` records the human
  decision.
- Recorded in ADR 0084.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 517 tests passed across 94 suites (all 94 test files; adoption rules, the failed-hypothesis demo, CLI decide/approve) |
| `git diff --check` | Passed |

The tests cover:
- **the failed-hypothesis demo (§253):** with a passing candidate,
  completion 51% → 43% gives extend_experiment at 400 sessions per arm
  (overlapping intervals) and rollback at 1000 (hypothesis rejected);
- **the other choices:** adopt, inconclusive without an evaluation,
  reject, iterate and extend;
- **approval:** recorded once;
- **CLI:** decide, approve, and refusals to decline a decided record or
  overwrite a decision.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- **A demo expectation:** the §253 demo first used 400 sessions per arm, at
  which 51% vs 43% is not significant. The test now covers both sample
  sizes, documenting why the smaller one extends the experiment.
- **A docs-update script** failed partway through, after the README and
  roadmap edits but before STATUS. The phase commit went through without
  STATUS and was amended before pushing.

### Scope notes

- Next recommended phase: I8 — Improvement Memory.

---

## Phase I8 — Improvement Memory

Complete — verified locally on 2026-10-25.

- **New `@pathcompiler/improvement-memory`.** `buildMemoryRecord` links one
  lifecycle (findings, recommendation, evaluation, experiment, outcome,
  decision) and refuses artifacts from another recommendation. Lessons
  come only from approved decisions, scoped to subject and category.
- **`historyFactor` and `rankWithMemory`:** mostly rejected history halves
  a matching recommendation's priority, as a visible `history` component;
  observations do not compound.
- **CLI:** `memory record <recommendation-id>` gathers the latest
  experiment, outcome and decision; `memory list` shows records and
  lessons; `recommend` applies the history factor.
- Recorded in ADR 0085.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 520 tests passed across 95 suites (all 95 test files; lifecycle record, history ranking, CLI memory) |
| `git diff --check` | Passed |

The tests cover:
- the failed-hypothesis lifecycle (measured, decided rollback, approved),
  which links every ID and records a rejected lesson only after approval;
- the history factor and re-ranking, limited to the same subject and
  category;
- refusal to mix lifecycles;
- CLI: record, then list, after an approved adopt.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- None in this phase. The roadmap's blocked column had a stray "·" left by
  the I7 edit; it was fixed.

### Scope notes

- Next recommended phase: I2 — Harness contract (mode 6 only).

---

## Phase I2 — Harness contract (mode 6 only)

Complete — verified locally on 2026-10-25.

- **New `@pathcompiler/harness-contracts`:**
  - strict, versioned Zod schemas for `HarnessTaskSpec` and
    `MutationResult` (major 1 only; unknown fields rejected), with
    generated JSON Schemas;
  - `createHarnessTask`, only for `eligible_for_harness`, with intents,
    constraints, acceptance criteria and lineage;
  - `parseMutationResult`, which checks the task, base commit and candidate;
  - `evaluationCriteria` for I3;
  - `runFixtureHarness`, which completes or blocks.
- **Files:** `examples/harness-contract/` (schemas, task, completed and
  blocked results, README) and `fixtures/harness/` (ISSUES_LOG #27
  resolved).
- **CLI `harness task <recommendation-id> <base-commit>`.**
- Recorded in ADR 0086.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 524 tests passed across 97 suites (all 97 test files; contracts, examples, fixture harness, CLI harness task) |
| `git diff --check` | Passed |

The tests cover:
- tasks only from eligible gate decisions, with lineage, intents,
  constraints and I3 criteria;
- round-trips of completed and blocked results;
- rejection of major version 2, unknown fields, foreign results, and
  completed results without a candidate;
- example and fixture files that match the contract and the generated
  schemas;
- CLI refusal without mode 6, and creation with it.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- **A test type error:** a test passed `reconciliation: undefined` under
  `exactOptionalPropertyTypes`. Typecheck stopped the commit, and the test
  was fixed.
- **#39 again:** in the same run, `pnpm test` exited 2 with 95 of 97 suites
  and no error. The rerun ran all 97.

### Scope notes

- **Deviation:** the contracts are camelCase JSON, not the handoff's
  snake-case YAML sketches, which the handoff calls conceptual (ADR 0086).
- Next recommended phase: I9 — External harness integration.

---

## Phase I9 — External harness integration (Integration V0)

Complete — verified locally on 2026-10-25.

- **CLI `harness import <MutationResult.json> [directory]`:**
  - finds the exported task, validates the result against it, and stores
    it;
  - when the result names a candidate, evaluates it with criteria frozen
    from the task, checking the harness's claim (never trusting it);
  - records a blocked or failed result with its questions.

  Tests and browser reports apply as in `evaluate`.
- **`reportEvaluation`** is shared with `evaluate`.
- **PathCompiler never runs the harness.**
- Recorded in ADR 0087.

### Verification

| Command / check | Result |
| --- | --- |
| `pnpm lint` | Passed without warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 525 tests passed across 97 suites (all 97 test files; Integration V0 end to end) |
| `git diff --check` | Passed |

The Integration V0 end-to-end test runs on a git copy of the fixture:
1. a regression drops `requireEditor` from the create-client API;
2. `reason diff`, `findings`, `gate` (mode 6 enabled in `pathcompiler.yaml`)
   gives `eligible_for_harness`;
3. `recommend` gives a FIX, and `harness task` gives a remove-reachability
   intent;
4. a candidate branch restores the guard;
5. `harness import` evaluates PASS, with every expected change met and the
   claim not contradicted;
6. a blocked result is recorded with its question.

No runtime or browser code changed, so the e2e suite was not rerun.

### Errors found during the phase

- **Open (#48):** a design limitation surfaced while choosing the scenario.
  Per-capability opportunities split one root cause into several tasks; a
  renamed role check would fail each narrower evaluation.

### Scope notes

- All planned phases except C6 are complete.

---

## Issue fixes after the phase run — batch 1 (2026-10-25)

Every planned phase except C6 was complete. Open ISSUES_LOG entries with a
clear fix are being fixed and verified one by one.

| Issue | Fix | Verified by |
| --- | --- | --- |
| #8 Node version | `.nvmrc` already pins 22 and the README documents `nvm install && nvm use`; the remaining step is the local environment | Documentation check |
| #15 CORS | `serve --allow-origin <origin>`: exact origins only (`*` refused); preflights are answered for allowed origins and refused (403) for others; CORS headers on responses | New http-service tests: preflight, a cross-origin post, a foreign origin, wildcard and path refusal |
| #33 Analysis cache | Every analyzing CLI command uses the content-hash cache (`--no-cache` bypasses it) | New CLI test: identical `capabilities discover` output cold, cached and uncached; all 56 earlier CLI tests unchanged |
| #36 Verb synonyms | Hypothesis validation maps add, remove, update, disable, copy and other synonyms to capability verbs | Semantic test: "Remove Client" for an archive action is rejected |
| #41 Bound labels | P5 bounds are labeled "from per-transition 95% intervals" everywhere | CLI test on the new wording |

Checks for the batch: lint and typecheck passed; `pnpm test` passed 528 tests across 98 suites (all 98 test files).

## Issue fixes after the phase run — batch 2 (2026-10-25)

| Issue | Fix | Verified by |
| --- | --- | --- |
| #19 Dirty fixture breaks approval tests | The approving CLI tests and the custom-assistant example approve from a committed temporary git copy of the fixture | All 27 tests pass with a deliberately dirty fixture (the edit was then reverted) |
| #22 Component-level roles | Roles come from the endpoint handlers' permission checks, with component-level checks as the fallback; Archive Plan lists `admin` only | Capability tests; graph golden (one fewer evidence edge) |
| #21 Baseline applicability | Baseline candidates carry the capability roles and the handlers' feature flags as preconditions | `eval workflow-discovery`: baseline applicability 0 → 1; discovery, compiler and golden updates reviewed |
| #38 Diagnose without endpoint changes | `diagnose --base <commit>` diffs endpoints up to the candidate | New CLI test on real commits: copy-only change gives formal-model-wrong, moved endpoint gives backend-changed |
| #48 Shared root causes | Findings keep R11 root-cause files, and opportunities sharing one merge (`subjects`); recommendations, harness tasks and protected workflows cover every merged capability | Findings unit test, plus an Integration V0 test where the editor-to-owner rename (5 capabilities) gives one task whose revert evaluates PASS |

Checks for the batch:
- lint and typecheck passed;
- `pnpm test` passed 531 tests across 98 suites (all 98 test files);
- `pnpm test:e2e` passed 50 Chromium tests.

**Errors found while fixing:**
- **The reference demo's guide test failed.** Change Plan Structure now
  carries a `planStructure` flag precondition, and the test started the
  guide without the app's feature flags, so it stopped with
  `precondition-unmet`. The test now passes the fixture's flags as the
  guide context, which is the documented contract (README, RuntimeContext).
  Apps must pass `featureFlags` for flag-guarded guides.
- **A test type error** (`exactOptionalPropertyTypes`) in the new findings
  test was fixed.
