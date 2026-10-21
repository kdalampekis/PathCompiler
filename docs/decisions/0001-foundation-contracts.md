# 0001 — Workflow and graph foundation contracts

Status: accepted for Phase 0.

## Context

The build specification names conditions, terminal conditions and provenance but
does not fix their wire format. The graph also needs a snapshot and identity
contract before an analyzer exists.

## Decision

- Zod is the runtime source of truth; public TypeScript types are inferred from it.
  Objects reject unknown keys so misspellings cannot silently discard constraints.
- Workflow conditions use a `type` discriminator. A terminal condition is one
  condition, or a nonempty `any` / `all` array. Nested boolean expressions are
  deferred until a real workflow needs them.
- Provenance is `{ evidence: EvidenceRef[] }`. Workflow provenance and every step
  require at least one evidence reference. Evidence remains embedded, retaining
  its own commit (which can differ from the workflow commit for Git history).
- Steps start at the first array element. `next` is an explicit default edge;
  branches are evaluated in array order before that edge. No implicit sequential
  edge is inferred. A step without a transition waits for terminal completion.
  Runtime execution and deeper reachability/cycle validation remain later phases.
- Graph snapshots carry `schemaVersion: 1`, nodes and edges. Node IDs combine a
  type prefix and an adapter-normalized locator. Adapters will own POSIX path and
  route normalization; the generic graph does not interpret filesystem paths.
- Edge IDs encode the exact `[type, source, target]` tuple as JSON. Multiple
  observations of the same relation belong in edge metadata, not random IDs.
- Serialization sorts entities by ID and recursively sorts object keys using
  code-unit order. Arrays retain meaningful order. Graph reads return copies;
  duplicate IDs and dangling edges are errors.
- Graph metadata accepts JSON values. Persistence, analysis, model providers and
  UI dependencies are absent from both core packages.

## Alternatives

Recursive condition languages, a central evidence registry, hashed opaque IDs and
database-backed graphs add contracts not needed by Phase 0. They can be considered
with actual analyzer and workflow examples.

## Consequences

Contracts are small and testable. Changing their wire format requires an explicit
schema version decision. Cross-step semantic correctness is not claimed by schema
validation alone. JSON Schema export is deferred; Zod refinements for references
would still need runtime validation even with an exported structural schema.
