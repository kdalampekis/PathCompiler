# Expanded PathCompiler roadmap

Companion to [EXPANDED_PATHCOMPILER_ARCHITECTURE.md](EXPANDED_PATHCOMPILER_ARCHITECTURE.md).
Phases are named **BX0–BX7** (behavior expansion) because P0–P5 already
exist in the probabilistic track of
[phases/MASTER_ROADMAP.md](phases/MASTER_ROADMAP.md).

Rules for every phase (from AGENTS.md):
- one coherent commit per milestone, after lint, typecheck, tests and build;
- `docs/phases/STATUS.md` updated; deviations and errors recorded;
- no removal of existing functionality; deterministic output;
- results are hypotheses unless reviewed; provenance everywhere;
- no model vendor dependency in core packages.

## Research questions

| # | Question | Measured by |
| --- | --- | --- |
| RQ1 | Can useful behavioral specifications be reconstructed automatically from existing artifacts? | Extraction precision and recall against fixture ground truth |
| RQ2 | How much of the extracted specification can be verified mechanically rather than probabilistically? | Share of extracted rules in the supported fragment; `UNSUPPORTED` rate |
| RQ3 | Can an explicit BehaviorIR detect business-logic regressions that ordinary tests miss? | Seeded regressions whose tests pass but whose rules fail |
| RQ4 | Can the same specification protect autonomous agent actions at runtime? | Unsafe block rate, safe allow rate, false-block rate |
| RQ5 | Can verified counterexamples improve future behavior through generated regression evaluations? | Recurrence of the counterexample and its variants |
| RQ6 | Can POSSIBLE / ALLOWED / OBSERVED / DESIRED provide a useful control loop? | Findings the four-way comparison surfaces that the two-way comparison misses |

## BX0 — Architecture audit (this document set)

Deliverables: the architecture document and this roadmap.
Acceptance: the thirteen audit questions are answered; no code changes.

## BX1 — BehaviorIR and provenance

Package `@pathcompiler/behavior-ir`.

- Variables, workflows, transitions, operations, invariants, permissions,
  temporal rules, data policies and business rules.
- Expression tree with linear arithmetic and `old()`; a text syntax with a
  parser and printer.
- Mandatory provenance on every rule, with validation of source-type
  requirements.
- Deterministic normalization, serialization and hash.
- Conversion from and to the Formal Product Model, so existing UX reasoning
  consumes the same IR.
- CLI: `pathcompiler behavior validate <file>` and `behavior show <file>`.

Acceptance:
- the Next.js fixture's formal model converts to BehaviorIR and back to an
  equal model;
- invariants, permissions, pre/postconditions and temporal rules validate
  and serialize identically regardless of authoring order;
- a rule without provenance is rejected, and every error is actionable.

## BX2 — Deterministic extractors

Package `@pathcompiler/behavior-extraction`. High-confidence sources first,
no model inference:

1. SQL DDL: `NOT NULL`, `UNIQUE`, `CHECK`, foreign keys, enums.
2. Zod schemas and TypeScript validation models.
3. OpenAPI: required parameters, numeric bounds, enums, status contracts,
   security requirements.
4. Test assertions that are safely extractable (`expect(x).toBeGreaterThanOrEqual(0)`).
5. Explicit authorization checks (role comparisons), reusing the Next.js
   permission edges.

Every rule is `EXPLICIT` only when it was read verbatim from a declaration;
rules lifted from assertions or conditions are `INFERRED`. Extraction is
conservative: unsupported constructs are listed, not guessed.

Acceptance: precision and recall against a hand-written ground truth for the
refund fixture; provenance (file, lines, type) is correct for every rule.

## BX3 — Verification router and SMT backend

Package `@pathcompiler/verification`.

- `Verifier` interface: `supports(property)` and `verify(request)`.
- Router that picks the first supporting verifier and reports
  `UNSUPPORTED` honestly.
- SMT backend over the existing `SolverProvider`, extended with linear
  integer arithmetic.
- Results: `VERIFIED`, `VIOLATED` (with a counterexample), `UNKNOWN`,
  `UNSUPPORTED`; each states the supported fragment it used.
- Property forms: invariant preserved by an operation, precondition
  sufficiency, permission constraint, business rule (implication).

Acceptance: invariant + candidate operation → `VERIFIED` or `VIOLATED` with a
concrete counterexample, which replays as a violation.

## BX4 — Behavior diff and PR guard

Package `@pathcompiler/pr-guard`.

- Model each commit, diff the behavior (changed transitions, operations,
  permissions), and verify the rules at base and at head.
- Report new reachable violations: unreachable at base, reachable at head.
- CLI: `pathcompiler verify-pr --base <ref> --candidate <ref>`; exit status
  nonzero on a regression.
- Counterexamples are stored (see BX6's model).
- GitHub integration is later; the API is the product.

Acceptance: seeded regressions in the refund fixture are found, benign
commits are not flagged, and tests-pass-but-rule-fails cases exist.

## BX5 — Agent action gate

Package `@pathcompiler/agent-gate`.

- `verifyAction({ action, actor, state })` → `PASS` or `BLOCK` with the
  violated rule, the missing precondition and a counterexample.
- Framework-neutral interceptor wrapping a tool function; an explicit policy
  for `UNKNOWN`/`UNSUPPORTED` (default: block).
- CLI: `pathcompiler agent check`; an optional HTTP/MCP adapter later.

Acceptance: valid actions pass, invalid actions are blocked with an
explanation, missing preconditions are named; measured on labeled sets.

## BX6 — Counterexample → eval

Package `@pathcompiler/counterexamples`.

- Counterexample record (ID, rule, trigger, action, state, violation, commit,
  time) and a file store.
- Generator for machine-checkable regression evals from a counterexample,
  and a runner.
- Acceptance: the eval fails on the violating spec or candidate and passes
  after a verified repair.

## BX7 — Closed repair loop (prototype)

Package `@pathcompiler/repair-loop`.

- Violation → counterexample → structured feedback → a candidate repair from
  a provider (or the fixture provider) → verification → tests → report.
- Bounded iterations; every step is logged. Nothing is merged or deployed.

Acceptance: a seeded violation is repaired within a few iterations on the
fixture, the trace is auditable, and human approval remains required.

## After BX7

Considered only later: arbitrary invariant inference, temporal and
model-checking backends, autonomous PR generation, deployment, and
fine-tuning datasets.

## Evaluation plan

Measured on the refund fixture and on the Next.js fixture:

| Area | Metric |
| --- | --- |
| Extraction | precision, recall, provenance correctness |
| Verification | violation detection, false positives and negatives, counterexample validity |
| PR guard | seeded-regression detection, benign false alarms, runtime |
| Agent gate | unsafe block rate, safe allow rate, false-block rate, latency |
| Repair loop | repair success, iterations, recurrence after the eval |
