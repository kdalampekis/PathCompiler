# ADR 0086 — Harness contract (I2)

## Context

Mode 6 hands improvement tasks to an external coding harness, which PathCompiler
does not build (handoff §1–§5). The handoff (§7–§16, §57–§59) defines a
`HarnessTaskSpec` going out and a `MutationResult` coming back. Both are
versioned, validated before use, provider-neutral and lineage-preserving,
and the harness never grades itself (§6). The roadmap asks for:
- JSON Schema plus Zod;
- round-trip serialization;
- rejection of unsupported major versions;
- a fixture harness;
- `examples/harness-contract/` and `fixtures/harness/`.

## Decision

- **New `@pathcompiler/harness-contracts`:**
  - **Strict Zod schemas** for both artifacts. Unknown fields are rejected
    rather than interpreted (§57).
  - **Versions:** `schemaVersion` is `major.minor`; only major 1 is read.
  - **`contractJsonSchemas()`** generates the JSON Schemas.
- **`createHarnessTask`:**
  - it is only for a gate decision `eligible_for_harness` on a
    harness-eligible recommendation, which needs mode 6 enabled twice
    (ADR 0079);
  - **intended changes:** formal acceptance checks become
    restore-reachability and remove-reachability intents, IMPROVE becomes
    reduce-workflow-cost, and PROMOTE becomes increase-discoverability;
  - **constraints:** R8 property refs, and the other approved workflows,
    which must stay valid;
  - **acceptance criteria and lineage** (finding IDs, recommendation ID,
    report sources) are carried over;
  - **requested artifacts** include preview instructions (§40).
- **`parseMutationResult(result, task)`** checks that the result answers the
  task (task ID, recommendation and base commit), and that a completed or
  partial result names a candidate commit.
- **`evaluationCriteria(task, result)`** builds I3 criteria: expected
  reachability changes from the intents, plus the mutation's claim mapped
  to success, partial or failed. The claim is recorded, never trusted.
- **`runFixtureHarness`** completes on a given candidate, or blocks with a
  reason. Blocking is a valid outcome (§13, §52).
- **Files:**
  - `examples/harness-contract/`: the schemas, a task, a completed result,
    a blocked result, and a README;
  - `fixtures/harness/{tasks,results}/`, which resolves ISSUES_LOG #27;
  - a test fails if the schemas drift from the code.
- **CLI.** `harness task <recommendation-id> <base-commit>` writes
  `harness/tasks/<id>.json`.

## Alternatives

- **Snake-case YAML, as in the handoff examples.** JSON with camelCase
  matches every other PathCompiler artifact. The handoff calls its shapes
  conceptual (§7).
- **Lenient parsing of unknown fields.** §57 says not to interpret unknown
  fields with possibly dangerous semantics.

## Consequences

- I9 imports a `MutationResult` and runs candidate evaluation with criteria
  frozen from the task.
