import type { ProductRuntimeEvent } from "@pathcompiler/observability-core";
import { describe, expect, it } from "vitest";
import {
  type AnalyticsOptions,
  type AnalyticsTransport,
  ConsoleTransport,
  createAnalytics,
  InMemoryTransport,
} from "../src/index.js";

function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 0;
  return {
    timers: {
      setTimeout(callback: () => void) {
        next += 1;
        pending.set(next, callback);
        return next;
      },
      clearTimeout(handle: unknown) {
        pending.delete(handle as number);
      },
    },
    /** Runs every due timer callback once. */
    fire() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    get count() {
      return pending.size;
    },
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const workflow = { workflowId: "clients.create", workflowVersion: 2 };
function setup(overrides: Partial<AnalyticsOptions> = {}) {
  const transport = new InMemoryTransport();
  const clock = fakeTimers();
  const errors: Error[] = [];
  let id = 0;
  const analytics = createAnalytics({
    projectId: "next-demo",
    release: "2026.10.1",
    sessionId: "s-1",
    policy: { enabled: true },
    transport,
    batchSize: 3,
    flushIntervalMs: 1000,
    timers: clock.timers,
    now: () => new Date("2026-10-23T12:00:00.000Z"),
    nextId: () => `evt-${++id}`,
    onError: (error) => errors.push(error),
    ...overrides,
  });
  return { analytics, transport, clock, errors };
}

describe("analytics SDK", () => {
  it("does nothing unless analytics is enabled", async () => {
    const { analytics, transport, clock } = setup({ policy: {} });
    expect(analytics.enabled).toBe(false);
    analytics.workflowStarted(workflow, "guide");
    analytics.goalReached("clients.created");
    await analytics.flush();
    expect(transport.batches).toEqual([]);
    expect(clock.count).toBe(0);
    expect(analytics.stats()).toEqual({
      queued: 0,
      sent: 0,
      rejected: 0,
      dropped: 0,
      failedSends: 0,
    });
  });

  it("batches by size and by interval, binding release and sticky context", async () => {
    const { analytics, transport, clock } = setup();
    analytics.setContext({ route: "/clients", role: "editor" });
    analytics.workflowStarted(workflow, "guide");
    analytics.workflowStepReached(workflow, "step.1", 0);
    expect(transport.batches).toHaveLength(0);
    expect(clock.count).toBe(1);
    analytics.targetActivated("clients.create", "click");
    await settle();
    expect(transport.batches.map((batch) => batch.length)).toEqual([3]);
    expect(clock.count).toBe(0);
    analytics.routeChanged("/plans", "/clients");
    analytics.workflowCompleted(workflow, 4200);
    clock.fire();
    await settle();
    expect(transport.batches.map((batch) => batch.length)).toEqual([3, 2]);
    const [first, , third] = transport.events;
    expect(first).toEqual({
      ...workflow,
      type: "workflow.started",
      trigger: "guide",
      schemaVersion: 1,
      eventId: "evt-1",
      timestamp: "2026-10-23T12:00:00.000Z",
      projectId: "next-demo",
      sessionId: "s-1",
      release: "2026.10.1",
      route: "/clients",
      role: "editor",
      privacy: { pii: false, userIdHashed: false },
    });
    expect(third).toMatchObject({
      type: "semantic_target.activated",
      semanticTarget: "clients.create",
      interaction: "click",
    });
    // A call's own fields win over the sticky context.
    expect(transport.events[3]).toMatchObject({
      type: "route.changed",
      route: "/plans",
      previousRoute: "/clients",
    });
    expect(analytics.stats()).toMatchObject({ queued: 0, sent: 5 });
  });

  it("rejects events that break the privacy policy without throwing", async () => {
    const { analytics, transport, errors } = setup();
    analytics.track("goal.reached", {
      goalId: "clients.created",
      context: { plan_tier: "pro" },
    });
    analytics.setContext({ anonymousUserId: "user-42" });
    analytics.actionBlocked("plans.change_structure", "permission");
    await analytics.flush();
    expect(transport.events).toEqual([]);
    expect(analytics.stats().rejected).toBe(2);
    expect(errors.map((error) => error.message)).toEqual([
      expect.stringContaining("not in the policy's allowedContextKeys"),
      expect.stringContaining("anonymousUserId must be hashed"),
    ]);
    const allowed = setup({
      policy: { enabled: true, allowedContextKeys: ["plan_tier"] },
    });
    allowed.analytics.track("goal.reached", {
      goalId: "clients.created",
      context: { plan_tier: "pro" },
    });
    await allowed.analytics.flush();
    expect(allowed.transport.events).toHaveLength(1);
  });

  it("keeps failed batches for a later attempt within the queue bound", async () => {
    let fail = true;
    const sent: ProductRuntimeEvent[][] = [];
    const flaky: AnalyticsTransport = {
      async send(events) {
        if (fail) throw new Error("offline");
        sent.push(events);
      },
    };
    const { analytics, errors } = setup({
      transport: flaky,
      batchSize: 2,
      maxQueue: 3,
    });
    analytics.goalReached("clients.created");
    analytics.goalReached("plans.created");
    await settle();
    expect(errors[0]?.message).toBe(
      "Transport failed to send 2 events; they will be retried.",
    );
    expect(analytics.stats()).toMatchObject({ queued: 2, failedSends: 1 });
    analytics.routeChanged("/a");
    analytics.routeChanged("/b");
    await settle();
    expect(analytics.stats().dropped).toBeGreaterThan(0);
    expect(analytics.stats().queued).toBeLessThanOrEqual(3);
    fail = false;
    await analytics.flush();
    await analytics.flush();
    expect(sent.flat().length).toBe(3);
    expect(analytics.stats().queued).toBe(0);
  });

  it("writes canonical lines with the console transport and stops on shutdown", async () => {
    const lines: string[] = [];
    const { analytics } = setup({
      transport: new ConsoleTransport((line) => lines.push(line)),
    });
    analytics.goalReached("clients.created", "clients.create");
    await analytics.shutdown();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      type: "goal.reached",
      goalId: "clients.created",
    });
    expect(lines[0]?.startsWith('{"capabilityId":"clients.create"')).toBe(true);
    analytics.goalReached("plans.created");
    await analytics.flush();
    expect(lines).toHaveLength(1);
  });
});
