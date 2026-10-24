import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import { createProductReasoner } from "@pathcompiler/reasoner-core";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createReasoningMcpServer,
  createReasoningService,
  REASONING_MCP_TOOL_NAMES,
  type ReasoningService,
} from "../src/index.js";

let solver: SolverProvider;
let service: ReasoningService;
let mcp: Client;
beforeAll(async () => {
  solver = await createZ3SolverProvider();
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  service = createReasoningService({
    reasoner: createProductReasoner(solver),
    model: buildFormalModel(
      capabilities.graph,
      capabilities.report,
      mined.report,
    ).model,
    capabilities: capabilities.report.capabilities.map((item) => ({
      id: item.id,
      uiEvidence: item.inferences.map((entry) => entry.nodeId),
      apiEvidence: item.apiEvidence.map((entry) => entry.nodeId),
    })),
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createReasoningMcpServer(service).connect(serverSide);
  mcp = new Client({ name: "test", version: "0.0.0" });
  await mcp.connect(clientSide);
}, 60_000);
afterAll(async () => {
  await mcp?.close();
  await solver?.close();
});

describe("developer reasoning service", () => {
  it("answers in product terms without solver statistics", async () => {
    const reachable = (await service.handle("reachability", {
      goal: "clients.created",
      context: { role: "editor" },
    })) as Record<string, unknown>;
    expect(reachable).toMatchObject({
      status: "reachable",
      goal: "clients.created",
    });
    expect(JSON.stringify(reachable)).not.toContain('"stats"');
    const why = (await service.handle("why-unreachable", {
      goal: "plans.archived",
      context: { role: "editor" },
    })) as { status: string; explanation: { summary: string[] } };
    expect(why.status).toBe("unreachable");
    expect(why.explanation.summary).toContain(
      "plans.archive.archive requires role = admin.",
    );
    expect(
      (await service.handle("alternatives", {
        goal: "clients.deactivated",
        context: { role: "editor" },
      })) as {
        variants: { variants: unknown[] };
      },
    ).toMatchObject({ variants: { variants: [{}, {}] } });
    expect(await service.handle("dead-features", {})).toMatchObject({
      findings: [],
    });
  }, 300_000);

  it("rejects bad requests with actionable messages", async () => {
    await expect(
      service.handle("reachability", { goal: "nope" }),
    ).rejects.toThrow(/Unknown goal nope\. Known goals: /);
    await expect(service.handle("reachability", { gaol: "x" })).rejects.toThrow(
      /Invalid reachability request: /,
    );
    await expect(service.handle("compare-releases", {})).rejects.toThrow(
      /Unknown reasoning operation compare-releases/,
    );
    await expect(
      service.handle("verify-property", { property: { kind: "never" } }),
    ).rejects.toThrow(/Invalid property/);
  });

  it("serves the spec §74 tools over a separate MCP server", async () => {
    const tools = await mcp.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...REASONING_MCP_TOOL_NAMES].sort(),
    );
    const result = await mcp.callTool({
      name: "pathcompiler.minimal_enablement",
      arguments: { goal: "clients.created", context: { role: "unlisted" } },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      result: { status: "enableable", diagnosticOnly: true },
    });
    const failed = await mcp.callTool({
      name: "pathcompiler.find_plan",
      arguments: { goal: "nope" },
    });
    expect(failed.isError).toBe(true);
  }, 300_000);
});
