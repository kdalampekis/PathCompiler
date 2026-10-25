# ADR 0075 — Commit risk scoring (P4)

## Context

Reasoning spec §56 asks for a change-risk summary that combines definite
formal impacts, probable semantic impacts and uncertain dependencies. For
example: "Change risk: HIGH; definite 3, probable 2, uncertain 1". An
uncalibrated score must not be presented as an incident probability.

Two inputs exist:
- impact analysis (Phase 13) gives reasons per approved workflow, with
  severities;
- R11 (`--reasoning`) adds reachability and applicability findings, plus
  its own uncertainty entries.

## Decision

- **`scoreCommitRisk(impact, { uncertainty, calibration })`
  (impact-analysis).** It classifies every impact reason by how it is known,
  with an exhaustive table checked by the type system:
  - **definite:** removed target, condition target, route, endpoint or
    access condition, which the workflow as written cannot survive; and
    R11's reachability and applicability changes, proven by bounded SMT
    (`source: formal`);
  - **probable:** content changes to a step's target, endpoint or route, and
    removed implementation or test evidence;
  - **uncertain:** moved targets, copy and implementation changes, test
    changes, shared files, unanalyzed history (`baseline-mismatch`), and
    R11's uncertainty entries (unknown results, contexts not enumerated).

  Reasons are deduplicated per workflow.
- **Level is a rule:**
  - **high:** any definite high-severity impact;
  - **medium:** any other definite impact, or a medium or high probable one;
  - **low:** anything else that was found;
  - **none:** nothing found.

  The level is labeled `rule-level-not-probability`, and its rationale is
  included.
- **Incident probability** is given only from a `RiskCalibration`: reviewed
  changes per level, with incident counts and a minimum sample size.
  Otherwise it is `null`, with the reason.
- **CLI.** `impact` writes `reports/commit-risk.json` and prints the change
  risk line.

## Alternatives

- **A weighted numeric score.** Weights would be arbitrary, and the result
  invites reading as a probability. Counts per class plus a rule level say
  what is known.
- **P0 fusion per impact.** Impact reasons are already deterministic facts
  with known provenance; the classification states that provenance directly.

## Consequences

- Risk is not yet shown in the GitHub check or proposals (ISSUES_LOG #40).
- No calibration data exists yet. Review decisions (P-RV) are the natural
  source.
