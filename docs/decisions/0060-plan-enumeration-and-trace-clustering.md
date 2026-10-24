# ADR 0060 — Plan enumeration and trace clustering

## Context

Phase R6 implements reasoning spec §27 (alternative feasible ways to satisfy
a goal, by bounded enumeration with blocking constraints), §28 (semantic
trace deduplication into business variants in a new `trace-clustering`
package) and §70 (alternative path detection). C7 gave the fixture an
alternative path: Deactivate Client from the row, or from inside Edit Client.

## Decision

- **`ProductReasoner.enumeratePlans(model, query & { slack?, limit? })`.**
  - It finds the shortest plan with `findPlan`; impossible and unknown
    results pass through.
  - It then enumerates every plan from that length up to `slack` more steps
    (default 1, at most 10) and stops at `limit` plans (default 50,
    `complete: false`).
  - At each length it solves, canonicalizes the model to the
    lexicographically smallest action sequence with the existing binary
    search (factored out and shared with `findPlan`), then adds a blocking
    clause on the action-choice variables, so results are deterministic.
  - Each plan must reach the goal only at its last step. Otherwise every
    longer plan would include "the short plan, then anything".
- **New `@pathcompiler/trace-clustering`** has no runtime dependencies.
  `traceSignature` and `clusterTraces` group plans or traces by:
  - goal and entry capability;
  - entry route family: the enum-valued state the last navigation set, so
    two links to `/clients` are one route;
  - capabilities with a lasting effect;
  - major actions. Within a capability's run of steps, the middle steps
    (form fields) are order-free, and consecutive repeats collapse.

  A **detour** (a dialog opened then cancelled, or abandoned by navigating
  away) leaves no lasting effect and is dropped. A hand-over into the next
  capability (Edit Client, then the Deactivate button inside it) is kept.
  Unknown booleans default to false, because dialogs and entered fields
  start unset. The output lists variants with members and the shortest
  representative, plus `duplicateRate`, the share of plans folded into an
  earlier variant.
- **CLI:** `pathcompiler reason alternatives <goal> [directory] [--slack]
  [--limit]` writes `reports/reasoning/alternatives/<goal>.json`. It is gated
  by `reasoning.enumeration`.
- **Evaluation:** reasoning cases gain an `alternatives` kind, which states
  the expected variants. The fixture's `clients.deactivated` yields exactly
  the two expected variants from 10 plans.

## Alternatives

- **Blocking "superplans"** (any plan containing an earlier one) in the
  solver. Subsequence constraints are expensive to encode. The first-reach
  constraint removes trailing extensions, and clustering removes the rest.
- **Clustering by action IDs.** The row and in-dialog entries are different
  actions of the same capability; signatures over semantic targets and
  capabilities keep the real difference while ignoring navigation noise.

## Consequences

O10 (alternative paths in analytics) and R7 (ranking alternatives by cost)
have their inputs. Enumeration costs grow quickly with slack: on the fixture,
slack 1 takes about 4 s and slack 2 hits the 50-plan limit. Defaults stay
small.
