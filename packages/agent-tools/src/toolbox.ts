import type { SolverProvider } from "@pathcompiler/solver-provider";
import { z } from "zod";
import type { ToolContext } from "./context.js";
import { TOOLS, type ToolDefinition, type ToolResult } from "./tools.js";

export type ToolboxOptions = {
  directory: string;
  /** Lets `pathcompiler_submit_rules` store candidates. Off by default. */
  allowWrite?: boolean;
  bindings?: Record<string, string>;
  exclude?: readonly string[];
  /** Creates the solver on first use. The toolbox closes it. */
  solver: () => Promise<SolverProvider>;
};

export type ToolCallOutcome =
  | { ok: true; tool: string; summary: string; data: unknown }
  | { ok: false; tool: string; error: string };

/**
 * The tools bound to one workspace. This is the single place a harness-facing
 * adapter (MCP, function calling, the CLI, the SDK) goes through, so they all
 * validate input and report errors the same way.
 */
export type Toolbox = {
  readonly tools: readonly ToolDefinition[];
  call(name: string, input: unknown): Promise<ToolCallOutcome>;
  close(): Promise<void>;
};

export function createToolbox(options: ToolboxOptions): Toolbox {
  let solver: Promise<SolverProvider> | undefined;
  const context: ToolContext = {
    directory: options.directory,
    allowWrite: options.allowWrite ?? false,
    ...(options.bindings ? { bindings: options.bindings } : {}),
    ...(options.exclude ? { exclude: options.exclude } : {}),
    solver: () => {
      solver ??= options.solver();
      return solver;
    },
  };
  return {
    tools: TOOLS,
    async call(name, input) {
      const tool = TOOLS.find((item) => item.name === name);
      if (!tool)
        return {
          ok: false,
          tool: name,
          error: `Unknown tool "${name}". Available: ${TOOLS.map((item) => item.name).join(", ")}.`,
        };
      const parsed = tool.input.safeParse(input ?? {});
      if (!parsed.success)
        return {
          ok: false,
          tool: name,
          error: `Invalid input for ${name}: ${parsed.error.issues
            .map(
              (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
            )
            .join("; ")}`,
        };
      try {
        const result: ToolResult = await tool.run(
          context,
          parsed.data as never,
        );
        return { ok: true, tool: name, ...result };
      } catch (error) {
        // The harness needs to read what went wrong; it is not a crash.
        return {
          ok: false,
          tool: name,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async close() {
      if (solver) await (await solver).close();
      solver = undefined;
    },
  };
}

/** JSON Schema of a tool's input, for function-calling APIs. */
export function inputJsonSchema(tool: ToolDefinition) {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.input) as Record<
    string,
    unknown
  >;
  return schema;
}

/** OpenAI Chat Completions / Responses `tools` entries. */
export function toOpenAITools(tools: readonly ToolDefinition[] = TOOLS) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: inputJsonSchema(tool),
    },
  }));
}

/** Anthropic Messages API `tools` entries. */
export function toAnthropicTools(tools: readonly ToolDefinition[] = TOOLS) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: inputJsonSchema(tool),
  }));
}
