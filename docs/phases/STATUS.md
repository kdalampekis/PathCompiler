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

Not started. No scanner, source-model or CLI package exists yet.
