# Quickstart

You need Node 22+ and a checkout of this repository (packages are not
published yet). Everything below runs locally; nothing is sent to a model unless
you configure one.

```bash
pnpm install && pnpm build
pnpm pathcompiler start /path/to/your/repo
```

`start` tells you where the repository stands and what to do next, in order.
Typical paths:

**Your code is TypeScript with a SQL schema or OpenAPI.** Rules are extracted
from them directly. Run `pathcompiler behavior extract` and
`pathcompiler verify-pr --base main --candidate HEAD`.

**Your code is in any other language.** Let your harness describe it once:

```bash
pathcompiler contract task /path/to/repo     # writes a task for the harness
# the harness reads the code and writes ContractProposal.json
pathcompiler contract import ContractProposal.json /path/to/repo
pathcompiler contract approve --by you@company.com /path/to/repo
```

or connect the harness over MCP and it does the same through
`pathcompiler_contract_task` and `pathcompiler_submit_contract`
([HARNESS_TOOLS.md](HARNESS_TOOLS.md)).

**Then business rules.** `pathcompiler rules task` asks the harness to read the
code, history and documents and propose rules with evidence; you approve the
true ones with `pathcompiler rules approve <id> --by you`.

**Then pull requests.** `pathcompiler ci --report-only` compares HEAD with your
main branch and reports what it would block, without failing the build. When you
trust it, drop `--report-only`. `pathcompiler ci --print-workflow` prints a
GitHub Actions file.

Read next: [ADOPTION_AUDIT.md](ADOPTION_AUDIT.md) (what works and what does
not), [BEHAVIOR_SPEC_GUIDE.md](BEHAVIOR_SPEC_GUIDE.md) (the rule language).
