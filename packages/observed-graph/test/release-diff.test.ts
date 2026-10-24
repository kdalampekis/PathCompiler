import {
  createEventFactory,
  type ProductRuntimeEvent,
} from "@pathcompiler/observability-core";
import { describe, expect, it } from "vitest";
import { compareReleaseBehavior } from "../src/index.js";

let sequence = 0;
function session(release: string, goals: string[]): ProductRuntimeEvent[] {
  const id = `s-${++sequence}`;
  let counter = 0;
  const create = createEventFactory({
    projectId: "next-demo",
    sessionId: id,
    release,
    now: () => new Date(Date.UTC(2026, 9, 24, 10, 0, counter)),
    nextId: () => `${id}-${++counter}`,
  });
  return [
    create("route.changed", { route: "/clients" }),
    ...goals.map((goalId) => create("goal.reached", { goalId })),
  ];
}
/** `count` sessions of a release; the first `reaching[goal]` of them reach each goal. */
function release(
  name: string,
  count: number,
  reaching: Record<string, number>,
) {
  return Array.from({ length: count }, (_, index) =>
    session(
      name,
      Object.entries(reaching).flatMap(([goal, n]) =>
        index < n ? [goal] : [],
      ),
    ),
  ).flat();
}

describe("release behavior diff", () => {
  const events = [
    ...release("r1", 40, {
      "clients.created": 32,
      "plans.created": 10,
      "clients.deactivated": 20,
    }),
    ...release("r2", 40, {
      "clients.created": 12,
      "plans.created": 30,
      "clients.deactivated": 20,
    }),
  ];

  it("classifies each goal against the formal semantic diff", () => {
    const diff = compareReleaseBehavior(events, "r1", "r2", {
      formalChanges: [
        { goal: "clients.created", direction: "removed" },
        { goal: "clients.deactivated", direction: "removed" },
      ],
    });
    expect(diff.sessions).toEqual({ base: 40, head: 40 });
    expect(
      diff.goals.map((goal) => [
        goal.goal,
        goal.observed,
        goal.formal,
        goal.class,
      ]),
    ).toEqual([
      ["clients.created", "down", "removed", "expected-change"],
      [
        "clients.deactivated",
        "no-change",
        "removed",
        "formal-change-not-observed",
      ],
      ["plans.created", "up", "no-change", "unexplained-behavior-change"],
    ]);
    expect(diff.goals[0]?.base).toMatchObject({
      sessions: 40,
      reaching: 32,
      share: 0.8,
    });
    expect(diff.meaning).toBe("hypothesis");
  });

  it("treats a goal changed in both directions as shifted applicability", () => {
    const diff = compareReleaseBehavior(events, "r1", "r2", {
      formalChanges: [
        { goal: "plans.created", direction: "removed" },
        { goal: "plans.created", direction: "added" },
      ],
    });
    expect(
      diff.goals.find((goal) => goal.goal === "plans.created"),
    ).toMatchObject({
      formal: "changed",
      observed: "up",
      class: "expected-change",
    });
  });

  it("compares behavior only without a formal diff, and refuses thin samples", () => {
    const behavior = compareReleaseBehavior(events, "r1", "r2");
    expect(behavior.goals.every((goal) => goal.formal === "not-compared")).toBe(
      true,
    );
    expect(
      behavior.goals.find((goal) => goal.goal === "plans.created")?.class,
    ).toBe("unexplained-behavior-change");
    const thin = compareReleaseBehavior(
      [...release("a", 5, { "clients.created": 5 }), ...release("b", 5, {})],
      "a",
      "b",
    );
    expect(thin.goals).toEqual([
      expect.objectContaining({
        goal: "clients.created",
        class: "insufficient-data",
      }),
    ]);
  });
});
