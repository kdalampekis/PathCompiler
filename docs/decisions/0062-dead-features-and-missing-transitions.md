# ADR 0062 — Dead features and missing transitions

## Context

Phase R9 implements reasoning spec §34 (for every user-facing capability, can
any valid trace reach it?) and §35 (button, API and goal all exist, but no
formal trace connects them). It feeds I0's `product_dead_end` findings. The
results must be candidates with possible causes, never verdicts, because an
unreachable goal can be a product bug or a modeling gap.

## Decision

- **`detectDeadFeatures(reasoner, model, { capabilities? })`** in
  `reasoner-core` returns three kinds of finding:
  - **`unreachable-capability`.** Each capability goal is checked with the
    context left free, so "unreachable" means no role, flag or context
    reaches it. It carries R4's constraints and possible causes inferred from
    them:
    - role constraints suggest an impossible permission combination;
    - boolean context constraints suggest a stale feature flag;
    - state constraints and initial state suggest dead code, broken routing
      or orphaned UI;
    - an incomplete model extraction is always listed.
  - **`dead-action`.** A capability action whose precondition can never hold
    in a reachable state (an R8 `never` check).
  - **`missing-transition`.** A capability that static analysis found with
    both UI and API evidence but no goal in the model: a "potential model or
    product gap". The causes are an analysis missing an edge, or a product
    wiring bug.

  Solver `unknown` results are reported as `unknown` findings, never dropped.
  The report is `meaning: "candidate"` and records what was checked.
- **CLI:** `pathcompiler reason dead-features [directory]` writes
  `reports/reasoning/dead-features.json`. It is gated by
  `reasoning.reachability`. With `--model` there is no capability report, so
  missing transitions are not checked.
- **Evaluation:** reasoning cases gain a `dead-features` kind with expected
  findings, and edits gain `all` (replace every occurrence). The fixture has
  two cases:
  - nothing is flagged on the unmodified fixture;
  - a seeded orphan: the Archive Plan test targets a renamed control, so no
    session completes archiving, while the button and handler remain. This is
    flagged as a missing transition.

## Alternatives

- **Treating free-context reachability as enough to call a feature live.**
  That is what the check does, and it means a capability reachable only under
  some flag combination is not dead. Per-context applicability is R11's
  semantic diff and the minimal-enablement query (R5).
- **Product dead ends (§71)**, meaning reachable states from which a goal
  becomes unreachable. They need a reach-then-cannot-reach query, which
  bounded checking cannot express directly. They are deferred, and noted for
  I0.

## Consequences

I0 can consume these findings with their causes and evidence. A capability
reachable only through a model over-approximation will not be flagged.
Over-approximation hides dead features rather than inventing them.
