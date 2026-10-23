# ADR 0042 — Candidate evaluation (mode 5)

## Context

Phase I3 delivers operating mode 5 (Evaluate, ADR 0033). PathCompiler judges
any candidate commit, whether a human PR or the output of an external harness,
independently of whoever produced it (harness handoff §17–§19; reasoning spec
§196–§199, §254). It must work with no recommendation, `HarnessTaskSpec` or
`MutationResult` (I2 is not built). It must never let a candidate's own claims
weaken the criteria.

## Decision

- **New `@pathcompiler/candidate-evaluator`.**
  `evaluateCandidate({ delta, base, head }, solver, { criteria?, approved?,
  tests? })` returns a `CandidateEvaluation`. It answers the four questions of
  handoff §18:
  1. **Intended change.** The observed reachability changes come from R11's
     semantic diff, one per goal and context. `criteria.expectedChanges` holds
     the expected changes: goal, added or removed, and an optional partial
     context.
     - Omitted means no declared intent, as for a human PR: observed changes
       become a review warning.
     - `[]` means no reachability change is intended.
     - When intent is declared, every unexpected change and every unmet
       expectation is a **risk**.
  2. **Protected behavior.** The invariants of both commits plus
     `criteria.protectedProperties` are checked on base and candidate (R8).
     - A violated protected property is a risk, and so is one that no longer
       fits the candidate model.
     - A non-protected property that held at base and is violated now is a
       regression risk.
     - A violation already present at base is a warning.
  3. **Unexpected workflow change.** Impact analysis runs with the semantic
     findings (R11). Medium or high impact is a warning unless declared,
     expected changes explain it.
  4. **Does it work.** Test coverage per capability (test evidence), base vs.
     candidate. Decreased coverage, or an affected capability without tests,
     is a warning. Supplied results (Playwright JSON reporter or
     `{ tests: [{ name, status }] }`) are mapped to capabilities through the
     mined traces, and any failure is a risk.
- **Decision rules.**
  - Any risk → `fail`.
  - Otherwise any unknown solver answer → `inconclusive`.
  - Otherwise any warning → `pass_with_warnings`.
  - Otherwise `pass`.
- **Next step.**
  - A violated protected property → `reject`.
  - Any other failure → `revise_candidate`.
  - `pass` with declared, non-empty expectations → `experiment`, and the
    candidate is `eligibleForExperiment`. It is technically coherent, but only
    measurement shows whether users benefit (spec §199).
  - Everything else → `human_review`.
- **Claims are recorded, never trusted.** The criteria may include
  `mutation: { id, claimedOutcome }`. A claimed success that the evaluation
  contradicts adds a warning, but the outcome is unchanged.
- **Evidence gaps are explicit.** Browser verification (I4) is listed as not
  run. So is test execution, when no results are supplied.
- **CLI.** `pathcompiler evaluate <base> <candidate> [directory] [--criteria
  <json>] [--tests <json>]` reads the approved workflows under `--out`. It
  writes `reports/evaluation/<candidate>.json` and exits nonzero on `fail`.
- **Deferred.** The GitHub check section and dashboard view that the roadmap
  lists for I3 need configuration (C2) and the dashboard to show stored
  evaluations. The report artifact and CLI deliver the mode now.

## Alternatives

- **Treating every observed change as a failure.** Human PRs change behavior
  on purpose, and with no declared intent PathCompiler cannot tell. Rejected;
  such changes are a warning that asks for review.
- **Waiting for I2's `MutationResult`.** This would couple mode 5 to mode 6,
  against ADR 0033. Rejected; the criteria accept a minimal optional mutation
  record now.

## Consequences

For `next-demo`:
- a copy-only human PR passes;
- the owner-role change without intent passes with a warning (18 observed
  changes, human review);
- the same change with exactly those expectations passes and is eligible for an
  experiment;
- the §254 demo fails, with `reject`. A UX rename that also drops
  `requireEditor` from PATCH `/api/clients/:id`, claimed as a success, gives an
  unlisted role `clients.deactivated`. Both an unexpected-reachability risk and
  a protected-property counterexample report it, and the claim is marked
  contradicted;
- a failed Playwright test fails the candidate, and the risk names the
  capabilities the test covers.
