# PathCompiler

Compile your codebase into executable product workflows.

PathCompiler will analyze source code, tests and Git history, discover workflows,
and compile reviewed workflows into versioned headless artifacts. The product graph
is a build-time representation; approved workflows are the runtime source of truth.

This repository implements **Phase 0 — Repository Foundation**,
**Phase 1 — Static Next.js Analyzer** and **Phase 2 — Semantic Targets**. Workflow discovery, compilation, SDKs and
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

## Packages

| Package                     | Public API                                                                        |
| --------------------------- | --------------------------------------------------------------------------------- |
| `@pathcompiler/workflow-ir` | Zod schemas, inferred types, `parseWorkflow(unknown)`                             |
| `@pathcompiler/graph-core`  | `ProductGraph`, graph schemas/types, `createNodeId`, `createEdgeId`, `diffGraphs` |

Additional Phase 1 packages:

| Package | Public API |
| --- | --- |
| `@pathcompiler/source-model` | `readSourceProject`, source/diagnostic schemas and exclusion defaults |
| `@pathcompiler/adapter-nextjs` | `analyzeNextProject`, `scanNextRepository`, `discoverRoute`, `suggestTargets`, scan/target schemas and types |
| `@pathcompiler/cli` | `pathcompiler scan`, `pathcompiler targets suggest`, `runCli` |

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
