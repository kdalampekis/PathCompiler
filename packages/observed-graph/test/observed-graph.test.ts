import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createEventFactory,
  type ProductRuntimeEvent,
  serializeEvent,
} from "@pathcompiler/observability-core";
import { describe, expect, it } from "vitest";
import {
  buildObservedGraph,
  readEventDirectory,
  SESSION_END,
  SESSION_START,
} from "../src/index.js";

const workflow = { workflowId: "clients.create", workflowVersion: 1 };
/** One session: steps at one-second intervals from `start`. */
function session(
  id: string,
  steps: ((
    create: ReturnType<typeof createEventFactory>,
  ) => ProductRuntimeEvent)[],
  options: { release?: string; start?: number } = {},
): ProductRuntimeEvent[] {
  let clock = options.start ?? Date.parse("2026-10-23T10:00:00.000Z");
  let counter = 0;
  const create = createEventFactory({
    projectId: "next-demo",
    sessionId: id,
    release: options.release ?? "r1",
    now: () => {
      const date = new Date(clock);
      clock += 1000;
      return date;
    },
    nextId: () => `${id}-${++counter}`,
  });
  return steps.map((step) => step(create));
}
const clients = (create: ReturnType<typeof createEventFactory>) =>
  create("route.changed", { route: "/clients", role: "editor" });
const open = (create: ReturnType<typeof createEventFactory>) =>
  create("semantic_target.activated", {
    semanticTarget: "clients.create",
    interaction: "click",
    role: "editor",
  });
const created = (create: ReturnType<typeof createEventFactory>) =>
  create("goal.reached", { goalId: "clients.created", role: "editor" });
const plans = (create: ReturnType<typeof createEventFactory>) =>
  create("route.changed", { route: "/plans", role: "viewer" });

describe("observed transition graph", () => {
  const events = [
    ...session("a", [clients, open, open, created]),
    ...session("b", [clients, open, created]),
    ...session("c", [clients, plans], { release: "r2" }),
  ];

  it("counts transitions, sessions, frequencies and median times", () => {
    const graph = buildObservedGraph(events, { minSessions: 2 });
    expect(graph).toMatchObject({ events: 9, sessions: 3 });
    const edge = (from: string, to: string) =>
      graph.edges.find((item) => item.from === from && item.to === to);
    expect(edge(SESSION_START, "route:/clients")).toMatchObject({
      count: 3,
      sessions: 3,
      frequency: 1,
      medianMs: null,
    });
    // Two of the three sessions continue from the Clients page to "create".
    expect(edge("route:/clients", "target:clients.create:click")).toMatchObject(
      {
        count: 2,
        frequency: 0.667,
        medianMs: 1000,
        byRole: { editor: 2 },
        sufficient: true,
      },
    );
    expect(edge("route:/clients", "route:/plans")).toMatchObject({
      count: 1,
      frequency: 0.333,
      byRelease: { r2: 1 },
      byRole: { viewer: 1 },
      sufficient: false,
    });
    // The repeated click in session a is not a transition; its goal came 2 s later.
    expect(
      edge("target:clients.create:click", "goal:clients.created"),
    ).toMatchObject({
      count: 2,
      medianMs: 1500,
    });
    expect(edge("goal:clients.created", SESSION_END)?.count).toBe(2);
    expect(
      graph.nodes.find((node) => node.id === "target:clients.create:click"),
    ).toEqual({
      id: "target:clients.create:click",
      kind: "target",
      count: 2,
      sessions: 2,
    });
    expect(graph.paths[0]).toEqual({
      states: [
        SESSION_START,
        "route:/clients",
        "target:clients.create:click",
        "goal:clients.created",
        SESSION_END,
      ],
      sessions: 2,
    });
  });

  it("is independent of input order and filters by release and workflow", () => {
    const graph = buildObservedGraph(events);
    expect(buildObservedGraph([...events].reverse())).toEqual(graph);
    const r2 = buildObservedGraph(events, { release: "r2" });
    expect(r2).toMatchObject({ sessions: 1, filter: { release: "r2" } });
    expect(r2.edges.every((edge) => edge.byRelease.r2 === edge.count)).toBe(
      true,
    );
    const lifecycle = buildObservedGraph(
      session("g", [
        (create) =>
          create("workflow.started", { ...workflow, trigger: "guide" }),
        (create) =>
          create("workflow.step_reached", { ...workflow, stepId: "step.1" }),
        (create) => create("workflow.completed", workflow),
        clients,
      ]),
      { workflowId: "clients.create" },
    );
    expect(lifecycle.nodes.map((node) => node.id)).toEqual([
      SESSION_END,
      SESSION_START,
      "step:clients.create@1:step.1",
      "workflow:clients.create@1:completed",
      "workflow:clients.create@1:started",
    ]);
  });

  it("reads the NDJSON files written by the ingestion sink", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "pathcompiler-observed-"),
    );
    try {
      await writeFile(
        path.join(directory, "2026-10-23.ndjson"),
        `${events.slice(0, 4).map(serializeEvent).join("\n")}\n`,
      );
      await writeFile(
        path.join(directory, "2026-10-24.ndjson"),
        `${events.slice(4).map(serializeEvent).join("\n")}\n`,
      );
      await writeFile(path.join(directory, "notes.txt"), "ignored");
      expect(await readEventDirectory(directory)).toEqual(events);
      expect(await readEventDirectory(path.join(directory, "missing"))).toEqual(
        [],
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
