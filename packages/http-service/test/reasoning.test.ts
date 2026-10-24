import type { AddressInfo } from "node:net";
import { PathCompiler, type RuntimeTransport } from "@pathcompiler/sdk-js";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpService, type HttpServiceOptions } from "../src/index.js";

const token = "api-token-0123456789";
const developer = "developer-token-0123456789";
const unused = async () => {
  throw new Error("unused");
};
const client = new PathCompiler({
  project: "next-demo",
  transport: {
    resolve: unused,
    getWorkflow: unused,
    getRuntimeManifest: unused,
    getRelatedWorkflows: unused,
  } as RuntimeTransport,
});
const calls: { operation: string; input: unknown }[] = [];
const service = {
  async handle(operation: string, input: unknown) {
    calls.push({ operation, input });
    if (operation === "plan") {
      const error = new Error("Unknown goal nope.");
      error.name = "ReasoningRequestError";
      throw error;
    }
    return { status: "reachable", goal: "clients.created" };
  },
};
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  calls.length = 0;
});
async function start(options: Partial<HttpServiceOptions> = {}) {
  const server = createHttpService({ client, token, ...options });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const post = (url: string, bearer: string, body: unknown = {}) =>
  fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });

describe("developer reasoning endpoints", () => {
  it("are off unless configured", async () => {
    const base = await start();
    const response = await post(`${base}/v1/reason/reachability`, token);
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("reasoning-disabled");
  });

  it("accept only the developer token, which works nowhere else", async () => {
    const base = await start({ reasoning: { token: developer, service } });
    const ok = await post(`${base}/v1/reason/reachability`, developer, {
      goal: "clients.created",
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      status: "reachable",
      goal: "clients.created",
    });
    expect(calls).toEqual([
      { operation: "reachability", input: { goal: "clients.created" } },
    ]);
    // The end-user API token never reaches reasoning…
    const user = await post(`${base}/v1/reason/reachability`, token);
    expect(user.status).toBe(401);
    expect((await user.json()).error.code).toBe("developer-token-required");
    // …and the developer token is refused on product endpoints.
    const product = await post(`${base}/v1/help/resolve`, developer, {
      query: "x",
    });
    expect(product.status).toBe(403);
    expect((await product.json()).error.code).toBe(
      "developer-token-not-accepted",
    );
    // Request errors are 400s with the service's message.
    const bad = await post(`${base}/v1/reason/plan`, developer, {
      goal: "nope",
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toEqual({
      code: "invalid-request",
      message: "Unknown goal nope.",
    });
    const get = await fetch(`${base}/v1/reason/plan`, {
      headers: { authorization: `Bearer ${developer}` },
    });
    expect(get.status).toBe(405);
  });

  it("require the developer token even when the API runs without one", async () => {
    const base = await start({
      token: null,
      reasoning: { token: developer, service },
    });
    expect((await post(`${base}/v1/reason/reachability`, "")).status).toBe(401);
    expect(
      (await post(`${base}/v1/reason/reachability`, developer)).status,
    ).toBe(200);
  });

  it("refuse weak or shared developer tokens", () => {
    expect(() =>
      createHttpService({
        client,
        token,
        reasoning: { token: "short", service },
      }),
    ).toThrow("Use a developer token of at least 16 characters.");
    expect(() =>
      createHttpService({ client, token, reasoning: { token, service } }),
    ).toThrow(
      "The developer token must differ from the API and ingest tokens.",
    );
  });
});
