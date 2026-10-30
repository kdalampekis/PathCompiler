# PathCompiler master roadmap

Status as of 2026-10-30. Every phase in this document is complete except C6
(alpha validation, which needs the user's repositories). The behavioral
specification expansion (BX0–BX7: BehaviorIR, extraction, verification, PR
guard, agent gate, counterexample evals, repair loop) was added after these
phases and is tracked in
[the expanded roadmap](../EXPANDED_PATHCOMPILER_ROADMAP.md). This document is
dependency-ordered, not sequential.

Sources: `CODEX_BUILD_SPEC.md` (original phases 0–30 and cross-cutting contracts
§§43–96), `REASONING_ENGINE_BUILD_SPEC.md` (R, P, O and I tracks) and
`HARNESS_ENGINEERING_HANDOFF.md` (external harness boundary). Decisions that
reconcile them are in [ADR 0032](../decisions/0032-integrate-reasoning-observability-improvement-tracks.md),
[ADR 0033](../decisions/0033-product-planes-operating-modes-and-improvement-gating.md)
(planes, operating modes, selective improvement) and
[ADR 0034](../decisions/0034-ai-integration-channels.md) (model providers vs MCP vs
external harness).
Per-phase verification records stay in [STATUS.md](STATUS.md).

**Status legend:** ✅ complete · 🟢 unblocked (all prerequisites met) · 🔒 blocked
(prerequisites listed) · ⏸ deferred (intentionally not scheduled).

---

## 0. Product shape

### 0.1 One foundation, three planes

```text
                 LIVING PRODUCT MODEL + WORKFLOW MODEL
        (Product Intelligence plane: evidence → graph → capabilities →
         workflows → formal reasoning → probabilistic evidence →
         observed behavior → reconciliation → diagnosis)
                      /                          \
                     /                            \
        EXPERIENCE plane                    IMPROVEMENT plane (optional)
        resolver · SDK · React/UI ·         findings · gate · recommendations ·
        guides · chatbot/assistants ·       candidate evaluation · experiments ·
        product-help MCP · docs/static      outcomes · memory · harness handoff
```

Experience and Improvement depend on Product Intelligence and never on each
other. Chatbots and agents are Experience consumers, not part of the improvement
loop.

| Plane | Packages from the original build | Packages added by the later tracks (all now implemented) |
| --- | --- | --- |
| Product Intelligence | `graph-core`, `source-model`, `adapter-nextjs`, `test-miner-playwright`, `git-intelligence`, `adapter-github`, `evidence`, `capability-engine`, `workflow-discovery`, `workflow-validator`, `workflow-review`, `workflow-compiler`, `graph-delta`, `impact-analysis`, `workflow-proposals` (artifact proposals) | `config`, `evaluation`, `model-provider` (+adapters), `formal-model`, `formal-abstraction`, `solver-provider`, `reasoner-core`, `trace-clustering`, `probabilistic-evidence`, `observability-core`, observed-model and reconciliation packages |
| Experience | `resolver`, `sdk-js`, `runtime-core`, `react`, `ui`, `mcp-server`, `http-service`, `assistant-tools`, docs/static export, `examples/custom-assistant` | `analytics-sdk` (emits into Intelligence), React analytics integration |
| Improvement | — (the GitHub check is release-triggered evaluation; see Mode 5) | `findings`, `improvement-gate`, `recommendation-engine`, `candidate-evaluator`, `harness-contracts`, `experiment-core`, `outcome-analysis`, `improvement-memory` |
| Delivery and integration | `cli`, `github-app`, `apps/dashboard` | `mcp-reasoning` (developer MCP) |

### 0.2 Operating modes (a customer can stop at any mode)

| Mode | Customer outcome | Delivered by | State |
| --- | --- | --- | --- |
| 1 Understand | "What can users do?" | Phases 0–12, 19–23; enhanced by R0–R11, C9 | ✅ deterministic, reasoning (R0–R11) and opt-in model assistance (C9 `analyze`) |
| 2 Guide | Help users complete tasks in their own UI, chatbot or assistant | Phases 13–18, 26–29; C1 aligns contracts | ✅ |
| 3 Observe | "What do users actually do?" | O0–O7, O11; O8 needs R2 | ✅ |
| 4 Recommend | Diagnosed, gated, human-facing recommendations | I0, IG, I1; O8–O10, R-track findings | ✅ |
| 5 Evaluate | "Did this PR (human or harness) preserve what it should?" | R11 + R8 + C8 + I3 (no harness contract needed) | ✅ |
| 6 Self-improvement | Recommendation → external harness → evaluation → experiment → learning | I2, I4–I9 | ✅ opt-in, off by default |
| 7 Specify and verify (expansion) | "Which rules does the software follow, and did this change or this agent action break one?" | BX0–BX7 | ✅ prototype; real-repository validation pending |

Mode 6 is an optional escalation of the same intelligence, never a prerequisite.
PathCompiler must stay fully useful for a customer who never enables a harness,
never runs an experiment and never lets AI modify code.

### 0.3 Three AI integration channels (ADR 0034)

| Channel | Direction | Purpose | Status |
| --- | --- | --- | --- |
| A. Internal AI: model providers (OpenAI, Anthropic, local) | PathCompiler → model, with *targeted, deterministic evidence* only | Semantic interpretation of ambiguous clusters, capability naming and merging, aliases, hypotheses | ✅ C5 boundary and C9 adapters (Anthropic, OpenAI, local); `analyze` sends ambiguous clusters only, opt-in |
| B. PathCompiler MCP | External agent → PathCompiler | Agents ask about workflows, constraints, diff impact, candidate checks | Product-help MCP ✅; developer reasoning MCP in R12 |
| C. External harness | `HarnessTaskSpec` out, `MutationResult` in | Repository mutation | I2 / I9, mode 6 only |

`pathcompiler analyze` never requires Claude Code, Codex, Cursor or any harness.
With no provider configured, analysis remains deterministic. The optional
enterprise `analysis_backend: external_harness` mode is deferred.

---

## 1. Current implementation state (inspected, not inferred)

### 1.1 Original phases 0–30: ✅ complete against their phase acceptance criteria

Verified on 2026-10-22 from a clean baseline: `pnpm lint` passes (207 files),
`pnpm typecheck` passes, 258 unit tests pass across 33 suites, and 27 Chromium
tests pass across 5 browser suites (all of `pnpm test:e2e`). Each phase has
tests in its package (see the inventory in §1.4) and a STATUS entry.

| Phases | Delivered as | Key public interfaces |
| --- | --- | --- |
| 0 Foundation | `workflow-ir`, `graph-core`, `fixtures/next-demo`, CI | `WorkflowV1Schema`, `EvidenceRefSchema`, `ProductGraph`, `createNodeId` |
| 1–5 Evidence extraction | `source-model`, `adapter-nextjs`, `test-miner-playwright`, `git-intelligence`, `adapter-github` | `readSourceProject`, `analyzeNextProject`, `minePlaywrightTests`, `GitProvider` |
| 6–7 Surfaces / capabilities | `capability-engine`, `evidence` | `discoverCapabilities`, `CapabilitySchema`, `SemanticModel` (interface only) |
| 8–10 Discovery / validation / browser | `workflow-discovery`, `workflow-validator` (+`/browser`) | `discoverWorkflows`, `validateWorkflow`, `verifyFixtureWorkflow` (Create Client only) |
| 11–12 Review / compile | `workflow-review`, `workflow-compiler` | `approveCandidate`, `compileWorkflows`, `workflowRevision` |
| 13–16 Runtime | `resolver`, `sdk-js`, `runtime-core`, `react`, `ui` | `createResolver`, `PathCompiler`, `RuntimeTransport`, `createGuideRuntime` |
| 17–18 Integration surfaces | `mcp-server`, `http-service` | MCP tools, `/v1/help/resolve`, `/v1/workflows/*` |
| 19–23 Maintenance | `graph-delta`, `impact-analysis`, `workflow-proposals` | `analyzeCommitRange(Detailed)`, `analyzeWorkflowImpact`, `generateProposals`, `detectNewWorkflows`, `acceptDeprecation` |
| 24–30 Delivery | `github-app`, `apps/dashboard`, static/docs export, `assistant-tools`, `examples/*` | webhook/check-run APIs, `exportArtifacts`, `renderHelpPages`, tool adapters |

### 1.2 Cross-cutting original-spec contracts: ⚠ partially implemented

These sections apply across phases and were not covered by any numbered phase's
acceptance criteria. They become the **C track** (§4.1).

| Spec section | State | Evidence |
| --- | --- | --- |
| §63–65 Runtime Result v1, Ambiguity, Unsupported | ✅ Aligned in C1 (ADR 0043). Was: divergent. | Resolver returns `type: "workflow"` with `workflow{id,revision,title,routes}`, not `type: "workflow_help"` with `content.steps`, `capabilities` or `workflowVersion`. Ambiguous uses `options` rather than `candidates[{workflowId,title,confidence}]`. Unsupported reasons are `empty-query/no-match/unavailable-in-context`, not `no_matching_workflow/not_available_for_context/workflow_not_verified`. |
| §75 RuntimeContext | ✅ Aligned in C1. Was: partial. | `ResolveContextSchema` is strict, so `locale`, `tenant` and `productRelease` are **rejected**. |
| §70 Versioning | ✅ Integer `workflowVersion` added in C1. Was: partial. | Schema version, content-hash revision and compiler version are present. There is no integer workflow revision (ADR 0014 chose a hash) and no repository commit in runtime artifacts. |
| §68 Guide failure modes | ✅ `manifest-mismatch` added in C1. Was: partial. | Target missing, wrong route, unmet permission precondition, timeout and stop are covered. There is no workflow manifest mismatch detection. |
| §44 `pathcompiler.yaml`, `pathcompiler init`; §43 `graph inspect`, `capabilities list` | ✅ Added in C2 (ADR 0053). Was: missing. | `@pathcompiler/config`, CLI gating, `init`, `config show`, `graph inspect`, `capabilities list`. |
| §46–47 `packages/model-provider` (Noop/Fixture), `scan --explain-model-context` | Missing | Only the `SemanticModel` interface (with a test fake) exists in `capability-engine`. |
| §51 Error taxonomy | Partial | Typed errors are `PathCompilerError`, `ReviewError`, `ProposalError`, `ToolInputError` and `HttpError`, not the named taxonomy. |
| §52 Structured logging; §53 scan counts table | Missing / partial | No logger. `scan` prints nodes, edges and files only. |
| §54 Evaluation harness; §55 Golden tests | ✅ Added in C3 (ADR 0054). Was: partial. | Fixture ground truth in `fixtures/next-demo/eval/`, `@pathcompiler/evaluation`, `pathcompiler eval`, readable goldens. |
| §84 Caching; §83 performance targets | Missing | No parse cache and no recorded timings. |
| §91 Product-ready alpha (two unrelated Next.js repos) | Not started | Only the fixture has been analyzed. |
| §74 Review editor (state-machine view, edit/merge) | Deferred by spec ("later") | The dashboard offers approve/reject/accept/ignore only. |

### 1.3 Known limitations carried from STATUS

- The GitHub App was never exercised against live GitHub, and its queue is in-memory.
- The dashboard is local-only and has no authentication.
- Assistant adapters have not been run against live model APIs.
- The resolver is English-only, uses empty aliases and has no embeddings.
- The browser verifier (Phase 10) supports only `clients.create`.
- The fixture's authorization model is minimal: roles `editor`/`viewer` via
  `requireEditor` (heuristic permission node, confidence 0.5) and one flag,
  `planStructure`. It has no intentional bugs or regressions.

### 1.4 Package inventory (source lines / test cases)

`graph-core` 267/8 · `workflow-ir` 189/5 · `source-model` 212/3 · `evidence` 173/3 ·
`adapter-nextjs` 1423/20 · `test-miner-playwright` 1090/16 · `git-intelligence` 985/12 ·
`adapter-github` 285/8 · `capability-engine` 1343/16 · `workflow-discovery` 804/5 ·
`workflow-validator` 1213/16 · `workflow-review` 236/5 · `workflow-compiler` 492/8 ·
`resolver` 454/7 · `sdk-js` 342/6 · `runtime-core` 627/14 · `react` 265/5 · `ui` 418/5 ·
`mcp-server` 145/3 · `http-service` 199/6 · `graph-delta` 301/7 · `impact-analysis` 415/4 ·
`workflow-proposals` 840/11 · `github-app` 581/7 · `assistant-tools` 214/5 · `cli` 1648/23 ·
`apps/dashboard` 1184/7 · `examples/custom-assistant` 223/4 · `examples/reference-demo` 303/4 ·
`fixtures/next-demo` 953/7.

### 1.5 Stability assessment for the new tracks

| Representation | Stable enough for the formal model? | Basis |
| --- | --- | --- |
| Product Graph (`graph-core`) | Yes | Versioned schema since Phase 0, deterministic IDs, consumed by 20+ packages, diffed by `graph-delta`. |
| Evidence (`EvidenceRef`, `evidence`) | Yes | Graph node IDs are the evidence IDs end to end (discovery → validation → impact → proposals). |
| Capabilities (`capability-engine`) | Yes for IDs and links; weak for authorization semantics | `domain.verb` IDs and source/evidence/route/API node lists are stable. Permission and flag extraction is heuristic, which matters for R1 rather than R0. |
| Semantic target / workflow IDs | Yes | Used by runtime, guide, impact and proposals. |
| Runtime contracts (result shape, versioning, context) | **No** | See §1.2. This blocks O0 and the I track until C1. |

---

## 2. System boundary (must be preserved)

```text
PATHCOMPILER
  Understand · Observe · Reason · Diagnose · Recommend
        │
        ▼
  ImprovementRecommendation ──► HarnessTaskSpec
──────────────────────────────────────────────────────────────
EXTERNAL CODING HARNESS (not implemented in this repository)
  Interpret task · Inspect repository · Use tools ·
  Modify code/config/UX · Run implementation-level checks ·
  Produce candidate repository state · Return MutationResult
──────────────────────────────────────────────────────────────
PATHCOMPILER
  Re-analyze candidate · Rebuild Product Model · Semantic diff ·
  Formal verification · Workflow regression analysis · Tests ·
  Browser verification · CandidateEvaluation · ExperimentSpec ·
  Outcome measurement · Adopt/Reject/Rollback recommendation ·
  Improvement memory
```

The harness exists only in **mode 6**. Modes 1–5 never require it. In particular,
mode 5 evaluates ordinary human PRs with the same `CandidateEvaluation` (ADR 0033).

Integration contracts, in order:

```text
ImprovementRecommendation → HarnessTaskSpec → [external harness] → MutationResult
  → CandidateEvaluation → ExperimentSpec / ExperimentRun → OutcomeAssessment
  → AdoptionDecision → ImprovementMemoryRecord
```

Rules:

- Contracts are provider-neutral, versioned, Zod- and JSON-Schema-validated.
- No domain package imports or names a specific harness. `harnessMetadata` is
  opaque provenance only.
- PathCompiler never trusts `MutationResult.claimedSemanticChanges`. It rebuilds
  the model from `candidateCommit` and evaluates independently (I3).
- PathCompiler does not implement code editing, tool orchestration, agent memory,
  IDE integration, patch generation, CI/CD execution or deployment (I10 stays
  read-only coordination and is deferred).
- Any harness used in tests is a **fixture harness** returning synthetic
  `MutationResult`s for prepared candidate commits.

---

## 3. Dependency graph

```text
                    ┌───────────────── existing phases 0–30 (✅) ─────────────────┐
                    │                                                              │
   C1 runtime contracts ─┬─► O0 ─► O1 ─┬─► O2                                      │
                          │             ├─► O3 ─┐                                   │
                          │             ├─► O4  │                                   │
                          │             └─► O5 ─┴─► O6 ─► O7 ─┬─► O9 ◄── R7         │
                          │                         │         ├─► O10 ◄── R6        │
                          │                         ├─► O11 ──┴─► P5 ◄── R8         │
                          │                         └─► O8 ◄── R2 (R1)              │
   C2 config/flags ───────┼──────────────────────► R-WI ◄── R1, R3, C3            │
   C3 eval/golden ────────┼──────────────────────► R-WI, P0 calibration           │
   C5 model provider ─────┼──────────────────────► C9 ─► P1                        │
   C7 fixture enrichment ─┼─► R5, R8, R9 cases, I-demos                            │
   C8 browser verifier ───┼─► I4, P3, model/browser consistency                    │
                          │                                                         │
   R0 ─► R1 ─► R2 ─┬─► R3 ─┬─► R6 ─► R7                                             │
                    │       └─► R10 ◄── R8                                           │
                    ├─► R4 ─┬─► R5                                                   │
                    │       └─► R12 developer surfaces                               │
                    ├─► R8 ─► (R10)                                                  │
                    ├─► R9                                                           │
                    └─► R11 ◄── R1, R4, phases 19–21                                │
                                                                                     │
   P0 ─┬─► P1 ◄── R1, C9 ─► P2 ◄── R2/R7                                             │
       ├─► P3 ◄── C8, R2                                                             │
       └─► P4 ◄── R11                                                                │
                                                                                     │
   C5 ─► C9 ◄── C2, C3 ─► P1                                                         │
                                                                                     │
   I3 (mode 5: human PRs) ◄── R1, R8, R11 ─┬─► I4 ◄── C8                             │
                                            └─► I5 ◄── O0, O7 ─► I6 ─► I7 ─► I8      │
   I0 ◄── P0, R4, R11 (+O7/O9 for behavioral classes)                                │
   I0 ─► IG ◄── C2 ─► I1 ◄── R8 ─► I2 ◄── R11 ─► I9 ◄── I3   (mode 6, opt-in)        │
```

Critical paths:

- **Reasoning MVP** (reasoning spec §94): R0 → R1 → R2 → R3 → R4 → R11, plus the
  existing proposals (Phase 21).
- **Observability MVP** (§159): C1 → O0 → O1 → O3/O4 → O6 → O7 → O8 (needs R2, R3)
  → O9 (needs R7).
- **Evaluate mode for human PRs** (mode 5): the reasoning MVP plus R8, C8, then I3.
  No observability or harness needed.
- **Recommend mode** (mode 4): the observability MVP plus the reasoning MVP, then
  I0 → IG → I1.
- **Improvement-loop MVP** (§252, mode 6): all of the above, then I2 and I5–I7.
  I8 and I9 follow.

---

## 4. Phase catalog

Each block lists: objective · prerequisites · packages · public interfaces ·
acceptance · tests/evals · runtime behavior change · unblocks · status.

### 4.1 C track: original-spec conformance (new IDs for unmet cross-cutting sections)

#### C1 — Runtime contract alignment
- **Objective:** Align runtime results with Runtime Result v1 / Ambiguity /
  Unsupported (§63–65). Accept the full `RuntimeContext` (§75). Add integer
  `workflowVersion` alongside `revision` (§70, ADR 0032 §4). Add guide manifest
  mismatch detection (§68).
- **Prerequisites:** phases 12–18 (✅).
- **Packages:** `resolver`, `workflow-compiler` (version metadata), `sdk-js`,
  `http-service`, `mcp-server`, `assistant-tools`, `react`, `ui`, `runtime-core`,
  examples.
- **Interfaces:** `WorkflowHelpResult` (`type: "workflow_help"`, `workflowId`,
  `workflowVersion`, `confidence`, `content.steps`, `entrypoint`,
  `capabilities`); `AmbiguousResult.candidates[]`; `UnsupportedResult.reason`
  (spec enum); `RuntimeContext` with `locale/tenant/productRelease`.
- **Acceptance:** SDK, HTTP, MCP and tool adapters all return the v1 shapes.
  Versions are monotonic per workflow ID across approvals and updates. A guide
  fails with `manifest-mismatch` when the revision differs from the expected one.
  The resolver evaluation set still meets its target.
- **Tests/evals:** contract tests for every surface; versioning across approve →
  accept-update; paraphrase eval; all e2e suites.
- **Runtime change:** **Yes, breaking** (migration note required).
- **Unblocks:** O0, I0 (`ProductTarget` versions), P-query ranking.
- **Status:** ✅ complete (2026-10-23): Runtime Result v1, full `RuntimeContext`, integer `workflowVersion`, guide `manifest-mismatch`, ADR 0043.

#### C2 — Configuration and feature flags
- **Objective:** Add `pathcompiler.yaml` (§44) with Zod validation and
  `pathcompiler init`. Add the reasoning, probabilistic and analytics flags
  (§116, §139), defaulting to off and privacy-first. Add enabled operating modes
  (ADR 0033), model provider selection (no keys in the file; keys come from the
  environment, ADR 0034), and `improvement_policy` with
  `autonomous_mutation: false`. Add `graph inspect` and `capabilities list` (§43).
- **Prerequisites:** none beyond existing phases.
- **Packages:** new `config`, `cli`.
- **Interfaces:** `loadConfig`, `PathCompilerConfigSchema`, `FeatureFlags`.
- **Acceptance:** absent config means current behavior, byte-for-byte. Invalid
  config gives an actionable error. Flags can be read by library callers.
- **Tests/evals:** schema tests; CLI golden output with and without config.
- **Runtime change:** No (defaults preserve behavior).
- **Unblocks:** R-WI, C9, IG, O1 privacy configuration, flag-gated rollouts.
- **Status:** ✅ complete (2026-10-23): `@pathcompiler/config`, `init`, `config show`, `graph inspect`, `capabilities list`, CLI gating, ADR 0053.

#### C3 — Evaluation harness and golden tests
- **Objective:** Fixture ground truth (§54: `capabilities.json`,
  `workflows/*.yaml`, `impact-cases/*.json`, `queries.json`) and
  `pathcompiler eval <capabilities|workflow-discovery|resolver|impact>`. Readable
  golden tests for graphs, manifests and CLI reports (§55).
- **Prerequisites:** existing phases.
- **Packages:** new `evaluation`, `cli`, `fixtures/next-demo/eval/`.
- **Interfaces:** `EvaluationReport` per metric family.
- **Acceptance:** each metric family reports precision/recall (or accuracy).
  Results are deterministic. The discovery eval can take an alternative
  discovery function for comparison (§117).
- **Tests/evals:** this phase *is* the eval infrastructure. Snapshot reviews.
- **Runtime change:** No.
- **Unblocks:** R-WI comparison, P0 calibration, model evaluation (§86).
- **Status:** ✅ complete (2026-10-23): `@pathcompiler/evaluation`, `fixtures/next-demo/eval/`, `pathcompiler eval`, goldens, ADR 0054.

#### C4 — Diagnostics hardening
- **Objective:** Error taxonomy (§51), structured logs (§52), scan counts table
  (§53), content-hash parse cache (§84), recorded timings against §83 targets.
- **Prerequisites:** none.
- **Packages:** `source-model`, `adapter-nextjs`, `cli`, new small `diagnostics`.
- **Interfaces:** named error classes; `Logger` interface (no source contents by
  default).
- **Acceptance:** typed errors at package boundaries; cache never changes
  output; timings reported.
- **Tests/evals:** error-class tests; cache determinism tests.
- **Runtime change:** No.
- **Unblocks:** none required. Improves solver diagnostics later (§90).
- **Status:** ✅ complete (2026-10-24): `@pathcompiler/diagnostics` (taxonomy, JSON logger, timings, content cache), adopted errors at boundaries, cached `scan` with the §53 table and §83 targets, ADR 0070.

#### C5 — Model provider boundary (AI channel A, part 1)
- **Objective:** `packages/model-provider` with `NoopModelProvider` and
  `FixtureModelProvider` (§46). Privacy preprocessing and
  `scan --explain-model-context` (§47). Wire `SemanticModel` through it.
  Interface only; no real vendor calls yet.
- **Prerequisites:** none (interface exists in `capability-engine`).
- **Packages:** new `model-provider`, `capability-engine`, `cli`.
- **Interfaces:** `PathCompilerModelProvider`, `ModelContextReport`.
- **Acceptance:** no vendor SDK in core packages; deterministic fixture
  provider; context dry-run lists exactly what would be sent.
- **Tests/evals:** provider contract tests; secret-stripping tests.
- **Runtime change:** No.
- **Unblocks:** C9, optional semantic assistance in R1, I1 wording.
- **Status:** ✅ complete (2026-10-23): `@pathcompiler/model-provider` (`PathCompilerModelProvider`, `NoopModelProvider`, `FixtureModelProvider`, `guardModelProvider`, redaction), `scan --explain-model-context`, ADR 0057.

#### C6 — Alpha validation on two unrelated Next.js repositories
- **Objective:** Run discovery → approval → compile → impact on two real
  repositories (§91) and record the gaps.
- **Prerequisites:** user-supplied repositories (**external input**).
- **Packages:** analyzers as needed; findings recorded in STATUS.
- **Acceptance:** each repository yields at least one approved workflow, or a
  documented reason why not.
- **Runtime change:** Possibly (analyzer fixes).
- **Unblocks:** confidence in R1 extraction design; making reasoning default.
- **Status:** 🟢 unblocked but needs repositories; can run any time in parallel.

#### C7 — Reasoning and harness fixture enrichment
- **Objective:** Extend the shared fixture (§88, handoff §75–76) with more
  roles and permissions, a second feature flag, an alternative path for one goal,
  and intentionally seedable bugs and regressions on branches. Create
  `fixtures/reasoning/` cases and `fixtures/harness/{tasks,results}/`.
- **Prerequisites:** R0, so cases are expressed in Formal Model terms.
- **Packages:** `fixtures/next-demo`, new fixture directories.
- **Acceptance:** existing fixture e2e tests stay green, and new cases cover
  reachable, unreachable, permissions, flags, alternatives, counterexamples and
  commit diffs.
- **Runtime change:** Fixture only.
- **Unblocks:** R5, R6 and R8–R10 evaluations; I demos.
- **Status:** ✅ complete (2026-10-24): admin role, `planArchive` flag, Archive Plan, alternative Deactivate path, `fixtures/reasoning/` (15 cases), `eval reasoning`, ADR 0058. Harness fixtures deferred to I2.

#### C8 — Generalized browser verification
- **Objective:** Generalize the Phase 10 runner from `clients.create` to
  approved workflows: a safe action allowlist, explicit input bindings and
  candidate/preview origins. Emit browser evidence as a distinct evidence class.
- **Prerequisites:** phases 9–10 (✅); C1 version binding (soft).
- **Packages:** `workflow-validator/browser` (or a new `browser-verifier`).
- **Interfaces:** `verifyWorkflowInBrowser(workflow, {page, origin, inputs, policy})`,
  `BrowserVerificationReport` v2.
- **Acceptance:** all fixture workflows verify. Stale or ambiguous targets fail
  clearly. Never performs destructive actions outside the declared allowlist.
- **Tests/evals:** browser suite across fixture workflows and a seeded regression.
- **Runtime change:** No (verification tooling).
- **Unblocks:** I4, P3, model/browser consistency (§37), mode 5 browser checks.
- **Status:** ✅ complete (2026-10-24): `verifyWorkflowInBrowser` with report v2 (`browser` evidence class), safe-action and destructive allowlists, input bindings, preview origins; all five discovered fixture workflows verify; ADR 0065.

#### C9 — Provider adapters and evidence-first semantic interpretation (AI channel A, part 2)
- **Objective:** The original-spec semantic layer (§45). Add OpenAI, Anthropic and
  local adapters, configured with the customer's own key from the environment.
  Deterministic analyzers identify ambiguous semantic clusters and send *only*
  that targeted evidence. Results are structured hypotheses (capability naming
  and merging, aliases, candidate interpretation), validated against
  deterministic evidence before use. Behind a flag, and evaluated (§86).
- **Prerequisites:** C5, C2 (provider and flag configuration), C3 (model eval).
- **Packages:** `model-provider-openai`, `model-provider-anthropic`,
  `model-provider-local` (adapters, plain HTTP preferred), `capability-engine`
  (consumer), `cli` (`analyze` step).
- **Interfaces:** adapter factories; `SemanticHypothesis` with confidence and
  evidence; `ModelContextReport` of what was sent.
- **Acceptance:** with no provider configured, output is identical to today.
  With the fixture provider, hypotheses are reproducible and validated. With
  real providers, a recorded evaluation compares baseline and assisted
  capability naming, and the unsupported-invention rate does not increase.
  Nothing is sent outside the declared context. Core packages stay SDK-free; if
  an adapter needs an SDK, narrow the Phase 28 provider-ban test to core
  packages with an explicit decision.
- **Tests/evals:** fixture-provider tests; privacy dry run; model eval (§86).
- **Runtime change:** No (analysis-time only, flag default off).
- **Unblocks:** P1; better alias recall for the resolver; real-repository
  usefulness (C6).
- **Status:** ✅ complete (2026-10-24): `model-provider-anthropic` (SDK, ADR 0071), `model-provider-openai` (OpenAI and local, plain HTTP), `findAmbiguousClusters`, `interpretAmbiguities`, `SemanticHypothesis`, CLI `analyze`. Deviation: the local adapter lives in `model-provider-openai`; the real-provider eval needs a key (ISSUES_LOG #34).

### 4.2 R track: formal reasoning

Shared rules: solver-independent domain packages, provenance on every formal
object and constraint, results `reachable | unreachable | unknown`, timeouts and
bounds on every solver call, artifacts under `.pathcompiler/reasoning/`, and no
change to default discovery or runtime until R-WI's evaluation passes.

#### R0 — Formal Model Foundation
- **Objective:** Solver-independent Formal Product Model: state variables,
  expression AST, actions with preconditions and effects, invariants, goals, Zod
  validation, deterministic serialization. Hand-encode fixture Create Client and
  Change Plan Structure with `EvidenceRef` provenance to real graph node IDs.
- **Prerequisites:** Product Graph, Evidence, Capability IDs (all ✅, stable per §1.5).
- **Packages:** new `formal-model` (depends only on `workflow-ir` for
  `EvidenceRef`, and `zod`).
- **Interfaces:** `FormalStateVariable`, `FormalExpr`, `FormalTerm`,
  `FormalAction`, `FormalEffect`, `FormalInvariant`, `FormalGoal`,
  `FormalProductModel`, `FormalProductModelSchema`, `serializeFormalModel`,
  `formalModelHash`, and model versioning fields (§82).
- **Acceptance:** fixture models validate. Serialization is byte-stable. Every
  action and goal carries evidence that resolves to fixture graph nodes. Invalid
  references (unknown variables or enum values, type mismatches) are rejected.
  No solver, and no runtime change.
- **Tests/evals:** schema and reference tests; determinism; provenance
  resolution against the mined fixture graph.
- **Runtime change:** No.
- **Unblocks:** R1, R2, C7, O8, I0.
- **Status:** ✅ complete (2026-10-23): `@pathcompiler/formal-model`, ADR 0035.

#### R1 — Formal Abstraction Builder
- **Objective:** Derive a candidate Formal Product Model from the Product Graph,
  capabilities, tests, permissions, flags, routes and APIs. Deterministic first;
  optional semantic assistance via C5. Uncertainty is explicit.
- **Prerequisites:** R0; capability-engine and test traces (✅). Soft: C5, C6.
- **Packages:** new `formal-abstraction`.
- **Interfaces:** `buildFormalModel(graph, capabilities, traces) → {model, coverage, uncertainties}`.
- **Acceptance:** reproduces the R0 hand model's actions and goals for the fixture
  (or explains each difference). Model coverage is reported (§85). Existing
  discovery is unchanged.
- **Tests/evals:** fixture equivalence; coverage report; determinism.
- **Runtime change:** No.
- **Unblocks:** R2 (extracted models), R-WI, R9, R11, P1, I3.
- **Status:** ✅ complete (2026-10-23): `@pathcompiler/formal-abstraction`, ADR 0036.

#### R2 — SMT Reachability
- **Objective:** `solver-provider` boundary and the first SMT backend (choice
  recorded by ADR; Z3-compatible preferred, §109). `reasoner-core` bounded
  reachability with witness traces and `unknown` preserved.
- **Prerequisites:** R0, R1.
- **Packages:** new `solver-provider`, `reasoner-core`, `cli` (`reason reachable`).
- **Interfaces:** `SolverProvider`, `ProductReasoner.checkReachability`,
  `ReachabilityResult`, `ReasoningTrace`, `sliceFormalModel`.
- **Acceptance:** fixture editor-creates-client is reachable with a trace;
  viewer-creates-client is unreachable; timeouts and insufficient bounds give
  `unknown`. No solver types leak.
- **Tests/evals:** reachability fixture cases; SAT/UNSAT correctness; unknown-rate
  metric.
- **Runtime change:** No.
- **Unblocks:** R3, R4, R8, R9, O8, P2, P3.
- **Status:** ✅ complete (2026-10-23): `@pathcompiler/solver-provider`, `@pathcompiler/solver-z3`, `@pathcompiler/reasoner-core`, `reason reachable`, ADR 0037.

#### R3 — Planning
- **Objective:** Bounded SMT planning from an admissible initial state to a goal,
  yielding product-semantic action traces with provenance.
- **Prerequisites:** R2.
- **Packages:** `reasoner-core`, `cli` (`reason plan`).
- **Interfaces:** `findPlan`, `PlanResult`.
- **Acceptance:** fixture plans match the approved workflows' major steps. Default
  discovery is not replaced.
- **Tests/evals:** planning metrics (§89: goal reached, invalid action count,
  major-step correctness).
- **Runtime change:** No.
- **Unblocks:** R6, R7, R10, R-WI, O9, O10.
- **Status:** ✅ complete (2026-10-23): `findPlan`, `evaluatePlan`, `reason plan`, ADR 0038.

#### R4 — UNSAT Explanation
- **Objective:** Stable constraint IDs with provenance and product-semantic unsat
  explanations, traced back to source (§25).
- **Prerequisites:** R2.
- **Packages:** `reasoner-core`, `solver-provider`, `cli` (`reason why-not`).
- **Interfaces:** `explainUnreachable`, `UnreachableExplanation`, `ConstraintProvenance`.
- **Acceptance:** viewer-cannot-create-client is explained as a missing editor
  permission, mapped to the `requireEditor` evidence. No raw solver labels.
- **Tests/evals:** root-cause precision; provenance correctness.
- **Runtime change:** No.
- **Unblocks:** R5, R11, R12, I0.
- **Status:** ✅ complete (2026-10-23): `explainUnreachable`, solver assumptions and cores, `reason why-not`, ADR 0039.

#### R-WI — Reasoning-assisted workflow discovery (spec §23, §125)
- **Objective:** Product Graph → Formal Abstraction → planning → feasible trace →
  workflow candidate, behind a flag, compared against test-backed discovery.
- **Prerequisites:** R1, R3, C2, C3. Soft: R4.
- **Packages:** `workflow-discovery` (new strategy behind an interface), `evaluation`.
- **Interfaces:** `DiscoveryStrategy`; `pathcompiler eval workflow-discovery --compare`.
- **Acceptance:** both strategies run on the fixture and report precision,
  invented-step rate, recall, applicability accuracy and edit distance. The
  baseline remains the default.
- **Runtime change:** No (flag defaults off).
- **Unblocks:** a decision on the default strategy (separate ADR); I3 candidate
  rebuild options.
- **Status:** ✅ complete (2026-10-23): `@pathcompiler/reasoning-discovery`, `DiscoveryStrategy` in `evaluation`, `eval workflow-discovery --compare`, ADR 0055. Reasoning: recall 1 vs 0.6, applicability 1 vs 0, terminals 0.4 vs 0.667; the baseline stays the default.

#### R5 — MUS / MCS
- **Objective:** Minimal unsatisfiable subsets and minimal correction sets as
  diagnostics. Never auto-changes permissions.
- **Prerequisites:** R4. Soft: C7.
- **Packages:** `reasoner-core`, `cli` (minimal enablement).
- **Acceptance:** fixture "what minimal change enables viewer create" is correct
  and minimal.
- **Runtime change:** No.
- **Unblocks:** permission audit and minimal-enablement modules.
- **Status:** ✅ complete (2026-10-24): `findMinimalEnablement` (core-guided minimum correction sets; R4 core as MUS), `reason enable`, enablement reasoning cases, ADR 0059.

#### R6 — Plan Enumeration and semantic trace clustering
- **Objective:** Bounded enumeration with blocking constraints, and
  `trace-clustering` into business variants.
- **Prerequisites:** R3; C7 (an alternative-path fixture, ✅).
- **Packages:** `reasoner-core`, new `trace-clustering`.
- **Acceptance:** alternative-path fixture yields the expected variants with a
  low duplicate rate.
- **Runtime change:** No.
- **Unblocks:** R7, O10, workflow breadth.
- **Status:** ✅ complete (2026-10-24): `enumeratePlans` (blocking constraints, first-reach), `@pathcompiler/trace-clustering`, `reason alternatives`, ADR 0060.

#### R7 — Optimization (OMT / MaxSAT)
- **Objective:** Rank plans by explicit costs and derive UX metrics (§30).
- **Prerequisites:** R3; R6 for alternatives.
- **Packages:** `reasoner-core`, `solver-provider` (optimize).
- **Acceptance:** cost-optimal plan on the fixture; metrics reported as hypotheses.
- **Runtime change:** No.
- **Unblocks:** O9, P2.
- **Status:** ✅ complete (2026-10-24): `findCheapestPlan` (exact by incremental enumeration and a cost lower bound), `actionCategories`, `uxMetrics` (hypotheses), `reason optimize`, ADR 0061. Solver-side OMT deferred.

#### R8 — Bounded Model Checking and counterexamples
- **Objective:** A small property language, bounded checking and counterexample
  traces.
- **Prerequisites:** R2; C7 (seeded violations).
- **Packages:** `reasoner-core`, `cli` (`reason verify`).
- **Interfaces:** `verifyProperty`, `ProductProperty`, `ProductPropertyRef`.
- **Acceptance:** "viewer can never create a client" holds on the fixture, and
  the seeded bug yields a counterexample.
- **Runtime change:** No.
- **Unblocks:** R10, I1/I2 protected behaviors, I3, P5.
- **Status:** ✅ complete (2026-10-23): `verifyProperty`, `ProductPropertySchema`, `reason verify`, ADR 0041. Seeded bug created in-test until C7.

#### R9 — Dead feature and missing transition detection
- **Prerequisites:** R1, R2. **Packages:** `reasoner-core`.
- **Acceptance:** an orphaned fixture capability is flagged with candidate causes.
- **Runtime change:** No. **Unblocks:** I0 findings (`product_dead_end`).
- **Status:** ✅ complete (2026-10-24): `detectDeadFeatures` (unreachable capabilities, dead actions, missing transitions; candidates with causes), `reason dead-features`, seeded orphan case, ADR 0062. Product dead ends (§71) deferred.

#### R10 — Automated test generation
- **Prerequisites:** R3, R8. **Packages:** new generator writing to
  `.pathcompiler/generated-tests/` (review required).
- **Acceptance:** generated positive and negative Playwright candidates run
  against the fixture.
- **Runtime change:** No. **Status:** ✅ complete (2026-10-24): `@pathcompiler/test-generator` (positive and negative Playwright candidates from plans and proofs), `tests generate`, a browser suite of 15 generated tests on the fixture, enabling conditions from tests, ADR 0063.

#### R11 — Commit semantic reasoning
- **Objective:** Formal model diff, reachability and applicability diff, and
  `SemanticChangeReport`. Feeds impact and proposals. Adds a "product logic"
  section to the existing GitHub check without replacing it.
- **Prerequisites:** R1, R2, R4; phases 19–21 (✅).
- **Packages:** `reasoner-core`, `impact-analysis` (additional reasons),
  `github-app` (check section).
- **Interfaces:** `compareModels`, `SemanticChangeReport`.
- **Acceptance:** reasoning-MVP steps 6–10 (§94) on the fixture: a permission
  change makes `clients.create` unreachable for editors, traced to file and commit,
  and a proposal follows.
- **Tests/evals:** true-change recall; false-positive rate.
- **Runtime change:** No (reports only).
- **Unblocks:** I2 (`SemanticChangeIntent` vocabulary), I3, P4, O12.
- **Status:** ✅ complete (2026-10-23): `compareModels`, `@pathcompiler/semantic-change`, `reason diff`, `--reasoning` impact and proposals, optional GitHub check section, ADR 0040.

#### R12 — Developer reasoning surfaces
- **Objective:** `/v1/reason/*` endpoints (§73) and a separate developer
  reasoning MCP (§74, §107) with its own permissions. CLI subcommands arrive with
  R2–R11.
- **Prerequisites:** R4 (first stable explanations).
- **Packages:** `http-service` (separate router and auth), new `mcp-reasoning`
  (or a separate entry point).
- **Acceptance:** never exposed to end-user tokens; product-semantic results only.
- **Runtime change:** Yes (new developer-only endpoints).
- **Status:** ✅ complete (2026-10-24): `@pathcompiler/reasoning-service`, `/v1/reason/*` behind a separate developer token, a developer MCP (`mcp-reasoning`, spec §74 tools), ADR 0064.

### 4.3 P track: probabilistic reasoning

#### P0 — Probabilistic Evidence Model
- **Objective:** `probabilistic-evidence`: supporting and contradicting evidence,
  evidence classes (static, test, formal, browser, observed, historical prose,
  model hypothesis), `ConfidenceAssessment` that separates confidence score from
  calibrated probability (§44), conflict objects (§47), and documented fusion rules.
- **Prerequisites:** `evidence` (✅). Soft: C3 for calibration data.
- **Packages:** new `probabilistic-evidence`.
- **Interfaces:** `ConfidenceAssessment`, `EvidenceClaim`, `EvidenceConflict`, `fuseEvidence`.
- **Acceptance:** fixture claims (for example deactivate vs archive) fuse with an
  explicit stale-artifact conflict. No averaging. Existing confidence fields stay
  labelled rule strength.
- **Runtime change:** No.
- **Unblocks:** P1, P3, P4, I0.
- **Status:** ✅ complete (2026-10-23): `@pathcompiler/probabilistic-evidence` (`fuseEvidence`, `ConfidenceAssessment`, `EvidenceConflict`, `calibrate`, `graphEvidenceItems`), ADR 0056.

#### P1 — Probabilistic semantic interpretation
- **Prerequisites:** P0, R1, C9 (model-produced candidate interpretations). **Packages:** `probabilistic-evidence`, `formal-abstraction`.
- **Acceptance:** candidate interpretations are filtered by formal consistency
  and re-scored.
- **Runtime change:** No. **Status:** ✅ complete (2026-10-24): `interpretCandidates` (probabilistic-evidence), `interpretCapabilities` (formal-abstraction), `analyze` writes `reports/semantic-interpretations.json`, ADR 0072. Hard constraints are deterministic facts (handler endpoint vs verb, product vocabulary, one ID per handler action); the formal model's own structure derives from the capability names, so it is not used to judge them.

#### P2 — Weighted soft constraints (MaxSAT)
- **Prerequisites:** P1, R2 (optimization-capable provider; R7 preferred).
- **Acceptance:** hard constraints always hold, and the best-supported
  interpretation is selected.
- **Runtime change:** No. **Status:** ✅ complete (2026-10-24): `SolverProvider.optimize` (Z3 MaxSAT), `selectInterpretations`, `selectCapabilityInterpretations`, joint selection in `analyze`, ADR 0073.

#### P3 — Browser failure diagnosis
- **Prerequisites:** P0, C8, R2. **Acceptance:** seeded failures rank the true
  cause first (stale target, permission or flag mismatch, model wrong).
- **Runtime change:** No. **Unblocks:** I4 diagnostics. **Status:** ✅ complete (2026-10-24): `diagnoseBrowserFailure`, CLI `diagnose`, seeded browser failures ranked correctly, ADR 0074. Formal guards are read from the R1 model directly; R2 is not needed per failure.

#### P4 — Commit risk scoring
- **Prerequisites:** P0, R11. **Acceptance:** definite, probable and uncertain
  impacts are separated, with no uncalibrated probability claims.
- **Runtime change:** No. **Status:** ✅ complete (2026-10-24): `scoreCommitRisk` (impact-analysis), `impact` writes `reports/commit-risk.json`, ADR 0075.

#### P-RV — Review prioritization and feedback (spec §52–53, unnumbered)
- **Prerequisites:** P0; review and proposal decisions (✅); usage factor needs O7.
- **Acceptance:** review queue ordering with explained components; decisions
  stored as calibration data.
- **Runtime change:** No. **Status:** ✅ complete (2026-10-24): `@pathcompiler/review-priority`, CLI `review queue` and `review feedback`, ADR 0077.

#### P5 — Probabilistic model checking
- **Prerequisites:** O11 (meaningful telemetry), R8. **Status:** ✅ complete (2026-10-24): `checkGoal`, `checkReachProperty`, `compareReach` (interval Markov chain bounds), CLI `observe check`, ADR 0076.

### 4.4 O track: observability (optional, privacy-first, never replaces tests or formal reasoning)

Shared rules: analytics disabled by default, no PII by default, hashed IDs, no raw
keystrokes, form contents or DOM. Events bind to release and workflow version.
Possible and observed are separate models. Nothing mutates Workflow IR (§155).
Minimum sample sizes come before any conclusion.

#### O0 — Event Model
- **Objective:** `observability-core`: typed semantic events, lifecycle events,
  runtime context, release binding, privacy metadata, Zod schemas, deterministic
  serialization. No transport.
- **Prerequisites:** C1 (workflow ID and version, `RuntimeContext.productRelease`).
  Soft: R0 goal IDs for `goal.reached`.
- **Packages:** new `observability-core`.
- **Interfaces:** `ProductRuntimeEvent` union, `RuntimeEventBase`, `PrivacyPolicy`.
- **Acceptance:** schemas reject raw-content fields by default; events reference
  semantic targets, workflow IDs and versions.
- **Runtime change:** No. **Unblocks:** O1, O5, I5. **Status:** ✅ complete (2026-10-23): `@pathcompiler/observability-core`, ADR 0044.

#### O1 — Lightweight Analytics SDK
- **Prerequisites:** O0. Soft: C2 (configured privacy defaults).
- **Packages:** new `analytics-sdk` (framework-independent; browser-safe module graph).
- **Interfaces:** `track`, `workflowStarted`, `workflowCompleted`, `goalReached`,
  `AnalyticsTransport`, `ConsoleTransport`, `InMemoryTransport`.
- **Acceptance:** batching; no network by default; privacy filters enforced.
- **Runtime change:** Opt-in only. **Status:** ✅ complete (2026-10-23): `@pathcompiler/analytics-sdk`, ADR 0045.

#### O2 — React integration
- **Objective:** Optional analytics in the **existing** `@pathcompiler/react`
  provider (ADR 0032 §7). Semantic-target activation events.
- **Prerequisites:** O1. **Runtime change:** Opt-in. **Status:** ✅ complete (2026-10-23): `analytics` prop on `PathCompilerProvider`, `useAnalytics`, ADR 0046.

#### O3 — Workflow runtime telemetry
- **Prerequisites:** O1; `runtime-core` (✅). **Acceptance:** guide state
  transitions emit lifecycle events.
- **Runtime change:** Opt-in. **Status:** ✅ complete (2026-10-23): `instrumentGuide`, `GuideState.version`, ADR 0047.

#### O4 — Domain events
- **Prerequisites:** O1; R0 goal IDs. **Status:** ✅ complete (2026-10-23): `domain.event`, `domainEvent`, goal/event allowlists, ADR 0048.

#### O5 — Event ingestion
- **Prerequisites:** O0; `http-service` (✅). **Acceptance:** `POST /v1/events/batch`
  with validation, rate limits, project isolation and privacy filtering.
- **Runtime change:** Yes (new endpoint). **Status:** ✅ complete (2026-10-23): `POST /v1/events/batch`, `EventSink`, `FetchTransport`, `serve --events`, ADR 0049.

#### O6 — Observed Transition Graph
- **Prerequisites:** O0 and events from O1 or O5. **Status:** ✅ complete (2026-10-23): `@pathcompiler/observed-graph`, `observe graph`, ADR 0050.

#### O7 — Workflow analytics
- **Prerequisites:** O6, O3. **Acceptance:** completion, abandonment, duration and
  action counts with sample thresholds. **Status:** ✅ complete (2026-10-23): `computeWorkflowAnalytics`, `observe workflows`, ADR 0051.

#### O8 — Possible-vs-Observed Reconciliation
- **Prerequisites:** O6, R2 (R1 model). Soft: R6.
- **Acceptance:** classifies possible+observed, possible+unobserved and
  observed+formally-unexpected. Never labels a discrepancy a bug.
- **Status:** ✅ complete (2026-10-23): `@pathcompiler/behavior-reconciliation`, `observe reconcile`, ADR 0052.

#### O9 — Path efficiency · O10 — Drop-off and alternative paths
- **Prerequisites:** O7 + R7 (O9); O7 + R6 (O10). **Status:** O9 ✅ complete (2026-10-24): `computePathEfficiency`, `observe efficiency`, ADR 0066. O10 ✅ complete (2026-10-24): `analyzeDropOffs`, `observe drop-offs`, ADR 0067.

#### O11 — Probabilistic transition model · O12 — Release behavior diff
- **Prerequisites:** O6 (O11); O7 + R11 + release binding (O12). **Status:** O11 ✅ complete (2026-10-24): `buildTransitionModel` (DTMC, Wilson intervals, goal reach estimates), `observe transitions`, ADR 0068. O12 ✅ complete (2026-10-24): `compareReleaseBehavior`, `observe release-diff`, ADR 0069.

#### O13 — Existing analytics adapters
- ⏸ Deferred until the native event model is stable in real use.

### 4.5 I track: improvement loop (PathCompiler-owned halves only)

Shared rules:
- Linked artifacts with stable IDs (finding → … → decision).
- Finding confidence and intervention confidence are separate.
- Human approval is required for adoption.
- No deployment execution, and no harness internals.
- **Selective:** the loop runs only on its four triggers (release, analytics
  threshold, scheduled, human request). It escalates only through the gate (IG).
  `no_change` is a valid outcome. Mode 6 is off by default.

#### I0 — Finding Model
- **Objective:** `findings`: `ProductFinding`, `ImprovementOpportunity`,
  `EvidenceBundle`, `PriorityAssessment` (components plus rationale).
- **Prerequisites:** P0, R4, R11 (permission and release regression, unexpected
  reachability); existing impact and browser evidence (✅). Behavioral classes
  (`workflow_friction`, `low_adoption`) are added once O7/O9 exist.
- **Acceptance:** deterministic classification from fixture reasoning and impact
  outputs, with lineage to evidence.
- **Triggers supported:** release-triggered (from R11 and impact; "no affected
  workflows" is a cheap no-op), human-triggered (`pathcompiler analyze
  <workflow|capability>`), and analytics-triggered (threshold crossings, once
  O7 exists). Scheduled runs are a CLI or CI invocation; hosted scheduling is
  deferred.
- **Runtime change:** No. **Unblocks:** IG. **Status:** ✅ complete (2026-10-24): `@pathcompiler/findings`, CLI `findings [subject]` (the human trigger; `analyze` was taken by C9), ADR 0078.

#### IG — Improvement gate, value assessment and policy (ADR 0033)
- **Objective:** Decide whether a finding should escalate:
  1. Is the evidence sufficient? If not, collect more data.
  2. Is the impact meaningful? If not, log only.
  3. Is a recommendation actionable? If not, surface the finding.
  4. Is autonomous implementation enabled? If not, give a human recommendation;
     if so, the task becomes eligible for a `HarnessTaskSpec`.

  The Improvement Value Assessment exposes its components (impact,
  affected/eligible users, confidence, expected gain, estimated cost) with a
  rationale. Per-project budgets apply. `no_change` decisions carry a rationale.
- **Prerequisites:** I0, C2 (`improvement_policy` configuration).
- **Packages:** new `improvement-gate`.
- **Interfaces:** `ImprovementPolicy` (minimum affected users, minimum
  confidence, minimum expected gain, recommendation/experiment/mutation budgets,
  compute budget, `autonomous_mutation: false` by default), `GateDecision`
  (`collect_more_data | log_only | surface_finding | recommend | eligible_for_harness | no_change`),
  `ImprovementValueAssessment`.
- **Acceptance:**
  - A low-impact, low-confidence finding gives `log_only` or `collect_more_data`.
  - A large, high-confidence regression gives `recommend`.
  - A niche feature with low usage but high completion gives `no_change` with
    its rationale.
  - Budgets cap recommendations per period.
  - With `autonomous_mutation: false`, no decision is ever `eligible_for_harness`.
- **Tests/evals:** decision-table tests; budget tests; explanation snapshots.
- **Runtime change:** No. **Unblocks:** I1. **Status:** ✅ complete (2026-10-24): `@pathcompiler/improvement-gate`, CLI `gate` (needs `modes.recommend` with a config), ADR 0079.

#### I1 — Recommendation Model
- **Prerequisites:** IG (only `recommend` decisions become recommendations); R8
  (`ProductPropertyRef` for protected behaviors).
- **Packages:** new `recommendation-engine`.
- **Interfaces:** `ImprovementHypothesis`, `ImprovementRecommendation`,
  `AcceptanceCriteria`.
- **Acceptance:** deterministic templates for regression and permission classes;
  categories FIX/IMPROVE/PROMOTE/BUILD/DEPRIORITIZE/INVESTIGATE.
- **Status:** ✅ complete (2026-10-24): `@pathcompiler/recommendation-engine`, CLI `recommend`, ADR 0080. BUILD and DEPRIORITIZE templates deferred (ISSUES_LOG #45).

#### I2 — Harness contract (mode 6 only)
- **Prerequisites:** I1, R11 (`SemanticChangeIntent`), R8. Emitted only for
  gate decisions `eligible_for_harness`.
- **Packages:** new `harness-contracts`; `examples/harness-contract/`; `fixtures/harness/`.
- **Interfaces:** `HarnessTaskSpec`, `MutationResult` (JSON Schema plus Zod,
  versioned), and a fixture harness returning synthetic results.
- **Acceptance:** round-trip serialization; lineage IDs preserved; unsupported
  major versions rejected; provider-neutral.
- **Runtime change:** No. **Status:** ✅ complete (2026-10-25): `@pathcompiler/harness-contracts`, `examples/harness-contract/`, `fixtures/harness/`, CLI `harness task`, ADR 0086. Tasks are emitted only for `eligible_for_harness`.

#### I3 — Candidate Evaluation (delivers mode 5)
- **Objective:** Evaluate any candidate commit, whether a human PR or harness
  output. Rebuild the model, compute the semantic diff, re-check protected
  properties, run workflow regression analysis and ingest business-level test
  results.
- **Prerequisites:** R1 (rebuild candidate model), R8, R11; phases 19–21 (✅).
  **Does not require I2.** Recommendation, acceptance criteria and
  `MutationResult` are optional inputs.
- **Packages:** new `candidate-evaluator`; GitHub check section; dashboard view.
- **Interfaces:** `CandidateEvaluation`, `evaluateCandidate({base, candidate, context?})`.
- **Acceptance:** a human PR is evaluated with no recommendation present. The
  "unexpected regression" demo (§254) fails a candidate even though the harness
  claims success.
- **Status:** ✅ complete (2026-10-23): `@pathcompiler/candidate-evaluator`, `pathcompiler evaluate`, ADR 0042. GitHub check section and dashboard view deferred (need C2 and stored evaluations).

#### I4 — Browser candidate verification
- **Prerequisites:** I3, C8. **Status:** ✅ complete (2026-10-24): `verifyCandidateWorkflows`, `evaluateCandidate` browser section with P3 diagnosis, `evaluate --browser`, ADR 0081.

#### I5 — Experiment Specification · I6 — Outcome Measurement · I7 — Adoption Decision · I8 — Improvement Memory
- **Prerequisites:** I3 + O0 + O7 (I5); I5 + O7/O11 (I6); I6 (I7); I7 (I8).
- **Packages:** new `experiment-core`, `outcome-analysis`, `improvement-memory`.
- **Acceptance:** success criteria fixed before measurement; outcomes improved,
  neutral, worse or inconclusive; failed-hypothesis demo (§253) yields
  ROLLBACK/ITERATE; human approval required.
- **Runtime change:** No. **Status:** I5 ✅ complete (2026-10-24): `@pathcompiler/experiment-core`, CLI `experiment create`, ADR 0082. I6 ✅ complete (2026-10-24): `@pathcompiler/outcome-analysis`, CLI `experiment measure`, ADR 0083. I7 ✅ complete (2026-10-24): `decideAdoption`, `recordApproval`, CLI `experiment decide/approve/decline`, failed-hypothesis demo yields ROLLBACK, ADR 0084. I8 ✅ complete (2026-10-25): `@pathcompiler/improvement-memory`, CLI `memory record/list`, history factor in `recommend`, ADR 0085.

#### I9 — External harness integration (mode 6)
- **Prerequisites:** I2 stable, I3, IG with mode 6 explicitly enabled. File- or API-based (`HarnessTaskSpec.json` in,
  `MutationResult.json` out).
- **Acceptance:** handoff Integration V0 (handoff §79) works without manual
  format conversion.
- **Status:** ✅ complete (2026-10-25): CLI `harness import`, Integration V0 proven end to end, ADR 0087.

#### I10 — Deployment and experiment adapters
- ⏸ Deferred (read-only coordination only, after the loop works manually).

---

## 5. Blocked and unblocked now

| Unblocked 🟢 | Blocked 🔒 (first missing prerequisite) | Deferred ⏸ |
| --- | --- | --- |
| C6 (needs repositories). Complete: R0 ✅, R1 ✅, R2 ✅, R3 ✅, R4 ✅, R11 ✅ (reasoning MVP), R8 ✅, I3 ✅ (mode 5), C1 ✅, O0 ✅, O1 ✅, O2 ✅, O3 ✅, O4 ✅, O5 ✅, O6 ✅, O7 ✅, O8 ✅ (mode 3 core), C2 ✅, C3 ✅, R-WI ✅, P0 ✅, C5 ✅, C7 ✅, R5 ✅, R6 ✅, R7 ✅, R9 ✅, R10 ✅, R12 ✅, C8 ✅, O9 ✅, O10 ✅, O11 ✅, O12 ✅, C4 ✅, C9 ✅, P1 ✅, P2 ✅, P3 ✅, P4 ✅, P5 ✅, P-RV ✅, I0 ✅, IG ✅, I1 ✅, I4 ✅, I5 ✅, I6 ✅, I7 ✅, I8 ✅, I2 ✅, I9 ✅ | — | O13, I10, MDP assistance (§60), information-gain diagnostics (§55), review editor/graph UI (spec §74), hosted multi-tenant control plane, billing, SSO, graph or vector database, CI/CD platform, multiple-candidate harness search, `analysis_backend: external_harness` (enterprise channel-A alternative), autonomous mutation by default (never), hosted scheduled triggers |

## 6. Parallel lanes

| Lane | Sequence | Notes |
| --- | --- | --- |
| A — formal core (critical path) | R0 ✅ → R1 ✅ → R2 ✅ → R3 ✅ / R4 ✅ → R11 ✅; R8 ✅ → I3 ✅ | Longest dependency chain; gates the reasoning MVP and the I track. |
| B — contracts and infrastructure | C1, C2, C3, C5, C8 (independent of each other and of lane A), then C9 | C1 gates O; C2 and C3 gate R-WI, C9 and IG; C8 gates I4, P3 and mode-5 browser checks. |
| C — uncertainty | P0 (any time) → P1 after R1 + C9 | Independent of A until P1. |
| D — observability | O0 after C1 → O1 → O3/O4/O5 → O6 → O7 | O8+ joins lane A outputs. |
| E — validation | C6 (needs repositories), C4 (hardening) | Any time. |
| F — evaluate (mode 5) | I3 after R1, R8, R11 (+C8) | Independent of observability and harness. |
| G — recommend and self-improve (modes 4, 6) | I0 → IG → I1 → (I2 → I9 only if mode 6 enabled); I5–I8 after observability | Selective by design; never forced. |

## 7. Remaining work: C6 on real repositories

Every planned phase except C6 is complete (I9: ADR 0087). PathCompiler now:
- understands a product statically, formally and probabilistically;
- guides, observes and evaluates;
- recommends with an explicit gate;
- runs the improvement loop through experiments, decisions and memory,
  with an optional, file-based harness boundary for mode 6.

Since then the behavioral-specification expansion (BX0–BX7) was added, the
ISSUES_LOG entries with a clear fix were resolved, and the documents were
re-read for gaps (2026-10-30; see the "Documentation and issue pass" record in
STATUS.md for what that covered and what it did not). The remaining work:
1. C6: alpha validation on the user's real repositories, for the original
   product and for the expansion (protocol in
   [BEHAVIOR_SPEC_GUIDE.md](../BEHAVIOR_SPEC_GUIDE.md));
2. the open ISSUES_LOG entries that real code is needed to settle.

### 7.1 Original rationale for choosing R0 first (2026-10-22)

Why R0, rather than another C phase or an original phase:

1. **No original phase remains open.** Phases 0–30 meet their acceptance
   criteria, and the remaining original-spec gaps (C1–C9) are cross-cutting
   rather than prerequisites for R0.
2. **R0's own prerequisite holds** (reasoning spec §19: "begin only after
   Product Graph, Capability representation and Evidence model are stable").
   All three are versioned, deterministic and consumed end to end (§1.5). The
   weak spot, heuristic permission and flag extraction, affects R1's automated
   extraction, not R0's hand-encoded model.
3. **R0 starts the longest critical path.** It feeds R1–R11, O8 reconciliation,
   the I3 candidate evaluation and C7 fixture cases. Every later MVP waits on
   this chain; the C phases can proceed in parallel lanes.
4. **R0 defines vocabulary later contracts reference.** Goal IDs, action IDs and
   property references are used by O4 domain events, I1 protected behaviors and
   I2 `SemanticChangeIntent`. Settling them first avoids rework in C1/O0/I2.
5. **R0 is additive and reversible.** It is a new package with no solver, no
   runtime change and no change to existing discovery.

6. **The product-layering decision (ADR 0033) keeps R0 first.** R0 is shared by
   three of the six modes: it improves mode 1 (Understand) and starts the
   critical path for mode 5 (Evaluate human PRs: R0 → R1 → R2 → R4 → R11 → R8 →
   I3) and mode 4 (Recommend). None of these require the harness.

**Immediately after, in parallel:** C1 (it unblocks the whole O track, mode 3, and
fixes a known public-contract divergence), then C2 and C3 (before R-WI, C9 and IG)
and C5 (before C9). If the business priority becomes "get a real customer such as
NutriPal to mode 3 (Observe) as fast as possible", the correct substitute for R0
is C1 followed by O0. That is a priority choice, not a dependency one: both lanes
are unblocked.
