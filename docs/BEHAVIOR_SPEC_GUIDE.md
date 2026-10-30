# Behavioral specification guide

How to use the behavioral-specification features (BehaviorIR, extraction,
verification, the PR guard, the agent gate, counterexample evals and the
repair loop), first on the bundled refund fixture, then on your own software.
The design is in
[EXPANDED_PATHCOMPILER_ARCHITECTURE.md](EXPANDED_PATHCOMPILER_ARCHITECTURE.md),
the phases and what was measured are in
[EXPANDED_PATHCOMPILER_ROADMAP.md](EXPANDED_PATHCOMPILER_ROADMAP.md).

What a result means, in one sentence: *given the encoded specification and the
modeled state, the verifier establishes whether the checked property holds
within the supported model.* It is not a statement that the business logic is
correct, and a rule extracted from code or tests is a candidate until a person
approves it.

All commands run from the PathCompiler checkout (`pnpm install && pnpm build`
first, Node 22.12+). Replace `fixtures/refunds` with the path to your own
repository when you get to part 2.

## 1. The refund demo

The fixture is a small TypeScript refund service with a SQL schema, Zod models,
an OpenAPI contract, example tests and a file of rules a person approved
(`spec/approved-rules.json`). Five variants of the service live in
`variants/`: three break a rule that the example tests do not cover, two are
harmless.

### Act 1: extract the specification

```bash
pnpm pathcompiler behavior extract fixtures/refunds \
  --bind payment=payments --bind createRefund=refund --bind request=refund_requests \
  --exclude variants --out .pathcompiler
```

```text
Extracted BehaviorIR refunds without a model:
  17 variables, 3 operations, 5 invariants, 5 business rules, 6 permissions, 17 data constraints
  facts by source: OPENAPI 6, DATABASE_SCHEMA 17, HUMAN_DECLARATION 8, VALIDATION_MODEL 9, SOURCE_CODE 11, TEST 2
  4 constructs not modeled (listed, not guessed): …
```

`--bind` says which entity or operation a code identifier belongs to
(`payment` in the code is the `payments` table). `behavior show` lists every
rule with where it came from and how far to trust it. The four constructs it
did not model are listed with file, line and reason: response status
contracts, a string length, a comparison with a literal in a test (test data,
not a rule) and an example equality.

### Act 2: verify the rules against the code

```bash
pnpm pathcompiler behavior verify .pathcompiler/reports/behavior-spec.json
```

On the base service all 23 properties verify. Each property is one question
about one operation: is this invariant preserved, is this business rule
enforced, is this permission respected. Copy a variant over `src/refunds.ts`
in a scratch copy of the fixture (the example tests still pass on every
variant), extract again and verify:

```text
Verified 23 properties of repo: 22 verified, 1 violated, 0 unknown, 0 unsupported.
VIOLATED refund enforces refunds.manager_approval_over_limit
  rule: refund.amount > 5000 => refund.manager_approval == true (human-approved, HIGH confidence; HUMAN_DECLARATION spec/approved-rules.json)
  counterexample (re-evaluated and confirmed):
    inputs: refund.amount=5001, refund.manager_approval=false, refund.payment_id=1
    context: actor.role="support_agent"
    state before: payments.original_amount=5001, payments.refunded_amount=0
```

The counterexample was re-evaluated with the specification's own evaluator
before it was shown; if that disagrees the result is `UNKNOWN`, never
`VIOLATED`.

### Act 3: the pull request

```bash
pnpm pathcompiler verify-pr --base main --candidate fast-refund <repo> \
  --bind payment=payments --bind createRefund=refund --bind request=refund_requests
```

This compares two Git revisions and reports only what the change introduces.
The approved rules are read from `main`, so the change cannot weaken a rule by
editing it. Output (a Markdown PR comment is also written):

```text
### PathCompiler behavior check: Blocked: a business rule is newly violated

main → fast-refund: 22 properties verified, 1 violated, 0 unknown, 0 unsupported.

- ✗ refund enforces refunds.manager_approval_over_limit: held at the base, violated at the head.
  Counterexample (re-evaluated and confirmed), operation `refund`: …

Behavior that changed:
- `refund` changed (weakened)
  - no longer requires `refund.amount <= 5000 || refund.manager_approval`
  - now requires `refund.amount <= 5000 || refund.manager_approval || actor.role == "support_agent"`
```

It exits nonzero when an approved rule is newly violated. A behavior-preserving
refactor produces an empty diff and `pass`; a stricter limit passes and is
reported as "strengthened"; a violated *extracted* rule, a removed rule,
edited approved rules or code the extractor cannot model produce `review`
(`--strict` makes those fail).

### Act 4: the same rules at run time

```bash
echo '{"operation":"refund","inputs":{"payment_id":1,"amount":7000,"manager_approval":false},
  "context":{"actor.role":"support_agent","actor.id":"a1"},
  "state":{"payments.original_amount":10000,"payments.refunded_amount":0}}' > action.json
pnpm pathcompiler agent check .pathcompiler/reports/behavior-spec.json --request action.json
```

```text
BLOCK refund: A refund above 5000 needs manager approval. (refund.amount > 5000 => refund.manager_approval == true) is violated (refund.amount=7000, refund.manager_approval=false).
  rule trust: human-approved, HIGH confidence (HUMAN_DECLARATION spec/approved-rules.json)
```

The gate evaluates the action on its concrete values, in well under a
millisecond, with no solver. A value it was not given makes the rule
`UNKNOWN`, and by default that blocks. In code, `guardTool` from
`@pathcompiler/agent-gate` wraps any tool function. `agent eval --cases
fixtures/refunds/spec/action-cases.json` measures the gate on 28 labeled
actions, and `agent audit --trace actions.jsonl` replays a log of past actions
to find the ones that already broke a rule.

### Act 5: the counterexample stays

`verify-pr` stored the counterexample. Turn it into a regression eval using
the specification the rule is approved in, then judge a candidate with it:

```bash
pnpm pathcompiler counterexamples list
pnpm pathcompiler counterexamples eval <id> --spec <trusted behavior-spec.json>
pnpm pathcompiler counterexamples run <eval.json> --spec <candidate behavior-spec.json>
```

The eval holds the counterexample, nearby actions that break the same rule
and nearby actions that must still be allowed. It fails the violating
candidate and passes after the repair. A candidate that is stricter than the
rule needs passes, and its extra rejections are reported as over-restrictive.

### Act 6: a proposed repair (prototype)

```bash
pnpm pathcompiler repair propose <repo> --fixture proposals.json --bind …
```

A repair provider sees the violated rule, the counterexample and the source
file of the operation, and nothing else. A proposal is accepted only if the
property holds, no other property became violated, the eval passes and the
tests you supply pass. The result is a patch for review (`git apply`);
nothing is changed. Only a scripted fixture provider exists; no model adapter
is wired in.

## 2. Trying it on your own software

This is the protocol for the first real-software trial. Its purpose is to
find out where the extractors, the supported fragment and the trust model meet
a real codebase, so record what does not work as carefully as what does.

**What fits today.** TypeScript code whose business rules are expressed as
top-level guard clauses (`if (…) throw`), SQL `CREATE TABLE` statements with
`CHECK` constraints, Zod models, OpenAPI documents (JSON or YAML) and tests
with `expect(a.b).toBeGreaterThanOrEqual(0)`-style assertions. Integer
amounts (cents), booleans, string enums and string equality. One execution of
one operation at a time.

**What does not.** Decimal money, null semantics, string length, collections,
rules that live in called helper functions, ORMs other than raw SQL, languages
other than TypeScript. These appear as "not modeled" entries and operation
limitations; they are not guessed.

1. **Extract, then read.** Run `behavior extract <repo> --out trial` with
   `--bind` for your entities and `--exclude` for build output or alternative
   versions of the same file. Read `trial/reports/behavior-extraction.json`:
   every fact with its source, and every construct not modeled. Run
   `behavior show` and check a sample of rules against the code by hand.
   Count: rules correct, rules wrong, rules you expected and did not get.
2. **Write the rules only people know.** Create `spec/approved-rules.json`
   (see `fixtures/refunds/spec/approved-rules.json`) for rules that no
   artifact states, with your name in `declaredBy`. Anything a verifier
   treats as authoritative should come from here.
3. **Verify.** `behavior verify`. For each `VIOLATED`: is it a real bug, a
   wrong rule, or a modeling gap (see the operation's limitations)? Each
   `UNSUPPORTED` names what is missing.
4. **Seed a regression.** On a branch, remove one guard or add a bypass of a
   rule you approved, keep the existing tests green, and run `verify-pr`.
   Record whether it was found. Then run it on ten real recent pull requests
   and record every `fail`, `review` and `pass`, with whether you agree.
5. **Gate an action.** Build a request from a real tool call (inputs, acting
   context, and the state from the system, not from the model) and run
   `agent check`. Replay a day of real actions with `agent audit` if you have a
   log carrying those values.
6. **Keep a note of cost.** Time to extract, time to verify, and the effort
   of writing the approved rules. The value of the approach depends on that
   last number.

What to bring back: the rules extracted correctly and wrongly, what the
extractor could not read, `verify-pr` hits, false alarms and misses on real
pull requests, and where the specification was too thin to say anything.
These feed the open issues in
[phases/ISSUES_LOG.md](phases/ISSUES_LOG.md).

## 3. Reading results

| Result | Meaning |
| --- | --- |
| `VERIFIED` | The encoded rule holds for one execution of the operation, from any state satisfying the invariants, within the supported fragment. A caveat appears if the operation has unmodeled constructs or the proof is vacuous. |
| `VIOLATED` | A counterexample exists and was re-evaluated against the specification. It may still be spurious if the starting state is unreachable or the operation has unmodeled preconditions; the result says so. |
| `UNKNOWN` | The solver gave up, a counterexample failed to replay (an encoding problem), or a value the gate needed was missing. |
| `UNSUPPORTED` | The property is outside the fragment (for example nonlinear arithmetic). It is a result, not a pass. |
| `PASS` / `BLOCK` | The agent gate's decision. `BLOCK` also covers what it could not decide, by default. |

A rule's trust is shown with every result: *human-approved* (from an approved
rules file), or *extracted* with a confidence from the sources that state it.
A rule two independent sources state (a schema `CHECK`, a Zod bound and a test
assertion) is kept once with all of them listed.
