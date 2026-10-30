# ADR 0092 — Agent action gate (BX5)

## Context

An autonomous agent can call tools that change real state. The same
specification that checks a pull request can also check an *action* before it
runs: given who is acting, what they are asking for and the relevant state,
does the action break a rule? The check sits on the agent's critical path, so
it has to be fast, deterministic and explain itself well enough for the agent
to correct its next attempt.

## Decision

- **New `@pathcompiler/agent-gate`.** `createActionGate(spec, options).check(
  { operation, inputs, context, state })` evaluates the specification **on the
  concrete values** with the IR's evaluator; no solver is involved.
  - Checked: that each value has its declared type and domain; the
    operation's preconditions; the permissions of the actor's role (a deny
    blocks, a constrained allow must hold); every applicable business rule
    and data policy; and the invariants the action's effects could break, on
    the state it would produce.
  - Result: `PASS` or `BLOCK`, a status (`VERIFIED`, `VIOLATED`, `UNKNOWN`),
    the violations (rule, plain-language explanation, the values that make it
    fail, the rule's trust), the values that were missing, warnings, and a
    counterexample that is the checked action itself. Approved rules are
    listed first.
- **Policy for what it cannot decide is explicit and conservative.** A rule
  that needs a value the request did not give is `UNKNOWN`, listed with the
  missing variables, and the default is to **block** (`onUnknown: "allow"`
  changes it). An operation the specification does not describe is blocked by
  default. `enforce: "approved_only"` blocks only on rules a person approved
  and reports the rest as warnings, for specifications whose extracted rules
  are not trusted yet.
- **Interceptor:** `guardTool(gate, tool, { toRequest })` wraps any tool
  function. A blocked call returns the explanation as data so the agent can
  self-correct (or throws `ActionBlockedError`). No agent framework is
  assumed.
- **Evaluation:** `evaluateGate(gate, labeledActions)` reports the unsafe
  block rate, the safe allow rate, the false block rate, whether the right
  rule was named, which unsafe actions were missed and which safe ones were
  blocked.
- **CLI:** `pathcompiler agent check <spec> --request <action.json>` (exits
  nonzero on BLOCK) and `agent eval <spec> --cases <labeled.json>`.

## Alternatives

- **Use the SMT verifier at runtime.** Handles partial information (any
  state that fits), but is slower and answers a different question. The gate
  answers "does *this* action break a rule"; the verifier answers "can this
  *operation* ever break one".
- **Block only on approved rules.** Safest against wrong extracted rules, but
  throws away the code's own preconditions; offered as `approved_only`.
- **Let the agent run and roll back.** Not possible for irreversible actions.

## Consequences

- On the labeled refund set (28 actions): all 10 safe actions pass; of 18
  unsafe actions, 16 are blocked and 15 of those name the expected rule; the
  two missed (a refund against someone else's payment and a repeated
  identical refund) are described by no rule. The gate is only as good as the
  specification, and the evaluation reports the gap instead of hiding it.
  Checks take well under a millisecond.
- The labeled set was written by the fixture's author alongside the rules, so
  the 100% safe-allow rate says the gate does not invent violations on these
  cases, not how it behaves on an agent's real traffic.
- Temporal rules (idempotency, ordering) are not checked; the gate warns.
- It trusts the state it is given. If the agent supplies a wrong balance the
  gate checks the wrong thing; state should come from the system, via the
  `toRequest` hook, not from the model.
