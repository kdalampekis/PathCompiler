# PathCompiler

Compile your codebase into executable product workflows.

PathCompiler will analyze source code, tests and Git history, discover workflows,
and compile reviewed workflows into versioned headless artifacts. The product graph
is a build-time representation; approved workflows are the runtime source of truth.

This repository currently implements **Phase 0 — Repository Foundation**. Analysis,
discovery, compilation, SDKs and runtime guidance are future phases.

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

## Packages

| Package                     | Public API                                                                        |
| --------------------------- | --------------------------------------------------------------------------------- |
| `@pathcompiler/workflow-ir` | Zod schemas, inferred types, `parseWorkflow(unknown)`                             |
| `@pathcompiler/graph-core`  | `ProductGraph`, graph schemas/types, `createNodeId`, `createEdgeId`, `diffGraphs` |

Both packages export ESM JavaScript and declarations from `dist/` after
`pnpm build`. They are private until release contracts are ready. Tests run against
source; typechecking includes tests and the Next.js route types.

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
