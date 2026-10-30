# ADR 0095 — Rule discovery with a model or a harness (BX8)

## Context

The deterministic extractors (ADR 0089) read what is written as a declaration:
schemas, validation models, contracts, tests and top-level guard clauses. Much
of what a product must obey lives elsewhere: in helper functions, in
conditionals, in comments, and in the history that explains why a check was
added. ADR 0034 kept understanding the product deterministic and listed "an
external harness as an analysis backend" as a deferred enterprise option.
The cheap way to read code and history at scale is often a coding harness the
team already runs, and a model API is the alternative. Both are untrusted
readers: they can be wrong, can invent evidence, and can encode a bug as a
requirement.

## Decision

- **New `@pathcompiler/rule-discovery`, two routes, one contract.**
  - **Harness route (file based, like ADR 0086/0087).** `rules task` exports a
    `DiscoveryTask`: the operations found (with parameters, contract,
    limitations and source lines), the variables rules may use, the known rules
    (approved, extracted, candidate, rejected), the constructs the extractors
    could not model, the files to read and the commit range. It does not
    contain the repository. The harness writes `RuleProposals.json`;
    `rules import` validates it. PathCompiler never runs the harness.
  - **Model route.** `rules discover` sends the same task plus bounded excerpts
    (the operations' source files, capped, and the messages of the commits that
    touched them) through the existing provider adapters. The adapters expose
    their structured-task primitive (`createAnthropicCompletion`,
    `createOpenAICompatibleCompletion`), so no new vendor code is needed and
    the core imports no SDK. `--explain-context` prints exactly what would be
    sent and sends nothing (ADR 0034, rule 3). The harness route is usually the
    cheaper one; both are equal in what they may produce.
- **Proposals are claims, validated before they count.** A proposal is a
  business rule, invariant or permission in the BehaviorIR syntax with
  evidence. It is accepted only if it parses, uses variables and operations
  that exist, is not a known or rejected rule, and has at least one piece of
  verifiable evidence: the file exists, the lines are in range and the quoted
  text is in them, or the commit exists. Unverifiable evidence is dropped and a
  proposal with none is rejected.
- **Provenance can only be inferred.** Accepted rules are written to
  `spec/candidate-rules.json` as `INFERRED` / `LLM_ASSISTED` (the provenance
  schema already forbids a model-found rule from being `EXPLICIT`), with
  confidence `LOW` or `MEDIUM` computed by PathCompiler, never taken from the
  proposer: `MEDIUM` only if a quote was found in the cited text. Provenance
  gains an optional `sourceCommit`.
- **The code is asked about the rule.** Each accepted rule is verified against
  the extracted code: `holds`, `contradicted` or `unknown`. A contradicted rule
  is kept and flagged: it is a bug in the code or a wrong rule, and only a
  person can say which.
- **A person promotes.** `rules approve <id> --by <name>` moves a candidate into
  `spec/approved-rules.json` with that person as `declaredBy` (approved files
  may now name an approver per rule) and records where it came from;
  `rules reject` records the reason and keeps the rule from being proposed
  again. Candidates take part in verification, the PR guard and the agent gate
  as extracted candidates: reported with the caveat, never failing a change
  alone. The PR guard reads approved rules from the base branch, so an approval
  applies once it is merged.

## Alternatives

- **Trust the reader's confidence.** Makes the most confident hallucination the
  most authoritative.
- **Let discovered rules go straight into the approved file.** Turns a reader's
  guess into a verifier's ground truth; the verifier would then prove the wrong
  thing.
- **Send the repository to the model.** Against the privacy rules; the
  deterministic extraction already isolates what to read.
- **A harness-specific integration.** The file contract works with any harness
  that can read a JSON task and write a JSON file.

## Consequences

- Rules that live in helpers, comments and history can enter the specification
  without lowering the bar for what is enforced.
- Evidence checking is textual: a real quote proves the passage exists, not
  that it supports the rule. That is why confidence is capped at MEDIUM and a
  person approves.
- Nothing here has been run against a real model API or a real harness; the
  tests use scripted answers on the refund fixture. How many valid rules a
  harness finds, and how many bugs it encodes as rules, is unmeasured.
- The model route ignores `--from` (it takes up to 20 recent commits per file,
  up to `--to`); the harness receives the range as a task field and applies it.
