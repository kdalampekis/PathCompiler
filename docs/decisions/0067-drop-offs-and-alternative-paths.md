# ADR 0067 — Drop-offs and alternative paths

## Context

Phase O10 (reasoning spec §158): "use the planner to suggest valid
alternative routes around high-friction transitions." The inputs are stored
events (O5 and O6), the observed side of the funnel, and R6 enumeration with
trace clustering. As with every observability finding, the output is a
hypothesis for review.

## Decision

- **`analyzeDropOffs(model, events, solver, options)`** in
  `behavior-reconciliation`:
  - An **attempt** at a goal starts when a session activates a semantic
    target of the goal's capability (its formal actions' targets). It ends
    as a completion at `goal.reached`, or as a drop-off at the end of the
    session, where the last activated target is the **drop-off point**.
  - Per goal and observed role, it counts attempts, completions, drop-offs,
    the drop-off rate (only with `minAttempts`, default 30) and points with
    their share of attempts.
  - A point holding `frictionShare` (default 20%) of attempts is
    **friction**. The planner enumerates the goal's valid routes under that
    role (R6, slack 1), clusters them into variants, and lists those whose
    major actions avoid the point. "No valid route avoids it" is a finding
    too.
- **CLI:** `pathcompiler observe drop-offs [directory] [--model]` writes
  `reports/drop-offs.json`. It is gated by `modes.observe` and
  `reasoning.enumeration`.

## Alternatives

- **Drop-offs from guide runs (`workflow.abandoned`).** O7 already reports
  guide abandonment. Free sessions show where the product itself loses
  people.
- **Suggesting the shortest route only.** Friction is about a specific
  point, so the useful answer is the routes that avoid it.

## Consequences

On the fixture, editors who give up after the row Deactivate button are
offered the Edit Client route. Targets shared by several capabilities (one
submit button for create and edit) count as attempts for each
(ISSUES_LOG #32).
