# ADR 0032 — Integrate the reasoning, observability and improvement tracks

## Context

`REASONING_ENGINE_BUILD_SPEC.md` and `HARNESS_ENGINEERING_HANDOFF.md` add four
tracks to the original plan: formal reasoning (R0–R11), probabilistic reasoning
(P0–P5), observability (O0–O13) and an improvement loop (I0–I10) with an external
coding-harness boundary. Original phases 0–30 are implemented and verified
(`docs/phases/STATUS.md`). The new documents were written partly as if the
original plan had not yet been built.

A re-read of `CODEX_BUILD_SPEC.md` §§44–96 also found cross-cutting contracts that
the numbered phases never covered or implemented differently. These include
Runtime Result v1 (§63–65), RuntimeContext (§75), versioning (§70), configuration
(§44), the evaluation harness (§54), golden tests (§55), the error taxonomy (§51),
structured logging (§52), caching (§84), the model provider (§46–47) and the
alpha validation (§91).

## Decision

1. **Additive insertion, no renumbering.** Phases 0–30 keep their numbers and
   their completed status. The new phases keep the reasoning spec's IDs (R, P, O,
   I). Original-spec conformance gaps become a new **C track** (C1–C8). The
   ordering lives in `docs/phases/MASTER_ROADMAP.md`, which is dependency-ordered
   rather than sequential.
2. **Build order conflict (§164).** That section places the formal model before
   the compiler and runtime SDK. Those already exist, so the formal model is
   inserted *beside* the existing pipeline. Nothing built is reordered or
   rewritten (consistent with reasoning spec §115).
3. **Discovery baseline.** The reasoning spec's "old" pipeline (Product Graph +
   LLM) is not what exists. The real baseline is deterministic, test-backed
   discovery (ADR 0010). Reasoning-assisted discovery is added behind a
   feature flag (phase R-WI) and compared against that baseline. The baseline
   stays the default until the comparison harness shows the new path is better.
4. **Workflow versioning (§70, §136 vs ADR 0014).** Content-hash `revision`
   remains the identity of an approved workflow's content. Phase C1 adds a
   monotonic integer `workflowVersion` per workflow ID, derived from approval
   lineage, for runtime results and analytics events. C1 records the exact rule.
   The two are never conflated.
5. **Runtime Result v1 (§63–65).** The implemented `ProductHelpResult` diverges
   in names and content: `type: "workflow"`, no `content.steps` or capability
   flags, no unsupported reason `workflow_not_verified`. Phase C1 aligns the
   public contract and adds a migration note. Observability (O0) and the
   improvement loop bind to workflow IDs, versions and runtime results, so C1
   precedes O0.
6. **Configuration and flags (§44, §116, §139).** Reasoning, probabilistic and
   analytics features are gated by `pathcompiler.yaml` (phase C2). Every flag
   defaults to off and privacy-first. Until C2 lands, new capabilities are opt-in
   library APIs and CLI subcommands only.
7. **React provider naming (§134).** No second `PathCompilerProvider` is created.
   Phase O2 integrates analytics into the existing `@pathcompiler/react`
   provider through an optional, framework-independent analytics client from
   `analytics-sdk`. Any separate `analytics-react` package must reuse that
   provider.
8. **Workflow IR stays canonical and stable.** Solver-derived applicability
   (§13), analytics (§155) and confidence fusion do not enter Workflow IR v1.
   They live in reasoning or analytics artifacts keyed by workflow ID and
   version. Putting applicability into compiled workflows requires a dedicated
   ADR and, if semantics change, Workflow IR v2.
9. **Evidence classes.** Formal results, probabilistic inference, browser
   verification and observed runtime behavior are separate evidence classes,
   introduced additively (R2 result types, P0 `ConfidenceAssessment`, O0 events).
   Existing `EvidenceRef` is reused for source provenance and is not overloaded
   with claim types. `UNKNOWN` is never coerced to `UNREACHABLE`.
10. **Two MCP surfaces (§107).** The existing product-help MCP is unchanged.
    Developer reasoning tools go in a separate server or entry point with
    separate permissions (phase R12).
11. **Naming of proposals.** Existing `pathcompiler proposals` remain *workflow
    artifact* proposals. Improvement-loop objects use their own commands and
    packages (recommendations, harness tasks, evaluations) to avoid conflation.
12. **Harness boundary.** PathCompiler produces `HarnessTaskSpec` and consumes
    `MutationResult`. Repository mutation, tool use and implementation strategy
    are external. No domain package depends on a specific harness (Codex, Claude
    Code, Cursor, Devin). Candidate commits are always re-analyzed independently.
13. **Browser verification generalization.** The Phase 10 runner is deliberately
    limited to `clients.create`. Candidate browser verification (I4),
    model/browser consistency (§37) and browser-failure diagnosis (P3) require
    phase C8, a generalized safe browser verifier.

## Alternatives

- Renumber everything into one sequence: invalidates completed phase records and
  commit history references.
- Start immediately at the reasoning spec's §164 order: would rebuild the
  compiler and runtime around the formal model and discard working code.
- Make reasoning-assisted discovery the default at R3: unproven. The spec itself
  requires evaluation first.
- Change Workflow IR now for applicability or analytics: speculative, and
  violates the IR's role as stable runtime truth.

## Consequences

The roadmap has explicit tracks and dependencies, and several phases can run in
parallel. C1 is a deliberate breaking change to runtime result shapes and needs a
migration note. R-track phases add packages without changing runtime behavior.
The improvement loop cannot complete before formal semantic diffing (R11),
property checking (R8), generalized browser verification (C8) and observability
(O7/O9) exist.
