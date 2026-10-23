# ADR 0019 — MCP adapter over the SDK

## Context

Phase 17 exposes `resolve_help`, `search_workflows`, `get_workflow`,
`get_related_workflows` and `get_supported_actions` over MCP. MCP must call the
same core services as REST/SDK, with no separate business logic.

## Decision

- `@pathcompiler/mcp-server` registers five read-only tools (`readOnlyHint`,
  closed world) with the official `@modelcontextprotocol/sdk` (1.32.1). Each
  handler makes exactly one `PathCompiler` SDK call and returns its result
  unchanged, as structured content and JSON text. A test asserts equality with
  direct SDK calls.
- New catalog logic lives in core `@pathcompiler/resolver`:
  `relatedWorkflows` (same entity first, then same domain, stable ID order) and
  `supportedActions` (explain and checklist always; navigate only for a static
  entry route; guide when every step has a target or is navigate/explain/wait;
  `execute: false`). The SDK exposes them as `workflows.related` and
  `workflows.getSupportedActions`.
- **Deviation:** `RuntimeTransport` gains `getRelatedWorkflows(id)`, because
  relations need the whole index and the specified three methods cannot list
  workflows. Supported actions derive from the existing `getRuntimeManifest`.
- `PathCompilerError`s become `isError` tool results with their code. Unexpected
  errors propagate to the MCP SDK, which also reports them as tool errors.
- `pathcompiler mcp` serves stdio from `generated/*.json` through the static
  transport. Only MCP traffic goes to stdout; the ready message goes to stderr.

## Alternatives

- Compute related workflows inside the MCP package: forbidden by the spec and
  would diverge from REST/SDK.
- Add numeric relatedness scores: no evidence base yet.
- An HTTP/SSE MCP transport: deferred until the HTTP service exists.

## Consequences

Assistants get the same answers through MCP, SDK and later REST. Admin tools
(`get_impacted_workflows`, `get_change_evidence`) are deferred until Phase 20
impact analysis provides the underlying services.
