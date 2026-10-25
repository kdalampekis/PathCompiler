import {
  createEventFactory,
  type ProductRuntimeEvent,
} from "@pathcompiler/observability-core";
import { describe, expect, it } from "vitest";
import {
  buildObservedGraph,
  buildTransitionModel,
  checkGoal,
  checkReachProperty,
  compareReach,
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
const model = (reaching: number, leaving: number, prefix = "") =>
  buildTransitionModel(
    buildObservedGraph([
      ...Array.from({ length: reaching }, (_, index) =>
        session(`${prefix}r-${index}`, true),
      ).flat(),
      ...Array.from({ length: leaving }, (_, index) =>
        session(`${prefix}l-${index}`, false),
      ).flat(),
    ]),
  );

describe("probabilistic model checking", () => {
  it("bounds completion and abandonment and estimates expected transitions", () => {
    const check = checkGoal(model(300, 100), "clients.created");
    expect(check.reach.point).toBe(0.75);
    expect(check.reach.lower).toBeGreaterThan(0.65);
    expect(check.reach.lower).toBeLessThan(0.75);
    expect(check.reach.upper).toBeGreaterThan(0.75);
    expect(check.reach.upper).toBeLessThan(0.85);
    // Fewer sessions, wider bounds; one session decides nothing.
    const small = checkGoal(model(30, 10), "clients.created").reach;
    expect(small.upper - small.lower).toBeGreaterThan(
      check.reach.upper - check.reach.lower,
    );
    const one = checkGoal(model(1, 0), "clients.created").reach;
    expect(one.point).toBe(1);
    expect(one.lower).toBeLessThan(0.5);
    expect(check.abandonment).toEqual({
      point: 0.25,
      lower: Math.round((1 - check.reach.upper) * 10_000) / 10_000,
      upper: Math.round((1 - check.reach.lower) * 10_000) / 10_000,
    });
    // session start → route → target → goal.
    expect(check.expectedTransitions).toBe(3);
    expect(check.sufficient).toBe(true);
  });

  it("decides a property only when the whole interval agrees", () => {
    const observed = model(300, 100);
    const verdict = (op: "at-least" | "at-most", bound: number) =>
      checkReachProperty(observed, { goal: "clients.created", op, bound })
        .verdict;
    expect(verdict("at-least", 0.5)).toBe("satisfied");
    expect(verdict("at-least", 0.75)).toBe("inconclusive");
    expect(verdict("at-least", 0.95)).toBe("violated");
    expect(verdict("at-most", 0.95)).toBe("satisfied");
    expect(verdict("at-most", 0.5)).toBe("violated");
    // Five sessions: anything in between stays inconclusive.
    expect(
      checkReachProperty(model(4, 1), {
        goal: "clients.created",
        op: "at-least",
        bound: 0.5,
      }).verdict,
    ).toBe("inconclusive");
    expect(() =>
      checkReachProperty(observed, {
        goal: "clients.created",
        op: "at-least",
        bound: 2,
      }),
    ).toThrow("between 0 and 1");
  });

  it("reports a redesign's change in completion only beyond sample noise", () => {
    expect(
      compareReach(model(200, 200, "b"), model(360, 40, "h"), "clients.created")
        .direction,
    ).toBe("increased");
    expect(
      compareReach(model(360, 40, "b"), model(200, 200, "h"), "clients.created")
        .direction,
    ).toBe("decreased");
    expect(
      compareReach(model(3, 2, "b"), model(4, 1, "h"), "clients.created")
        .direction,
    ).toBe("no-detectable-change");
    expect(() => checkGoal(model(0, 5), "clients.created")).toThrow(
      "No observed session reached clients.created",
    );
  });
});
