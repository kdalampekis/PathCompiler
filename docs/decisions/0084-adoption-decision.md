# ADR 0084 — Adoption decision (I7)

## Context

Reasoning spec §211–§213 and §248: after evaluation and measurement,
PathCompiler recommends one of ADOPT, REJECT, ROLLBACK, ITERATE,
EXTEND_EXPERIMENT or INCONCLUSIVE, with its evidence. A human stays the
final authority. The failed-hypothesis demo (§253) must reject PathCompiler's
own recommendation: a formally valid, tested, browser-verified candidate
whose completion falls from 51% to 43% gives ROLLBACK or ITERATE.

## Decision

- **`decideAdoption(outcome)`** (outcome-analysis) applies ordered rules:
  1. a failed candidate evaluation gives **reject**; the hypothesis was
     never tested;
  2. a worse outcome (a breached guardrail, or the primary metric worse
     beyond the intervals) gives **rollback**, with iterate as the
     alternative. The hypothesis is *rejected* whatever the formal result.
  3. improved with a passing evaluation gives **adopt**; improved without
     one gives **inconclusive**, with adopt as the alternative;
  4. neutral gives **iterate**, with reject as the alternative; the
     hypothesis is not supported;
  5. a measured but under-sampled or overlapping primary metric gives
     **extend_experiment**;
  6. otherwise **inconclusive**, with the evidence gaps.
- **Every decision** has `humanApprovalRequired: true` and starts `pending`.
  `recordApproval` records approval or refusal once, with the reviewer,
  time and an optional note; a decided record is never re-decided.
- **The decision carries lineage:** recommendation, experiment, evaluation,
  outcome and mutation IDs.
- **CLI:**
  - `experiment decide <outcome.json>` writes `decisions/<experiment>.json`
    and never overwrites one;
  - `experiment approve|decline <decision.json> --by <name> [--reason]`
    records the human decision.

  PathCompiler does not deploy or roll back anything.

## Alternatives

- **Auto-applying adopt or rollback.** That is forbidden before proven
  reliability (§213). The decision is advice.
- **Calling a 51% → 43% drop on 400 sessions per arm a failure.** The
  intervals still overlap at that size, so the honest decision is to extend
  the experiment. At 1000 per arm the drop is decisive, and the decision is
  rollback. Both cases are tested.

## Consequences

- I8 stores the decision, with its predecessors, as improvement memory.
