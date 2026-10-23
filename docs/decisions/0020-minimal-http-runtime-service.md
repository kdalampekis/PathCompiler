# ADR 0020 — Minimal HTTP runtime service

## Context

Phase 18 asks for a minimal runtime service with `POST /v1/help/resolve`,
`POST /v1/workflows/search`, `GET /v1/workflows/:id` and
`GET /v1/workflows/:id/runtime`, protected by a simple API token, with behavior
mirroring the SDK. The SDK transport also needs related workflows (ADR 0019).

## Decision

- `@pathcompiler/http-service` uses Node's `http` module with no framework. Each
  endpoint makes exactly one `PathCompiler` SDK call. Request validation and
  error codes therefore come from the SDK, and `PathCompilerError` codes map to
  HTTP statuses (400/404/500/401/502).
- `GET /v1/workflows/:id/related` is added (the architecture lists it) so
  `createHttpTransport` can implement the full `RuntimeTransport`.
- Authentication is one bearer token (16+ characters), compared with
  `timingSafeEqual`. `token: null` exists only for programmatic loopback
  development. The CLI always requires `PATHCOMPILER_API_TOKEN`.
- Unexpected errors return a generic 500 and go to an `onError` hook, so internal
  messages and paths never reach clients. Responses use `cache-control: no-store`
  and `nosniff`. JSON bodies only, limited to 64 KiB.
- `createHttpTransport` (SDK) uses `fetch`. It is browser-safe and rejects
  credentials in the base URL. HTTP error responses become typed
  `PathCompilerError`s (new codes `unauthorized`, `transport-failed`). Network
  errors propagate unchanged.
- `pathcompiler serve` binds to `127.0.0.1:4310` by default and serves
  `generated/*.json` through the static transport.

## Alternatives

- Express/Fastify/Hono: a dependency for five routes.
- Per-user auth, API keys per project, rate limiting, CORS: deferred until hosted
  deployment and tenancy exist (Security Rules, spec §48).
- Separate HTTP business logic: forbidden; it would drift from the SDK.

## Consequences

SDK, MCP and HTTP share one implementation path. The single shared token is
unsuitable for browsers or multi-tenant hosting, and the docs say so.
