# ADR 0030 — Provider-neutral assistant tools

## Context

Phase 28 provides a provider-neutral core `resolveProductHelp()` plus OpenAI,
Anthropic, LangChain-style and generic JSON Schema tool descriptions. No provider
SDK may enter core packages (Invariant 4).

## Decision

- Add `@pathcompiler/assistant-tools`, which depends only on the SDK and zod.
  There is a single tool, `resolve_product_help`, with one JSON Schema that
  mirrors the SDK's resolve request.
- `resolveProductHelp(client, input)` is the shared core.
  `parseToolInput` accepts a JSON string (OpenAI `arguments`) or an object
  (Anthropic `input`, LangChain), drops strict-mode nulls, and converts
  feature-flag pairs to a map. Invalid input raises `ToolInputError`. The SDK then
  validates again.
- Adapters only reshape data. Anthropic gets `{name, description, input_schema}`.
  OpenAI gets a `strict: true` function in Chat Completions (nested) or Responses
  (flat) form, using a strict-compatible schema. LangChain gets the structured-tool
  shape (`name`, `description`, `schema`, `invoke` returning a JSON string). The
  generic form is `{name, description, inputSchema}`.
- A test fails if any workspace package depends on `openai`, `@anthropic-ai/*` or
  LangChain packages.

## Alternatives

- Import provider SDK types for precise typings: introduces vendor dependencies
  into the package.
- Several tools (search, get workflow): MCP already exposes those. Assistants
  need one well-described entry point first.
- A non-strict OpenAI schema: weaker argument guarantees.

## Consequences

Any assistant can call PathCompiler with a copy of these definitions and get the
same structured results as the SDK, MCP and HTTP. Provider wire formats can change,
but adapters are thin, so updates stay small.
