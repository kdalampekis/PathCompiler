# ADR 0043 — Runtime Result v1, RuntimeContext and workflow versions

## Context

Phase C1 closes the runtime-contract gaps recorded in the master roadmap (§1)
and ADR 0032 §4–5:
- results diverged from Runtime Result v1 (spec §63–65);
- `RuntimeContext` rejected `locale`, `tenant` and `productRelease` (§75);
- workflows had only a content-hash `revision`, not the integer version that
  analytics and the improvement loop bind to (§70);
- the guide could not detect a stale manifest (§68).

Observability (O0) depends on these shapes, so they change now, before
external consumers rely on the old ones.

## Decision

- **Workflow version.** `approval.version` is a monotonic integer per workflow
  ID.
  - `approveCandidate` writes 1.
  - `acceptProposal` writes the current record's version + 1. It now requires
    the current approved record and rejects it with `approved-changed` when its
    revision no longer matches the proposal.
  - Records approved earlier have no version and count as 1
    (`approvalVersion`).
  - `revision` stays the content hash; the two are never conflated.
- **Compiled artifacts (`COMPILER_VERSION` 1.1.0).** Search records and
  runtime workflows carry `version`. Search records also carry plain-text
  `steps` and `capabilities`. `supportedActions` moved to
  `@pathcompiler/workflow-compiler/schema` and is re-exported by the resolver.
  Artifacts built by 1.0.0 must be rebuilt (`pathcompiler build`). The SDK
  already rejects mixed builds.
- **Runtime Result v1.**
  - `workflow_help`: `workflowId`, `workflowVersion`, `revision`,
    `confidence`, `content {title, summary?, steps[{id, text}]}`,
    `entrypoint {route}` (the first static route), `capabilities` and the
    diagnostic `matched`.
  - `ambiguous`: `candidates[{workflowId, workflowVersion, title,
    confidence}]`.
  - `unsupported`: reason `no_matching_workflow` (also for empty queries),
    `not_available_for_context` (with `unavailable[{workflowId,
    workflowVersion, title, requires}]`) or `workflow_not_verified`. The last
    is in the schema but not produced: approval already requires validation,
    and browser verification (C8/I4) will decide when to emit it.
  - `reason` and `message` stay on ambiguous and unsupported results.
- **`RuntimeContextSchema`** adds `locale`, `tenant` and `productRelease`.
  These are accepted and passed through, but do not affect resolution, because
  no tenant-specific or release-specific workflows exist yet.
  `ResolveContextSchema` and `ResolveContext` remain as deprecated aliases.
- **Guide manifest mismatch.** `GuideRuntime.start(workflow, { revision?,
  version? })` fails with `manifest-mismatch` when the manifest differs from
  what the caller resolved.
  - React's `useGuideRuntime().start(id, expected)` passes it through.
  - The UI help card passes the values automatically. It also renders steps
    from `content.steps`, with no second request, and shows "Show me" only when
    `capabilities.guide` is true.
- **SDK.** `workflows.search` returns `{workflowId, workflowVersion, title}`.
  The SDK exports the v1 result types and `RuntimeContext`. The assistant tool
  description reflects the v1 result, and its schemas accept `locale`.

## Migration (breaking for pre-C1 consumers)

| Before | After |
| --- | --- |
| `type: "workflow"`, `workflow.{id, revision, title, routes}` | `type: "workflow_help"`, `workflowId`, `revision`, `workflowVersion`, `content.title`, `entrypoint.route` |
| `ambiguous.options[{id, revision, title}]` | `ambiguous.candidates[{workflowId, workflowVersion, title, confidence}]` |
| `empty-query`, `no-match` | `no_matching_workflow` |
| `unavailable-in-context`, `unavailable[{id, …}]` | `not_available_for_context`, `unavailable[{workflowId, workflowVersion, …}]` |
| `WorkflowSummary {id, revision, title}` | `{workflowId, workflowVersion, title}` |
| compiler 1.0.0 artifacts | rebuild with 1.1.0 |

## Alternatives

- **Keeping the old shapes and adding v1 next to them.** Two public contracts
  for one product, before any external consumer exists. Rejected.
- **Deriving the version from Git history of the approved file.** That is
  implicit and fails in shallow clones. Rejected in favor of an explicit field
  in the record.

## Consequences

O0 can bind runtime events to `workflowId` + `workflowVersion`. The resolver
paraphrase evaluation is unchanged (it compares workflow IDs). The browser e2e
suites must be rerun to confirm the guide and demo flows on the new shapes.
