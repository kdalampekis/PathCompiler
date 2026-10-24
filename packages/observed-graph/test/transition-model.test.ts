import {
  createEventFactory,
  type ProductRuntimeEvent,
} from "@pathcompiler/observability-core";
import { describe, expect, it } from "vitest";
import {
  buildObservedGraph,
  buildTransitionModel,
  SESSION_START,
  wilsonInterval,
} from "../src/index.js";

function session(id: string, reaches: boolean): ProductRuntimeEvent[] {
  let counter = 0;
  const create = createEventFactory({
    projectId: "next-demo",
    sessionId: id,
    now: () => new Date(Date.UTC(2026, 9, 24, 10, 0, counter)),
    nextId: () => `${id}-${++counter}`,
  });
  return [
    create("route.changed", { route: "/clients" }),
    create("semantic_target.activated", {
      semanticTarget: "clients.create",
      interaction: "click",
    }),
    ...(reaches ? [create("goal.reached", { goalId: "clients.created" })] : []),
  ];
}
const events = (reaching: number, leaving: number) => [
  ...Array.from({ length: reaching }, (_, index) =>
    session(`r-${index}`, true),
  ).flat(),
  ...Array.from({ length: leaving }, (_, index) =>
    session(`l-${index}`, false),
  ).flat(),
];

describe("probabilistic transition model", () => {
  it("estimates transition probabilities with intervals and goal reach", () => {
    const model = buildTransitionModel(buildObservedGraph(events(30, 10)));
    expect(model).toMatchObject({ meaning: "estimate", sessions: 40 });
    const target = model.states.find(
      (state) => state.id === "target:clients.create:click",
    );
    expect(target).toMatchObject({
      total: 40,
      sufficient: true,
      absorbing: false,
    });
    expect(target?.transitions).toEqual([
      {
        to: "goal:clients.created",
        count: 30,
        probability: 0.75,
        interval: wilsonInterval(30, 40),
      },
      {
        to: "session:end",
        count: 10,
        probability: 0.25,
        interval: wilsonInterval(10, 40),
      },
    ]);
    const [low, high] = wilsonInterval(30, 40);
    expect(low).toBeGreaterThan(0.59);
    expect(high).toBeLessThan(0.86);
    expect(model.goals).toEqual([
      { goal: "clients.created", probability: 0.75, sufficient: true },
    ]);
    expect(
      model.states.find((state) => state.id === SESSION_START)?.total,
    ).toBe(40);
  });

  it("flags small samples instead of trusting them", () => {
    const model = buildTransitionModel(buildObservedGraph(events(4, 1)));
    expect(model.goals).toEqual([
      { goal: "clients.created", probability: 0.8, sufficient: false },
    ]);
    expect(wilsonInterval(0, 0)).toEqual([0, 1]);
  });
});
