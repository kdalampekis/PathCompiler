# Expanded PathCompiler architecture

Status: designed in BX0 (2026-10-29) and implemented through BX7
(2026-10-30). Sections 1–3 describe the repository **before** the expansion
and are kept as the audit; section 17 records what was built and where it
differs from the design below. Phases, results and open items are in
[EXPANDED_PATHCOMPILER_ROADMAP.md](EXPANDED_PATHCOMPILER_ROADMAP.md); how to use
it is in [BEHAVIOR_SPEC_GUIDE.md](BEHAVIOR_SPEC_GUIDE.md).

> **PathCompiler reconstructs how software is allowed to behave from code,
> tests, schemas, policies and runtime traces, then uses that specification
> to verify code changes and agent actions.**

The shared asset is the compiled behavioral specification:

```text
CODEBASE + TESTS + SCHEMAS + API CONTRACTS + PERMISSION LOGIC + CONFIG
+ POLICIES + RUNTIME TRACES + COMMITS
              ↓
   BEHAVIOR / SPECIFICATION EXTRACTION
              ↓
   BehaviorIR  (every rule carries provenance)
              ↓
   VERIFICATION / REASONING LAYER
              ↓
   UX reasoning · PR guard · agent gate · evals · runtime analytics
              ↓
   counterexamples → candidate repair → verification → human review
              ↓
   deploy → observe ↺
```

UX and product paths are one consumer of this specification. Nothing in the
existing workflow, journey, reachability, permission, analytics or commit-diff
functionality is removed or replaced.

This document answers the thirteen questions asked for the audit. The
sections are numbered to match.

## 1. Summary of the current architecture

Before the expansion PathCompiler was a TypeScript (strict, ESM) pnpm monorepo of 56 packages with
no dependency cycles. Facts are derived deterministically wherever possible;
models are optional and always behind a provider interface. Seven tracks
exist:

| Track | What it does | Main packages |
| --- | --- | --- |
| Source analysis | Reads a Next.js repository, builds a product graph with provenance | `source-model`, `adapter-nextjs`, `graph-core`, `test-miner-playwright`, `git-intelligence`, `adapter-github`, `evidence` |
| Product understanding | Surfaces, capabilities, workflow candidates, validation, review | `capability-engine`, `workflow-discovery`, `workflow-validator`, `workflow-review`, `workflow-ir` |
| Runtime and delivery | Compiles approved workflows into headless artifacts | `workflow-compiler`, `resolver`, `sdk-js`, `runtime-core`, `react`, `ui`, `mcp-server`, `http-service`, `assistant-tools` |
| Change tracking | Graph diff, impact, proposals, deprecation, GitHub check | `graph-delta`, `impact-analysis`, `workflow-proposals`, `github-app` |
| Formal reasoning | A solver-neutral Formal Product Model, SMT reachability, plans, explanations, properties, semantic change | `formal-model`, `formal-abstraction`, `reasoner-core`, `solver-provider`, `solver-z3`, `semantic-change`, `reasoning-service` |
| Observation | Semantic events, analytics, ingestion, possible-vs-observed reconciliation, Markov model | `observability-core`, `analytics-sdk`, `observed-graph`, `behavior-reconciliation` |
| Improvement loop | Findings, gate, recommendations, evaluation, experiments, decisions, memory, harness boundary | `findings`, `improvement-gate`, `recommendation-engine`, `candidate-evaluator`, `experiment-core`, `outcome-analysis`, `improvement-memory`, `harness-contracts` |

Cross-cutting: `diagnostics` (error taxonomy, logs, cache), `config`
(`pathcompiler.yaml`, flags), `model-provider*` (opt-in semantic
interpretation), `probabilistic-evidence` (evidence fusion, calibration),
`evaluation` (ground truth and golden tests).

Invariants that carry over unchanged:
- the product graph is a build-time representation, not runtime truth;
- results are hypotheses or candidates, never verdicts, unless reviewed;
- `unknown` is never treated as `unreachable`;
- possible and observed behavior stay separate;
- reports are deterministic;
- all model access goes through a provider interface;
- privacy first: no source contents sent, no secrets logged.

## 2. How existing modules map into the expanded vision

| Expanded concept | Already in the repository |
| --- | --- |
| Specification extraction from code | `adapter-nextjs` (UI, routes, APIs, permissions, flags), `test-miner-playwright` (test traces), `formal-abstraction` (graph + tests → Formal Product Model with coverage and uncertainty records) |
| Intermediate representation | `formal-model`: variables, actions with preconditions and effects, invariants, goals, mandatory evidence, deterministic normalization and hash. Solver-neutral. |
| Provenance | `evidence` (`EvidenceBundle`, source provenance), `workflow-ir` `EvidenceRef` (mandatory on every formal object), `probabilistic-evidence` (reliability tiers, conflicts) |
| Verification layer | `reasoner-core` (reachability, plans, unsat explanations, `verifyProperty` by k-induction, enumeration, optimization) over `SolverProvider` |
| Solver backends | `solver-z3` (WASM Z3 via the neutral `SolverProvider`, now also `optimize`) |
| Commit differential verification | `semantic-change` (R11: reachability and applicability changes between commits, root causes), `candidate-evaluator` (intended versus observed change, protected properties, tests, browser) |
| PR integration | `github-app` check, `impact-analysis`, `workflow-proposals`, `harness-contracts` |
| Counterexamples | `ReasoningTrace` and property counterexamples in `reasoner-core`; `test-generator` turns formal findings into executable Playwright tests |
| Evals | `evaluation` (ground truth, golden tests, reasoning cases), `fixtures/reasoning/{counterexamples,commit-diffs}` |
| Possible vs observed | `behavior-reconciliation`, `observed-graph` |
| Self-improvement loop | `findings` → `improvement-gate` → `recommendation-engine` → `harness-contracts` → `candidate-evaluator` → experiments → `improvement-memory` |
| Agent boundary | `mcp-server`, `reasoning-service` (developer-only), `assistant-tools` give agents read access; there is no action gate yet |

## 3. Gaps

Against the expanded vision, the repository lacked the following. Items 1–9
were closed by BX1–BX7; item 10 is closed only in part (section 17):

1. **A general rule language.** `FormalExpr` compares variables with
   constants or other variables, but has no arithmetic (`balance - amount`),
   no numeric amounts as inputs, and no notion of operation parameters.
   Business rules such as "refund ≤ original payment" or
   "new_balance == old_balance − amount" cannot be written.
2. **First-class rule kinds.** Permissions, temporal rules, data policies,
   business rules and pre/postcondition contracts exist only implicitly
   (permission guards become action preconditions; there is no
   `Permission`, `TemporalRule` or `Operation` object).
3. **Provenance beyond graph evidence.** Evidence refs say where a fact was
   found. They do not say how it was extracted (static analysis, schema
   parse, model, human), whether it is explicit, inferred or human
   approved, or how much to trust it.
4. **Non-UI extractors.** Nothing reads database schemas, ORM or validation
   models, OpenAPI contracts, or assertions for business invariants. The
   analyzer targets Next.js UI, routes, API handlers and Playwright tests.
5. **A verification router.** `reasoner-core` is bound to the Formal Product
   Model and to Z3 through the solver interface. There is no verifier
   interface that other backends (policy evaluation, static analysis,
   property tests) can implement, and no `UNSUPPORTED` result.
6. **Arithmetic in the solver language.** `SolverTerm` has booleans,
   integers, comparison and boolean connectives, not `+`, `−` or constant
   multiplication.
7. **Counterexamples as stored data.** Counterexamples are traces inside
   reports; they have no ID, source, store or lifecycle.
8. **A runtime action gate** between an agent and a tool.
9. **Counterexample → evaluation** generation, and a conservative repair
   loop that does not merge or deploy.
10. **The ALLOWED set.** The model has POSSIBLE (reachable) and OBSERVED
    (events). Behavior that satisfies approved rules (ALLOWED) and behavior
    the product wants (DESIRED) are not separate objects.

Not gaps: workflow extraction, user journeys, UX reasoning, runtime
analytics, role-aware reachability and commit-diff analysis all exist and
stay.

## 4. Proposed BehaviorIR

BehaviorIR is a new, solver-neutral package, `@pathcompiler/behavior-ir`. It
sits above the Formal Product Model: the model is the transition-system
core, and BehaviorIR adds the rule kinds, provenance and an expression
language with arithmetic. It does not import any solver.

```text
BehaviorSpec
  id, repository.commit
  variables[]        state | input | context; boolean | integer | enum | string
  workflows[]        id, entry (state or condition), terminal (states or condition)
  transitions[]      id, workflow?, from?, to?, guard, effects[], provenance
  operations[]       id, parameters[], preconditions[], postconditions[], provenance
  invariants[]       id, expression, provenance
  permissions[]      id, role, action, resource?, constraint?, effect, provenance
  temporalRules[]    id, kind (must_precede | never_after), before, after, provenance
  dataPolicies[]     id, rule, provenance
  businessRules[]    id, when, must, provenance            (when X holds, Y must hold)
```

Expressions are a small typed tree, not strings, with a text syntax for
authoring and for readable counterexamples:

```text
literal · var(id) · old(id)          (old = pre-state, in postconditions)
+ − ×(constant)                      linear arithmetic
== != < <= > >=
and · or · not · implies
```

Example: `refund > 5000 implies manager_approval == true`.

Provenance is mandatory on every rule:

```text
sourceType      TEST | DATABASE_SCHEMA | ORM_MODEL | VALIDATION_MODEL | OPENAPI |
                SOURCE_CODE | CONFIG | POLICY_DOCUMENT | HUMAN_DECLARATION |
                RUNTIME_TRACE | INFERRED
origin          EXPLICIT | INFERRED | HUMAN_APPROVED
extractionMethod  STATIC_ANALYSIS | SCHEMA_PARSE | LLM_ASSISTED | HUMAN | OBSERVATION | FORMAL_MODEL
extractorVersion, confidence (HIGH | MEDIUM | LOW)
sourceFile + sourceLines     required for file-based source types
declaredBy                   required for HUMAN_DECLARATION and HUMAN_APPROVED
evidence[]                   optional graph EvidenceRefs (kept so UX rules round-trip)
```

The IR keeps three kinds of statement apart, everywhere:
- what the system **does** (transitions, operations);
- what the specification **requires** (invariants, permissions, rules);
- how much to **trust** a requirement (provenance, never mathematical
  truth).

Deterministic serialization: collections sorted by ID, keys sorted, a
SHA-256 hash of the canonical form, the same approach as the Formal Product
Model.

Mapping from the existing model (lossless for the boolean/enum/integer
fragment the model already uses):

| Formal Product Model | BehaviorIR |
| --- | --- |
| variable (`state`/`context`) | variable (scope `state`/`context`) |
| action | transition (guard, effects, capability, semantic target, cost) |
| invariant | invariant (provenance from its evidence) |
| goal | workflow terminal condition (business meaning kept) |
| `initial` | workflow entry condition |

## 5. Architecture diagram

```text
             ┌──────────────────────── EXTRACTION ────────────────────────┐
 Next.js UI  │ adapter-nextjs · test-miner-playwright · formal-abstraction │ (exists)
 tests       │ assertion extractor                                          │ BX2
 DB schemas  │ schema extractor (SQL DDL)                                   │ BX2
 validation  │ Zod / TypeScript type extractor                              │ BX2
 OpenAPI     │ OpenAPI extractor                                            │ BX2
 permissions │ authorization extractor                                      │ BX2
             └────────────────────────────┬────────────────────────────────┘
                                          ↓
                        BehaviorIR  +  provenance           (BX1)
                                          ↓
                          Verification Router               (BX3)
        ┌───────────────┬─────────────────┬───────────────┬──────────────┐
   SMT backend      reachability        policy eval     (future: model
   (solver-z3,      (reasoner-core,     (rules over     checking, static
   linear arith.)   formal model)       an action)      analysis, PBT)
        └───────────────┴─────────────────┴───────────────┴──────────────┘
                                          ↓
              VERIFIED | VIOLATED (+ counterexample) | UNKNOWN | UNSUPPORTED
                                          ↓
   ┌──────────────┬────────────────┬───────────────┬─────────────┬────────────┐
   UX / product   PR guard (BX4)    Agent gate      Evals         Runtime
   reasoning      base vs head      (BX5)           (BX6)         analytics
   (exists)       differential      action+state    counterexample possible vs
                                    → PASS / BLOCK  → regression  allowed vs
                                                    eval          observed
   └──────────────┴────────────────┴───────────────┴─────────────┴────────────┘
                                          ↓
                         Counterexample store (BX6)
                                          ↓
                    Candidate repair (BX7) → verification → human review
```

## 6. Phased implementation roadmap

See [EXPANDED_PATHCOMPILER_ROADMAP.md](EXPANDED_PATHCOMPILER_ROADMAP.md). The
phases are named BX0–BX7 to avoid colliding with the P0–P5 phases of the
probabilistic track.

## 7. What can reuse existing code

| New work | Reuses |
| --- | --- |
| BehaviorIR serialization, hashing, evidence refs | `formal-model` canonicalization pattern, `workflow-ir` `EvidenceRef` |
| IR ↔ Formal Product Model conversion | `formal-model`, so UX reasoning and every R-phase command consume the same IR |
| Z3 backend | `solver-provider` and `solver-z3` (extended with linear arithmetic and `optimize`, which already exists) |
| Reachability and workflow questions | `reasoner-core` unchanged |
| PR differential verification | `semantic-change` (model comparison and root causes), `graph-delta`, `analyzeCommitRangeDetailed` |
| Candidate PR checks | `candidate-evaluator` (protected properties, unexpected changes) and the GitHub check |
| Counterexample → eval | `test-generator` (executable tests), `evaluation` (machine-checkable cases), `fixtures/reasoning` |
| Possible/allowed/observed | `behavior-reconciliation` and `observed-graph` |
| Agent gate transport | `mcp-server`, `http-service`, `reasoning-service` patterns (token-gated, schema-validated) |
| Repair loop | `harness-contracts` (task, result, lineage) and `improvement-memory` |
| Error taxonomy, logs, cache | `diagnostics` |

## 8. What requires new modules

| Module | Purpose |
| --- | --- |
| `@pathcompiler/behavior-ir` | The IR, expression language, provenance, serialization, conversion (BX1) |
| `@pathcompiler/behavior-extraction` | Deterministic extractors for tests, SQL schemas, Zod, OpenAPI, authorization (BX2) |
| `@pathcompiler/verification` | `Verifier` interface, router, SMT backend, rule-evaluation backend, counterexamples (BX3) |
| `@pathcompiler/pr-guard` | Behavior diff and differential verification (BX4) |
| `@pathcompiler/agent-gate` | Framework-neutral action verification (BX5) |
| `@pathcompiler/counterexamples` | Counterexample model, store, eval generation and runner (BX6) |
| `@pathcompiler/repair-loop` | Conservative candidate repair with an auditable trace (BX7) |

CLI commands follow the existing style (`pathcompiler behavior …`,
`verify-pr`, `gate`). `gate` already means the improvement gate, so the agent
gate is `pathcompiler agent check`.

## 9. Technical risks

1. **Expressiveness versus decidability.** Linear integer arithmetic with
   booleans and bounded enums is decidable and fast. Non-linear arithmetic,
   strings, collections and quantifiers are not supported: the verifier must
   return `UNSUPPORTED`, never guess.
2. **Extraction is heuristic.** Assertions and `if` statements do not map
   cleanly to rules. Extractors must be conservative, return fewer rules,
   and mark everything non-explicit as `INFERRED`.
3. **Static diff soundness.** A behavior diff between two commits is only as
   good as the extracted model of each. A missed code path gives a false
   "no regression". The guard reports coverage of what it modeled.
4. **State modeling.** Real systems have unbounded data. The IR models
   chosen variables only; a violation in the model may not be reachable in
   the real system, and the reverse.
5. **Runtime gate overhead.** The gate must be fast and fail safe: the
   behavior on `UNKNOWN`/`UNSUPPORTED` must be an explicit policy (block or
   allow), not a default.
6. **Z3 in WASM.** Memory and thread behavior already needed care (one
   context per check). The router must keep that discipline.

## 10. Research risks

1. **RQ1/RQ2:** the extractable fraction of a real specification may be small.
   Tests and schemas encode few business rules; most rules live in code.
   Measured honestly on fixtures first.
2. **RQ3:** a PR guard that finds only regressions the author already
   suspects is not useful. It needs seeded regressions that ordinary tests
   miss, with ground truth.
3. **RQ5:** counterexample-derived evals prevent recurrence of that
   counterexample, not the class of bug. Measure recurrence of variants.
4. **RQ6:** POSSIBLE/ALLOWED/OBSERVED/DESIRED as a control loop is a
   conceptual claim. It is evaluated by whether the four-way comparison
   surfaces actionable findings that two-way comparison misses.
5. **Specification correctness.** A verifier proves a property relative to
   an encoded specification. If the specification was extracted wrongly,
   the proof is about the wrong thing. This is why provenance is mandatory
   and why human approval is a first-class state (see section 14).

## 11. The narrowest credible MVP

One narrow, fully modeled domain, refunds, with hand-checked ground truth:

1. BehaviorIR for the refund domain, with provenance, written as a
   specification and partly extracted (a Zod validation model, an OpenAPI
   contract and test assertions).
2. A verifier that proves or refutes each invariant against a candidate
   operation, with counterexamples.
3. `verify-pr` on two commits of a small refund service: the AI-generated
   change introduces a path that the original code did not have.
4. The same specification blocking the same action at runtime through the
   agent gate.
5. The counterexample becomes a permanent regression evaluation that fails
   before the repair and passes after it.

## 12. Flagship demo design

A fixture application, `fixtures/refunds`, a small TypeScript service (no
framework) with:
- roles: `support_agent`, `manager`, `customer`;
- operations: `refund`, `approve_refund`, `process_refund`;
- state: payments with `originalAmount` and `refundedAmount`, and refund
  requests with `approved` and `processed` flags.

Invariants:

```text
balance >= 0
refund <= original_payment
refund > 5000 implies manager_approval == true
support_agent cannot approve their own refund
a processed refund cannot be processed twice
```

Act 1, **existing service:** all invariants hold (VERIFIED).
Act 2, **AI-generated PR:** adds a "fast refund" path that skips the
approval check when a flag is set. The existing tests pass.
`pathcompiler verify-pr --base main --candidate HEAD` reports a
`support_agent` refunding more than 5000 without `manager_approval` as a
violation that holds in the candidate and not at the base, with the
provenance of the violated rule. (The implemented demo uses an exemption
`actor.role !== "support_agent"` in the approval guard; the counterexample the
solver returns is `refund.amount = 5001`.)
Act 3, **runtime:** an agent proposes `refund(7000)` as `support_agent`.
The gate returns `BLOCK` and names the violated rule, the values that violate
it and the precondition that fails.
Act 4, **learning:** the counterexample becomes a regression eval. It
fails on the candidate and passes after a verified repair. The repair is
proposed, never merged automatically.

## 13. Tests and evaluation strategy

Every claim is measured against fixture ground truth created with the
fixtures themselves, so correctness is exact rather than judged.

| Area | Ground truth | Measures |
| --- | --- | --- |
| Extraction | A hand-written specification per fixture file | Precision and recall of extracted rules, provenance correctness (file, lines, source type) |
| Verification | Rules with known satisfying and violating assignments | Violation detection, false positives and negatives, counterexample validity (replaying the counterexample against the rule must violate it) |
| PR guard | Seeded regressions in fixture commits, including ones tests pass | Detection rate, false-alarm rate on benign commits, runtime |
| Agent gate | Labeled safe and unsafe action sets | Unsafe block rate, safe allow rate, false-block rate, decision latency |
| Repair loop | Seeded violations with known repairs | Repair success, iterations, recurrence after the counterexample became an eval |

Engineering checks per milestone: `pnpm lint`, `pnpm typecheck`,
`pnpm test`, and the e2e suite when browser behavior changes. Determinism
tests assert identical output for identical input.

## 14. What this does and does not claim

PathCompiler keeps two questions apart:
- **Specification correctness:** is the extracted rule the real business
  rule?
- **Verification correctness relative to the specification:** given the
  encoded rules and modeled state, does the checked property hold?

> Given the encoded specification and modeled system state, the verifier can
> establish whether the checked property holds within the supported model.

Nothing here is "guaranteed business correctness", "zero risk" or "the
solver is ground truth". A rule extracted from a test is a candidate with
provenance until a human approves it. A property reported as `VERIFIED` is
verified for the modeled variables and the supported fragment, and the
result says which. `UNKNOWN` and `UNSUPPORTED` are results, never silently
treated as safe.

## 15. Four sets of behavior

The existing POSSIBLE-versus-OBSERVED distinction extends to four sets:

| Set | Meaning | Source |
| --- | --- | --- |
| POSSIBLE | Behavior the system can reach | Formal reachability over the transition system (exists) |
| ALLOWED | Possible behavior that satisfies the approved rules | BehaviorIR rules (BX1, BX3) |
| OBSERVED | Behavior seen in production | Runtime events (exists) |
| DESIRED | Behavior implied by goals, evals and product policy | Goals, acceptance criteria, evals (exists in pieces; BX6 adds evals) |

Useful comparisons:
- **possible ∧ ¬allowed:** a latent violation (what the PR guard looks for);
- **observed ∧ ¬allowed:** a violation that already happened;
- **allowed ∧ ¬observed:** unused, valid behavior (today's possible-but-unobserved);
- **desired ∧ ¬possible:** a missing capability;
- **observed ∧ ¬possible:** the model is wrong (today's unexpected observation).

## 16. Non-goals

Superseded in part by [PRODUCT_NORTH_STAR.md](PRODUCT_NORTH_STAR.md), which
sets the end goal: any business, any codebase, harness-integrated. As of
2026-10-30:

- **In scope now (BX10–BX16):** universal change assessment, tools for
  harnesses (MCP, function-calling schemas, SDK), agentic software as a rule
  source, checking an answer before it renders, **datasets for alignment and
  post-training**, and downloadable packages.
- **Still out of scope:** arbitrary-program verification (proof of an entire
  program), semantic equivalence across languages, autonomous deployment, and
  the **training loop** itself (fine-tuning, DPO and RL runs). The datasets
  that such a loop would consume are in scope; running the loop is not.

## 17. What was built, and where it differs from the design

All ten phases (BX0–BX9) are implemented and merged; each has an ADR (0088–0096) and a
verification record in [phases/STATUS.md](phases/STATUS.md). The design above
held, with these differences, which matter if you rely on it:

| Design | As built |
| --- | --- |
| The router fronts several backends: SMT, reachability, policy evaluation | The router has **one** verifier, the SMT backend. Policy evaluation on concrete values is the **agent gate**, a separate API and not a router backend. The reachability reasoner stays on the Formal Product Model and is not routed. |
| `verification` has a rule-evaluation backend | That lives in `agent-gate`. |
| PR differential verification reuses `semantic-change` and `graph-delta` | The PR guard extracts BehaviorIR at both revisions and compares **properties and extracted contracts**. `semantic-change` and `graph-delta` still serve the UX track and were not reused. |
| Counterexamples → evals reuse `test-generator` | Evals are concrete action cases run against an executor (code behind an adapter, the extracted contract, or the verifier); `test-generator` (Playwright) was not reused. |
| The repair loop reuses `harness-contracts` and `improvement-memory` | It has its own provider boundary (`RepairProvider`) and report; the harness contracts were not reused. |
| An authorization extractor reusing Next.js permission edges | Role checks are read from guard clauses (`if (actor.role !== …) throw`) and become `allow` permissions; the Next.js permission edges are not used. |
| (not in the design) A harness or model that reads code and commits to find rules | **BX8, added later**: `rules task/import/discover`. Proposals are candidates with inferred, model-assisted provenance, validated for evidence and checked against the code, and become approved rules only when a person runs `rules approve`. This is a narrow form of the deferred `analysis_backend: external_harness` of ADR 0034: it finds *rules*, not the product model. |
| (not in the design) Running the harness | **BX9, added later**: `harness run` executes a harness command in an isolated worktree and decides by mode (`approval` or `automatic`) what happens to the candidate; the assessment merges deterministic checks with the harness's own report. See ADR 0096 and `docs/HARNESS_HANDOFF_STATUS.md`. |
| Ground truth written by hand per fixture file (section 13) | Generated from the extractors' output, then reviewed fact by fact. Precision and recall of 1.0 are therefore weak evidence; an independent ground truth is an open item. |
| `ALLOWED` and `DESIRED` as separate objects (section 15) | **Partly.** POSSIBLE ∧ ¬ALLOWED is `verify` / `verify-pr`; OBSERVED ∧ ¬ALLOWED is `agent audit` (replay a log of actions). ALLOWED ∧ ¬OBSERVED, DESIRED ∧ ¬POSSIBLE and OBSERVED ∧ ¬POSSIBLE for the new rules are not built; RQ6 is therefore **not evaluated**. |
| Verification of the transition system from the initial state | One execution of one operation from **any state satisfying the invariants** (inductive). A `VIOLATED` counterexample may start in an unreachable state; the result says so. Temporal rules exist in the IR but no verifier checks them. |

Additions the design did not list: `dataConstraints` in the IR (null,
uniqueness, keys: recorded, not verified); `appliesTo` on rules and
`limitations` on operations (so a verifier knows when extracted preconditions
may be weaker than the code); a vacuity check on proofs; the `relevant` field
that keeps counterexamples readable; `approved_only` enforcement in the gate;
the rule that a PR is judged against the base's approved rules.

Package count after the expansion: 65 (nine new: `harness-runner`, `rule-discovery`, `behavior-ir`,
`behavior-extraction`, `verification`, `pr-guard`, `agent-gate`,
`counterexamples`, `repair-loop`).
