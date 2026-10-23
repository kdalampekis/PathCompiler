import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import {
  createHttpTransport,
  createStaticTransport,
  PathCompiler,
  PathCompilerError,
} from "@pathcompiler/sdk-js";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { compileWorkflows } from "@pathcompiler/workflow-compiler";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import { approveCandidate } from "@pathcompiler/workflow-review";
import { validateWorkflow } from "@pathcompiler/workflow-validator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpService, createRequestHandler } from "../src/index.js";

const token = "test-token-0123456789";
let local: PathCompiler;
let remote: PathCompiler;
let base: string;
const errors: unknown[] = [];
let close: () => Promise<void>;
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
  local = new PathCompiler({
    project: "next-demo",
    transport: createStaticTransport(compiled),
  });
  const server = createHttpService({
    client: local,
    token,
    onError: (error) => errors.push(error),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
  remote = new PathCompiler({
    project: "next-demo",
    transport: createHttpTransport({ baseUrl: base, token }),
  });
});
afterAll(() => close?.());
async function failure(promise: Promise<unknown>): Promise<PathCompilerError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PathCompilerError) return error;
    throw error;
  }
  throw new Error("Expected a PathCompilerError");
}
const raw = (path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
  });

describe("HTTP service", () => {
  it("mirrors SDK results for every endpoint through the HTTP transport", async () => {
    const context = { route: "/clients" };
    for (const query of ["add a client", "plan", "delete a client", "   "])
      expect(await remote.resolve({ query, context })).toEqual(
        await local.resolve({ query, context }),
      );
    expect(await remote.workflows.search("plan")).toEqual(
      await local.workflows.search("plan"),
    );
    for (const id of ["clients.create", "plans.create"]) {
      expect(await remote.workflows.get(id)).toEqual(
        await local.workflows.get(id),
      );
      expect(await remote.workflows.getRuntimeManifest(id)).toEqual(
        await local.workflows.getRuntimeManifest(id),
      );
      expect(await remote.workflows.related(id)).toEqual(
        await local.workflows.related(id),
      );
      expect(await remote.workflows.getSupportedActions(id)).toEqual(
        await local.workflows.getSupportedActions(id),
      );
    }
  });

  it("mirrors SDK errors with matching codes and statuses", async () => {
    for (const run of [
      (client: PathCompiler) => client.workflows.get("clients.edit"),
      (client: PathCompiler) => client.workflows.getRuntimeManifest("x/../y"),
      (client: PathCompiler) => client.workflows.related("missing.one"),
    ])
      expect((await failure(run(remote))).code).toBe(
        (await failure(run(local))).code,
      );
    const response = await raw("/v1/help/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "x".repeat(501) }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid-request");
    const missing = await raw("/v1/workflows/clients.edit");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
  });

  it("requires the bearer token", async () => {
    for (const authorization of [
      "",
      "Bearer wrong",
      `Basic ${token}`,
      `Bearer ${token}x`,
    ]) {
      const response = await fetch(`${base}/v1/workflows/clients.create`, {
        headers: { authorization },
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
    }
    const anonymous = new PathCompiler({
      project: "x",
      transport: createHttpTransport({ baseUrl: base }),
    });
    expect(
      (await failure(anonymous.workflows.get("clients.create"))).code,
    ).toBe("unauthorized");
    expect(() =>
      createRequestHandler({ client: local, token: "short" }),
    ).toThrow("16 characters");
  });

  it("rejects malformed HTTP requests with structured errors", async () => {
    const cases: [string, RequestInit, number, string][] = [
      ["/v1/help/resolve", { method: "GET" }, 405, "method-not-allowed"],
      [
        "/v1/workflows/clients.create",
        { method: "POST" },
        405,
        "method-not-allowed",
      ],
      [
        "/v1/help/resolve",
        { method: "POST", body: "{}" },
        415,
        "unsupported-media-type",
      ],
      [
        "/v1/help/resolve",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        },
        400,
        "invalid-json",
      ],
      [
        "/v1/workflows/search",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: "a", extra: 1 }),
        },
        400,
        "invalid-request",
      ],
      [
        "/v1/help/resolve",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: "x".repeat(70_000) }),
        },
        413,
        "payload-too-large",
      ],
      ["/v1/workflows/%E0%A4%A", {}, 400, "invalid-request"],
      ["/v2/anything", {}, 404, "not-found"],
    ];
    for (const [path, init, status, code] of cases) {
      const response = await raw(path, init);
      expect(response.status, path).toBe(status);
      expect((await response.json()).error.code, path).toBe(code);
    }
    expect(
      (await raw("/v1/help/resolve", { method: "GET" })).headers.get("allow"),
    ).toBe("POST");
    expect(errors).toEqual([]);
  });

  it("hides unexpected errors and reports them to the host", async () => {
    const broken = new PathCompiler({
      project: "x",
      transport: {
        resolve: async () => {
          throw new Error("disk exploded at /secret/path");
        },
        getWorkflow: async () => ({}) as never,
        getRuntimeManifest: async () => ({}) as never,
        getRelatedWorkflows: async () => [],
      },
    });
    const seen: unknown[] = [];
    const server = createHttpService({
      client: broken,
      token: null,
      onError: (error) => seen.push(error),
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const response = await fetch(`${url}/v1/help/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "a" }),
      });
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain("secret");
      expect(seen).toHaveLength(1);
      const invalid = await fetch(`${url}/v1/workflows/a`);
      expect(invalid.status).toBe(500);
      expect((await invalid.json()).error.code).toBe("invalid-response");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("validates HTTP transport configuration", () => {
    for (const baseUrl of ["not a url", "ftp://host", "http://user:pass@host"])
      expect(() => createHttpTransport({ baseUrl })).toThrow(PathCompilerError);
  });
});
