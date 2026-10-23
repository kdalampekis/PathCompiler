# ADR 0035 — Formal Product Model semantics

## Context

Phase R0 introduces `@pathcompiler/formal-model`, the solver-independent model
every later reasoning phase encodes (R2 reachability, R3 planning, R8 model
checking, R11 model diffs). Several semantics must be fixed before any solver is
written, or different reasoners would interpret the same model differently.

## Decision

- **Variable scope.** Each variable is `context` (fixed during one reasoning
  query: roles, permissions, feature flags, plan or tenant settings) or `state`
  (business state changed by actions). Actions may not assign context variables.
  Reachability "under context C" fixes context variables. The reasoner explores
  state.
- **Types.** `boolean`, `enum` (declared values), `integer` (optional bounds) and
  `string`. Expressions are a typed AST (`bool`, `var` for boolean variables,
  `not`, `and`, `or`, `eq`, `lt`, `lte`, `gt`, `gte`). No logic is ever parsed
  from strings. Ordering comparisons are integer-only. String literals compared
  with enum variables must be declared values. `implies` and `neq` are
  constructor helpers that expand to the core AST, so solvers see one small
  language.
- **Action semantics.** An action is enabled when its precondition holds in the
  current state. Its effects are **simultaneous assignments**: every right-hand
  term reads the pre-state, and each variable is assigned at most once per action.
  Unassigned variables keep their values (frame rule). Costs default to 1 when
  reasoning about effort.
- **Initial states** are an admissible-set constraint (`initial`), not a single
  snapshot. Context variables are normally left unconstrained, so a query
  chooses them.
- **Invariants** are state properties expected to hold in every reachable state.
  R0 only declares them; checking them begins in R8. **Goals** are state
  conditions with business meaning, an optional capability link and a confidence.
- **Provenance is mandatory.** Every variable, action, invariant and goal carries
  at least one `EvidenceRef` using graph node IDs, the same convention discovery,
  validation and impact analysis already use.
- **Versioning** follows reasoning spec §82: `schemaVersion`, plus `metadata`
  holding `repositoryCommit` (nullable for unbound models), `source`
  (`hand-encoded` or `extracted`), `extractorVersion` and an optional
  `semanticModelVersion`. The reasoner version belongs to results, not to models.
- **Canonical form.** Named collections and evidence are sorted by ID, keys are
  sorted, and expression operand order is preserved. `serializeFormalModel` and
  `formalModelHash` are therefore independent of authoring order.
- **Reference model.** The hand-encoded `next-demo` model lives in
  `packages/formal-model/test/next-demo-model.ts`, as a function of the scanned
  commit (evidence is commit-bound). R1 compares its extracted model against it.
  It is test data, not public API.

## Alternatives

- Graph edges as transitions: cannot express preconditions over several
  variables, effects or invariants (reasoning spec §10).
- Sequential effects within an action: order-dependent and easy to mis-encode.
- Initial snapshot instead of a constraint: cannot ask "is there any admissible
  context where…".
- Ship the fixture model as a package export: test data would leak into the
  public API.

## Consequences

Solvers in R2 and later can encode actions as transition relations with frame
axioms and simultaneous updates, and keep `unknown` distinct from `unreachable`.
The model is deliberately small. Richer constructs (sets, per-entity state,
parameterized actions) need an ADR and a schema version bump when real cases
require them.
