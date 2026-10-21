# AGENTS.md

## Repository mission

This repository builds **PathCompiler**, a self-maintaining product-workflow compiler.

PathCompiler analyzes a living software repository, tests, Git history and related evidence, discovers product capabilities/business processes, compiles approved processes into versioned executable workflows, and exposes those workflows through headless SDK/API/MCP interfaces.

Read:
1. `PRODUCT_ARCHITECTURE.md` for product vision and architectural rationale.
2. `CODEX_BUILD_SPEC.md` for implementation phases, contracts and acceptance criteria.
3. `docs/phases/STATUS.md` for current progress.

## Core architectural rules

- The product graph is a build-time/intermediate representation, not the primary runtime retrieval mechanism.
- Approved workflow artifacts are the runtime source of truth.
- Preserve provenance for generated capabilities and workflow steps.
- Prefer deterministic parsing/rules/tests over LLM inference whenever facts can be derived statically.
- All LLM access must go through a provider interface; core packages must not depend directly on a model vendor.
- Core/runtime APIs are headless and return structured data, never framework-specific UI.
- UI packages are optional consumers of the core.
- Do not introduce a graph database until real requirements justify it.
- Do not silently overwrite approved workflows after code changes; create proposals for semantic changes.
- Bind workflow versions to repository commits/releases.
- Browser runtime manifests must not expose repository/private analysis data.

## Development workflow

For a substantial phase:
1. read the relevant phase in `CODEX_BUILD_SPEC.md`;
2. inspect current code and `docs/phases/STATUS.md`;
3. run baseline checks before editing;
4. implement only the requested phase unless a dependency is strictly necessary;
5. add focused tests;
6. run lint, typecheck and tests before finishing;
7. update `docs/phases/STATUS.md`;
8. report any deviation from the spec.

Do not perform unrelated refactors.

## Phase delivery

The user has authorized committing and pushing after every completed phase.
After required checks pass and `docs/phases/STATUS.md` is updated, create one
coherent phase commit and push the current branch to its configured upstream.
Do not mark or commit an incomplete phase as complete. Do not force-push.

## Architecture decisions

If a material unresolved architecture decision is required, create an ADR in:

`docs/decisions/NNNN-short-title.md`

Include context, decision, alternatives and consequences.

Prefer the simplest reversible choice.

## Coding standards

- TypeScript strict mode.
- Avoid `any`; if unavoidable, explain why locally.
- Use explicit package public APIs.
- Avoid hidden global state.
- Avoid circular package dependencies.
- Deterministic inputs should produce deterministic outputs.
- Validate external/config/model data at boundaries.
- Do not swallow errors.
- Keep user-facing errors actionable.
- Do not log secrets or repository credentials.
- Do not send full repositories to model providers by default.

## Verification

At minimum, before completing implementation work:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Run additional package/browser tests required by the active phase.

Never mark a phase complete while required checks are failing.

## Scope control

Do not build speculative infrastructure.

Deferred until explicitly requested:
- billing;
- SSO;
- multiple Git providers/frameworks;
- autonomous destructive execution;
- graph database;
- mobile SDK;
- advanced analytics;
- polished marketing UI.

The first supported stack is Next.js + React + TypeScript + Playwright.
