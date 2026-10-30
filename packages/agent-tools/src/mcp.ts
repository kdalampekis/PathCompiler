import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Toolbox } from "./toolbox.js";

/**
 * MCP adapter over the toolbox. A tool failure is a tool error the model can
 * read and act on, never a crashed server.
 */
export function createAgentToolsMcpServer(
  toolbox: Toolbox,
  info: { name?: string; version?: string } = {},
): McpServer {
  const server = new McpServer({
    name: info.name ?? "pathcompiler-agent-tools",
    version: info.version ?? "0.0.0",
  });
  for (const tool of toolbox.tools)
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input.shape,
        annotations: { readOnlyHint: tool.readOnly, openWorldHint: false },
      },
      async (input): Promise<CallToolResult> => {
        const outcome = await toolbox.call(tool.name, input);
        if (!outcome.ok)
          return {
            isError: true,
            content: [{ type: "text", text: outcome.error }],
          };
        const structuredContent = {
          summary: outcome.summary,
          data: outcome.data,
        };
        return {
          content: [
            { type: "text", text: JSON.stringify(structuredContent, null, 2) },
          ],
          structuredContent,
        };
      },
    );
  return server;
}

/** Serves the tools over stdin/stdout; stdout carries only MCP messages. */
export async function serveAgentToolsStdio(
  toolbox: Toolbox,
  info?: { name?: string; version?: string },
): Promise<McpServer> {
  const server = createAgentToolsMcpServer(toolbox, info);
  await server.connect(new StdioServerTransport());
  return server;
}
