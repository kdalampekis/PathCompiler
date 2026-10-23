# Example: an existing assistant using PathCompiler

This example shows an assistant that already has its own chat loop, model
interface and UI, and adds PathCompiler as **one tool call**:

```text
existing assistant ──► resolve_product_help ──► structured result ──► its own card UI
```

It depends only on `@pathcompiler/sdk-js` and `@pathcompiler/assistant-tools`.
It does not use `@pathcompiler/ui`, `@pathcompiler/react` or any PathCompiler
server: answers come from static artifacts.

```sh
pnpm --filter @pathcompiler/example-custom-assistant prepare-artifacts   # discover, approve, build the fixture
pnpm --filter @pathcompiler/example-custom-assistant start "How do I add a new client?"
```

```text
+----------------------------------------------------+
| Create Client                                      |
+----------------------------------------------------+
| Here's how to create client.                       |
| 1. Click Create Client                             |
| ...                                                |
+----------------------------------------------------+
| [Open /clients] [Show me] [Checklist]              |
+----------------------------------------------------+
```

- `src/assistant.ts`: the assistant's loop. `ChatModel` is its existing model
  interface. `ScriptedModel` is a deterministic stand-in, so the example runs
  without credentials.
- `src/ui.ts`: the assistant's own presentation. It turns the structured result,
  workflow details and supported actions into a card. "Show me" appears only when
  `guide` is supported, and execution is never offered.
- `src/main.ts`: wires static artifacts, the assistant and the UI.

## Using a real model

Implement `ChatModel.respond` with your provider and pass PathCompiler's tool
definition. For example, with the Anthropic Messages API:

```ts
const response = await anthropic.messages.create({
  model, max_tokens: 1024, messages, tools: [anthropicTool()],
});
const use = response.content.find((block) => block.type === "tool_use");
if (use) return { type: "tool_call", name: use.name, arguments: use.input };
```

With OpenAI, use `openAITool()` and return the call's `function.arguments`, which
is a JSON string that `resolveProductHelp` accepts as is. The rest of the
assistant is unchanged.
