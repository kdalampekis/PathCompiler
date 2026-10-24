import type { ProductRuntimeEvent } from "@pathcompiler/observability-core";
import { describe, expect, it } from "vitest";
import {
  type AnalyticsOptions,
  type AnalyticsTransport,
  ConsoleTransport,
  createAnalytics,
  type GuideStateLike,
  InMemoryTransport,
  instrumentGuide,
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

describe("guide telemetry", () => {
  function fakeGuide() {
    let listener: ((state: GuideStateLike) => void) | null = null;
    const base: GuideStateLike = {
      status: "idle",
      workflowId: null,
      revision: null,
      version: null,
      completedStepIds: [],
      step: null,
    };
    return {
      guide: {
        getState: () => base,
        subscribe(next: (state: GuideStateLike) => void) {
          listener = next;
          return () => {
            listener = null;
          };
        },
      },
      emit(patch: Partial<GuideStateLike>) {
        listener?.({ ...base, ...patch });
      },
      get subscribed() {
        return listener !== null;
      },
    };
  }
  const running = {
    workflowId: "clients.create",
    revision: `sha256:${"a".repeat(64)}`,
    version: 2,
  };

  it("maps guide transitions to lifecycle events", async () => {
    const { analytics, transport } = setup({ batchSize: 100 });
    const fake = fakeGuide();
    let clock = 1000;
    const stop = instrumentGuide(fake.guide, analytics, { now: () => clock });
    fake.emit({ ...running, status: "waiting-route" });
    fake.emit({ ...running, status: "active", step: { id: "step.1" } });
    fake.emit({ ...running, status: "target-missing", step: { id: "step.1" } });
    fake.emit({
      ...running,
      status: "active",
      step: { id: "step.2" },
      completedStepIds: ["step.1"],
    });
    clock = 5200;
    fake.emit({
      ...running,
      status: "completed",
      completedStepIds: ["step.1", "step.2"],
    });
    // A second run that is stopped, and a guide that fails before starting.
    fake.emit({ ...running, status: "active", step: { id: "step.1" } });
    fake.emit({ ...running, status: "stopped", step: { id: "step.1" } });
    fake.emit({ ...running, version: null, status: "failed" });
    await analytics.flush();
    expect(
      transport.events.map((event) =>
        event.type === "workflow.step_reached"
          ? `step ${event.stepId}#${event.stepIndex}`
          : event.type === "workflow.completed"
            ? `completed ${event.durationMs}`
            : event.type === "workflow.abandoned"
              ? `abandoned ${event.reason} at ${event.lastStepId}`
              : `${event.type}${"trigger" in event ? ` ${event.trigger}` : ""}`,
      ),
    ).toEqual([
      "workflow.started guide",
      "step step.1#0",
      "step step.2#1",
      "completed 4200",
      "workflow.started guide",
      "step step.1#0",
      "abandoned stopped at step.1",
    ]);
    expect(transport.events[0]).toMatchObject({
      workflowId: "clients.create",
      workflowVersion: 2,
    });
    stop();
    expect(fake.subscribed).toBe(false);
  });

  it("treats a restart of a running guide as abandoning the first run", async () => {
    const { analytics, transport } = setup({ batchSize: 100 });
    const fake = fakeGuide();
    instrumentGuide(fake.guide, analytics);
    fake.emit({ ...running, status: "active", step: { id: "step.1" } });
    fake.emit({ ...running, status: "waiting-route" });
    await analytics.flush();
    expect(transport.events.map((event) => event.type)).toEqual([
      "workflow.started",
      "workflow.step_reached",
      "workflow.abandoned",
      "workflow.started",
    ]);
  });
});

describe("domain events", () => {
  it("emits explicit business events and checks goal and event names when declared", async () => {
    const { analytics, transport, errors } = setup({
      batchSize: 100,
      goals: ["clients.created", "plans.structure_changed"],
      domainEvents: ["client.created"],
    });
    analytics.domainEvent("client.created");
    analytics.goalReached("clients.created", "clients.create");
    analytics.goalReached("clients.creatd");
    analytics.domainEvent("client.deleted");
    analytics.domainEvent("Client Created");
    await analytics.flush();
    expect(transport.events.map((event) => event.type)).toEqual([
      "domain.event",
      "goal.reached",
    ]);
    expect(transport.events[0]).toMatchObject({ name: "client.created" });
    expect(errors.map((error) => error.message)).toEqual([
      "Unknown goal clients.creatd; known goals: clients.created, plans.structure_changed.",
      "Unknown domain event client.deleted; declare it in domainEvents.",
      "Unknown domain event Client Created; declare it in domainEvents.",
    ]);
    expect(analytics.stats().rejected).toBe(3);
    const open = setup({ batchSize: 100 });
    open.analytics.goalReached("anything.reached");
    open.analytics.domainEvent("anything.happened");
    // Without an allowlist the schema still requires a semantic name.
    open.analytics.domainEvent("Client Created");
    await open.analytics.flush();
    expect(open.transport.events).toHaveLength(2);
    expect(open.analytics.stats().rejected).toBe(1);
  });
});
