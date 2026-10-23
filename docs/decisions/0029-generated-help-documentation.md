# ADR 0029 — Generated help documentation

## Context

Phase 27 uses approved workflows to generate `docs/help/*.md`, so that a workflow
produces a documentation page without anyone duplicating business knowledge by
hand. Markdown must not become the source of truth.

## Decision

- Pure `renderHelpPages(documentation)` in `@pathcompiler/workflow-compiler`
  returns `index.md` (grouped by domain) and `<id>.md` for each approved workflow,
  reusing the escaped `renderWorkflowMarkdown` from Phase 26.
- Every page begins with the generated marker plus the workflow ID, revision and
  compiler version, followed by an instruction to change the workflow, not the
  file.
- `pathcompiler docs export [--dir docs/help]` preflights the directory. An
  unmarked file that a page would replace aborts the export before anything is
  written. Then it writes pages atomically and deletes only marked pages whose
  workflow is no longer approved. Unmarked files are never modified or deleted.

## Alternatives

- Overwrite the directory: destroys hand-written help.
- Treat edited Markdown as workflow input: makes Markdown a second source of
  truth.
- One file for all workflows: already provided by the static catalog
  (`generated/workflows.md`); help centers need one page per task.

## Consequences

Approving, updating or deprecating a workflow followed by `docs export` keeps help
pages in sync. Writing quality depends on approved instruction text.
Localization and site-generator front matter are not provided.
