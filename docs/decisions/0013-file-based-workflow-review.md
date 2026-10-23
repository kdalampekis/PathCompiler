# ADR 0013 — File-based workflow review

## Context

Phase 11 needs review state and commands before any visual editor. Approved
workflows become the runtime source of truth (Invariant 1) and must be bound to
a commit (Invariant 6). Workflow IR v1 is a strict schema with no approval fields.

## Decision

Add `@pathcompiler/workflow-review` between the validator and the future compiler.
It holds pure functions and schemas only; the CLI owns file access.

- Approved record: `.pathcompiler/workflows/<id>.yaml`, an envelope
  `{schemaVersion: 1, kind: approved-workflow, approval, workflow}` where
  `approval = {approvedBy, approvedAt, approvedCommit}` and the workflow has
  `status: approved`. `approvedCommit` must equal `workflow.repository.commit`.
- Rejected record: `.pathcompiler/workflows/rejected/<id>.yaml` with
  `{rejectedBy, rejectedAt, rejectedCommit, reason?}`.
- Candidates stay in `workflows/candidates/` as discovery cache and are not moved,
  so discovery metadata (ambiguities, observations) survives approval.

Approval requires a fresh static validation of the stored candidate against a
rescanned repository. It refuses a mismatched report, a candidate discovered at a
different commit, a failed validation, or a dirty/unknown scanned directory, since
the commit alone could not reproduce what was approved. Warnings do not block; the
CLI reports their count and the validation report path.

The reviewer is a configured string from `--by` or `PATHCOMPILER_USER`; it is not
authentication. Records are created atomically with an exclusive link, so an
existing decision is never replaced. Listing precedence is approved > rejected >
candidate.

## Alternatives

- Add approval fields to Workflow IR v1: changes a versioned contract for metadata
  that belongs to review, not workflow semantics.
- Move candidates into `approved/`: loses discovery metadata and makes rediscovery
  look like a missing candidate.
- Read the reviewer from Git config: implicit; a configured value is explicit.
- Allow approval of dirty trees with a warning: breaks commit reproducibility.

## Consequences

Approved YAML can be committed and reviewed in pull requests. Compilers read only
approved records. Changing or withdrawing an approved workflow is deliberately
unsupported here and is left to update proposals (Phase 21) and deprecation
(Phase 23). Rejections can be undone only by removing the record by hand.
