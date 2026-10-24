import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import {
  type CompiledWorkflows,
  compileWorkflows,
} from "@pathcompiler/workflow-compiler";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import { approveCandidate } from "@pathcompiler/workflow-review";
import { validateWorkflow } from "@pathcompiler/workflow-validator";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createStaticTransport,
  PathCompiler,
  PathCompilerError,
  type RuntimeTransport,
} from "../src/index.js";

let compiled: CompiledWorkflows;
beforeAll(async () => {
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  compiled = compileWorkflows(
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
});
function client(transport = createStaticTransport(compiled)) {
  return new PathCompiler({ project: "next-demo", transport });
}
async function failure(promise: Promise<unknown>): Promise<PathCompilerError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PathCompilerError) return error;
    throw error;
  }
  throw new Error("Expected a PathCompilerError");
}

describe("headless SDK", () => {
  it("resolves, searches and reads workflows through the static transport", async () => {
    const sdk = client();
    expect(sdk.project).toBe("next-demo");
    expect(
      await sdk.resolve({
        query: "how do I add a client",
        context: { route: "/clients" },
      }),
    ).toMatchObject({
      type: "workflow_help",
      workflowId: "clients.create",
      workflowVersion: 1,
      content: { title: "Create Client" },
      entrypoint: { route: "/clients" },
      capabilities: { guide: true, execute: false },
    });
    const help = await sdk.resolve({ query: "how do I add a client" });
    if (help.type !== "workflow_help") throw new Error(help.type);
    expect(help.content.steps).toHaveLength(4);
    expect(
      (await sdk.workflows.search("plan")).map((item) => item.workflowId),
    ).toEqual(["plans.change_structure", "plans.create"]);
    expect(await sdk.workflows.search("delete a client")).toEqual([]);
    expect(
      (await sdk.workflows.search("create client")).map(
        (item) => item.workflowId,
      ),
    ).toEqual(["clients.create"]);
    const details = await sdk.workflows.get("clients.create");
    expect(details.steps.map((step) => step.text)).toHaveLength(4);
    expect(details).not.toHaveProperty("commit");
    const manifest = await sdk.workflows.getRuntimeManifest("clients.create");
    expect(manifest.steps[0]?.target).toBe("clients.create");
    manifest.steps.length = 0;
    expect(
      (await sdk.workflows.getRuntimeManifest("clients.create")).steps,
    ).toHaveLength(4);
  });

  it("lists related workflows and supported actions from the same artifacts", async () => {
    const sdk = client();
    expect(await sdk.workflows.related("plans.create")).toEqual([
      expect.objectContaining({
        id: "plans.change_structure",
        relation: "same-entity",
      }),
    ]);
    expect(await sdk.workflows.related("clients.create")).toEqual([]);
    expect(await sdk.workflows.getSupportedActions("clients.create")).toEqual({
      explain: true,
      checklist: true,
      navigate: true,
      guide: true,
      execute: false,
    });
    expect((await failure(sdk.workflows.related("clients.edit"))).code).toBe(
      "workflow-not-found",
    );
    expect(
      (await failure(sdk.workflows.getSupportedActions("clients.edit"))).code,
    ).toBe("workflow-not-found");
  });

  it("reports unknown workflows and invalid requests with typed errors", async () => {
    const sdk = client();
    expect((await failure(sdk.workflows.get("clients.edit"))).code).toBe(
      "workflow-not-found",
    );
    expect(
      (await failure(sdk.workflows.getRuntimeManifest("clients.edit"))).code,
    ).toBe("workflow-not-found");
    expect((await failure(sdk.workflows.get(""))).code).toBe("invalid-request");
    expect((await failure(sdk.resolve({ query: "x".repeat(501) }))).code).toBe(
      "invalid-request",
    );
    expect(
      () =>
        new PathCompiler({ project: "", transport: {} as RuntimeTransport }),
    ).toThrow(PathCompilerError);
  });

  it("validates every transport response and does not swallow transport failures", async () => {
    const broken: RuntimeTransport = {
      resolve: async () => ({ type: "workflow" }) as never,
      getWorkflow: async () => ({ id: "x" }) as never,
      getRuntimeManifest: async () => {
        throw new Error("network down");
      },
      getRelatedWorkflows: async () => [{ id: "x" }] as never,
    };
    const sdk = client(broken);
    expect((await failure(sdk.resolve({ query: "a" }))).code).toBe(
      "invalid-response",
    );
    expect((await failure(sdk.workflows.get("x"))).code).toBe(
      "invalid-response",
    );
    await expect(sdk.workflows.getRuntimeManifest("x")).rejects.toThrow(
      "network down",
    );
    expect((await failure(sdk.workflows.related("x"))).code).toBe(
      "invalid-response",
    );
  });

  it("refuses incomplete or mismatched static artifacts", () => {
    expect(() =>
      createStaticTransport({ ...compiled, documentation: undefined }),
    ).toThrow(PathCompilerError);
    const other = structuredClone(compiled);
    other.runtimeManifest.workflows.pop();
    expect(() => createStaticTransport(other)).toThrow("different builds");
    const revised = structuredClone(compiled);
    const first = revised.documentation.workflows[0];
    if (!first) throw new Error("Missing workflow");
    first.revision = `sha256:${"b".repeat(64)}`;
    expect(() => createStaticTransport(revised)).toThrow("different builds");
  });

  it("has a browser-safe runtime module graph without Node.js built-ins", async () => {
    const seen = new Set<string>();
    const queue = [fileURLToPath(new URL("../dist/index.js", import.meta.url))];
    while (queue.length) {
      const file = queue.pop() ?? "";
      if (seen.has(file)) continue;
      seen.add(file);
      const source = await readFile(file, "utf8");
      for (const [, specifier = ""] of source.matchAll(
        /(?:import|export)[^"']*?from\s*["']([^"']+)["']/g,
      )) {
        expect(specifier, file).not.toMatch(/^node:|^(fs|path|crypto|os)$/);
        if (specifier.startsWith("."))
          queue.push(path.resolve(path.dirname(file), specifier));
        else if (specifier.startsWith("@pathcompiler/"))
          queue.push(await workspaceEntry(file, specifier));
      }
    }
    expect([...seen].some((file) => file.includes("resolver"))).toBe(true);
    expect([...seen].some((file) => file.endsWith("schema.js"))).toBe(true);
  });
});

/** Resolves an ESM-only workspace package export from the importing file. */
async function workspaceEntry(from: string, specifier: string) {
  const [scope, name, ...rest] = specifier.split("/");
  const subpath = rest.length ? `./${rest.join("/")}` : ".";
  for (
    let directory = path.dirname(from);
    ;
    directory = path.dirname(directory)
  ) {
    const root = path.join(directory, "node_modules", scope ?? "", name ?? "");
    try {
      const manifest = JSON.parse(
        await readFile(path.join(root, "package.json"), "utf8"),
      );
      return path.join(root, manifest.exports[subpath].import);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (directory === path.dirname(directory))
        throw new Error(`Cannot resolve ${specifier} from ${from}`);
    }
  }
}
