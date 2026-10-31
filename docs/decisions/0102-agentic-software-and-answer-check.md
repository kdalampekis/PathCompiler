# ADR 0102 — Agentic software: tool definitions, answer check (BX15)

## Context

Companies now ship agents: software whose behavior is a model calling tools and
writing answers. Its tools are declared in JSON Schema in every language and
framework; its answers commit the business to things ("I refunded 6000"). Rules
for it had no source, and an answer was not checked before it was rendered.

## Decision

- **Tool definitions are a rule source.** `tooldefs` reads OpenAI function
  calling, Anthropic tools, MCP `tools/list` and plain `{name, parameters}`
  declarations from any JSON file. Each tool becomes an operation; integer
  bounds become preconditions, enums and booleans become typed variables, a
  `required` field becomes a data constraint. Verbatim declarations are EXPLICIT.
  Types with no exact form (decimals, nested objects) are listed as unsupported.
  The action gate then refuses a call that breaks its own schema or an approved
  business rule on the same operation, regardless of the agent's language.
- **The answer check.** `checkOutput` / `guardOutput` / `pathcompiler_check_output`.
  Whoever has the answer (the agent, a harness, a model reading the text) lists
  what it commits to as claims, in the form of action requests; each is judged by
  the action gate. Declared **answer policies** (`spec/output-policies.json`,
  approved by a person: forbidden promises, required disclaimers, per channel,
  optionally only when the answer claims a given operation) are matched as
  patterns. A block carries instructions to rewrite the answer. The model finds
  the claims; the rules decide. A harness never grades its own answer.
- **Prompts and instructions are documents** in the rule-discovery task, so a
  harness reads a system prompt or guardrail file next to the code.
- **Feedback.** Output checks are recorded like other checks (ADR 0101).

## Alternatives

- *A model judging the text.* Cannot be audited and is the thing being checked.
- *Extracting claims deterministically from prose.* Brittle; the harness or model
  already reads language, and its output is checked by the gate.
- *Prompt text as rules.* Prompts are instructions to a model, not facts about
  behavior; they inform what a harness proposes, with evidence.

## Consequences

- A claim the caller forgets to list is not checked: the answer check is as good
  as the claim extraction (ISSUES_LOG #77). Policies are patterns, not meaning.
- Regular expressions come from a person-approved file, are length-capped and
  matched against at most 50,000 characters.
- Operation IDs are snake_case tool names; two tools in different files share a
  namespace (ISSUES_LOG #75).
