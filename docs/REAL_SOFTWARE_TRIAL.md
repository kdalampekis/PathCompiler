# Real-software trial: protocol

Goal: learn where PathCompiler is wrong, noisy or missing on a repository the
authors did not write. Nothing here publishes or changes the repository except
files under `spec/` and `.pathcompiler/`, which you can delete.

Pick one repository you know well, ideally with a business rule you can name
("refunds over X need approval") and a recent bug or incident to test against.

## 1. First look (10 minutes)

```bash
pnpm pathcompiler start <repo>
```

Record: did it name the right language and tests? Is the stage sensible? Were
the suggested next steps clear without reading any other document?

## 2. Describe the code (any language)

```bash
pnpm pathcompiler contract task <repo>      # give the printed task file to your harness
pnpm pathcompiler contract import ContractProposal.json <repo>
pnpm pathcompiler contract status <repo>
```

Record: how many operations did the harness describe, how many were rejected and
why, and read three descriptions against the code: are they right? Count the
wrong ones (ISSUES_LOG #73). For TypeScript, SQL or OpenAPI, also run
`pathcompiler behavior extract` and compare what was read without a harness.

## 3. Rules

```bash
pnpm pathcompiler rules task <repo>         # the harness reads code, history and documents
pnpm pathcompiler rules import RuleProposals.json <repo>
pnpm pathcompiler rules list <repo>
```

Record: of the proposed rules, how many are true, wrong, or true but trivial?
Approve the true ones (`rules approve <id> --by you`).

## 4. The test that matters

Replay a past change or incident: check out the commit before a real bug fix on a
branch, apply the buggy version, and run

```bash
pnpm pathcompiler ci <repo> --base <good> --candidate <buggy> --report-only
```

Record: was it caught, with which rule and values; or missed, and why (the rule
did not exist, the description was wrong, the rule language cannot say it).
Also run it on 5 ordinary recent pull requests: how many false alarms?

## 5. With a harness in the loop

Add `pathcompiler mcp-agent <repo> --record --agent <name>` to the harness's MCP
settings; let it do a small task; note whether `check_change` helped or got in
the way. Then `pathcompiler feedback summary <repo>` and
`pathcompiler dataset export <repo> --out data`.

## What to send back

The five records above, plus: time to first useful output, anything that
required reading source code to understand, and the three most wrong things.
That is enough to prioritize the next phase (ISSUES_LOG #57, #66, #67, #71, #73,
#74, #75, #77).
