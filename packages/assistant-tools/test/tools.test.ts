import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PathCompiler,
  type ProductHelpResult,
  type ResolveRequest,
  type RuntimeTransport,
} from "@pathcompiler/sdk-js";
import { describe, expect, it } from "vitest";
import {
  anthropicTool,
  INPUT_SCHEMA,
  jsonSchemaTool,
  langChainTool,
  openAITool,
  parseToolInput,
  resolveProductHelp,
  STRICT_INPUT_SCHEMA,
  TOOL_NAME,
  ToolInputError,
  toolResultText,
} from "../src/index.js";

const result: ProductHelpResult = {
  type: "workflow_help",
  workflowId: "clients.create",
  workflowVersion: 1,
  revision: `sha256:${"a".repeat(64)}`,
  confidence: 1,
  content: {
    title: "Create Client",
    steps: [{ id: "step.1", text: "Click Create Client" }],
  },
  entrypoint: { route: "/clients" },
  capabilities: {
    explain: true,
    checklist: true,
    navigate: true,
    guide: true,
    execute: false,
  },
  matched: { alias: null, action: "create", entity: "client", qualifiers: [] },
};
function client(requests: ResolveRequest[] = []) {
  const transport: RuntimeTransport = {
    resolve: async (request) => {
      requests.push(request);
      return result;
    },
    getWorkflow: async () => {
      throw new Error("unused");
    },
    getRuntimeManifest: async () => {
      throw new Error("unused");
    },
    getRelatedWorkflows: async () => [],
  };
  return new PathCompiler({ project: "tools", transport });
}
function objects(
  schema: unknown,
  visit: (node: Record<string, unknown>) => void,
) {
  if (!schema || typeof schema !== "object") return;
  const node = schema as Record<string, unknown>;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes("object") && node.properties) visit(node);
  for (const value of Object.values(node)) objects(value, visit);
}

describe("assistant tool adapters", () => {
  it("describes one tool in each provider's shape from the same schema", () => {
    expect(jsonSchemaTool()).toMatchObject({
      name: TOOL_NAME,
      inputSchema: INPUT_SCHEMA,
    });
    expect(anthropicTool()).toEqual({
      name: TOOL_NAME,
      description: expect.stringContaining("approved product workflow"),
      input_schema: INPUT_SCHEMA,
    });
    expect(openAITool()).toEqual({
      type: "function",
      function: {
        name: TOOL_NAME,
        description: expect.any(String),
        parameters: STRICT_INPUT_SCHEMA,
        strict: true,
      },
    });
    expect(openAITool({ api: "responses" })).toMatchObject({
      type: "function",
      name: TOOL_NAME,
      parameters: STRICT_INPUT_SCHEMA,
      strict: true,
    });
    expect(langChainTool(client())).toMatchObject({
      name: TOOL_NAME,
      schema: INPUT_SCHEMA,
    });
    expect(INPUT_SCHEMA.required).toEqual(["query"]);
  });

  it("keeps the OpenAI schema strict-mode compatible at every level", () => {
    let count = 0;
    objects(STRICT_INPUT_SCHEMA, (node) => {
      count += 1;
      expect(node.additionalProperties).toBe(false);
      expect([...(node.required as string[])].sort()).toEqual(
        Object.keys(node.properties as object).sort(),
      );
    });
    expect(count).toBe(3);
    expect(JSON.stringify(STRICT_INPUT_SCHEMA)).not.toContain(
      '"additionalProperties":{',
    );
  });

  it("normalizes provider arguments into the SDK request", () => {
    expect(parseToolInput({ query: "add a client" })).toEqual({
      query: "add a client",
    });
    expect(
      parseToolInput(
        JSON.stringify({
          query: "add a client",
          context: {
            route: "/clients",
            role: null,
            permissions: null,
            featureFlags: [{ name: "beta", enabled: true }],
          },
        }),
      ),
    ).toEqual({
      query: "add a client",
      context: { route: "/clients", featureFlags: { beta: true } },
    });
    expect(
      parseToolInput({
        query: "x",
        context: { featureFlags: { beta: false } },
      }),
    ).toEqual({ query: "x", context: { featureFlags: { beta: false } } });
    expect(parseToolInput({ query: "x", context: null })).toEqual({
      query: "x",
    });
    for (const invalid of [
      "{",
      { query: "x", extra: 1 },
      { query: "x".repeat(501) },
      {},
    ])
      expect(() => parseToolInput(invalid)).toThrow(ToolInputError);
  });

  it("resolves through the SDK client for every adapter", async () => {
    const requests: ResolveRequest[] = [];
    const sdk = client(requests);
    expect(await resolveProductHelp(sdk, { query: "add a client" })).toEqual(
      result,
    );
    expect(
      await langChainTool(sdk).invoke(
        '{"query":"add a client","context":null}',
      ),
    ).toBe(toolResultText(result));
    expect(requests).toEqual([
      { query: "add a client" },
      { query: "add a client" },
    ]);
    await expect(resolveProductHelp(sdk, { nope: true })).rejects.toThrow(
      ToolInputError,
    );
  });

  it("keeps provider SDKs out of every workspace package but the Anthropic adapter", async () => {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../..",
    );
    for (const group of ["packages", "apps"])
      for (const name of await readdir(path.join(root, group))) {
        // The one adapter allowed a vendor SDK (ADR 0071).
        if (group === "packages" && name === "model-provider-anthropic")
          continue;
        const manifest = await readFile(
          path.join(root, group, name, "package.json"),
          "utf8",
        );
        expect(manifest, name).not.toMatch(
          /"(openai|@anthropic-ai\/[^"]+|langchain|@langchain\/[^"]+)"/,
        );
      }
  });
});
