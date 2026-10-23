# ADR 0024 — Multi-signal new workflow detection

## Context

Phase 22 turns a new capability with no approved workflow (for example
`plans.duplicate`) into a new workflow candidate. Detection confidence should
consider new user-facing actions, new routes or dialogs, new write APIs, new
Playwright flows and commit/PR titles. No single signal is sufficient in every
case.

## Decision

- Add pure `detectNewWorkflows` to `@pathcompiler/workflow-proposals`. A new
  candidate is a proposal for review, like an update. `analyzeCommitRangeDetailed`
  now returns both analyses.
- "New" means the capability ID is absent at the base commit. Capabilities that
  existed but were never approved are not new and stay with ordinary discovery.
  Capabilities already approved or rejected, by ID or domain/verb/entity, are
  skipped.
- Signals are joins of capability evidence against the delta's added nodes.
  Weights: user action 0.30, write API 0.25, Playwright flow 0.20, route or
  component 0.15, commit subject 0.10.
- The write-API signal also follows newly added `CALLS_API` edges from functions
  of the capability's components. Phase 7 API association is component-context
  only and attached the wrong existing API in the fixture scenario.
- Statuses: two or more signals plus a test-backed head candidate gives
  `new-candidate`. Two or more without one gives `needs-evidence`. One signal gives
  `insufficient-evidence`, and no candidate is produced.
- `pathcompiler workflows detect` writes `reports/new-workflows.json` and new
  candidate files, never replacing existing ones. Approval follows the normal
  validate/approve path at the head commit.

## Alternatives

- Treat every unapproved capability as new: floods review with pre-existing gaps.
- One signal (for example a new button) is enough: decorative or experimental
  UI would create candidates.
- Improve capability API association in the capability engine: out of this
  phase's scope, and the explicit call-edge check is local and deterministic.

## Consequences

The Duplicate Plan feature (button, handler, POST API, test, descriptive commit)
yields `new-candidate` with confidence 0.85, and approving it clears the detection.
A lone new button is reported as insufficient. PR titles need the GitHub adapter
and are not read here.
