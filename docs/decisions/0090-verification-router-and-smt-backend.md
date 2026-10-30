# ADR 0090 — Verification router and SMT backend (BX3)

## Context

BehaviorIR holds rules with provenance; something has to check them. The
expansion's own principle is that not everything belongs in an SMT solver and
that a verifier must say what it did not check. A result is only useful if it
states what it established and under which assumptions, and a counterexample
is only useful if it is real.

## Decision

- **New `@pathcompiler/verification`.**
  - `Verifier` interface: `supports(property, spec)` and `verify(...)`. A
    **router** asks each registered verifier in order and returns
    `UNSUPPORTED` with every verifier's reason when none supports a
    property, instead of passing it.
  - **Properties** (each about one execution of one operation, from any
    state satisfying the invariants): an invariant is preserved; a business
    rule or data policy is enforced; a deny or constrained-allow permission
    is respected; stated postconditions follow from the effects.
  - **Results:** `VERIFIED`, `VIOLATED` (with a counterexample), `UNKNOWN`,
    `UNSUPPORTED`. Every result names the verifier, the supported fragment,
    the rule's trust (confidence, human-backed or extracted candidate,
    sources) and caveats.
- **SMT backend** over the existing `SolverProvider`. `SolverTerm` gains
  integer `add`, `sub`, `mul` (additive; existing providers and callers are
  untouched). Strings and enum values are interned as integers, which is
  complete for equality, the only operation the language allows on them.
  Nonlinear arithmetic is `UNSUPPORTED`.
- **Counterexamples are checked, not trusted.** A model is turned back into
  specification values and re-evaluated with the IR's own evaluator: the
  starting state must satisfy the domains, invariants and preconditions, the
  step is recomputed from the effects, and the property must fail. If the
  replay disagrees the result is `UNKNOWN` (an encoding problem), never
  `VIOLATED`.
- **Vacuity:** a `VERIFIED` result carries a caveat when no state lets the
  operation run at all (a contradictory specification proves everything).
- **Caveats that travel with results:** the starting state satisfies the
  invariants but may be unreachable; an operation with extractor
  limitations may have weaker preconditions than the code, so a violation
  may be spurious (and unmodeled effects are not covered by a proof); a rule
  that is an extracted candidate is only as good as its extraction.
- **CLI:** `pathcompiler behavior verify <spec> [--operation <id> ...]`
  writes `reports/behavior-verification.json` and exits nonzero on a
  violation.

## Wording

What may be claimed: *given the encoded specification and the modeled
system state, the verifier can establish whether the checked property holds
within the supported model.* Not: that the business logic is correct, that
the code outside the model is correct, or that an extracted rule is the
business's rule.

## Alternatives

- **Verify against the whole system from the initial state (reachability).**
  Stronger, but requires a complete transition system. The inductive
  single-step check is what extracted operations support, and its caveat is
  stated.
- **Trust the solver's model.** Cheaper, but one encoding bug would turn into
  false violations in a PR comment; the replay costs microseconds.
- **Encode strings in a string theory.** Unneeded for equality; interning
  avoids theory-combination timeouts.

## Consequences

- On the refund fixture all 23 properties of the base service verify, and
  the support-agent fast path (which the existing tests do not catch) is
  reported as the single violation with a confirmed counterexample; the
  benign refactor and the stricter limit are not flagged.
- Decimals, null, string order, quantifiers over collections and temporal
  rules are outside the fragment; temporal rules have no verifier yet.
