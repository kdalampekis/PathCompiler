// @vitest-environment happy-dom
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { createStaticTransport, PathCompiler } from "@pathcompiler/sdk-js";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import {
  type CompiledWorkflows,
  compileWorkflows,
} from "@pathcompiler/workflow-compiler";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import { approveCandidate } from "@pathcompiler/workflow-review";
import { validateWorkflow } from "@pathcompiler/workflow-validator";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  type GuideControls,
  PathCompilerProvider,
  type PathCompilerProviderProps,
  useGuideRuntime,
  useProductHelp,
  useWorkflow,
  useWorkflowProgress,
} from "../src/index.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let compiled: CompiledWorkflows;
let client: PathCompiler;
beforeAll(async () => {
  const project = await readSourceProject(
    // happy-dom replaces URL, so resolve from the module path instead.
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../fixtures/next-demo",
    ),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  compiled = compileWorkflows(
    discoverWorkflows(
      capabilities.graph,
      capabilities.report,
      mined.report,
    ).report.candidates.map((candidate) =>
      approveCandidate(candidate, {
        approvedBy: "Test Reviewer",
        approvedAt: "2026-10-22T10:00:00.000Z",
        validation: validateWorkflow(candidate.workflow, {
          graph: mined.graph,
          traces: mined.report,
        }),
        repository: { ...project.repository, dirty: false },
      }),
    ),
  );
  client = new PathCompiler({
    project: "next-demo",
    transport: createStaticTransport(compiled),
  });
});

const seen: Record<string, unknown> = {};
let controls: GuideControls | undefined;
let progress: ReturnType<typeof useWorkflowProgress> | undefined;
function Help({ query }: { query: string }) {
  seen[query] = useProductHelp(query);
  return null;
}
function Details({ id }: { id: string }) {
  seen[id] = useWorkflow(id);
  return null;
}
function App() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  controls = useGuideRuntime();
  progress = useWorkflowProgress();
  return createElement(
    "main",
    null,
    createElement(
      "button",
      {
        type: "button",
        "data-pathcompiler": "clients.create",
        onClick: () => setOpen(true),
      },
      "Create Client",
    ),
    open &&
      createElement(
        "form",
        null,
        createElement("input", { "data-pathcompiler": "client.form.name" }),
        createElement("input", {
          "data-pathcompiler": "client.form.email",
        }),
        createElement(
          "button",
          {
            type: "button",
            "data-pathcompiler": "client.form.submit",
            onClick: () => setDone(true),
          },
          "Save",
        ),
      ),
    done &&
      createElement(
        "p",
        { "data-pathcompiler": "clients.feedback" },
        "Client created",
      ),
  );
}
function Orphan() {
  useWorkflowProgress();
  return null;
}

let root: Root | null = null;
afterEach(() => {
  for (const key of Object.keys(seen)) delete seen[key];
  controls = undefined;
  progress = undefined;
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});
async function render(
  children: ReactNode,
  props: Partial<PathCompilerProviderProps> = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const draw = async (next: Partial<PathCompilerProviderProps>) =>
    act(async () =>
      root?.render(
        createElement(PathCompilerProvider, { client, ...next }, children),
      ),
    );
  await draw(props);
  return draw;
}
const settle = () =>
  act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
const target = (id: string) =>
  document.querySelector<HTMLElement>(`[data-pathcompiler="${id}"]`);

describe("React runtime", () => {
  it("resolves help with provider context and ignores blank queries", async () => {
    await render(
      [
        createElement(Help, { key: "a", query: "how do I add a client" }),
        createElement(Help, { key: "b", query: "plan" }),
        createElement(Help, { key: "c", query: "   " }),
      ],
      { route: "/clients" },
    );
    await settle();
    expect(seen["how do I add a client"]).toMatchObject({
      status: "success",
      data: { type: "workflow", workflow: { id: "clients.create" } },
    });
    expect(seen.plan).toMatchObject({
      status: "success",
      data: { type: "ambiguous" },
    });
    expect(seen["   "]).toEqual({ status: "idle", data: null, error: null });
  });

  it("loads workflow details and surfaces SDK errors", async () => {
    await render([
      createElement(Details, { key: "a", id: "clients.create" }),
      createElement(Details, { key: "b", id: "clients.edit" }),
    ]);
    await settle();
    expect(seen["clients.create"]).toMatchObject({
      status: "success",
      data: { id: "clients.create", title: "Create Client" },
    });
    expect(seen["clients.edit"]).toMatchObject({
      status: "error",
      error: { code: "workflow-not-found" },
    });
  });

  it("guides a compiled workflow through rendered semantic targets", async () => {
    const draw = await render(createElement(App), { route: "/plans" });
    await act(async () => {
      await controls?.start("clients.create");
    });
    expect(progress).toMatchObject({
      workflowId: "clients.create",
      status: "waiting-route",
      total: 4,
      fraction: 0,
    });
    await draw({ route: "/clients" });
    expect(progress).toMatchObject({
      status: "active",
      step: { id: "step.1" },
    });
    await act(async () => target("clients.create")?.click());
    await settle();
    expect(progress?.step?.id).toBe("step.2");
    for (const id of ["client.form.name", "client.form.email"])
      await act(async () =>
        target(id)?.dispatchEvent(new Event("change", { bubbles: true })),
      );
    expect(progress?.step?.id).toBe("step.4");
    controls?.pause();
    await settle();
    expect(progress?.status).toBe("paused");
    await act(async () => controls?.resume());
    await act(async () => target("client.form.submit")?.click());
    await settle();
    expect(progress).toMatchObject({
      status: "completed",
      completed: 4,
      total: 4,
      fraction: 1,
    });
    await expect(controls?.start("clients.edit")).rejects.toMatchObject({
      code: "workflow-not-found",
    });
  });

  it("requires the provider", async () => {
    const container = document.createElement("div");
    root = createRoot(container);
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await expect(
        act(async () => root?.render(createElement(Orphan))),
      ).rejects.toThrow("inside <PathCompilerProvider>");
    } finally {
      console.error = original;
    }
  });
});
