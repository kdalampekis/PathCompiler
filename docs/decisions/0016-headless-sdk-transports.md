# ADR 0016 — Headless SDK and transports

## Context

Phase 14 adds a headless client with `resolve`, `workflows.get` and
`workflows.search` over a transport abstraction, starting with a local static
transport for bundled/offline use. The SDK must run in browsers, but the
compiler module imports `node:crypto` for revision hashing.

## Decision

- Split compiled-artifact schemas into `@pathcompiler/workflow-compiler/schema`,
  with no Node.js imports. The resolver and SDK import only that entry. A test
  walks the SDK's built module graph and fails on Node built-ins.
- `RuntimeTransport` is exactly `resolve`, `getWorkflow`, `getRuntimeManifest`.
  `workflows.search` is derived from `resolve`: one match, all ambiguous options,
  or none. It does not add a ranked-listing endpoint.
- `getWorkflow` returns the documentation record without `commit`. Runtime
  consumers get readable steps, not repository binding.
- The client validates responses with the published schemas and throws a typed
  `PathCompilerError`. Transport errors propagate unchanged, so nothing is
  swallowed or re-labelled.
- `createStaticTransport` requires all three build outputs, with matching
  compiler versions and identical `id@revision` sets. It serves copies so
  callers cannot mutate shared state.
- `project` is validated and exposed for future hosted transports. The static
  transport does not use it.

## Alternatives

- Make the compiler hash with a pure-JS SHA-256 so the root entry is browser-safe:
  adds code to a build-time package to serve runtime consumers.
- Extend the transport with search/list: not in the specified contract, and not
  needed yet.
- Return full Workflow IR from `getWorkflow`: it contains evidence and paths.

## Consequences

Applications can bundle the generated files and run without a network. The HTTP
service (Phase 18) implements the same transport interface. Bundling
`documentation.json` still ships commit SHAs in the bundle, even though the SDK
never returns them. Teams that mind can omit those values at build time later.
