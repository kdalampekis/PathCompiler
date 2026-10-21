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

Not started. Next planned phase introduces explicit semantic target annotations
and target suggestions.
