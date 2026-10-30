# ADR 0034 — AI integration channels: model providers, MCP and external harness

## Context

PathCompiler now touches AI in three different directions, and they risk being
conflated:

- The original plan (`CODEX_BUILD_SPEC.md` §45–47) uses LLMs for semantic
  interpretation of repository evidence through a provider-neutral interface,
  configured with a customer's own key (for example `OPENAI_API_KEY` or
  `ANTHROPIC_API_KEY`). Only the `SemanticModel` interface exists today
  (Phase 6). Analysis is fully deterministic.
- MCP servers expose PathCompiler intelligence to external agents (Phase 17,
  product help; developer reasoning later).
- The reasoning extension adds an external coding harness for code mutation
  (`HarnessTaskSpec` → `MutationResult`).

## Decision

Keep three separate channels with separate packages, configuration and
permissions:

| Channel | Direction | Purpose | Interface | Required for |
| --- | --- | --- | --- | --- |
| **A. Internal AI (model providers)** | PathCompiler → model | Understand the product: interpret ambiguous evidence clusters, name and merge capabilities, propose aliases, produce semantic hypotheses | `PathCompilerModelProvider` in `model-provider`, with adapters (OpenAI, Anthropic, local) | Optional semantic assistance in mode 1 |
| **B. PathCompiler MCP** | Agent → PathCompiler | Let external agents ask what a workflow does, which constraints apply, what a diff affects and whether a candidate broke anything | Product-help MCP (exists); developer reasoning MCP (R12) with separate permissions | Optional agent integrations |
| **C. External harness** | PathCompiler → harness → PathCompiler | Modify the repository | `HarnessTaskSpec` / `MutationResult` | Mode 6 only |

Rules:

1. **PathCompiler understands repositories on its own.** `pathcompiler analyze`
   needs no Claude Code, Codex, Cursor or other harness. Channel A is optional,
   and with no provider configured, analysis stays deterministic, as it is today.
2. **Evidence-first model use.** Deterministic analyzers select and structure
   evidence (routes, components, APIs, permissions, tests, Git). Only targeted
   evidence for ambiguous semantic clusters is sent. Repositories are never
   uploaded wholesale. Model outputs are structured, schema-validated
   hypotheses, checked against deterministic evidence before they enter
   capabilities or candidates. They are semantic evidence, never formal proof
   or approval.
3. **Privacy:** honor excludes; never send `.env`, secrets or binaries; record
   exactly what was sent; and offer `--explain-model-context` as a dry run (§47).
4. **Vendor isolation.** Core packages never import provider SDKs. Provider
   adapters live in separate adapter packages and prefer plain HTTP. The current
   workspace-wide ban on provider SDKs (Phase 28 test) will be narrowed to core
   packages if an adapter genuinely needs an SDK. That change requires an
   explicit decision.
5. **Optional enterprise analysis backend (deferred).** Later,
   `analysis_backend.mode: external_harness` may route semantic analysis tasks
   to a customer's own agent instead of a provider API, using the same structured
   hypothesis contract and the same deterministic validation. This is not the
   default.
6. **No channel substitutes for another.** MCP is not how PathCompiler analyzes a
   repository. The harness is not how it understands the product. Model
   providers never mutate code.

## Alternatives

- Use a coding harness for all semantic analysis: creates a hard dependency on
  third-party agents and makes the core product non-functional without one.
- Send whole repositories to a model: violates privacy rules and is unnecessary,
  because deterministic analysis already isolates the relevant evidence.
- Merge product-help and developer-reasoning MCP: would expose admin flows,
  permissions and source details to end-user agents (reasoning spec §108).

## Consequences

The roadmap splits C5 (provider boundary, fixture and no-op providers, privacy
dry run) from a new C9 (real provider adapters and evidence-first
model-assisted semantic interpretation, behind a flag and evaluated). P1 builds
on C9. The developer reasoning MCP (R12) and the harness contract (I2) remain
separate phases with separate permissions.

## Update (2026-10-30)

A narrow form of rule 5 now exists: ADR 0095 lets an external harness, or a
model through the provider adapters, read the code and its history to *propose
business rules*. It does not replace deterministic understanding of the
product: proposals are validated, checked against the code and stored as
candidates that only a person can approve.
