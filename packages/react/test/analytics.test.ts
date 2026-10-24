// @vitest-environment happy-dom
import {
  type Analytics,
  createAnalytics,
  InMemoryTransport,
} from "@pathcompiler/analytics-sdk";
import {
  PathCompiler,
  type RuntimeTransport,
  type RuntimeWorkflow,
} from "@pathcompiler/sdk-js";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  type GuideControls,
  PathCompilerProvider,
  useAnalytics,
  useGuideRuntime,
} from "../src/index.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const unused = async () => {
  throw new Error("unused");
};
const manifest: RuntimeWorkflow = {
  id: "clients.create",
  revision: `sha256:${"b".repeat(64)}`,
  version: 4,
  title: "Create Client",
  entrypoints: [{ route: "/clients" }],
  preconditions: [],
  steps: [{ id: "open", target: "clients.create", action: { type: "click" } }],
  terminal: { type: "explicit_next" },
};
const client = new PathCompiler({
  project: "demo",
  transport: {
    resolve: unused,
    getWorkflow: unused,
    getRuntimeManifest: async () => manifest,
    getRelatedWorkflows: unused,
  } as RuntimeTransport,
});
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});
let hooked: Analytics | null | undefined;
let guide: GuideControls | undefined;
function Probe() {
  hooked = useAnalytics();
  guide = useGuideRuntime();
  return null;
}
function Page() {
  return createElement(
    "main",
    null,
    createElement(Probe),
    createElement(
      "button",
      { type: "button", "data-pathcompiler": "clients.create" },
      createElement("span", null, "Add client"),
    ),
    createElement(
      "form",
      {
        "data-pathcompiler": "client.form",
        onSubmit: (event: Event) => event.preventDefault(),
      },
      createElement("input", {
        "data-pathcompiler": "client.form.name",
        defaultValue: "",
      }),
      createElement(
        "select",
        { "data-pathcompiler": "plan.structure.selector", defaultValue: "a" },
        createElement("option", { value: "a" }, "A"),
        createElement("option", { value: "b" }, "B"),
      ),
      createElement("button", { type: "submit" }, "Save"),
    ),
    createElement("button", { type: "button", id: "plain" }, "Plain"),
  );
}
async function render(props: {
  analytics?: Analytics;
  route: string;
  context?: { role?: string };
}): Promise<(next: { route: string }) => Promise<void>> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const draw = (route: string) =>
    act(async () =>
      root?.render(
        createElement(
          PathCompilerProvider,
          {
            client,
            route,
            ...(props.analytics ? { analytics: props.analytics } : {}),
            ...(props.context ? { context: props.context } : {}),
          },
          createElement(Page) as ReactNode,
        ),
      ),
    );
  await draw(props.route);
  return async (next) => {
    await draw(next.route);
  };
}
const fire = (element: Element | null, type: string) =>
  act(async () => {
    element?.dispatchEvent(new Event(type, { bubbles: true }));
  });

describe("React analytics integration", () => {
  it("reports routes and semantic target activations without reading values", async () => {
    const transport = new InMemoryTransport();
    const analytics = createAnalytics({
      projectId: "demo",
      release: "1.0.0",
      sessionId: "s",
      policy: { enabled: true },
      transport,
      batchSize: 100,
    });
    const navigate = await render({
      analytics,
      route: "/clients",
      context: { role: "editor" },
    });
    expect(hooked).toBe(analytics);
    await act(async () =>
      (document.querySelector("button span") as HTMLElement).click(),
    );
    const input = document.querySelector("input") as HTMLInputElement;
    input.value = "Ada Lovelace";
    await fire(input, "change");
    await fire(document.querySelector("select"), "change");
    await fire(input, "click");
    await fire(document.querySelector("form"), "submit");
    await act(async () =>
      (document.querySelector("#plain") as HTMLElement).click(),
    );
    await navigate({ route: "/plans" });
    await analytics.flush();
    const events = transport.events;
    expect(
      events.map((event) =>
        event.type === "semantic_target.activated"
          ? `${event.semanticTarget}:${event.interaction}`
          : event.type === "route.changed"
            ? `route ${event.previousRoute ?? "-"}→${event.route}`
            : event.type,
      ),
    ).toEqual([
      "route -→/clients",
      "clients.create:click",
      "client.form.name:input",
      "plan.structure.selector:select",
      "client.form:submit",
      "route /clients→/plans",
    ]);
    expect(events[1]).toMatchObject({
      route: "/clients",
      role: "editor",
      release: "1.0.0",
    });
    expect(JSON.stringify(events)).not.toContain("Ada Lovelace");
  });

  it("emits guide lifecycle events through the provider", async () => {
    const transport = new InMemoryTransport();
    const analytics = createAnalytics({
      projectId: "demo",
      sessionId: "s",
      policy: { enabled: true },
      transport,
      batchSize: 100,
    });
    await render({ analytics, route: "/clients" });
    await act(async () => {
      await guide?.start("clients.create", { version: 4 });
    });
    await act(async () =>
      (document.querySelector("button span") as HTMLElement).click(),
    );
    await act(async () => guide?.next());
    await analytics.flush();
    const lifecycle = transport.events.filter((event) =>
      event.type.startsWith("workflow."),
    );
    expect(lifecycle.map((event) => event.type)).toEqual([
      "workflow.started",
      "workflow.step_reached",
      "workflow.completed",
    ]);
    expect(lifecycle[0]).toMatchObject({
      workflowId: "clients.create",
      workflowVersion: 4,
      trigger: "guide",
    });
  });

  it("does nothing without analytics", async () => {
    await render({ route: "/clients" });
    expect(hooked).toBeNull();
    await act(async () =>
      (document.querySelector("button span") as HTMLElement).click(),
    );
  });
});
