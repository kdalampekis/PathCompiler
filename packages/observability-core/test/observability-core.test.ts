import { describe, expect, it } from "vitest";
import {
  createEventFactory,
  DEFAULT_PRIVACY_POLICY,
  EventPolicyError,
  hashUserId,
  type ProductRuntimeEvent,
  parseEvents,
  serializeEvent,
  validateEvent,
} from "../src/index.js";

const base = {
  schemaVersion: 1,
  eventId: "evt-1",
  timestamp: "2026-10-23T10:00:00.000Z",
  projectId: "next-demo",
  release: "2026.10.1",
  sessionId: "session-1",
  privacy: { pii: false, userIdHashed: false },
} as const;
const workflow = { workflowId: "clients.create", workflowVersion: 2 };
const issues = (input: unknown, policy = {}) => {
  try {
    validateEvent(input, policy);
    return [];
  } catch (error) {
    if (error instanceof EventPolicyError) return error.issues;
    throw error;
  }
};

describe("semantic runtime events", () => {
  it("accepts every event type bound to workflow IDs, versions and semantic targets", () => {
    const events = [
      { ...base, ...workflow, type: "workflow.started", trigger: "guide" },
      {
        ...base,
        ...workflow,
        type: "workflow.step_reached",
        stepId: "step.2",
        stepIndex: 1,
      },
      { ...base, ...workflow, type: "workflow.completed", durationMs: 4200 },
      {
        ...base,
        ...workflow,
        type: "workflow.abandoned",
        lastStepId: "step.3",
        reason: "navigated-away",
      },
      {
        ...base,
        type: "semantic_target.activated",
        semanticTarget: "clients.create",
        interaction: "click",
        route: "/clients",
      },
      {
        ...base,
        type: "goal.reached",
        goalId: "clients.created",
        capabilityId: "clients.create",
      },
      {
        ...base,
        type: "route.changed",
        route: "/plans/[id]",
        previousRoute: "/plans",
      },
      {
        ...base,
        type: "action.blocked",
        semanticTarget: "plans.change_structure",
        reason: "feature_flag",
        role: "viewer",
      },
      { ...base, type: "domain.event", name: "client.created" },
    ];
    for (const event of events) expect(issues(event), event.type).toEqual([]);
    expect(
      issues({ ...base, type: "workflow.completed", workflowId: "x.y" }),
    ).toEqual([
      "workflowVersion: Invalid input: expected number, received undefined",
    ]);
  });

  it("rejects raw content, coordinates and query strings by default", () => {
    const click = {
      ...base,
      type: "semantic_target.activated",
      semanticTarget: "client.form.name",
      interaction: "input",
    };
    expect(issues({ ...click, value: "Ada Lovelace" }).join()).toMatch(
      /Unrecognized key/,
    );
    expect(issues({ ...click, x: 10, y: 20 }).join()).toMatch(
      /Unrecognized key/,
    );
    expect(issues({ ...click, dom: "<form>" }).join()).toMatch(
      /Unrecognized key/,
    );
    expect(
      issues({ ...click, route: "/clients?email=a@b.c" }).join(),
    ).toContain("Routes must be paths without query strings or fragments");
    expect(
      issues({ ...click, semanticTarget: "Ada Lovelace" }).join(),
    ).toContain("Use a semantic ID");
  });

  it("enforces the privacy policy for context, PII and user IDs", async () => {
    const event = {
      ...base,
      type: "goal.reached",
      goalId: "clients.created",
      context: { plan_tier: "pro" },
    };
    expect(DEFAULT_PRIVACY_POLICY).toEqual({
      enabled: false,
      collectPii: false,
      hashUserIds: true,
      allowedContextKeys: [],
    });
    expect(issues(event)).toEqual([
      "context.plan_tier is not in the policy's allowedContextKeys",
    ]);
    expect(issues(event, { allowedContextKeys: ["plan_tier"] })).toEqual([]);
    expect(
      issues(
        { ...event, context: { userEmail: "a@b.c", domain: "billing" } },
        { allowedContextKeys: ["userEmail", "domain"] },
      ),
    ).toEqual(["context.userEmail looks like user content or a credential"]);
    expect(
      issues({
        ...event,
        context: undefined,
        privacy: { pii: true, userIdHashed: false },
      }),
    ).toEqual(["privacy.pii is true but the policy does not allow PII"]);
    const raw = { ...event, context: undefined, anonymousUserId: "user-42" };
    expect(issues(raw)).toEqual([
      "anonymousUserId must be hashed with hashUserId",
    ]);
    expect(issues(raw, { hashUserIds: false })).toEqual([]);
    const hashed = await hashUserId("user-42", "project-salt");
    expect(hashed).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await hashUserId("user-42", "project-salt")).toBe(hashed);
    expect(await hashUserId("user-42", "other-salt")).not.toBe(hashed);
    expect(
      issues({
        ...raw,
        anonymousUserId: hashed,
        privacy: { pii: false, userIdHashed: true },
      }),
    ).toEqual([]);
    await expect(hashUserId("user-42", "")).rejects.toThrow(/salt/);
  });

  it("serializes canonically and round-trips newline-delimited events", () => {
    const event = validateEvent({
      ...base,
      ...workflow,
      type: "workflow.started",
      trigger: "assistant",
    });
    const reordered = Object.fromEntries(
      Object.entries(event).reverse(),
    ) as ProductRuntimeEvent;
    expect(serializeEvent(reordered)).toBe(serializeEvent(event));
    const text = `${serializeEvent(event)}\n\n${serializeEvent(reordered)}\n`;
    expect(parseEvents(text)).toEqual([event, event]);
    expect(() => parseEvents('{"type":"nope"}')).toThrow(EventPolicyError);
  });

  it("binds project, session and release in the event factory", () => {
    let id = 0;
    const create = createEventFactory({
      projectId: "next-demo",
      sessionId: "s-1",
      release: "2026.10.1",
      now: () => new Date("2026-10-23T12:00:00.000Z"),
      nextId: () => `evt-${++id}`,
    });
    expect(
      create("workflow.started", { ...workflow, trigger: "organic" }),
    ).toEqual({
      ...workflow,
      type: "workflow.started",
      trigger: "organic",
      schemaVersion: 1,
      eventId: "evt-1",
      timestamp: "2026-10-23T12:00:00.000Z",
      projectId: "next-demo",
      sessionId: "s-1",
      release: "2026.10.1",
      privacy: { pii: false, userIdHashed: false },
    });
    expect(create("goal.reached", { goalId: "clients.created" }).eventId).toBe(
      "evt-2",
    );
    expect(() =>
      create("semantic_target.activated", {
        semanticTarget: "clients.create",
        interaction: "click",
        anonymousUserId: "plain",
      }),
    ).toThrow(/must be hashed/);
  });
});
