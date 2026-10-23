import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type PathCompiler, PathCompilerError } from "@pathcompiler/sdk-js";
import { z } from "zod";

export const MCP_TOOL_NAMES = [
  "pathcompiler.resolve_help",
  "pathcompiler.search_workflows",
  "pathcompiler.get_workflow",
  "pathcompiler.get_related_workflows",
  "pathcompiler.get_supported_actions",
] as const;

const context = z
  .strictObject({
    route: z.string().min(1).max(500).optional(),
    role: z.string().min(1).max(120).optional(),
    permissions: z.array(z.string().min(1).max(200)).max(500).optional(),
    featureFlags: z.record(z.string().min(1).max(200), z.boolean()).optional(),
  })
  .optional()
  .describe("Current route, role, permissions and feature flags of the user");
const query = z
  .string()
  .max(500)
  .describe("The user's product-help question in their own words");
const id = z
  .string()
  .min(1)
  .max(200)
  .describe("Approved workflow ID, for example clients.create");
const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

/**
 * MCP adapter over the SDK client. Every tool delegates to one SDK call; no
 * resolution or catalog logic lives here.
 */
export function createPathCompilerMcpServer(
  client: PathCompiler,
  info: { name?: string; version?: string } = {},
): McpServer {
  const server = new McpServer({
    name: info.name ?? "pathcompiler",
    version: info.version ?? "0.0.0",
  });
  server.registerTool(
    "pathcompiler.resolve_help",
    {
      title: "Resolve product help",
      description:
        "Map a product-help question to one approved workflow, ambiguous options, or unsupported. Use before explaining how to do something in the product.",
      inputSchema: { query, context },
      annotations: readOnly,
    },
    ({ query, context }) =>
      respond(async () => ({
        result: await client.resolve(context ? { query, context } : { query }),
      })),
  );
  server.registerTool(
    "pathcompiler.search_workflows",
    {
      title: "Search workflows",
      description:
        "List approved workflows relevant to a query: one match, every ambiguous option, or none.",
      inputSchema: { query, context },
      annotations: readOnly,
    },
    ({ query, context }) =>
      respond(async () => ({
        workflows: await client.workflows.search(query, context),
      })),
  );
  server.registerTool(
    "pathcompiler.get_workflow",
    {
      title: "Get workflow",
      description:
        "Readable steps, prerequisites, entry routes and completion for an approved workflow.",
      inputSchema: { id },
      annotations: readOnly,
    },
    ({ id }) =>
      respond(async () => ({ workflow: await client.workflows.get(id) })),
  );
  server.registerTool(
    "pathcompiler.get_related_workflows",
    {
      title: "Get related workflows",
      description:
        "Approved workflows sharing the workflow's entity (listed first) or domain.",
      inputSchema: { id },
      annotations: readOnly,
    },
    ({ id }) =>
      respond(async () => ({ workflows: await client.workflows.related(id) })),
  );
  server.registerTool(
    "pathcompiler.get_supported_actions",
    {
      title: "Get supported actions",
      description:
        "Whether a workflow can be explained, shown as a checklist, navigated to or guided. Execution is never supported.",
      inputSchema: { id },
      annotations: readOnly,
    },
    ({ id }) =>
      respond(async () => ({
        actions: await client.workflows.getSupportedActions(id),
      })),
  );
  return server;
}

/** SDK errors become tool errors the model can read; anything else propagates. */
async function respond(
  run: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    const structuredContent = await run();
    return {
      content: [
        { type: "text", text: JSON.stringify(structuredContent, null, 2) },
      ],
      structuredContent,
    };
  } catch (error) {
    if (!(error instanceof PathCompilerError)) throw error;
    return {
      isError: true,
      content: [{ type: "text", text: `${error.code}: ${error.message}` }],
    };
  }
}

/** Serves the tools over stdin/stdout; stdout carries only MCP messages. */
export async function serveStdio(
  client: PathCompiler,
  info?: { name?: string; version?: string },
): Promise<McpServer> {
  const server = createPathCompilerMcpServer(client, info);
  await server.connect(new StdioServerTransport());
  return server;
}
