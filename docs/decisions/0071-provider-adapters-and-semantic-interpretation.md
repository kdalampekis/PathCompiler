# ADR 0071 — Provider adapters and evidence-first semantic interpretation

## Context

Phase C9 completes AI channel A (ADR 0034). C5 (ADR 0057) defined the
boundary: `PathCompilerModelProvider`, `guardModelProvider`, redaction, the
context record and the fixture provider. It had no real provider, and a test
banned vendor SDKs from every package.

C9 adds three things:
- OpenAI, Anthropic and local adapters, keyed from the environment;
- deterministic selection of ambiguous semantic clusters, so that only their
  evidence is sent;
- structured hypotheses, validated against deterministic evidence, behind a
  flag.

## Decision

- **One adapter primitive.** In core, `createStructuredModelProvider(id,
  complete)` maps the five provider methods onto a single call, which
  receives:
  - the task's instructions: the evidence is data, never instructions;
  - the guarded request as JSON;
  - the response's JSON Schema, generated from the existing Zod schemas.

  Adapters implement only that call, so every provider uses the same prompts
  and schemas, and `guardModelProvider` still validates every answer.
- **Anthropic adapter** (`@pathcompiler/model-provider-anthropic`). It uses
  the official SDK, `@anthropic-ai/sdk` pinned at 0.133.0. Each request has:
  - default model `claude-opus-5` and `max_tokens` 16000;
  - structured outputs (`output_config.format`, a JSON schema with the
    SDK's `transform` for unsupported keywords);
  - server-side refusal fallbacks (`fallbacks: "default"`, beta
    `server-side-fallback-2026-07-01`).

  The response is handled as follows:
  - `stop_reason: "refusal"` becomes `ModelProviderError("refused")`;
  - `max_tokens` becomes an invalid response;
  - transport errors become `request-failed`, with status and message only.
- **OpenAI-compatible adapter** (`@pathcompiler/model-provider-openai`). It is
  plain `fetch` to `/chat/completions`, with a non-strict `json_schema`
  response format: strict mode requires every property, and the schemas
  have optional ones.
  - It serves `openai` (key required) and `local` (OpenAI-compatible
    servers such as Ollama, LM Studio and vLLM; key optional; default
    `http://localhost:11434/v1`).
  - Error bodies are never repeated, because they may echo the request.
- **The ban tests are narrowed** (C5's in model-provider and Phase 28's in
  assistant-tools). Only `model-provider-anthropic` may depend
  on a vendor SDK, and only `cli` may depend on that package. The CLI loads
  it with a dynamic `import()` only when `provider: anthropic` is
  configured. Every other package stays SDK-free, as before.
- **Configuration.** `model_provider.provider` gains `local`, and
  `base_url` is added (http or https). Keys come only from the environment:
  `api_key_env`, or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.
  - A missing key is an actionable error.
  - `openai` and `local` require `model`; there is no guessed default.
- **Ambiguity is deterministic.** `findAmbiguousClusters` flags capabilities
  with any of:
  - a low confidence band;
  - no `semantic-target` inference (`weak-naming`);
  - a `semantic-label-conflict`;
  - a sibling with the same domain and verb (`possible-duplicate`).

  Flagged capabilities that share a domain or a route form one cluster, so
  the model can tell same-page actions apart or merge them.
- **Only targeted evidence is sent.** `interpretAmbiguities` sends one
  `inferCapabilities` request per cluster: the cluster's surfaces and
  `collectGraphEvidence` of their nodes, nothing else. With provider `none`
  nothing is sent. The report's `ModelContextReport` records every request.
- **Hypotheses are checked, never applied.** Each answer becomes a
  `SemanticHypothesis`: `confirm`, `rename` (current titles become alias
  candidates), `merge` or `interpretation`. Its confidence is
  `model-stated-not-probability`. It is rejected when:
  - it cites evidence outside its own surfaces' packets;
  - its title has a capability verb that none of the covered capabilities
    has;
  - its title names none of their entities or domains;
  - it merges different entities.

  Rejected hypotheses are reported, never used. Capabilities are not
  changed; P1 will consume supported hypotheses as candidate
  interpretations. A refused or invalid answer is recorded as a per-cluster
  failure. Transport and key errors stop the run.
- **CLI `analyze [directory]`.** It writes `reports/semantic-hypotheses.json`.
  `--model-fixtures` replays recorded answers through `FixtureModelProvider`,
  for reproducible runs without a key.
- **Evaluation.** The report states:
  - `proposedInventionRate`: the rejected share of model proposals;
  - `appliedInventionRate`: always 0, because only supported hypotheses can
    be used.

  The deterministic baseline invents nothing by construction, so the
  assisted output cannot raise the unsupported-invention rate.

## Alternatives

- **Plain HTTP for Anthropic too.** The roadmap preferred HTTP. The official
  SDK keeps the structured-output and fallback request shapes current, and
  confining it to one adapter, loaded lazily, keeps core SDK-free. The
  roadmap allowed this with an explicit decision, which this ADR records.
- **Separate `model-provider-local` package.** Local servers speak the
  OpenAI-compatible API, so a second package would duplicate the adapter.
  `createLocalModelProvider` lives in the OpenAI-compatible package.
- **Applying supported renames to capabilities.** That would change existing
  deterministic output and approved-workflow inputs. Hypotheses stay
  reviewable data until P1 fuses them with formal consistency.
- **Sending every capability.** That sends more than is needed and contradicts
  evidence-first selection; unambiguous capabilities gain nothing.

## Consequences

- With no provider configured, every existing output is identical, and
  `analyze` sends nothing.
- The demo fixture has no ambiguous capability, so even a configured
  provider receives nothing there. Tests use small synthetic projects.
- A recorded real-provider evaluation needs a key and was not run
  (ISSUES_LOG #34). Real providers' acceptance of the generated JSON
  Schemas is not verified either (#35).
- The ambiguity and validation rules are lexical heuristics; synonyms such
  as "Add" for create are not treated as verbs (#36).
