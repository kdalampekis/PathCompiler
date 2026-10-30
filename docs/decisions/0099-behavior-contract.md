# ADR 0099 — The behavior contract: one format for any language (BX12)

## Context

The deterministic extractors read TypeScript, SQL, OpenAPI and JSON. For any
other language (Python, Go, Java, Ruby, PHP, Rust, ...) PathCompiler had no
description of what an operation does, so the PR guard had nothing to compare
and `check_change` could only offer risk heuristics. Writing a parser per
language does not scale, and the end goal (docs/PRODUCT_NORTH_STAR.md) is any
codebase. The harness already reads any language; what was missing was a
language-neutral format for it to write down what it understood, and a way to
keep that description honest as the code changes.

## Decision

A **behavior contract** (`spec/behavior-contract.json`, `behavior-contract/1`):
facts about code, never business rules.

- **Content.** Variables (typed, scoped input/state/context) and operations:
  parameters, preconditions (the guards the code enforces), postconditions,
  effects on state, limitations, and **anchors** (file, line range, verbatim
  quote, and a fingerprint PathCompiler computes). Expressions use the existing
  BehaviorIR syntax, so every verifier, the PR guard and the action gate work
  unchanged. Business rules stay in the approved and candidate rule files.
- **Any front end.** A harness, a model, a person, or a future
  language-specific tool writes it. The task (`contract task`,
  `pathcompiler_contract_task`) lists the files, what is described, what is
  stale and the instructions; the answer (`contract import`,
  `pathcompiler_submit_contract`) is validated per operation: the anchor lines
  exist and contain the quote, expressions parse, variables are declared, and
  the merged result is a valid specification. Rejected operations come back
  with reasons to fix.
- **Trust.** Facts are INFERRED (`LLM_ASSISTED`, MEDIUM) until a person runs
  `contract approve`; any edit withdraws the approval. In a pull request, facts
  count as approved **only if identical to the base's approved contract**;
  whatever the head file says about itself is ignored (a null base approval means
  nothing is approved, which a test caught as a self-approval hole). A violation
  found through unapproved facts is capped at `review` with a caveat, because
  whoever wrote the facts may have misread the code, and a harness that writes
  both the change and the description would be grading itself.
- **Drift without a parser.** An anchor's fingerprint covers its normalized lines
  (whitespace and blank lines ignored). At the head the same lines are found
  intact, moved, or changed. A base operation whose anchored code changed while
  its description was not re-derived is a `contract_stale` finding
  (`review`): the rules were checked against an out-of-date description. This
  works for any language.
- **Reading.** `readSourceFiles` also reads the files a contract is anchored to,
  whatever their extension, so base and head both carry them.

## Alternatives

- *Tree-sitter or per-language analyzers.* Deterministic, but one per language,
  heavy native/WASM dependencies, and still blind to framework conventions. They
  remain welcome as another producer of the same contract.
- *Let the harness's verdict stand.* Violates "a harness never grades itself".
- *Put rules inside the contract.* Mixes facts about code (change with the PR)
  with rules (must not change with the PR); the PR guard needs the split.

## Consequences

- Business rules can now be checked in a Python (or any) repository: tested on
  `fixtures/pyrefunds` with the refund policy, where an unreviewed fast path is
  reported with the values that break the approved rule.
- The check is as good as the description. A wrong or incomplete description
  yields false comfort or false alarms; approval by a person, the independent
  reviewer and the project's own tests remain the safeguards. Recorded in
  ISSUES_LOG #73.
- The expression language is the limit of what a contract can say (linear
  integer arithmetic, booleans, enums, string equality). Dates, decimals, lists
  and loops go in `limitations` and are not verified (ISSUES_LOG #74).
