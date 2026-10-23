# ADR 0027 — Local control plane dashboard

## Context

Phase 25 adds `apps/dashboard` with Projects, Product Map, Workflows, Workflow
Detail, Pending Changes, Evidence and Settings screens. Workflow Detail must show
steps, source evidence, confidence, current commit, validation report and pending
diff. The first editor can be simple, and graph visualization should wait until
the review loop proves useful.

## Decision

- A Next.js App Router app (the first supported stack) with server components
  that read a project's `.pathcompiler` directory per request
  (`force-dynamic`). Projects come from `PATHCOMPILER_PROJECTS`
  (`{name: {root, out?}}`), defaulting to the working directory.
- Reads use the core parsers (`workflow-review`, `workflow-discovery`,
  `workflow-proposals`) and the CLI's JSON reports. IDs are schema-validated
  before any path is built, so unknown or traversal IDs return 404.
- Writes are server actions that invoke `runCli`: approve/reject candidates and
  accept/reject/ignore proposals. Every rule (re-validation, clean-tree and
  commit checks, exclusive decisions) is therefore the CLI's. Results come back
  as status/alert messages through a redirect.
- The CLI is imported at runtime (`turbopackIgnore`), and project paths are
  marked as runtime-dynamic, so the build neither bundles the scanners nor traces
  the filesystem.
- The product map is a table of capabilities by domain with coverage. There is
  no graph rendering.
- Local use only: there is no authentication, the server binds to `127.0.0.1`,
  and the reviewer name comes from the form or `PATHCOMPILER_USER`.

## Alternatives

- A separate API service for the dashboard: duplicates the CLI and HTTP service.
- A client-side SPA reading generated JSON: cannot run review actions or read
  candidates and reports safely.
- Graph visualization now: deferred by the spec.

## Consequences

Reviews can happen in a browser with the same guarantees as the CLI. A Playwright
suite builds a real project with the CLI and verifies every screen, accepting a
proposal and approving a candidate. Hosted multi-user use needs authentication,
authorization and audit logs (spec §48) first.
