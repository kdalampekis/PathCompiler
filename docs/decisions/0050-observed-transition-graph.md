# ADR 0050 — Observed transition graph

## Context

Phase O6 aggregates stored semantic events (O5) into the observed transition
graph (reasoning spec §141), the "what actually happened" model of §131.
Workflow analytics (O7) and reconciliation with the formal model (O8) build
on it. The observed graph must stay separate from the formal model and must
not support conclusions on tiny samples.

## Decision

- **New `@pathcompiler/observed-graph`**, which depends only on
  `observability-core`, never on the formal model.
- **States.** Each event enters one semantic state:
  - `route:<route>`;
  - `target:<semanticTarget>:<interaction>`;
  - `step:<workflow>@<version>:<step>`;
  - `workflow:<workflow>@<version>:started|completed|abandoned`;
  - `goal:<goalId>`;
  - `domain:<name>`;
  - `blocked:<target>:<reason>`.

  Every session also gets `session:start` and `session:end`.
- **Session paths.** Sessions are keyed by project and session ID. Events are
  ordered by timestamp, then event ID, so output is independent of input order.
  A repeat of the current state (for example a double click) is not a
  transition. Its time is measured from the state's first entry.
- **Edges** record:
  - count and unique sessions;
  - frequency among the source state's outgoing transitions;
  - median time between the two events (`null` for synthetic session edges);
  - counts by role and by release;
  - `sufficient`, true when at least `minSessions` sessions (default 30) took
    the edge. Below that, an edge is an anecdote, not evidence.
- **Nodes** carry entry counts and sessions. **Paths** list the top complete
  session paths.
- **Filters.** Project, release, role, workflow ID and version (spec §156:
  per-release analysis).
- **`readEventDirectory`** reads the O5 NDJSON files.
  `pathcompiler observe graph [--release]` writes
  `reports/observed-graph.json` for the served project.

## Alternatives

- **Building the graph over formal-model states.** That would blur observed
  and possible behavior, against §131 and §142. Mapping between the two is O8.
- **Probabilities instead of frequencies.** Frequencies are what is observed.
  Probabilistic transition models are O11.

## Consequences

O7 can compute completion and abandonment from workflow states, and O8 can
classify formal transitions as observed or unobserved. Event streams that skip
states, such as uninstrumented pages, appear as direct transitions. That is an
instrumentation gap, never evidence that a step is impossible.
