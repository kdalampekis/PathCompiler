import type { RuntimeWorkflow } from "@pathcompiler/workflow-compiler/schema";
import { describe, expect, it } from "vitest";
import {
  createGuideRuntime,
  type GuideClock,
  type GuideEnvironment,
  type GuideSignal,
  routeMatches,
  type TargetSnapshot,
} from "../src/index.js";

function fakeEnvironment(route = "/") {
  const targets = new Map<string, TargetSnapshot[]>();
  const listeners = new Set<(signal: GuideSignal) => void>();
  const environment: GuideEnvironment & {
    path: string;
    show(target: string, text?: string, count?: number): void;
    hide(target: string): void;
    act(target: string, kind: "click" | "input" | "change"): void;
    listeners: number;
  } = {
    path: route,
    route: () => environment.path,
    query: (target) => targets.get(target) ?? [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    show(target, text = "", count = 1) {
      targets.set(
        target,
        Array.from({ length: count }, () => ({
          visible: true,
          enabled: true,
          checked: null,
          text,
        })),
      );
      for (const listener of [...listeners]) listener({ type: "change" });
    },
    hide(target) {
      targets.delete(target);
      for (const listener of [...listeners]) listener({ type: "change" });
    },
    act(target, kind) {
      for (const listener of [...listeners])
        listener({ type: "interaction", target, kind });
    },
    get listeners() {
      return listeners.size;
    },
  };
  return environment;
}
function manualClock() {
  let now = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let id = 0;
  const clock: GuideClock & { tick(ms: number): void } = {
    setTimeout(callback, ms) {
      id += 1;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    tick(ms) {
      now += ms;
      for (const [key, timer] of [...timers].sort((a, b) => a[1].at - b[1].at))
        if (timer.at <= now && timers.has(key)) {
          timers.delete(key);
          timer.callback();
        }
    },
  };
  return clock;
}
const revision = `sha256:${"c".repeat(64)}`;
function createClient(): RuntimeWorkflow {
  return {
    id: "clients.create",
    revision,
    version: 3,
    title: "Create Client",
    entrypoints: [{ route: "/clients" }],
    preconditions: [],
    steps: [
      {
        id: "open",
        target: "clients.create",
        action: { type: "click" },
        instruction: { text: "Click Create Client" },
        next: "name",
      },
      {
        id: "name",
        target: "client.form.name",
        action: { type: "input" },
        next: "save",
      },
      {
        id: "save",
        target: "client.form.submit",
        action: { type: "click" },
        expected: {
          type: "element_text",
          target: "clients.feedback",
          text: "Client created",
          match: "exact",
        },
      },
    ],
    terminal: {
      type: "element_text",
      target: "clients.feedback",
      text: "Client created",
      match: "exact",
    },
  };
}
function setup(route = "/clients") {
  const environment = fakeEnvironment(route);
  const clock = manualClock();
  const runtime = createGuideRuntime({
    environment,
    clock,
    targetTimeoutMs: 1_000,
    stepTimeoutMs: 10_000,
  });
  const statuses: string[] = [];
  runtime.subscribe((state) => statuses.push(state.status));
  return { environment, clock, runtime, statuses };
}

describe("guide runtime", () => {
  it("waits for the entry route, then follows user actions to completion", () => {
    const { environment, runtime } = setup("/");
    expect(runtime.start(createClient())).toMatchObject({
      status: "waiting-route",
      expectedRoute: "/clients",
      totalSteps: 3,
    });
    environment.show("clients.create");
    expect(runtime.getState().status).toBe("waiting-route");
    environment.path = "/clients";
    runtime.refresh();
    expect(runtime.getState()).toMatchObject({
      status: "active",
      step: { id: "open", instruction: { text: "Click Create Client" } },
      target: { id: "clients.create", matches: "one" },
    });
    environment.act("client.form.name", "click");
    expect(runtime.getState().step?.id).toBe("open");
    environment.act("clients.create", "click");
    environment.show("client.form.name");
    expect(runtime.getState().step?.id).toBe("name");
    environment.act("client.form.name", "input");
    expect(runtime.getState().step?.id).toBe("name");
    environment.act("client.form.name", "change");
    environment.show("client.form.submit");
    expect(runtime.getState().step?.id).toBe("save");
    environment.act("client.form.submit", "click");
    expect(runtime.getState().step?.id).toBe("save");
    environment.show("clients.feedback", "Client created");
    expect(runtime.getState()).toMatchObject({
      status: "completed",
      completedStepIds: ["open", "name", "save"],
      failure: null,
    });
    expect(environment.listeners).toBe(0);
  });

  it("stops with navigated-away when the user leaves every route the workflow knows (#14)", () => {
    const { environment, runtime } = setup("/clients");
    runtime.start(createClient());
    environment.show("clients.create");
    expect(runtime.getState().status).toBe("active");
    environment.path = "/settings";
    runtime.refresh();
    expect(runtime.getState()).toMatchObject({
      status: "stopped",
      failure: { code: "navigated-away" },
    });
    expect(environment.listeners).toBe(0);
  });

  it("does not skip a step whose expected state already holds until the user acts", () => {
    const { environment, runtime } = setup();
    environment.show("clients.feedback", "Client created");
    environment.show("clients.create");
    runtime.start(createClient());
    environment.act("clients.create", "click");
    environment.act("client.form.name", "change");
    expect(runtime.getState().step?.id).toBe("save");
    environment.show("client.form.submit");
    expect(runtime.getState().status).toBe("active");
    environment.act("client.form.submit", "click");
    expect(runtime.getState().status).toBe("completed");
  });

  it("reports missing and ambiguous targets after a grace period and recovers", () => {
    const { environment, clock, runtime } = setup();
    runtime.start(createClient());
    expect(runtime.getState()).toMatchObject({
      status: "active",
      target: { matches: "none" },
    });
    clock.tick(999);
    expect(runtime.getState().status).toBe("active");
    clock.tick(1);
    expect(runtime.getState()).toMatchObject({
      status: "target-missing",
      step: { id: "open", instruction: { text: "Click Create Client" } },
    });
    environment.show("clients.create", "", 2);
    expect(runtime.getState().target?.matches).toBe("many");
    environment.show("clients.create");
    expect(runtime.getState()).toMatchObject({
      status: "active",
      target: { matches: "one" },
    });
  });

  it("pauses without observing or timing out, then resumes", () => {
    const { environment, clock, runtime } = setup();
    environment.show("clients.create");
    runtime.start(createClient());
    runtime.pause();
    expect(runtime.getState().status).toBe("paused");
    environment.act("clients.create", "click");
    clock.tick(60_000);
    expect(runtime.getState()).toMatchObject({
      status: "paused",
      step: { id: "open" },
    });
    runtime.resume();
    expect(runtime.getState().status).toBe("active");
    environment.act("clients.create", "click");
    expect(runtime.getState().step?.id).toBe("name");
  });

  it("times out stalled steps and stops explicitly", () => {
    const first = setup();
    first.environment.show("clients.create");
    first.runtime.start(createClient());
    first.clock.tick(10_000);
    expect(first.runtime.getState()).toMatchObject({
      status: "timed-out",
      failure: { code: "step-timeout" },
    });
    expect(first.environment.listeners).toBe(0);
    const second = setup();
    second.environment.show("clients.create");
    second.runtime.start(createClient());
    second.runtime.stop();
    second.environment.act("clients.create", "click");
    expect(second.runtime.getState()).toMatchObject({
      status: "stopped",
      step: { id: "open" },
    });
    second.runtime.resume();
    second.runtime.next();
    expect(second.runtime.getState().status).toBe("stopped");
  });

  it("follows branches, navigation, explanations and application events", () => {
    const workflow: RuntimeWorkflow = {
      ...createClient(),
      entrypoints: [{ route: "/plans/[id]" }],
      steps: [
        {
          id: "choose",
          target: "plan.confirm",
          action: { type: "click" },
          branches: [
            {
              when: { type: "feature_flag", flag: "beta", enabled: true },
              next: "read",
            },
          ],
          next: "go",
        },
        {
          id: "read",
          action: { type: "explain" },
          next: "go",
        },
        {
          id: "go",
          action: { type: "navigate", route: "/plans/[id]/done" },
          next: "wait",
        },
        {
          id: "wait",
          action: { type: "wait" },
          expected: { type: "event_emitted", event: "plan.saved" },
        },
      ],
      terminal: { any: [{ type: "event_emitted", event: "plan.saved" }] },
    };
    const { environment, runtime } = setup("/plans/7");
    runtime.setContext({ featureFlags: { beta: true } });
    environment.show("plan.confirm");
    runtime.start(workflow);
    environment.act("plan.confirm", "click");
    expect(runtime.getState().step?.id).toBe("read");
    environment.act("plan.confirm", "click");
    expect(runtime.getState().step?.id).toBe("read");
    runtime.next();
    expect(runtime.getState().step?.id).toBe("go");
    runtime.next();
    expect(runtime.getState().step?.id).toBe("go");
    environment.path = "/plans/7/done";
    runtime.refresh();
    expect(runtime.getState().step?.id).toBe("wait");
    runtime.emit("plan.saved");
    expect(runtime.getState()).toMatchObject({
      status: "completed",
      completedStepIds: ["choose", "read", "go", "wait"],
    });
  });

  it("fails clearly for unmet preconditions and invalid manifests", () => {
    const guarded = {
      ...createClient(),
      preconditions: [{ type: "permission", permission: "clients.write" }],
    } satisfies RuntimeWorkflow;
    const { runtime } = setup();
    expect(runtime.start(guarded)).toMatchObject({
      status: "failed",
      failure: { code: "precondition-unmet" },
    });
    expect(runtime.start({ id: "x" })).toMatchObject({
      status: "failed",
      failure: { code: "invalid-workflow" },
      workflowId: null,
    });
    const allowed = createGuideRuntime({
      environment: fakeEnvironment("/clients"),
      context: { permissions: ["clients.write"] },
    });
    expect(allowed.start(guarded).status).toBe("active");
    allowed.dispose();
  });

  it("completes an explicit-next terminal on next() instead of trapping the user", () => {
    const { runtime, environment } = setup();
    runtime.start({
      ...createClient(),
      steps: [
        {
          id: "open",
          target: "clients.create",
          action: { type: "click" },
        },
      ],
      terminal: { type: "explicit_next" },
    });
    environment.show("clients.create");
    environment.act("clients.create", "click");
    expect(runtime.getState().status).toBe("awaiting-completion");
    runtime.next();
    expect(runtime.getState().status).toBe("completed");
  });

  it("refuses a manifest that differs from the resolved revision or version", () => {
    const { runtime } = setup();
    expect(
      runtime.start(createClient(), { revision, version: 3 }).status,
    ).not.toBe("failed");
    for (const expected of [
      { revision: `sha256:${"e".repeat(64)}` },
      { version: 2 },
    ])
      expect(runtime.start(createClient(), expected)).toMatchObject({
        status: "failed",
        workflowId: "clients.create",
        failure: { code: "manifest-mismatch" },
      });
  });

  it("matches canonical route templates", () => {
    expect(routeMatches("/clients", "/clients")).toBe(true);
    expect(routeMatches("/clients", "/clients/?tab=1")).toBe(true);
    expect(routeMatches("/clients", "/clients/7")).toBe(false);
    expect(routeMatches("/clients/[id]", "/clients/7")).toBe(true);
    expect(routeMatches("/clients/[id]", "/clients/7/edit")).toBe(false);
    expect(routeMatches("/docs/[...slug]", "/docs/a/b")).toBe(true);
    expect(routeMatches("/a.b", "/axb")).toBe(false);
  });
});
