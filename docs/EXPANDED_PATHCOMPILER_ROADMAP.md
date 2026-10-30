# Expanded PathCompiler roadmap

Companion to [EXPANDED_PATHCOMPILER_ARCHITECTURE.md](EXPANDED_PATHCOMPILER_ARCHITECTURE.md).
Phases are named **BX0–BX7** (behavior expansion) because P0–P5 already
exist in the probabilistic track of
[phases/MASTER_ROADMAP.md](phases/MASTER_ROADMAP.md).

## Status

All eight phases are complete (2026-10-30). Each has an ADR and a record in
[phases/STATUS.md](phases/STATUS.md); the as-built differences from the design
are in [the architecture document](EXPANDED_PATHCOMPILER_ARCHITECTURE.md#17-what-was-built-and-where-it-differs-from-the-design);
usage is in [BEHAVIOR_SPEC_GUIDE.md](BEHAVIOR_SPEC_GUIDE.md).

| Phase | Delivered | ADR | CLI |
| --- | --- | --- | --- |
| BX0 | Audit and design | — | — |
| BX1 | `behavior-ir`: rule kinds, expressions, mandatory provenance, lossless Formal Product Model conversion | 0088 | `behavior export`, `validate`, `show` |
| BX2, BX2b | `behavior-extraction`: SQL, Zod, OpenAPI, test assertions, approved rules, guard clauses; ledger and scoring | 0089 | `behavior extract` |
| BX3 | `verification`: router, SMT backend with replayed counterexamples, `solver-z3` arithmetic | 0090 | `behavior verify` |
| BX4 | `pr-guard`: behavior diff, base-versus-head verification | 0091 | `verify-pr` |
| BX5 | `agent-gate`: concrete action checks, tool wrapper, labeled evaluation, log audit | 0092 | `agent check`, `eval`, `audit` |
| BX6 | `counterexamples`: records, store, regression evals | 0093 | `counterexamples …` |
| BX7 | `repair-loop`: bounded, logged, human-approved prototype | 0094 | `repair propose` |

## Results on the evaluation plan

Measured on `fixtures/refunds`, a fixture written alongside the features. The
numbers show the mechanisms behave as designed; none is an estimate of
performance on a real repository.

| Question | Result | Not measured |
| --- | --- | --- |
| RQ1 extraction | 53 facts from 6 files, generated from the extractors and then reviewed against the files: precision 1.0, recall 1.0, provenance correct, all 4 constructs it must refuse reported. **Circular by construction**: it shows consistency, not that a person would find the same facts | An independently written ground truth; any repository the author did not write; rules in called helpers or ORMs |
| RQ2 mechanical share | All 23 extracted-and-approved properties of the base service are in the supported fragment (`UNSUPPORTED` 0) | The fraction of a real codebase's rules that fits the fragment |
| RQ3 regressions tests miss | 3 of 3 seeded regressions found while the example tests pass; 0 of 2 benign changes flagged; about 0.5 s per check | False-negative and false-positive rates on real pull requests |
| RQ4 agent gate | 10 of 10 safe actions allowed; 16 of 18 unsafe blocked (88.9%), 15 with the expected rule named; the 2 missed are described by no rule; 0.09 ms per check | Behavior on real agent traffic; the effect of state supplied by the model |
| RQ5 counterexample evals | The eval fails the violating code, its extracted contract and the verifier, and passes after the repair; a harmless refactor passes | Recurrence of the counterexample and its variants over later commits |
| RQ6 four sets | OBSERVED ∧ ¬ALLOWED via `agent audit`; POSSIBLE ∧ ¬ALLOWED via `verify` | The four-way comparison as a control loop: **not evaluated** |

## Open items for the expansion

Recorded as issues #50–#57 in [phases/ISSUES_LOG.md](phases/ISSUES_LOG.md):
decimals and null in the IR; helper calls and conditionals in the guard
extractor; temporal rules and reachability in the verifier; GitHub and MCP
transports; recurrence measurement; a model-backed repair provider; the thin
ground truth; and the real-software trial.

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

Acceptance: precision and recall against a ground truth for the
refund fixture (as built: generated from the extractors' output, then reviewed); provenance (file, lines, type) is correct for every rule.

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
