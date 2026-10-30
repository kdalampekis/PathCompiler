# ADR 0091 — Behavior diff and PR guard (BX4)

## Context

A pull request changes code; the question a reviewer needs answered is
whether it changes behavior that a business rule protects, including changes
that existing tests do not exercise. Verifying the rules once says what is
broken, not what this change broke: a violation that already existed at the
base should not block an unrelated PR.

## Decision

- **New `@pathcompiler/pr-guard`.** `verifyPullRequest({ base, head, ... })`:
  1. extracts BehaviorIR from the base files and from the head files;
  2. verifies every property (BX3) on both;
  3. compares property by property. **Held at the base and violated at the
     head** is a *regression*; absent at the base and violated at the head is
     a *new violation*; violated at both is *pre-existing* (informational);
  4. diffs the extracted behavior itself.
- **Approved rules come from the base.** The head is checked against the
  base's approved-rules files, so a change cannot weaken a rule by editing
  it. Editing them is reported (`approved_rules_changed`, needs a person).
- **Behavior diff:** per operation, preconditions and effects added and
  removed, and — using the solver — whether a changed set of preconditions
  is *weakened*, *strengthened*, *changed* or *equivalent*. Equivalent
  changes (a named constant, reordered guards) are not changes: the benign
  refactor yields an empty diff.
- **Verdict:** `fail` when a human-approved rule is newly violated;
  `review` when an extracted rule is newly violated, a rule was removed,
  coverage was lost (verified → unknown or unsupported), the extractor
  cannot model new code, or approved rules were edited; otherwise `pass`.
  `--strict` makes `review` fail. A violation of an extracted candidate is
  `review` because the candidate may be the wrong rule.
- **CLI:** `pathcompiler verify-pr --base <ref> --candidate <ref> [directory]`
  exports both revisions with `git archive`, writes `reports/pr-guard.json`
  and a PR-comment `reports/pr-guard.md`, and exits nonzero on `fail`.
- **Fixture:** `fixtures/refunds/tests/scenarios.ts` holds the example tests
  as plain functions; a test runs them against every variant, so "tests
  pass, the rule fails" is demonstrated and not asserted.

## Alternatives

- **Run the project's tests inside the guard.** Useful, but needs a sandbox
  and a per-project command; not needed to show the claim.
- **Block on any rule violation.** Would block unrelated PRs on old problems
  and on wrong extracted rules.
- **Trust the head's approved rules.** Lets a PR rewrite the policy it is
  judged by.

## Consequences

- On the refund fixture the guard blocks all three seeded regressions
  (support-agent fast path, dropped self-approval check, dropped
  already-processed check) while the example tests pass on every one, and
  raises no alarm on the behavior-preserving refactor or the stricter
  limit. Each check takes about half a second.
- That is a small fixture whose variants were written to be detectable;
  false-negative and false-positive rates on real pull requests are unknown
  until C6.
- GitHub integration (posting the comment, a check run) is a thin layer over
  the report and is not built here.
