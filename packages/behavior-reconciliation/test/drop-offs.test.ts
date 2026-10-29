import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import {
  createEventFactory,
  type ProductRuntimeEvent,
} from "@pathcompiler/observability-core";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nextDemoFormalModel } from "../../formal-model/test/next-demo-model.js";
import { analyzeDropOffs, type DropOffReport } from "../src/index.js";

let solver: SolverProvider;
let report: DropOffReport;
let model: Parameters<typeof analyzeDropOffs>[0];
function session(id: string, completes: boolean): ProductRuntimeEvent[] {
  let counter = 0;
  const create = createEventFactory({
    projectId: "demo",
    sessionId: id,
    now: () => new Date(Date.UTC(2026, 9, 24, 10, 0, counter)),
    nextId: () => `${id}-${String(++counter).padStart(3, "0")}`,
  });
  const activate = (semanticTarget: string) =>
    create("semantic_target.activated", {
      semanticTarget,
      interaction: "click",
      role: "editor",
    });
  return [
    create("route.changed", { route: "/clients", role: "editor" }),
    activate("clients.deactivate"),
    ...(completes
      ? [
          activate("client.deactivate.confirm"),
          create("goal.reached", {
            goalId: "clients.deactivated",
            role: "editor",
          }),
        ]
      : []),
  ];
}

beforeAll(async () => {
  solver = await createZ3SolverProvider();
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  model = buildFormalModel(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).model;
  const events = [
    ...Array.from({ length: 20 }, (_, index) =>
      session(`done-${index}`, true),
    ).flat(),
    ...Array.from({ length: 15 }, (_, index) =>
      session(`left-${index}`, false),
    ).flat(),
  ];
  report = await analyzeDropOffs(model, events, solver);
}, 300_000);
afterAll(async () => {
  await solver?.close();
});

describe("drop-offs and alternative paths", () => {
  it("finds where attempts end and suggests routes around the friction", () => {
    expect(report.items).toEqual([
      {
        goal: "clients.deactivated",
        capabilityId: "clients.deactivate",
        role: "editor",
        attempts: 35,
        completions: 20,
        dropOffs: 15,
        dropOffRate: 0.429,
        points: [{ target: "clients.deactivate", sessions: 15, share: 0.429 }],
        friction: [
          {
            target: "clients.deactivate",
            share: 0.429,
            alternatives: [
              [
                "clients.edit",
                "client.form.deactivate",
                "client.deactivate.confirm",
              ],
            ],
          },
        ],
      },
    ]);
    expect(report.meaning).toBe("hypothesis");
  });

  it("reports no rates or friction below the attempt threshold", async () => {
    const small = await analyzeDropOffs(
      nextDemoFormalModel("abc"),
      session("one", false).map((event) =>
        event.type === "semantic_target.activated"
          ? { ...event, semanticTarget: "clients.create" }
          : event,
      ),
      solver,
    );
    expect(small.items).toEqual([
      expect.objectContaining({
        goal: "clients.created",
        attempts: 1,
        dropOffs: 1,
        dropOffRate: null,
        friction: [],
      }),
    ]);
  }, 120_000);

  it("does not count shared targets as attempts at another capability (#32)", async () => {
    // Sessions that edit a client and finish. Targets the edit form shares
    // with Deactivate Client must not start deactivate attempts.
    const editing = (id: string): ProductRuntimeEvent[] => {
      let counter = 0;
      const create = createEventFactory({
        projectId: "demo",
        sessionId: id,
        now: () => new Date(Date.UTC(2026, 9, 24, 10, 0, counter)),
        nextId: () => `${id}-${String(++counter).padStart(3, "0")}`,
      });
      return [
        create("semantic_target.activated", {
          semanticTarget: "clients.edit",
          interaction: "click",
          role: "editor",
        }),
        create("semantic_target.activated", {
          semanticTarget: "client.form.submit",
          interaction: "click",
          role: "editor",
        }),
        create("goal.reached", { goalId: "clients.edited", role: "editor" }),
      ];
    };
    const edits = await analyzeDropOffs(
      model,
      Array.from({ length: 40 }, (_, index) => editing(`edit-${index}`)).flat(),
      solver,
    );
    expect(
      edits.items.map((item) => [item.goal, item.attempts, item.dropOffs]),
    ).toEqual([["clients.edited", 40, 0]]);
  });
});
