import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { createStaticTransport, PathCompiler } from "@pathcompiler/sdk-js";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { compileWorkflows } from "@pathcompiler/workflow-compiler";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import { approveCandidate } from "@pathcompiler/workflow-review";
import { validateWorkflow } from "@pathcompiler/workflow-validator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPathCompilerMcpServer, MCP_TOOL_NAMES } from "../src/index.js";

let mcp: Client;
let sdk: PathCompiler;
beforeAll(async () => {
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  const compiled = compileWorkflows(
    discoverWorkflows(
      capabilities.graph,
      capabilities.report,
      mined.report,
    ).report.candidates.map((candidate) =>
      approveCandidate(candidate, {
        approvedBy: "Test Reviewer",
        approvedAt: "2026-10-22T10:00:00.000Z",
        validation: validateWorkflow(candidate.workflow, {
          graph: mined.graph,
          traces: mined.report,
        }),
        repository: { ...project.repository, dirty: false },
      }),
    ),
  );
  sdk = new PathCompiler({
    project: "next-demo",
    transport: createStaticTransport(compiled),
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createPathCompilerMcpServer(sdk).connect(serverSide);
  mcp = new Client({ name: "test", version: "0.0.0" });
  await mcp.connect(clientSide);
});
afterAll(async () => {
  await mcp?.close();
});
const call = (name: string, args: Record<string, unknown>) =>
  mcp.callTool({ name, arguments: args });

describe("MCP server", () => {
  it("lists the specified read-only tools", async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [...MCP_TOOL_NAMES].sort(),
    );
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        openWorldHint: false,
      });
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("returns exactly what the SDK returns for every tool", async () => {
    const context = { route: "/clients" };
    const cases: [string, Record<string, unknown>, unknown][] = [
      [
        "pathcompiler.resolve_help",
        { query: "add a client", context },
        { result: await sdk.resolve({ query: "add a client", context }) },
      ],
      [
        "pathcompiler.search_workflows",
        { query: "plan" },
        { workflows: await sdk.workflows.search("plan") },
      ],
      [
        "pathcompiler.get_workflow",
        { id: "clients.create" },
        { workflow: await sdk.workflows.get("clients.create") },
      ],
      [
        "pathcompiler.get_related_workflows",
        { id: "plans.create" },
        { workflows: await sdk.workflows.related("plans.create") },
      ],
      [
        "pathcompiler.get_supported_actions",
        { id: "clients.create" },
        { actions: await sdk.workflows.getSupportedActions("clients.create") },
      ],
    ];
    for (const [name, args, expected] of cases) {
      const result = await call(name, args);
      expect(result.isError, name).toBeFalsy();
      expect(result.structuredContent, name).toEqual(expected);
      const [content] = result.content as { type: string; text: string }[];
      expect(JSON.parse(content?.text ?? "null"), name).toEqual(expected);
    }
  });

  it("reports SDK and validation errors as readable tool errors", async () => {
    const missing = await call("pathcompiler.get_workflow", {
      id: "clients.edit",
    });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.content)).toContain("workflow-not-found");
    const invalid = await call("pathcompiler.resolve_help", {
      query: "x".repeat(501),
    });
    expect(invalid.isError).toBe(true);
    const extra = await call("pathcompiler.resolve_help", {
      query: "x",
      context: { secret: true },
    });
    expect(extra.isError).toBe(true);
  });
});
