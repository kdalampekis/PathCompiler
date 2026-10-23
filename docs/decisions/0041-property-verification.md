# ADR 0041 — Product property verification

## Context

Phase R8 verifies business and security properties (reasoning spec §31–§33),
for example "a viewer can never create a client", and returns counterexample
traces. Spec §111 asks for bounded model checking over the same transition
model, without a second verification stack. Until now, R0 and R1 only
*declared* invariants.

## Decision

- **A small safety-property language** (`ProductPropertySchema`, validated at
  the boundary). Every property has an `id`, a `description` and an optional
  fixed `context`:
  - `never`: a goal or a condition is never reached;
  - `always`: a condition holds in every reachable state;
  - `invariant`: a model invariant holds. `propertiesFromInvariants` lifts
    every declared invariant;
  - `via`: every path that reaches a goal performs one of the listed actions,
    such as "every structure change passes through confirmation".
- **One engine.** Each property reduces to "no reachable state satisfies a
  target":
  - `never` uses the goal or the condition itself;
  - `always` and `invariant` use the negated condition;
  - `via` uses the goal in the model with the `via` actions removed.

  The target becomes a synthetic goal in a validated copy of the model, so its
  expression is type-checked like any other. It is then decided by R2's BMC
  plus k-induction:
  - **holds** comes with the proof;
  - **violated** comes with a counterexample, found by R3's canonical search,
    so it is shortest and stable;
  - **unknown** keeps its reason.

  A `via` property that holds because the goal is unreachable anyway is
  reported as `vacuous`.
- **Liveness is out of scope.** "A submitted form eventually reaches
  client_created" needs lasso or fairness reasoning. That waits for a real
  requirement.
- **`pathcompiler reason verify [directory]`** checks the model's invariants
  plus any `--property <json-file>` properties. `--context` gives default
  context values, which a property's own context overrides. The command writes
  `reports/reasoning/verification.json`. A violation prints the counterexample
  and exits nonzero, so the command can gate CI. For extracted models it notes
  that a violation may also be an extraction error (§32), to be confirmed in
  the browser.
- **Seeded violations.** C7, which provides seeded bugs on branches, has not
  been built. R8's acceptance test therefore seeds the bug in a temporary copy
  of the fixture: it removes `requireEditor` from the clients POST handler. C7
  will turn such cases into shared fixtures.

## Alternatives

- **A temporal-logic front end (LTL/CTL) or an external model checker.**
  Spec §111 says not yet, and safety properties cover the stated examples.
- **Checking `via` by enumerating paths.** Incomplete and expensive. Removing
  the actions turns it into one reachability question.

## Consequences

- On the hand model, the three declared invariants, "viewer never creates a
  client" and `always`/`via` examples hold. "Every structure change passes
  through confirmation" is violated, and the counterexample ends in
  `plans.save_structure`.
- On the extracted model, the six structural invariants and "viewer never
  creates a client" hold.
- With `requireEditor` removed from POST `/api/clients`, the property is
  violated with the 5-step counterexample navigation → open → email → name →
  submit.
- I3 can now evaluate candidate changes against protected properties.
