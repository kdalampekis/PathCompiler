# ADR 0011 — Explicit static workflow validation

## Context

Schema-valid candidates can still refer to removed targets, stale evidence,
unreachable steps or action sequences contradicted by tests. Discovery confidence
and embedded validation labels cannot substitute for an independent check.

## Decision

Add a pure `validateWorkflow(unknown, {graph, traces?})` API returning a versioned
report with errors, warnings and named schema/structure/repository/evidence/test/
browser checks. Malformed workflow data yields a failed schema report with later
checks not-run. Validity requires all mandatory static checks to pass with no
errors. Missing/unsupported test comparison remains not-run with a warning.
No code or tests execute, no workflow changes and no approval occurs.

Preserve ADR 0001's first-step and explicit-edge semantics. Require every step to
be reachable and at least one reachable transition-free step to await completion.
Reject cycles because the IR declares no iteration bound. Reject duplicate branch
guards because earlier matching guards shadow later ones. This proves graph
reachability only; runtime predicate truth and completion remain unverified.

Validate targets and routes against source declarations and commit-bound provenance.
Use canonical graph route paths/templates; do not duplicate adapter routing logic.
Check source/test citations for exact identity/location/commit and history/PR refs
against their historical metadata. Weak per-step, external and low-confidence
evidence generates explicit warnings. Dirty source cannot be reproduced by SHA alone.

Compare supported linear workflows against their cited Playwright actions and
assertions in one continuous trace segment. Source annotations resolve identities;
test event citations resolve action order. Only an asserted failed form submission
followed by corrected input and a repeated submit may be omitted. Extra intervening
actions and completion assertions after another action cannot satisfy the path.
This prevents false matches across repeated operations in the same test.

Partial traces are reported. Branch guards, wait/explain actions and unsupported
condition kinds are not claimed as fully compared. Missing tests are not passes.
Runtime inputs, prerequisites, authorization, simultaneous boolean conditions,
rendered instance uniqueness and browser behavior remain separate checks.

CLI validation rescans the requested repository, writes the report and exits
nonzero for failures. Candidate YAML remains unchanged. Reader errors (invalid
YAML/envelope) fail before analysis; the library handles arbitrary Workflow V1 input.

## Alternatives

- Trust discovery validation flags: can be stale or edited and misses deeper checks.
- Match arbitrary action subsequences: can combine unrelated test repetitions.
- Simulate all branch and runtime conditions statically: unsupported by evidence.
- Treat every warning as an error: would reject useful candidates requiring review.

## Consequences

The three fixture candidates pass static validation while retaining meaningful
warnings, especially the weak structure-change terminal. Browser checks remain
explicitly not-run until Phase 10. Future bounded loops or broader condition/trace
support need explicit IR and validator extensions, not silent inference.
