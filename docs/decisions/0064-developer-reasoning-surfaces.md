# ADR 0064 — Developer reasoning surfaces

## Context

Phase R12 implements reasoning spec §73 (`/v1/reason/*` endpoints), §74 (MCP
reasoning tools) and §75 (developer agents asking product-semantic
questions). The roadmap's acceptance has two parts:
- the surfaces are never exposed to end-user tokens;
- results are product-semantic only.

The existing HTTP service and MCP server serve end-user product help.

## Decision

- **New `@pathcompiler/reasoning-service`.** `createReasoningService({
  reasoner, model, capabilities? })` has seven operations:
  - `reachability`;
  - `why-unreachable` (R4);
  - `plan` (R3);
  - `alternatives` (R6, with variants);
  - `verify-property` (R8);
  - `minimal-enablement` (R5);
  - `dead-features` (R9).

  Inputs are validated with Zod, unknown goals become
  `ReasoningRequestError`s with the known goals, and every result has its
  solver `stats` removed. `compare-releases` is not served: it needs two
  commits, and `reason diff` and the GitHub check already cover it.
- **HTTP (`http-service`).** The new `reasoning: { token, service }` option
  routes `POST /v1/reason/<operation>`:
  - only the developer token is accepted there, and it is required even when
    the API runs without a token;
  - the developer token is refused (403) on every other endpoint;
  - it must be 16+ characters and differ from the API and ingest tokens.

  The service is structural, so `http-service` does not depend on the
  reasoner.
- **A separate developer MCP.** `createReasoningMcpServer` and
  `serveReasoningStdio` register `pathcompiler.check_reachability`,
  `explain_unreachable`, `find_plan`, `list_alternative_paths`,
  `verify_product_property`, `minimal_enablement` and `dead_features`, all
  read-only. The product-help MCP (`mcp-server`) is unchanged and gains no
  reasoning tools.
- **CLI:**
  - `serve` adds the endpoints when `PATHCOMPILER_DEVELOPER_TOKEN` is set,
    over the working directory's model or `--model`;
  - `pathcompiler mcp-reasoning [directory] [--model]` serves the developer
    MCP on stdio;
  - with `pathcompiler.yaml`, both need `reasoning.enabled`.

## Alternatives

- **Adding reasoning tools to the product MCP.** End-user assistants would
  see product internals (guards, unreachable features). Rejected; the
  roadmap asks for separate permissions.
- **Reusing the API token with a scope claim.** The tokens are plain shared
  secrets with no scopes. A distinct token is the simplest separation that
  can be verified.

## Consequences

Coding agents can ask product-semantic questions while they work, through
MCP or HTTP. End users and browser builds never reach reasoning. The solver
in `serve` and `mcp-reasoning` lives as long as the process.
