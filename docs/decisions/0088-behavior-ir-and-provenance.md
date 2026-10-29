# ADR 0088 — BehaviorIR and mandatory provenance (BX1)

## Context

The expansion (docs/EXPANDED_PATHCOMPILER_ARCHITECTURE.md) generalizes
PathCompiler from workflow and UX understanding into a compiler from
software artifacts to an explicit behavioral specification. UX reasoning, PR
verification, an agent action gate and counterexample evals are consumers of
that specification.

The Formal Product Model already is a solver-neutral transition system with
mandatory evidence. It lacks arithmetic, operation parameters, and first-class
permissions, temporal rules, data policies and business rules. Its evidence
says where a fact was found, not how it was extracted or how far to trust
it.

## Decision

- **New `@pathcompiler/behavior-ir`.** It adds, and removes nothing:
  - **Rule kinds:** variables (state, input, context), workflows,
    transitions, operations (parameters, pre/postconditions, effects),
    invariants, permissions (allow/deny with constraints), temporal rules
    (`must_precede`, `never_after`), data policies and business rules
    (`when` ⇒ `then`).
  - **Expressions:** a typed tree with linear arithmetic, comparisons,
    boolean connectives, implication and `old(x)`, plus a text syntax whose
    parser and printer round-trip. The same text appears in counterexamples
    and reports. An evaluator replays a state against an expression, which
    is how counterexamples will be checked.
  - **Validation:** unique IDs, rule IDs unique across kinds (so a
    counterexample can cite one rule), declared variables, scope rules
    (`old()` only in postconditions; only state variables are updated;
    parameters are inputs), types, enum membership and state references.
  - **Determinism:** collections and provenance sorted, keys sorted,
    SHA-256 hash.
- **Provenance is mandatory on every rule**, in the schema, not by convention:
  - source type (TEST, DATABASE_SCHEMA, ORM_MODEL, VALIDATION_MODEL,
    OPENAPI, SOURCE_CODE, CONFIG, POLICY_DOCUMENT, HUMAN_DECLARATION,
    RUNTIME_TRACE, INFERRED);
  - origin (EXPLICIT, INFERRED, HUMAN_APPROVED);
  - extraction method, extractor version, confidence (HIGH, MEDIUM, LOW),
    and optional score;
  - file and line range, or graph evidence, for file-based sources;
  - `declaredBy` for human declarations and approvals.

  A rule found with model assistance cannot be EXPLICIT, and an INFERRED
  source cannot be EXPLICIT: only a human approval raises trust. A rule is
  only as sure as its weakest source (`weakestConfidence`).
- **Conversion to and from the Formal Product Model**, lossless for the
  model's fragment (tested on the hand-encoded model and on the model
  extracted from the Next.js fixture). Everything outside the fragment is
  returned as an `omitted` list with a reason, never dropped silently. This
  keeps every existing reasoning command usable on the same specification.
- **CLI:** `behavior export` (existing analysis → `reports/behavior-spec.json`),
  `behavior validate` and `behavior show`.
- **Language:** the brief's examples are Python-flavored; the repository is
  TypeScript, so interfaces are TypeScript and specification files are JSON.

## Alternatives

- **Extending `FormalExpr` with arithmetic.** That would change a contract
  that R-phase reasoners, goldens and the generated tests depend on. A new
  layer that converts to it is additive and reversible.
- **Strings for expressions.** Unvalidated strings defer errors to a solver.
  A typed tree with a text syntax gives both.
- **Optional provenance.** The brief calls it critical. A schema that
  allows rules without a source would make "unsupported by evidence"
  indistinguishable from "unknown".

## Consequences

- Specifications from extractors (BX2) and the verification layer (BX3) have a
  stable, reviewable target.
- A verified property is verified relative to this specification.
  Provenance is what lets a reader judge whether the specification is the
  business's.
- Permissions are constraints on execution; the absence of a permission
  rule means unconstrained, not denied. A closed-world default is a policy
  choice left to BX3.
