# ADR 0094 — Conservative repair loop (BX7)

## Context

With a violation, a counterexample and a regression eval in hand, a repair
can be proposed and judged mechanically. The risk is the proposer: a repair
that satisfies the checked rule by removing another check, by rejecting
valid actions, or by editing the rule itself is worse than the bug. The
prototype therefore constrains what a proposer may touch and treats its
answer as untrusted.

## Decision

- **New `@pathcompiler/repair-loop`, one violation at a time:** violation →
  counterexample → structured feedback → candidate repair from a provider →
  verification → regression eval → tests → report.
- **Provider boundary.** `RepairProvider.proposeRepair(request)` is the only
  contact with whatever proposes a repair. Core code depends on no model
  vendor. The answer is validated (Zod) and checked before it is believed.
  A `fixtureRepairProvider` replays prepared proposals for tests and
  demonstrations; adapters for the existing model providers are not built.
- **Minimal disclosure.** The request carries the violated rule and its
  trust, the counterexample, an explanation, the rules that must keep
  holding, the constraints, earlier rejections, and the source file(s) of the
  operation. Not the repository.
- **Allowed edits.** Only the files the operation was read from. Edits to
  approved rules, schema, contracts or tests are rejected, as is a proposal
  that changes nothing.
- **Acceptance** requires all of: the target property is now `VERIFIED`; no
  property that held before is `VIOLATED`; the regression eval from the
  counterexample passes on the candidate's extracted contract; and, when the
  caller supplies them, the project's tests pass. All checks run so the
  provider gets complete feedback on a rejection.
- **Stateless attempts, bounded, logged.** Every attempt starts from the
  original files (default 3 attempts, at most 10); previous rejections are
  fed back as text. Every step is a trace entry.
- **Nothing is applied.** The result is a report and a unified diff. Approval
  is `required` / `pending`. The CLI writes `reports/repair.json` and
  `repair/<id>.patch` and never touches the working tree; a person applies
  the patch (`git apply`) after review.
- **CLI:** `pathcompiler repair propose [directory] --fixture <proposals.json>`.
  It does not run the project's tests; the library takes a `runTests` hook
  and the CLI says so.

## Alternatives

- **Let the loop edit files and commit.** Faster and exactly what the
  constraints are meant to prevent.
- **Carry the failed candidate into the next attempt.** Repairs compound
  and drift; restarting from the original keeps each attempt comparable.
- **Wire a model adapter now.** Needs an API key and a prompt-evaluation
  effort of its own (C6); the boundary is in place for it.

## Consequences

- On the refund fixture the loop repairs the support-agent fast path in
  three scripted attempts: the first (a comment) fails the target and the
  eval, the second (rejecting every support agent) satisfies the rule but
  fails the example tests, the third restores the guard and passes
  everything. Further scripted cases show it rejecting a repair that drops
  the customer check (a new violation), an edit of the approved rules, an
  unusable response, and stopping at the iteration bound.
- The scripted provider proves the loop, not that a model can repair real
  code. How often a model proposes an acceptable repair, and how many
  attempts it takes, is unmeasured.
- A repair that passes is accepted relative to the specification, the eval
  and the tests given; the report says so. Rules that are missing from the
  specification are not protected by any of this.
