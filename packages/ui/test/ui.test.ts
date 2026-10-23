// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PathCompilerProvider } from "@pathcompiler/react";
import {
  PathCompiler,
  type ProductHelpResult,
  type RuntimeTransport,
  type RuntimeWorkflow,
  type WorkflowDetails,
} from "@pathcompiler/sdk-js";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  GuideOverlay,
  ProductHelpCard,
  WorkflowChecklist,
  WorkflowSearch,
} from "../src/index.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const revision = `sha256:${"d".repeat(64)}`;
const manifest: RuntimeWorkflow = {
  id: "notes.create",
  revision,
  title: "Create Note",
  entrypoints: [{ route: "/" }],
  preconditions: [],
  steps: [
    {
      id: "open",
      target: "notes.create",
      action: { type: "click" },
      instruction: { text: "Click New note" },
      next: "save",
    },
    {
      id: "save",
      target: "note.save",
      action: { type: "click" },
      expected: {
        type: "element_text",
        target: "notes.feedback",
        text: "Saved",
        match: "exact",
      },
    },
  ],
  terminal: {
    type: "element_text",
    target: "notes.feedback",
    text: "Saved",
    match: "exact",
  },
};
const details: WorkflowDetails = {
  id: "notes.create",
  revision,
  title: "Create Note",
  domain: "notes",
  intent: { action: "create", entity: "note" },
  roles: [],
  entrypoints: ["/"],
  prerequisites: [],
  steps: [
    {
      id: "open",
      text: "Click New note",
      optional: false,
      next: "save",
      branches: [],
    },
    { id: "save", text: "Save the note", optional: false, branches: [] },
  ],
  completion: 'notes.feedback shows "Saved"',
};
const option = { id: "notes.create", revision, title: "Create Note" };
const found: ProductHelpResult = {
  type: "workflow",
  workflow: { ...option, routes: ["/"] },
  confidence: 1,
  matched: { alias: null, action: "create", entity: "note", qualifiers: [] },
};
const resolved: string[] = [];
const transport: RuntimeTransport = {
  async resolve(request) {
    resolved.push(request.query);
    return request.query.includes("note")
      ? found
      : {
          type: "unsupported",
          reason: "no-match",
          message: "x",
          unavailable: [],
        };
  },
  async getWorkflow(id) {
    if (id !== "notes.create") throw new Error(`unknown ${id}`);
    return details;
  },
  async getRuntimeManifest() {
    return manifest;
  },
};
const client = new PathCompiler({ project: "ui", transport });

function App(props: { children: ReactNode }) {
  const [saved, setSaved] = useState(false);
  return createElement(
    "main",
    null,
    createElement(
      "button",
      { type: "button", "data-pathcompiler": "notes.create" },
      "New note",
    ),
    createElement(
      "button",
      {
        type: "button",
        "data-pathcompiler": "note.save",
        onClick: () => setSaved(true),
      },
      "Save",
    ),
    saved &&
      createElement("p", { "data-pathcompiler": "notes.feedback" }, "Saved"),
    props.children,
  );
}

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  resolved.length = 0;
  document.body.innerHTML = "";
});
async function render(...children: ReactNode[]) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(
        PathCompilerProvider,
        { client, route: "/", runtimeOptions: { targetTimeoutMs: 20 } },
        createElement(App, null, ...children),
      ),
    ),
  );
  await settle();
}
const settle = (ms = 5) =>
  act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
function button(name: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === name,
  );
  if (!match) throw new Error(`No button ${name}`);
  return match;
}
const click = (element: HTMLElement) => act(async () => element.click());

describe("optional UI components", () => {
  it("renders help results with accessible structure and starts guides", async () => {
    const selected: string[] = [];
    await render(
      createElement(ProductHelpCard, { key: "w", result: found }),
      createElement(ProductHelpCard, {
        key: "a",
        result: {
          type: "ambiguous",
          reason: "multiple-matches",
          message: "x",
          options: [option],
        },
        onSelect: (id: string) => selected.push(id),
        labels: { chooseWorkflow: "Choose one" },
      }),
      createElement(ProductHelpCard, {
        key: "u",
        result: {
          type: "unsupported",
          reason: "unavailable-in-context",
          message: "x",
          unavailable: [],
        },
      }),
      createElement(GuideOverlay, { key: "o" }),
    );
    const card = document.querySelector("section.pathcompiler-help-card");
    const heading = card?.querySelector("h2");
    expect(card?.getAttribute("aria-labelledby")).toBe(heading?.id);
    expect(heading?.textContent).toBe("Create Note");
    expect(
      [...(card?.querySelectorAll("ol li") ?? [])].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Click New note", "Save the note"]);
    expect(document.body.textContent).toContain("Choose one");
    await click(button("Create Note"));
    expect(selected).toEqual(["notes.create"]);
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "not available to you here",
    );
    expect(document.querySelector("aside")).toBeNull();
    await click(button("Show me"));
    await settle();
    expect(document.querySelector("aside")?.textContent).toContain(
      "Click New note",
    );
  });

  it("tracks guide progress in the checklist and overlay controls", async () => {
    await render(
      createElement(WorkflowChecklist, {
        key: "c",
        workflowId: "notes.create",
      }),
      createElement(GuideOverlay, { key: "o", labels: { stop: "End" } }),
      createElement(ProductHelpCard, { key: "h", result: found }),
    );
    const items = () => [
      ...document.querySelectorAll("ol.pathcompiler-checklist li"),
    ];
    expect(items().map((item) => item.getAttribute("data-state"))).toEqual([
      "pending",
      "pending",
    ]);
    await click(button("Show me"));
    await settle();
    expect(items()[0]?.getAttribute("aria-current")).toBe("step");
    const aside = document.querySelector("aside");
    expect(aside?.getAttribute("aria-labelledby")).toBe(
      aside?.querySelector("h2")?.id,
    );
    expect(aside?.textContent).toContain("Step 1 of 2");
    expect(
      document
        .querySelector(".pathcompiler-highlight")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    await click(button("Pause"));
    expect(button("Resume")).toBeTruthy();
    await click(button("Resume"));
    await click(
      document.querySelector(
        '[data-pathcompiler="notes.create"]',
      ) as HTMLElement,
    );
    await settle();
    expect(items().map((item) => item.getAttribute("data-state"))).toEqual([
      "done",
      "current",
    ]);
    expect(items()[0]?.textContent).toContain("(done)");
    await click(button("End"));
    await settle();
    expect(document.querySelector("aside")?.textContent).toContain(
      "Guide stopped.",
    );
    await click(button("Dismiss"));
    expect(document.querySelector("aside")).toBeNull();
  });

  it("explains missing targets and completes", async () => {
    await render(
      createElement(GuideOverlay, { key: "o" }),
      createElement(ProductHelpCard, { key: "h", result: found }),
    );
    document
      .querySelector('[data-pathcompiler="notes.create"]')
      ?.removeAttribute("data-pathcompiler");
    await click(button("Show me"));
    await settle(40);
    expect(document.querySelector("aside")?.textContent).toContain(
      "isn't visible right now",
    );
    expect(document.querySelector(".pathcompiler-highlight")).toBeNull();
    document
      .querySelector("main button")
      ?.setAttribute("data-pathcompiler", "notes.create");
    await settle();
    await click(
      document.querySelector(
        '[data-pathcompiler="notes.create"]',
      ) as HTMLElement,
    );
    await click(
      document.querySelector('[data-pathcompiler="note.save"]') as HTMLElement,
    );
    await settle();
    expect(document.querySelector("aside")?.textContent).toContain(
      "Guide complete.",
    );
  });

  it("searches on submit with a labelled field and announces results", async () => {
    const selected: string[] = [];
    await render(
      createElement(WorkflowSearch, {
        key: "s",
        onSelect: (id: string) => selected.push(id),
      }),
    );
    const input = document.querySelector("search input") as HTMLInputElement;
    expect(
      document.querySelector(`label[for="${input.id}"]`)?.textContent,
    ).toBe("Search guides");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "new note");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(resolved).toEqual([]);
    await click(button("Search"));
    await settle();
    expect(resolved).toEqual(["new note"]);
    expect(document.querySelector('search [role="status"]')?.textContent).toBe(
      "1 guide found",
    );
    await click(button("Create Note"));
    expect(selected).toEqual(["notes.create"]);
  });

  it("is never a dependency of the SDK, runtime or React adapter", async () => {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../..",
    );
    for (const name of ["sdk-js", "runtime-core", "react"]) {
      const manifest = JSON.parse(
        await readFile(path.join(root, name, "package.json"), "utf8"),
      );
      expect(JSON.stringify(manifest)).not.toContain("@pathcompiler/ui");
    }
  });
});
