# ADR 0028 — Static export formats

## Context

Phase 26: `pathcompiler build` must output runtime artifacts that can be bundled
with a customer application, support JSON, YAML and Markdown, and never require
PathCompiler servers at runtime (privacy, latency, enterprise deployment,
developer trust).

## Decision

- `exportArtifacts(compiled, formats)` in `@pathcompiler/workflow-compiler`
  returns deterministic `[path, content]` pairs under `generated/`. The CLI writes
  them atomically. `--format` accepts `json`, `yaml` and `markdown`, repeated or
  comma-separated, with `json` as the default.
- JSON is the runtime interchange format: the SDK's static transport (ADR 0016)
  consumes it and bundlers import it natively. YAML mirrors the same three
  documents for teams that review or post-process YAML. The browser SDK does not
  gain a YAML parser.
- Markdown is a single `workflows.md` catalog rendered from documentation records.
  It is derived output with a generated-file marker. All approved text passes
  through `escapeMarkdown`, so titles or instructions cannot inject HTML, links or
  emphasis. The per-workflow renderer is shared with Phase 27.
- Static mode has no runtime dependency on PathCompiler services. This is verified
  by resolving through the SDK from the built files with `fetch` disabled.

## Alternatives

- Generate a JavaScript module wrapping the JSON: bundlers already import JSON,
  and a module adds a code-generation surface.
- YAML parsing in the SDK: adds weight to browser bundles for no runtime benefit.
- Markdown as an input format: Markdown is a renderer/export, never the source of
  truth.

## Consequences

Customers can commit or bundle `generated/*.json` and run offline. YAML and
Markdown are for humans and tooling. All formats change only when approved content
or `COMPILER_VERSION` changes.
