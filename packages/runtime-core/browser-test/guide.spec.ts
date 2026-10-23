import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import {
  compileWorkflows,
  type RuntimeWorkflow,
} from "@pathcompiler/workflow-compiler";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import { approveCandidate } from "@pathcompiler/workflow-review";
import { validateWorkflow } from "@pathcompiler/workflow-validator";
import { expect, type Page, test } from "@playwright/test";
import { build } from "vite";
import type {
  createDomEnvironment,
  createGuideRuntime,
  GuideRuntime,
  GuideState,
} from "../src/index.js";

declare global {
  interface Window {
    PathCompilerRuntime: {
      createDomEnvironment: typeof createDomEnvironment;
      createGuideRuntime: typeof createGuideRuntime;
    };
    guide: GuideRuntime;
  }
}

let bundle: string;
let workflow: RuntimeWorkflow;
test.beforeAll(async () => {
  const output = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL("./harness.ts", import.meta.url)),
        formats: ["iife"],
        name: "PathCompilerHarness",
        fileName: () => "harness.js",
      },
    },
  });
  const [result] = Array.isArray(output) ? output : [output];
  const chunk = result && "output" in result ? result.output[0] : undefined;
  if (chunk?.type !== "chunk")
    throw new Error("Expected a bundled runtime harness");
  bundle = chunk.code;

  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  const candidate = discoverWorkflows(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).report.candidates.find((item) => item.workflow.id === "clients.create");
  if (!candidate) throw new Error("Expected discovered clients.create");
  const approved = approveCandidate(candidate, {
    approvedBy: "Runtime Test",
    approvedAt: "2026-10-22T10:00:00.000Z",
    validation: validateWorkflow(candidate.workflow, {
      graph: mined.graph,
      traces: mined.report,
    }),
    repository: { ...project.repository, dirty: false },
  });
  const [compiled] = compileWorkflows([approved]).runtimeManifest.workflows;
  if (!compiled) throw new Error("Expected compiled clients.create");
  workflow = compiled;
});

async function startGuide(page: Page) {
  await page.addScriptTag({ content: bundle });
  await page.evaluate((manifest) => {
    const runtime = window.PathCompilerRuntime.createGuideRuntime({
      environment: window.PathCompilerRuntime.createDomEnvironment(),
      targetTimeoutMs: 500,
    });
    window.guide = runtime;
    runtime.start(manifest);
  }, workflow);
}
const state = (page: Page): Promise<GuideState> =>
  page.evaluate(() => window.guide.getState());
const target = (page: Page, id: string) =>
  page.locator(`[data-pathcompiler="${id}"]`);

test("guides compiled clients.create through the real fixture to completion", async ({
  page,
}) => {
  await page.goto("/clients");
  await startGuide(page);
  await expect
    .poll(() => state(page))
    .toMatchObject({
      status: "active",
      workflowId: "clients.create",
      step: { id: "step.1", target: "clients.create" },
      target: { matches: "one" },
    });
  await target(page, "clients.create").click();
  await expect.poll(async () => (await state(page)).step?.id).toBe("step.2");
  await target(page, "client.form.name").fill("Runtime Guided Client");
  expect((await state(page)).step?.id).toBe("step.2");
  await target(page, "client.form.email").click();
  await expect.poll(async () => (await state(page)).step?.id).toBe("step.3");
  await target(page, "client.form.email").fill("runtime@example.test");
  await target(page, "client.form.submit").click();
  await expect
    .poll(() => state(page))
    .toMatchObject({
      status: "completed",
      completedStepIds: ["step.1", "step.2", "step.3", "step.4"],
      failure: null,
    });
  await expect(
    page.getByRole("heading", { name: "Runtime Guided Client", exact: true }),
  ).toBeVisible();
});

test("waits for the entry route across client-side navigation", async ({
  page,
}) => {
  await page.goto("/plans");
  await startGuide(page);
  expect(await state(page)).toMatchObject({
    status: "waiting-route",
    expectedRoute: "/clients",
  });
  await target(page, "nav.clients").click();
  await expect
    .poll(() => state(page))
    .toMatchObject({ status: "active", step: { id: "step.1" } });
});

test("falls back to target-missing when the session cannot see the control", async ({
  page,
}) => {
  const response = await page.request.post("/api/session", {
    data: { role: "viewer", planStructure: true },
  });
  expect(response.ok()).toBe(true);
  await page.goto("/clients");
  await startGuide(page);
  await expect
    .poll(() => state(page))
    .toMatchObject({
      status: "target-missing",
      step: { id: "step.1", instruction: { text: "Click Create Client" } },
      target: { id: "clients.create", matches: "none" },
    });
  await page.evaluate(() => window.guide.stop());
  expect((await state(page)).status).toBe("stopped");
});
