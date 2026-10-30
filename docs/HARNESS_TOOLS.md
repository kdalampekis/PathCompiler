# Tools for harnesses and agents

PathCompiler's checks as tools a harness calls while it works, over MCP, as
function-calling schemas, from TypeScript, or from the command line. They work
on any repository; how much they can check depends on how much of the
behavior is known (see "What a result means").

## Start the MCP server

```bash
pathcompiler mcp-agent <repository> [--bind payment=payments ...] [--exclude <dir> ...] [--allow-write]
```

Add it to any MCP client. For a client that reads an `mcpServers` object:

```json
{
  "mcpServers": {
    "pathcompiler": {
      "command": "pathcompiler",
      "args": ["mcp-agent", ".", "--bind", "payment=payments"]
    }
  }
}
```

(From a checkout, use `pnpm pathcompiler` or `node packages/cli/dist/bin.js`.)
Read-only unless `--allow-write` is given.

## The tools

| Tool | Ask it when | Returns |
| --- | --- | --- |
| `pathcompiler_readiness` | first, in a repository you have not used PathCompiler on | languages, what is known, the stage, and the next steps in order |
| `pathcompiler_describe` | starting, and after learning something | operations, rules with provenance and trust, what could not be modeled |
| `pathcompiler_check_change` | before you finish, and after each fix | `mustFix`, `consider`, counterexample values, what was not checked |
| `pathcompiler_check_action` | an agent is about to act | PASS or BLOCK with the violated rule, the values, what is missing |
| `pathcompiler_verify` | looking for a real bug | solver results with counterexamples |
| `pathcompiler_contract_task` | the language has no extractor (Python, Go, Java, ...) | the task of describing what its operations do in the behavior contract |
| `pathcompiler_submit_contract` | you described operations | per-operation acceptance and reasons; stored with a fingerprint of the code only with `--allow-write` |
| `pathcompiler_rule_task` | you can read code, history and documents | the discovery task: operations, known rules, unmodeled constructs, expression syntax |
| `pathcompiler_submit_rules` | you found rules | per-rule acceptance and reasons; stored as candidates only with `--allow-write` |
| `pathcompiler_list_rules` | reviewing | rules by trust and kind |

## A repository in any language

The deterministic extractors read TypeScript, SQL and OpenAPI. For anything
else, describe the code once in the **behavior contract**:

1. `pathcompiler_readiness` says which stage the repository is at.
2. `pathcompiler_contract_task`, read the code, `pathcompiler_submit_contract`
   with each operation's parameters, preconditions (the guards the code
   enforces), effects, and anchors (file, lines, a verbatim quote). Fix what is
   rejected and resubmit.
3. `pathcompiler_rule_task` and `pathcompiler_submit_rules` for the business
   rules, over the same variables.
4. A person approves (`pathcompiler contract approve`, `pathcompiler rules
   approve`). From then on `pathcompiler_check_change` applies the rules to this
   language, and reports `contract_stale` when the code a description covers
   changes without the description being re-derived.

## A working loop for a coding harness

1. `pathcompiler_describe` to learn the rules before changing code.
2. Make the change and run the project's own tests.
3. `pathcompiler_check_change`. Fix everything in `mustFix`; judge `consider`.
4. Repeat 2-3 until `mustFix` is empty, then finish.

## Function calling without MCP

```bash
pathcompiler tools list --format openai      # `tools` array for Chat Completions / Responses
pathcompiler tools list --format anthropic   # `tools` array for the Messages API
pathcompiler tools call pathcompiler_check_action <repository> --input '{"operation":"refund", ...}'
```

```ts
import { createToolbox, toAnthropicTools } from "@pathcompiler/agent-tools";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";

const tools = createToolbox({ directory: ".", solver: () => createZ3SolverProvider() });
// Pass toAnthropicTools() to the model; route each tool call to:
const outcome = await tools.call(name, input); // { ok, summary, data } or { ok: false, error }
await tools.close();
```

Every failure (unknown tool, invalid input, a git error) comes back as a
message the model can read, never as a crash.

## What a result means

- `check_change` compares the working tree with a base using the base's approved
  rules, so editing a rule does not make a change pass.
- `behaviorCheck.applied: false` means no specification exists for this
  repository, so business rules were **not** checked; the risk signals still
  ran. Use `pathcompiler_rule_task` and `pathcompiler_submit_rules` to create
  one from the code, the history and your documents.
- A rule you submit is an inferred candidate until a person approves it
  (`pathcompiler rules approve`). Approved rules enforce; candidates warn.
- Facts from a contract nobody approved can raise a concern but never fail a
  change on their own: whoever wrote them may have misread the code.
- Nothing is sent to a model by these tools. They read the directory the server
  was started in and nothing else.

Design: [ADR 0098](decisions/0098-tools-for-harnesses.md).
