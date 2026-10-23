// An "existing" assistant: its own chat loop, its own model interface and its
// own UI. PathCompiler is added only as one tool call returning structured data.
import {
  anthropicTool,
  resolveProductHelp,
  TOOL_NAME,
  toolResultText,
} from "@pathcompiler/assistant-tools";
import type {
  PathCompiler,
  ProductHelpResult,
  ResolveContext,
  SupportedActions,
  WorkflowDetails,
} from "@pathcompiler/sdk-js";

export type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "tool"; name: string; text: string };
export type ModelTurn =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; arguments: unknown };
export type ToolDefinition = ReturnType<typeof anthropicTool>;

/** What the assistant already talks to; swap in any provider behind this. */
export interface ChatModel {
  respond(messages: Message[], tools: ToolDefinition[]): Promise<ModelTurn>;
}

/**
 * Deterministic stand-in for a real model so the example runs offline: it calls
 * the product-help tool for how-to questions and summarizes the tool result.
 */
export class ScriptedModel implements ChatModel {
  readonly #context: ResolveContext;
  constructor(context: ResolveContext = {}) {
    this.#context = context;
  }
  async respond(messages: Message[]): Promise<ModelTurn> {
    const last = messages.at(-1);
    if (last?.role === "user")
      return /\b(how|where|can i|help|want to)\b/i.test(last.text)
        ? {
            type: "tool_call",
            name: TOOL_NAME,
            arguments: { query: last.text, context: this.#context },
          }
        : {
            type: "text",
            text: "I can help with questions about using the app.",
          };
    if (last?.role === "tool") {
      const result = JSON.parse(last.text) as ProductHelpResult;
      if (result.type === "workflow")
        return {
          type: "text",
          text: `Here's how to ${result.workflow.title.toLowerCase()}.`,
        };
      if (result.type === "ambiguous")
        return {
          type: "text",
          text: `Which of these did you mean: ${result.options.map((option) => option.title).join(" or ")}?`,
        };
      return {
        type: "text",
        text: "I couldn't find an approved guide for that yet.",
      };
    }
    return { type: "text", text: "How can I help?" };
  }
}

export type Answer = {
  text: string;
  help: ProductHelpResult | null;
  workflow: WorkflowDetails | null;
  actions: SupportedActions | null;
};

/** The assistant's existing loop with one extra tool. */
export class ExistingAssistant {
  readonly #model: ChatModel;
  readonly #pathcompiler: PathCompiler;
  constructor(model: ChatModel, pathcompiler: PathCompiler) {
    this.#model = model;
    this.#pathcompiler = pathcompiler;
  }

  async ask(question: string): Promise<Answer> {
    const messages: Message[] = [{ role: "user", text: question }];
    let help: ProductHelpResult | null = null;
    for (let turn = 0; turn < 4; turn += 1) {
      const reply = await this.#model.respond(messages, [anthropicTool()]);
      if (reply.type === "text") {
        const workflow =
          help?.type === "workflow"
            ? await this.#pathcompiler.workflows.get(help.workflow.id)
            : null;
        const actions =
          help?.type === "workflow"
            ? await this.#pathcompiler.workflows.getSupportedActions(
                help.workflow.id,
              )
            : null;
        return { text: reply.text, help, workflow, actions };
      }
      if (reply.name !== TOOL_NAME)
        throw new Error(`Unknown tool ${reply.name}`);
      help = await resolveProductHelp(this.#pathcompiler, reply.arguments);
      messages.push({
        role: "tool",
        name: reply.name,
        text: toolResultText(help),
      });
    }
    throw new Error("The model did not finish within four turns.");
  }
}
