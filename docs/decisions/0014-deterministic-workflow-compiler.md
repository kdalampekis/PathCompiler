# ADR 0014 — Deterministic workflow compiler

## Context

Approved workflow records (ADR 0013) are the runtime source of truth, but runtime
consumers need compact, purpose-specific data: a search index for the resolver, a
browser-safe manifest for guides, and readable documentation. The spec requires
the same approved input and compiler version to produce the same output.

## Decision

Add `@pathcompiler/workflow-compiler` with a pure `compileWorkflows(records)`
that accepts only schema-valid approved records and returns three versioned
documents with a shared `{schemaVersion: 1, compilerVersion}` header.

- Output is sorted by workflow ID, has no timestamps, and fails on duplicate IDs.
- Each record carries `revision = sha256(canonical JSON of the approved workflow)`.
  Approval metadata is excluded, so re-approval of identical content is stable.
- The search record contains the spec's fields plus `qualifiers`, `domain`,
  `permissions` and `featureFlags` from preconditions, because the Phase 13
  resolver filters on them. `aliases` stays empty until alias generation exists.
- The runtime manifest keeps entrypoints, preconditions, steps without evidence,
  and the terminal. It omits evidence, provenance, confidence, repository commit,
  status and reviewer data. The search index follows the same omission rule
  because a static export may bundle it for local resolution.
- Documentation resolves conditions into deterministic English text and keeps the
  commit for traceability. It does not reorder steps.
- `pathcompiler build` compiles stored approved files into `generated/*.json`. It
  does not re-validate against newer commits; detecting drift is impact analysis.

`COMPILER_VERSION` must be bumped whenever output changes for identical input.

## Alternatives

- Numeric workflow versions (`clients.create@7`): needs a registry with history;
  a content hash is deterministic and available now.
- Ship the full IR to the browser: leaks evidence locators, paths and commits.
- Re-validate during build: couples a pure compiler to scanning, and would fail
  every approved workflow after unrelated commits.

## Consequences

Resolver, SDK and static export can consume stable, schema-validated artifacts
without the graph. Changing a step changes the revision; changing the reviewer does
not. Human-readable instruction text is only as good as the approved instructions.
