import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createAnalytics, FetchTransport } from "@pathcompiler/analytics-sdk";
import { parseEvents } from "@pathcompiler/observability-core";
import { PathCompiler, type RuntimeTransport } from "@pathcompiler/sdk-js";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFileEventSink,
  createHttpService,
  type HttpServiceOptions,
  InMemoryEventSink,
} from "../src/index.js";

const token = "api-token-0123456789";
const ingestToken = "ingest-token-0123456789";
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
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});
async function start(events?: HttpServiceOptions["events"]) {
  const server = createHttpService({
    client,
    token,
    ...(events ? { events } : {}),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/events/batch`;
}
const post = (url: string, body: unknown, bearer = ingestToken) =>
  fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });
const event = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  eventId: "evt-1",
  timestamp: "2026-10-23T10:00:00.000Z",
  projectId: "next-demo",
  sessionId: "s-1",
  privacy: { pii: false, userIdHashed: false },
  type: "goal.reached",
  goalId: "clients.created",
  ...overrides,
});

describe("event ingestion", () => {
  it("is off unless configured", async () => {
    const url = await start();
    const response = await post(url, { events: [] }, token);
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("ingestion-disabled");
  });

  it("accepts valid events, refuses privacy violations and other projects per event", async () => {
    const sink = new InMemoryEventSink();
    const url = await start({ sink, ingestToken });
    const response = await post(url, {
      events: [
        event(),
        event({ eventId: "evt-2", context: { email: "a@b.c" } }),
        event({ eventId: "evt-3", projectId: "other" }),
        event({ eventId: "evt-4", value: "Ada" }),
      ],
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(1);
    expect(body.rejected.map((item: { index: number }) => item.index)).toEqual([
      1, 2, 3,
    ]);
    expect(body.rejected[0].issues[0]).toContain("context.email");
    expect(body.rejected[1].issues[0]).toBe(
      "projectId other does not match next-demo",
    );
    expect(sink.events.get("next-demo")?.map((item) => item.eventId)).toEqual([
      "evt-1",
    ]);
    expect(sink.events.has("other")).toBe(false);
  });

  it("limits the ingest token to events, and enforces batch and rate limits", async () => {
    let now = 0;
    const url = await start({
      sink: new InMemoryEventSink(),
      ingestToken,
      maxBatch: 3,
      rateLimit: { events: 4, windowMs: 60_000 },
      now: () => now,
    });
    const resolve = await fetch(
      url.replace("/v1/events/batch", "/v1/help/resolve"),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ingestToken}`,
        },
        body: JSON.stringify({ query: "x" }),
      },
    );
    expect(resolve.status).toBe(401);
    expect(
      (await post(url, { events: [] }, "wrong-token-0123456789")).status,
    ).toBe(401);
    expect((await post(url, { events: [event()] }, token)).status).toBe(200);
    expect((await post(url, { nope: true })).status).toBe(400);
    expect(
      (await post(url, { events: [event(), event(), event(), event()] }))
        .status,
    ).toBe(413);
    expect(
      (await post(url, { events: [event(), event(), event()] })).status,
    ).toBe(200);
    const limited = await post(url, { events: [event()] });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    now = 60_000;
    expect((await post(url, { events: [event()] })).status).toBe(200);
  });

  it("stores canonical NDJSON per project and day", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "pathcompiler-events-"),
    );
    closers.push(() => rm(directory, { recursive: true, force: true }));
    const url = await start({
      sink: createFileEventSink(directory),
      ingestToken,
    });
    await post(url, {
      events: [
        event(),
        event({ eventId: "evt-2", timestamp: "2026-10-24T00:00:01.000Z" }),
      ],
    });
    const folder = path.join(directory, "next-demo");
    expect((await readdir(folder)).sort()).toEqual([
      "2026-10-23.ndjson",
      "2026-10-24.ndjson",
    ]);
    const stored = parseEvents(
      await readFile(path.join(folder, "2026-10-23.ndjson"), "utf8"),
    );
    expect(stored.map((item) => item.eventId)).toEqual(["evt-1"]);
  });

  it("receives batches from the analytics SDK's fetch transport", async () => {
    const sink = new InMemoryEventSink();
    const url = await start({ sink, ingestToken });
    const rejected: string[] = [];
    // The server's policy is stricter than the client's, so one event is refused there.
    const analytics = createAnalytics({
      projectId: "next-demo",
      release: "2026.10.1",
      policy: { enabled: true, allowedContextKeys: ["plan_tier"] },
      transport: new FetchTransport({
        url,
        token: ingestToken,
        onRejected: ({ reason }) => rejected.push(reason),
      }),
      batchSize: 10,
    });
    analytics.workflowStarted(
      { workflowId: "clients.create", workflowVersion: 1 },
      "guide",
    );
    analytics.track("goal.reached", {
      goalId: "clients.created",
      context: { plan_tier: "pro" },
    });
    await analytics.flush();
    expect(sink.events.get("next-demo")?.map((item) => item.type)).toEqual([
      "workflow.started",
    ]);
    expect(rejected[0]).toContain("context.plan_tier is not in the policy");
    expect(analytics.stats()).toMatchObject({ sent: 2, queued: 0 });
  });
});
