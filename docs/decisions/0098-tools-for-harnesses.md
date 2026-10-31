# ADR 0098 — Tools for harnesses (BX11)

## Context

Harnesses and LLM agents already have the code, the shell and the automation.
Until now they could only hand PathCompiler a finished result (`harness import`)
or be run by it (`harness run`). They could not ask a question while working:
what are the rules here, does my change break one, may this agent action run,
are the rules I found acceptable. The only MCP servers served product help and
developer reasoning over a Next.js model. The end goal
(docs/PRODUCT_NORTH_STAR.md, principle 5) is that every capability is a tool
any harness can call, in any language, with feedback coming back.

> **As built later:** the registry grew to twelve tools. `pathcompiler_readiness`
> (BX13), `_contract_task` and `_submit_contract` (BX12), `_check_output` (BX15)
> and `_record_feedback` (BX14) were added with the same rules: input validated,
> failures returned as messages, read-only unless the server is started with
> `--allow-write` (rules, contract) or `--record` (feedback).

## Decision

One provider-neutral registry, `@pathcompiler/agent-tools`, with thin adapters.

- **Seven tools**, each a question a harness would otherwise guess at:
  `pathcompiler_describe` (operations, rules, provenance, what could not be
  modeled), `_verify` (solver check with counterexamples), `_check_change`,
  `_check_action`, `_rule_task`, `_submit_rules`, `_list_rules`.
- **`_check_change` is a self-check of the working tree.** It compares the
  files as they are now, committed or not, with a base (default HEAD). Approved
  rules are read from the base, so editing a rule cannot make a change pass. It
  returns `mustFix` (a business rule newly violated, with the values that break
  it; a protected path; a secret), `consider` (removed guard, changed
  constant, weakened tests) and what was not checked. It reuses the same
  PR guard, risk analysis, safety checks and merge as `harness run`, with
  `needVouching: false`: while work is in progress, "nothing vouched yet" is not
  a finding. It does not run the project's tests; the harness does.
- **Adapters, no logic.** `toolbox.call` validates strict Zod input, turns every
  failure into a message the harness can read, and is the only path. MCP
  (`mcp-agent` over stdio), OpenAI and Anthropic function-calling schemas
  (`tools list --format openai|anthropic`), the TypeScript SDK (`createToolbox`)
  and the CLI (`tools call`) all go through it.
- **Read-only by default.** Only `_submit_rules` can write, and only to
  `spec/candidate-rules.json`, and only when the server is started with
  `--allow-write`; otherwise it is a dry run that returns the same validation.
  Submitted rules pass the same checks as `rules import` (parses, known
  variables, new, evidence exists with a verbatim quote, then checked against
  the code) and stay inferred candidates until a person approves them.
- **Reading is bounded to the workspace.** Evidence files are read only inside
  the directory the server was started in; sizes and result counts are capped.

## Alternatives

- *Extend `mcp-server` / `mcp-reasoning`.* They serve different data (generated
  product artifacts, a product model) and different audiences; mixing them would
  couple the new tools to Next.js. A separate package keeps the core headless.
- *Only an SDK.* Harnesses speak MCP or function calling; an SDK alone leaves
  every integrator to rebuild the validation and the error messages.
- *Run the project's tests inside `_check_change`.* Slow, ecosystem-specific and
  the harness already runs them; `harness run` does it when PathCompiler drives.

## Consequences

- Any MCP client (Claude Code, Cursor, Codex, a custom agent) can call the
  checks without PathCompiler running the harness.
- The behavior check inside `_check_change` is as strong as the specification:
  strong for TypeScript, SQL, OpenAPI and approved rules, absent for a language
  with no extractor until a harness describes it in the behavior contract (BX12 does this). The tool
  says so in `behaviorCheck.reason` instead of passing silently.
- Feedback from these calls is recorded for datasets only when capture is on (BX14, ADR 0101).
