# ADR 0081 — Browser candidate verification (I4)

## Context

Reasoning spec §245: run selected candidate workflows against a preview or
candidate environment, and verify goals and protected behavior. I3
candidate evaluation (ADR 0042) listed browser verification as an evidence
gap. C8 (ADR 0065) verifies one workflow in a browser, and P3 (ADR 0074)
diagnoses failures.

## Decision

- **`verifyCandidateWorkflows(workflows, options)`**
  (`@pathcompiler/workflow-validator/browser`):
  - it runs the selected workflows (default all) against the candidate's
    origin, one after another in the caller's page;
  - it clears cookies between runs and applies per-workflow preconditions;
  - it requires the candidate commit and stamps it on every report.
- **`verifyWorkflowInBrowser` gains `candidateCommit`.** Until now
  `report.candidateCommit` was the workflow's approval commit, not the
  build under test. The option makes it the deployed build; without it the
  old default stays.
- **`evaluateCandidate` gains `browser`**, which is section E:
  - each report is validated with the Playwright-free schema;
  - a report for another commit is ignored with a `browser-report-stale`
    warning;
  - a failed run is a risk (`browser-verification-failed`), and the
    candidate fails with `revise_candidate`;
  - each failure carries its P3 diagnosis, computed on the candidate's own
    model and source targets;
  - workflows needing review that no run covered are warned about;
  - `browserResults` lists verified, failed, unverified-affected and stale
    workflows, and the evidence gap disappears when reports are supplied.
- **CLI.** `evaluate … --browser <json>` takes one report or an array, and
  prints a browser line.

## Alternatives

- **Running the browser inside `pathcompiler evaluate`.** That needs a
  deployed candidate, its URL and setup per workflow, all of which belong
  to CI. The runner is a library call for a Playwright job, and the CLI
  ingests its reports, as it does test results.
- **Trusting `workflow.repository.commit` as the candidate.** For approved
  workflows that is the approval commit, so every report would look stale.

## Consequences

- A CI job can verify the affected workflows on a preview, and gate merges
  on the evaluation.
- There is no CLI runner for browsers (ISSUES_LOG #46).
