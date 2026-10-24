# ADR 0058 — Reasoning fixture enrichment

## Context

Phase C7 (reasoning spec §88, handoff §75–§76) enriches the shared fixture so
reasoning has something to reason about:
- more roles and permissions;
- a second feature flag;
- an alternative path for one goal;
- seedable bugs.

It also adds `fixtures/reasoning/` cases, which unblock R6 and give R5, R9 and
R10 evaluation material. Until now, R8 and I3 seeded their bugs inline in
tests (ISSUES_LOG #6).

## Decision

- **Fixture app:**
  - an `admin` role that keeps every editor action (`requireEditor` accepts
    editor or admin);
  - an admin-only Archive Plan (`plans.archive`, `POST
    /api/plans/:id/archive`, `requireAdmin`) behind a second flag,
    `planArchive`, which is off by default;
  - a second path to Deactivate Client from inside the Edit Client dialog
    (`client.form.deactivate`).

  Demo controls gain the role and the flag. Playwright adds a test for the
  alternative path and one for archive permissions and the flag. The ground
  truth adds `plans.archive`, and the existing workflows now list
  `roles: [admin, editor]`.
- **Pipeline fixes the enrichment exposed:**
  - *API association (capability-engine):* a component-context endpoint
    named after an action (`…/archive`) now belongs only to that verb's
    capability, and wins over generic same-domain endpoints. Previously Archive
    Plan was linked to `PATCH /api/plans/:id`, so the formal model would have
    given it Change Plan Structure's guards.
  - *Formal abstraction:*
    - one-click capabilities (no dialog in any test) become a single "direct"
      action, reported as a `direct-action` uncertainty;
    - alternative entries with the same short name get distinct action IDs;
    - an entry clicked inside another capability's dialog, as observed in a
      test, requires that dialog open and closes it.
  - *Resolver:* deactivate, disable, archive and suspend form their own verb
    group, separate from delete and remove, so "delete a client" no longer
    resolves to Deactivate Client.
- **`fixtures/reasoning/<category>/*.json`.** There are 15 cases across
  reachable, unreachable, permissions, feature-flags, alternative-plans,
  counterexamples and commit-diffs. Each names its fixture, optional seeded
  `edits` and one query:
  - reachability, plan (expected target subsequence) or explanation (cited
    constraints);
  - property (verdict and the last counterexample action);
  - diff against the unedited fixture (expected added and removed
    reachability).
- **`@pathcompiler/evaluation`** gains `loadReasoningCases` and
  `evaluateReasoningCases`. Models are extracted from temporary copies with a
  fixed snapshot commit. The report gives verdict accuracy, plan accuracy,
  diff accuracy, unknown rate and per-category counts. The CLI command is
  `pathcompiler eval reasoning <cases directory>`, gated by
  `reasoning.reachability` when `pathcompiler.yaml` exists.
- **Harness fixtures** (`fixtures/harness/{tasks,results}/`) are deferred to
  I2, which defines `HarnessTaskSpec` and `MutationResult`. Cases without
  their schemas would be speculative.

## Alternatives

- **A separate reasoning fixture app.** It would drift from the product
  fixture the rest of the pipeline is measured on. Enriching `next-demo` makes
  every metric see the new behavior.
- **Hand-written formal models for the cases.** That would test the reasoner,
  not the extraction. Cases run against the extracted model, so abstraction
  regressions show up.

## Consequences

Every fixture count changed (six capabilities, nine traces, 27 extracted
actions), and goldens and tests were updated after review. The enrichment
showed real gaps:
- capability roles are taken per component (ISSUES_LOG #22);
- baseline discovery starts the alternative deactivate path at the in-dialog
  button (#23);
- impact reports more file-level false positives (#18).

R6 is unblocked.
