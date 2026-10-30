# Rule discovery contract

How an external harness (or a model) proposes business rules to PathCompiler.
Design: [ADR 0095](../../docs/decisions/0095-rule-discovery.md).

```bash
pathcompiler rules task <repo> --bind payment=payments [--from <ref>] [--to <ref>]
#   writes .pathcompiler/rules/tasks/<id>.json
#   and   .pathcompiler/rules/schemas/RuleProposals.schema.json
# the harness reads the task, the code and the commits, and writes RuleProposals.json
pathcompiler rules import RuleProposals.json <repo> --bind payment=payments
#   validates every proposal, writes the accepted ones to <repo>/spec/candidate-rules.json
pathcompiler rules list <repo>
pathcompiler rules approve <rule-id> --by <you> <repo>      # a person decides
pathcompiler rules reject <rule-id> --by <you> --reason "…" <repo>
```

## What the harness receives (the task)

- the **operations** found in the code, with their parameters, preconditions,
  effects, limitations and the `file:lines` they were read from;
- the **variables** you may use in rules (ID, type, scope, enum values);
- the **known rules** (approved, extracted, candidate and rejected), so it does
  not repeat them;
- the constructs the deterministic extractors **could not model**, with where
  they are: this is where a reader adds the most;
- the **files to read** and the **commit range** (`--from`, `--to`);
- the **instructions** and the **expression syntax**.

It does not contain the repository. A harness that has the repository reads
what it needs; a model route sends only bounded excerpts (see
`rules discover --explain-context`).

## What the harness returns

`RuleProposals.json` (see `RuleProposals.example.json`; the JSON Schema is
written by `rules task`). Per proposal: a `kind` (`business_rule`, `invariant`
or `permission`), the rule in the expression syntax, a `rationale` and at
least one piece of **evidence**:

| `type` | needs | checked by PathCompiler |
| --- | --- | --- |
| `code`, `test`, `doc`, `config` | `file`, optionally `lines` and a short `quote` | the file exists in the repository, the lines are in range, the quote is in the cited lines |
| `commit` | `commit` (SHA), optionally a `quote` | the commit exists |

Evidence that cannot be verified is dropped; a proposal left with none is
rejected. Cite the passage you relied on and quote it.

## What happens to a proposal

1. It must parse and use only the task's variables and the specification's
   operations.
2. It must not repeat a known or rejected rule.
3. It is checked against the code: `holds`, `contradicted` (the code violates
   it: a bug or a wrong rule, to be triaged) or `unknown`.
4. It is stored as a **candidate**: inferred, model-assisted, confidence LOW or
   MEDIUM whatever the proposer claimed. The verifier, PR guard and agent gate
   report it with the *extracted candidate* caveat and never fail a change on
   it alone.
5. Only `rules approve`, by a named person, makes it an approved rule.

If the code looks wrong, say so in the `rationale`; do not encode the bug as a
requirement.
