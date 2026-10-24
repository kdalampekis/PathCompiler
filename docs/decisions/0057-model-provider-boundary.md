# ADR 0057 — Model provider boundary

## Context

Phase C5 implements CODEX spec §45–§47 and AI channel A, part 1 (ADR 0034).
Models are optional semantic helpers. Every output must be schema-validated,
the whole repository must never be sent by default, requests carry minimal
evidence with obvious secrets stripped, and the context sent is recorded and
can be listed in a dry run. `capability-engine` already had an optional
`SemanticModel` interface with output validators, but nothing routed through a
shared boundary, and no provider existed.

## Decision

- **New `@pathcompiler/model-provider`** with no vendor SDK:
  - `PathCompilerModelProvider` (spec §46): `inferCapabilities`,
    `synthesizeWorkflow`, `explainImpact` and `generateAliases`, plus
    `summarizeEvidence`, so `SemanticModel` maps onto the same boundary;
  - strict Zod request and response schemas. `inferCapabilities` reuses
    capability-engine's classification schemas;
  - `NoopModelProvider`, the default: deterministic, it infers nothing.
    `explainImpact` returns the reasons verbatim, and `summarizeEvidence`
    fails with `no-provider`;
  - `FixtureModelProvider`, which replays recorded responses by `fixtureKey`
    (kind plus a hash of the canonical request) and fails with
    `fixture-missing` instead of guessing;
  - `guardModelProvider`, the boundary every call goes through. It validates
    and secret-redacts the request, then reports a `ModelContextEntry` (bytes,
    evidence node counts, referenced paths, redaction counts by kind, never
    values). It then validates the response against its schema and the
    evidence it may cite:
    - classifications and syntheses may cite only request evidence;
    - explanations may cite only request reason codes;
    - a synthesized workflow must be a `candidate` for the requested
      capability;
  - `semanticModelFromProvider`, which turns a guarded provider into
    capability-engine's `SemanticModel`;
  - `redactSecrets` and `redactValue`: private keys, AWS access keys,
    `sk-…`, GitHub and Slack tokens, JWTs, and quoted values assigned to
    key/secret/token/password names.
- **Privacy by construction.** Requests are evidence packets (graph nodes with
  locators and labels), not file contents. Source reading already skips
  hidden files (`.env`), binaries, excludes and Git-ignored paths.
- **CLI dry run:** `pathcompiler scan <directory> --explain-model-context
  [--json]` builds the `inferCapabilities` request a provider would receive,
  redacts it and writes the exact payload, with its description, to
  `reports/model-context.json`. Nothing is sent. The provider shown comes from
  `model_provider.provider` in `pathcompiler.yaml`, or `none`.

## Alternatives

- **Keeping the provider interface in `capability-engine`.** Synthesis,
  impact explanations and aliases belong to other packages, and one boundary
  keeps redaction and logging in one place.
- **A vendor adapter now.** Deferred to C9 by the roadmap. The contract test
  fails if any package depends on a vendor SDK.
- **Redacting by entropy.** It catches more, but also mangles IDs and hashes
  in evidence. Pattern-based redaction is predictable, and C9 can extend it.

## Consequences

C9 can add vendor adapters behind `PathCompilerModelProvider`, and they get
redaction, context logging and response validation for free. No existing
behavior changes: nothing calls a model unless a caller passes a provider.
