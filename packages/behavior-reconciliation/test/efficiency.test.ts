import {
  createEventFactory,
  type ProductRuntimeEvent,
} from "@pathcompiler/observability-core";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nextDemoFormalModel } from "../../formal-model/test/next-demo-model.js";
import {
  computePathEfficiency,
  type PathEfficiencyReport,
} from "../src/index.js";

let solver: SolverProvider;
let report: PathEfficiencyReport;
function session(
  id: string,
  role: string,
  detours: number,
): ProductRuntimeEvent[] {
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
      role,
    });
  return [
    create("route.changed", { route: "/clients", role }),
    // A detour: open the dialog and close it again.
    ...Array.from({ length: detours }, () => [
      activate("clients.create"),
      activate("dialog.close"),
    ]).flat(),
    activate("clients.create"),
    activate("client.form.name"),
    activate("client.form.email"),
    activate("client.form.submit"),
    create("goal.reached", { goalId: "clients.created", role }),
  ];
}

beforeAll(async () => {
  solver = await createZ3SolverProvider();
  const events = [
    ...Array.from({ length: 15 }, (_, index) =>
      session(`direct-${index}`, "editor", 0),
    ).flat(),
    ...Array.from({ length: 20 }, (_, index) =>
      session(`detour-${index}`, "editor", 2),
    ).flat(),
    ...session("viewer-1", "viewer", 0),
    ...session("viewer-2", "viewer", 0),
  ];
  report = await computePathEfficiency(
    nextDemoFormalModel("abc"),
    events,
    solver,
  );
}, 120_000);
afterAll(async () => {
  await solver?.close();
});

describe("path efficiency", () => {
  it("divides the median observed cost by the cheapest formal path", () => {
    const editor = report.items.find((item) => item.role === "editor");
    expect(editor).toMatchObject({
      goal: "clients.created",
      completions: 35,
      sessions: 35,
      // 15 direct sessions cost 5, 20 detours cost 9: the median is 9.
      observedCost: { median: 9, min: 5, max: 9 },
      minimumFormalCost: 5,
      ratio: 1.8,
      insufficientData: false,
    });
    expect(editor?.formalPath).toEqual([
      "nav.open_clients",
      "clients.open_create_form",
      "clients.enter_email",
      "clients.enter_name",
      "clients.submit_create",
    ]);
    expect(report.friction).toEqual([
      { goal: "clients.created", role: "editor", ratio: 1.8 },
    ]);
    expect(report).toMatchObject({
      meaning: "hypothesis",
      unit: "interactions",
    });
  });

  it("does not report a ratio for small samples or formally impossible paths", () => {
    const viewer = report.items.find((item) => item.role === "viewer");
    expect(viewer).toMatchObject({
      completions: 2,
      insufficientData: true,
      minimumFormalCost: null,
      ratio: null,
    });
  });
});
