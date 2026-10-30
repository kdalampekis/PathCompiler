# ADR 0093 — Counterexamples as regression evals (BX6)

## Context

A violation found once should not be found twice. A PR comment fades; a test
stays. A counterexample is already a concrete action in a concrete state, so
it can become a test of the implementation — as long as the test also guards
against a fix that handles only those exact values, and against a "fix" that
rejects everything.

## Decision

- **New `@pathcompiler/counterexamples`.**
  - **Record:** ID (a content hash of rule, operation and values, so the same
    finding is one record), the rule and how far it is trusted, trigger
    (PR guard, verification, agent gate, manual), the action (inputs and
    context), the state, the violation in words, commit, specification
    hash, time (injected) and status (`open` or `fixed`).
  - **File store:** `counterexamples/cx-<hash>.json`. Recording a known
    finding keeps the first observation. IDs are validated, so a name cannot
    point outside the directory.
  - **Eval generator:** from a record and the *trusted* specification (the one
    the rule is approved in) it produces cases, labeled by the specification:
    the `reproduction` (must be rejected), `reject-*` variants that change one
    value (another role, a boundary amount, a flipped flag) and still break
    the same rule, and `accept-*` neighbors that break nothing. It refuses to
    generate if the counterexample does not break the rule in that
    specification.
  - **Runners:** `runEval` against any `Executor` (real code behind an
    adapter, or `contractExecutor`, which predicts acceptance from the
    preconditions extracted from a candidate and deliberately ignores rules
    the code does not enforce), and `runSpecEval`, which asks the SMT verifier
    the same property of a candidate specification.
- **Pass criteria:** the reproduction and every rejected variant must be
  rejected. Neighbors that the specification allows but the implementation
  rejects are reported as `overRestrictive` and fail only with
  `strictNeighbors`: a stricter-but-correct change should not fail a
  regression eval, but a change that rejects everything is visible.
- **Integration:** `verify-pr` stores the counterexample of every new
  violation under `<out>/counterexamples`. CLI: `counterexamples list`,
  `record <report>`, `eval <id> --spec <trusted spec>`,
  `run <eval> --spec <candidate spec>` (nonzero on failure).

## Alternatives

- **Only the exact counterexample as a test:** a fix special-cased to those
  values would pass. Variants make that harder, not impossible.
- **Ask the solver for more counterexamples instead of perturbing:** gives
  broader coverage but needs blocking clauses per variable domain; the
  perturbations are cheap, deterministic and explainable (`change`).
- **Treat over-restriction as failure:** would flag legitimate tightening as
  a regression.

## Consequences

- On the refund fixture the eval for the support-agent fast path has 13 cases
  (1 reproduction, 8 variants, 4 neighbors). It fails the violating candidate
  — the real code, its extracted contract and the verifier all agree — and
  passes the repaired code; a behavior-preserving refactor passes; the
  stricter limit passes with the stricter neighbors reported.
- The oracle is the specification, so an eval is as right as the approved
  rules. A wrong rule produces a wrong eval; records keep the rule's trust.
- Variants perturb one value at a time from a fixed set (booleans, enum
  values, integers around the rule's literals), so a violation that needs two
  values to change together is not generated. Recurrence is measured by
  re-running the evals on later commits, which the store makes possible and
  which is not automated yet.
