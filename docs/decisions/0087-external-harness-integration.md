# ADR 0087 — External harness integration (I9, Integration V0)

## Context

Handoff §24–§25 and §79 define the done condition for Integration V0. The
chain must work without manual conversion between formats:

PathCompiler recommendation → `HarnessTaskSpec` → harness candidate →
`MutationResult` → PathCompiler `CandidateEvaluation`

The first integration is file-based: a task JSON goes to a local harness
CLI working on a branch or worktree, and a result JSON comes back. I2
(ADR 0086) defined the contracts. I3 and I4 evaluate candidates.

## Decision

- **CLI `harness import <MutationResult.json> [directory] [--tests]
  [--browser]`:**
  1. it finds the exported task (`harness/tasks/`) by `harnessTaskId`, and
     validates the result against it: lineage, base commit, and a
     candidate for completed or partial results;
  2. it stores the result under `harness/results/`;
  3. when the result names a candidate commit, it runs `evaluateCandidate`
     on base..candidate. The criteria are frozen from the task (expected
     reachability changes and the recommendation ID), and the mutation's
     claim is checked, never trusted. Approved workflows, tests and browser
     reports apply as in `evaluate`.
  4. it reports like `evaluate` and exits nonzero when the candidate fails;
  5. a blocked or failed result is recorded with its unresolved questions,
     and nothing is evaluated.
- **No harness is executed by PathCompiler.** Running an external program
  that mutates repositories is the harness's side of the boundary, and
  autonomous destructive execution is deferred (AGENTS.md). The harness
  reads the task file and writes the result file; exit codes (§25) are its
  own.
- **`reportEvaluation`** is shared by `evaluate` and `harness import`.

## Alternatives

- **`pathcompiler harness run --command <harness>`.** It would execute
  arbitrary commands against the repository, which is out of scope.
  Wrappers in CI can call the harness and then `harness import`.

## Consequences

- **Integration V0 is proven end to end** on a copy of the fixture:
  1. a regression commit drops an API role check;
  2. `reason diff` → `findings` → `gate` (mode 6 enabled) → `recommend` →
     `harness task`;
  3. a candidate restores the guard;
  4. `harness import` evaluates it as PASS, with the claim confirmed;
  5. a blocked result is recorded.
- **Opportunities group findings by capability.** One root cause that
  affects several capabilities, such as a renamed role check, becomes
  several tasks. A harness fixing the cause for all of them then fails each
  narrower evaluation with "unexpected" changes (ISSUES_LOG #48).
