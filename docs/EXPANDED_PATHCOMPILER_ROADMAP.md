# Expanded PathCompiler roadmap

Companion to [EXPANDED_PATHCOMPILER_ARCHITECTURE.md](EXPANDED_PATHCOMPILER_ARCHITECTURE.md).
Phases are named **BX0–BX16** (behavior expansion) because P0–P5 already
exist in the probabilistic track of
[phases/MASTER_ROADMAP.md](phases/MASTER_ROADMAP.md). BX0–BX7 were the original
plan; BX8 onwards were added at the owner's direction and are governed by
[PRODUCT_NORTH_STAR.md](PRODUCT_NORTH_STAR.md). Phase numbers after BX11 were
reassigned on 2026-10-30; older documents that say BX12 or BX13 mean what is
now BX14 and BX15.

## Status

BX0–BX15 are complete (2026-10-31); BX16 (packaging) waits for the real-software
trial and is not started. Each phase has an ADR and a record in
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
| BX8 | `rule-discovery`: a harness (file contract) or a model (provider adapters) proposes rules from code and history; validated, checked against the code, stored as candidates, approved by a person | 0095 | `rules task`, `import`, `discover`, `list`, `approve`, `reject` |
| BX9 | `harness-runner`: the harness handoff implemented. A harness command runs in an isolated worktree; the candidate is assessed independently; **approval** and **automatic** modes decide what happens next; never merges or deploys; a JSON-command protocol lets a harness serve analysis, rule discovery and repair | 0096 | `harness run`, `runs`, `status`, `approve`, `reject`; `--harness-command` on `rules discover` and `repair propose` |
| BX10 | Stack-neutral change assessment: project checks of any ecosystem compared with the base, risk signals from the diff in any language, an independent reviewer, configurable vouching | 0097 | `harness detect`; `--review-command` |
| BX11 | `agent-tools`: one registry of tools for harnesses served as an MCP server, function-calling schemas and an SDK; `check_change` self-checks uncommitted work | 0098 | `mcp-agent`, `tools list`, `tools call` |
| BX12 | The behavior contract: a language-neutral description of what code does, anchored to the code so changes are noticed; approval cannot be self-granted by a pull request | 0099 | `contract task`, `status`, `import`, `approve` |
| BX13 | Adoption layer: readiness report, CI mode with report-only rollout, documents in the discovery task, the adoption audit | 0100 | `start`, `ci` |
| BX14 | `alignment-data`: opt-in capture of checks, outcomes and human decisions; preference, SFT, reward and eval datasets with a dataset card; structure-only by default | 0101 | `feedback summary`, `list`; `dataset export`; `--record` |
| BX15 | Agentic software: tool definitions (OpenAI, Anthropic, MCP) as a rule source; the answer check before rendering with declared answer policies | 0102 | tool `pathcompiler_check_output` |
| BX16 | Packaging (Apache-2.0, `@pathcompiler/*`): **not started**, after the real-software trial | 0103 (decisions) | — |

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
| RQ7 (added) rule discovery by a harness or model | Scripted proposals on the fixture: valid rules accepted with code check `holds`; a rule the code contradicts flagged; invented variables, unverifiable quotes, syntax errors, duplicates and re-proposed rejected rules refused | How many valid rules a real harness or model finds, how many bugs it encodes as rules, what it costs |
| RQ6 four sets | OBSERVED ∧ ¬ALLOWED via `agent audit`; POSSIBLE ∧ ¬ALLOWED via `verify` | The four-way comparison as a control loop: **not evaluated** |

## Open items for the expansion

Recorded as issues #50–#57, #63 and #64 in [phases/ISSUES_LOG.md](phases/ISSUES_LOG.md):
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

## Later

Considered only later: arbitrary invariant inference, temporal and
model-checking backends, autonomous merging and deployment, and the training
loop itself. (Fine-tuning *datasets*, harness tools, agentic software and
downloadable packages moved into scope and are built or planned as BX10–BX16:
see [PRODUCT_NORTH_STAR.md](PRODUCT_NORTH_STAR.md).) What the real-software
trial finds ([REAL_SOFTWARE_TRIAL.md](REAL_SOFTWARE_TRIAL.md)) sets the next
phase; the open limits are ISSUES_LOG #73–#77.

## Evaluation plan

Measured on the refund fixture and on the Next.js fixture:

| Area | Metric |
| --- | --- |
| Extraction | precision, recall, provenance correctness |
| Verification | violation detection, false positives and negatives, counterexample validity |
| PR guard | seeded-regression detection, benign false alarms, runtime |
| Agent gate | unsafe block rate, safe allow rate, false-block rate, latency |
| Repair loop | repair success, iterations, recurrence after the eval |
| Change assessment (BX10) | how often project checks alone vouch for a change, noise of the risk heuristics, reviewer precision (**not measured**, #71) |
| Behavior contract (BX12) | share of operations described correctly by a harness, stale detection (**not measured on real code**, #73) |
| Answer check (BX15) | share of commitments a caller lists, policy false alarms (**not measured**, #77) |
| Datasets (BX14) | label agreement with humans, usefulness for post-training (**not measured**, #76) |
