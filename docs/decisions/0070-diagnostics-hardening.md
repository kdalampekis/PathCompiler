# ADR 0070 — Diagnostics hardening

## Context

Phase C4 covers CODEX spec §51 (error taxonomy), §52 (structured logs
without source contents), §53 (scan counts and phase durations), §83
(development performance targets) and §84 (a content-hash parse cache that
never changes output). Until now, errors were plain `Error`s or
package-specific classes, nothing was logged, `scan` printed only node and
edge totals, and every command re-analyzed from scratch.

## Decision

- **New `@pathcompiler/diagnostics`** (no dependencies):
  - **Taxonomy:** the nine spec §51 classes (ConfigurationError,
    RepositoryAnalysisError, UnsupportedFrameworkError,
    WorkflowValidationError, TargetResolutionError, WorkflowNotFoundError,
    AmbiguousWorkflowError, ModelProviderError, GitProviderError) on a
    `PathCompilerDiagnosticError` base with a `kind`. `errorKind(error)` also
    classifies packages that keep their own public classes, by name and code
    (`ReviewError` and `ProposalError` as workflow validation, the SDK's
    `workflow-not-found`).
  - **`Logger`** and **`createJsonLogger`**: JSON lines with the §52 fields
    (project, commit, phase, workflow_id, node_id, duration_ms). Fields that
    could carry source (source, content, code, snippet, text, body) are
    dropped unless `debugSource`.
  - **`timed`** records phase durations (even when a phase throws) and logs
    them. **`PERFORMANCE_TARGETS_MS`** holds the §83 targets.
  - **`contentKey` and `createFileCache`:** a sha-256 key over versioned
    parts, one JSON file per key, written with an atomic rename. A corrupt
    entry is reported and treated as a miss.
- **Adoption at package boundaries:**
  - `ConfigError` extends `ConfigurationError`, and model-provider's error
    extends `ModelProviderError`;
  - `readSourceProject` throws `RepositoryAnalysisError`, with an actionable
    message for missing directories;
  - git-intelligence throws `GitProviderError` and `TargetResolutionError`,
    and adapter-github throws `GitProviderError`;
  - adapter-nextjs throws `UnsupportedFrameworkError` when no App Router
    pages exist.

  Messages are unchanged or extended, never shortened.
- **Cache:** `analysisCacheKey` (adapter version, TypeScript version,
  repository snapshot, every file and config) and `analyzeNextProjectCached`
  (round-trips the graph and summary through their schemas; anything
  unusable is recomputed).
- **CLI `scan`:**
  - it uses the cache under `<out>/cache/analysis` (`--no-cache` to bypass);
  - it prints the §53 counts table (files, routes, components, UI actions,
    API endpoints, tests, capabilities, candidate workflows, warnings) and
    phase durations against the fixture target;
  - with `PATHCOMPILER_LOG=json|debug` it writes JSON logs to stderr;
  - timings stay out of artifacts, so repeated scans produce identical files.

## Alternatives

- **Replacing every package's error classes.** That would break public APIs
  (`ReviewError`, the SDK's `PathCompilerError` codes). Classifying them by
  name keeps their contracts.
- **A per-file AST cache.** TypeScript analysis spans the whole program, so
  per-file reuse needs incremental program APIs. Whole-project keys are
  correct by construction and already make repeated scans much faster.

## Consequences

Errors can be reported by kind (for example in the dashboard or the GitHub
check), and logs are safe to ship. Only `scan` uses the cache so far; other
commands still analyze fresh (ISSUES_LOG #33).
