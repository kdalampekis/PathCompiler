import {
  createEventFactory,
  type ProductRuntimeEvent,
} from "@pathcompiler/observability-core";
import { describe, expect, it } from "vitest";
import { computeWorkflowAnalytics } from "../src/index.js";

const workflow = { workflowId: "clients.create", workflowVersion: 2 };
type Create = ReturnType<typeof createEventFactory>;
/** A session whose events are one second apart. */
function session(
  id: string,
  steps: ((create: Create) => ProductRuntimeEvent)[],
  release = "r1",
): ProductRuntimeEvent[] {
  let clock = Date.parse("2026-10-23T10:00:00.000Z");
  let counter = 0;
  const create = createEventFactory({
    projectId: "demo",
    sessionId: id,
    release,
    now: () => {
      clock += 1000;
      return new Date(clock);
    },
    nextId: () => `${id}-${++counter}`,
  });
  return steps.map((step) => step(create));
}
const start =
  (role = "editor") =>
  (create: Create) =>
    create("workflow.started", { ...workflow, trigger: "guide", role });
const step = (stepId: string) => (create: Create) =>
  create("workflow.step_reached", { ...workflow, stepId });
const click = (create: Create) =>
  create("semantic_target.activated", {
    semanticTarget: "clients.create",
    interaction: "click",
  });
const done = (durationMs?: number) => (create: Create) =>
  create("workflow.completed", {
    ...workflow,
    ...(durationMs === undefined ? {} : { durationMs }),
  });
const quit = (create: Create) =>
  create("workflow.abandoned", {
    ...workflow,
    reason: "stopped",
    lastStepId: "step.1",
  });

describe("workflow analytics", () => {
  const events = [
    ...session("a", [
      start(),
      step("step.1"),
      click,
      step("step.2"),
      click,
      done(4000),
    ]),
    ...session("b", [start(), step("step.1"), click, done(2000)]),
    ...session("c", [start("viewer"), step("step.1"), quit]),
    ...session("d", [start(), step("step.1")], "r2"),
    ...session("e", [start(), step("step.1"), click, done()]),
  ];

  it("reconstructs runs and reports counts, durations, actions and the step funnel", () => {
    const report = computeWorkflowAnalytics(events, {
      minRuns: 3,
      minSegmentSize: 2,
    });
    expect(report.workflows).toHaveLength(1);
    const [analytics] = report.workflows;
    expect(analytics).toMatchObject({
      ...workflow,
      starts: 5,
      byTrigger: { guide: 5 },
      completions: 3,
      abandonments: 1,
      byAbandonReason: { stopped: 1 },
      unfinished: 1,
      completionRate: 0.6,
      // Run e has no reported duration: measured from its start, 3 s later.
      medianDurationMs: 3000,
      p95DurationMs: 4000,
      medianActionCount: 1,
      steps: [
        { stepId: "step.1", runs: 5 },
        { stepId: "step.2", runs: 1 },
      ],
      sufficient: true,
    });
    expect(analytics?.byRole).toEqual([
      { value: "editor", starts: 4, completions: 3, completionRate: 0.75 },
      {
        value: "(suppressed)",
        starts: 1,
        completions: 0,
        completionRate: null,
      },
    ]);
    expect(analytics?.byRelease.map((item) => item.value)).toEqual([
      "r1",
      "(suppressed)",
    ]);
  });

  it("withholds rates below the sample threshold and filters by release", () => {
    const report = computeWorkflowAnalytics(events);
    expect(report).toMatchObject({ minRuns: 30, minSegmentSize: 5 });
    expect(report.workflows[0]).toMatchObject({
      starts: 5,
      completions: 3,
      completionRate: null,
      sufficient: false,
    });
    expect(report.workflows[0]?.byRole).toEqual([
      {
        value: "(suppressed)",
        starts: 5,
        completions: 3,
        completionRate: null,
      },
    ]);
    expect(
      computeWorkflowAnalytics(events, { release: "r2" }).workflows[0],
    ).toMatchObject({ starts: 1, unfinished: 1 });
  });

  it("closes a run restarted in the same session as unfinished", () => {
    const report = computeWorkflowAnalytics(
      session("f", [
        start(),
        step("step.1"),
        start(),
        step("step.1"),
        done(1000),
      ]),
      { minRuns: 1 },
    );
    expect(report.workflows[0]).toMatchObject({
      starts: 2,
      completions: 1,
      unfinished: 1,
      completionRate: 0.5,
    });
  });
});
