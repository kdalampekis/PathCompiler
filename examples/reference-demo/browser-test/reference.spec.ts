import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
  createDomEnvironment,
  createGuideRuntime,
  GuideRuntime,
  GuideState,
  RuntimeWorkflow,
} from "@pathcompiler/runtime-core";
import { expect, type Page, test } from "@playwright/test";
import { build } from "vite";
import { type DemoTranscript, transcriptFile } from "../src/demo.ts";

declare global {
  interface Window {
    PathCompilerRuntime: {
      createDomEnvironment: typeof createDomEnvironment;
      createGuideRuntime: typeof createGuideRuntime;
    };
    guide: GuideRuntime;
  }
}

test.describe.configure({ mode: "serial" });
const BASE = "http://127.0.0.1:3104";
const HEAD = "http://127.0.0.1:3105";
let transcript: DemoTranscript;
let bundle: string;

test.beforeAll(async () => {
  transcript = JSON.parse(
    await readFile(transcriptFile, "utf8"),
  ) as DemoTranscript;
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
  if (chunk?.type !== "chunk") throw new Error("Expected a runtime bundle");
  bundle = chunk.code;
});

const manifest = (
  artifacts: DemoTranscript["baseArtifacts"],
  id: string,
): RuntimeWorkflow => {
  const found = artifacts.runtimeManifest.workflows.find(
    (item) => item.id === id,
  );
  if (!found) throw new Error(`Missing ${id} in runtime manifest`);
  return found;
};
async function guide(page: Page, workflow: RuntimeWorkflow) {
  await page.addScriptTag({ content: bundle });
  await page.evaluate((input) => {
    const runtime = window.PathCompilerRuntime.createGuideRuntime({
      environment: window.PathCompilerRuntime.createDomEnvironment(),
      // The app's runtime context: discovered workflows carry feature-flag
      // preconditions, as the fixture's default session sets them.
      context: { featureFlags: { planStructure: true, planArchive: false } },
      targetTimeoutMs: 500,
    });
    window.guide = runtime;
    runtime.start(input);
  }, workflow);
}
const state = (page: Page): Promise<GuideState> =>
  page.evaluate(() => window.guide.getState());
const target = (page: Page, id: string) =>
  page.locator(`[data-pathcompiler="${id}"]`);

test("1–7: scan, graph, discovery, approval, compile, resolver and assistant answer", () => {
  expect(transcript.steps.map((item) => item.number)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
  ]);
  expect(transcript.steps[0]?.output).toMatch(/^Scanned \d+ source files/);
  expect(transcript.graph.nodes).toBeGreaterThan(50);
  expect(transcript.graph.tests).toBeGreaterThan(0);
  expect(transcript.steps[2]?.output).toContain(
    "Discovered 5 workflow candidates",
  );
  expect(transcript.steps[3]?.output.split("\n")).toHaveLength(3);
  expect(
    transcript.baseArtifacts.runtimeManifest.workflows.map((item) => item.id),
  ).toEqual(["clients.create", "plans.change_structure", "plans.create"]);
  expect(transcript.answers["How do I add a new client?"]).toMatchObject({
    type: "workflow_help",
    workflowId: "clients.create",
    entrypoint: { route: "/clients" },
  });
  expect(
    transcript.answers["How do I change the structure of a plan?"],
  ).toMatchObject({
    type: "workflow_help",
    workflowId: "plans.change_structure",
  });
  expect(transcript.card).toMatchObject({
    heading: "Create Client",
    buttons: ["Open /clients", "Show me", "Checklist"],
  });
});

test("8–9: the assistant's navigate action and an interactive guide on the product", async ({
  page,
}) => {
  await page.goto(`${BASE}/plans`);
  const answer = transcript.answers["How do I add a new client?"];
  if (answer?.type !== "workflow_help")
    throw new Error("Expected a workflow_help answer");
  // "Open /clients": the host app navigates to the workflow's entry route.
  await page.goto(new URL(answer.entrypoint?.route ?? "/", BASE).href);
  await expect(
    page.getByRole("heading", { name: "Clients", exact: true }),
  ).toBeVisible();
  await guide(page, manifest(transcript.baseArtifacts, "clients.create"));
  await expect
    .poll(() => state(page))
    .toMatchObject({ status: "active", step: { id: "step.1" } });
  await target(page, "clients.create").click();
  await target(page, "client.form.name").fill("Reference Client");
  await target(page, "client.form.email").click();
  await target(page, "client.form.email").fill("reference@example.test");
  await target(page, "client.form.submit").click();
  await expect
    .poll(() => state(page))
    .toMatchObject({
      status: "completed",
      completedStepIds: ["step.1", "step.2", "step.3", "step.4"],
    });
  await expect(
    page.getByRole("heading", { name: "Reference Client", exact: true }),
  ).toBeVisible();
});

test("10–13: code change, impacted workflow, update proposal and approval", () => {
  expect(transcript.head).not.toBe(transcript.base);
  expect(
    transcript.impact.find(
      (item) => item.workflowId === "plans.change_structure",
    ),
  ).toEqual({
    workflowId: "plans.change_structure",
    severity: "high",
    reasons: expect.arrayContaining(["target-removed"]),
  });
  expect(
    transcript.impact.find((item) => item.workflowId === "clients.create")
      ?.severity,
  ).toBe("none");
  expect(transcript.steps[11]?.output).toContain(transcript.proposal);
  expect(transcript.steps[12]?.output).toMatch(
    /^Accepted plans\.change_structure\./,
  );
});

test("14: the new runtime output guides the changed product; the old one no longer resolves", async ({
  page,
}) => {
  const before = manifest(transcript.baseArtifacts, "plans.change_structure");
  const after = manifest(transcript.headArtifacts, "plans.change_structure");
  expect(after.revision).not.toBe(before.revision);
  expect(before.steps[0]?.target).toBe("plans.change_structure");
  expect(after.steps[0]?.target).toBe("plans.restructure");
  await page.goto(`${HEAD}/plans`);
  const created = await page.request.post(`${HEAD}/api/clients`, {
    data: { name: "Head Client", email: "head@example.test" },
  });
  const { id } = (await created.json()) as { id: string };
  expect(
    (
      await page.request.post(`${HEAD}/api/plans`, {
        data: { title: "Head Plan", clientId: id },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await guide(page, before);
  await expect
    .poll(() => state(page))
    .toMatchObject({
      status: "target-missing",
      target: { id: "plans.change_structure", matches: "none" },
    });
  await page.reload();
  await guide(page, after);
  await expect
    .poll(() => state(page))
    .toMatchObject({
      status: "active",
      step: { id: "step.1", target: "plans.restructure" },
      target: { matches: "one" },
    });
  await target(page, "plans.restructure").click();
  await target(page, "plan.structure.selector").selectOption("weekly");
  await target(page, "plan.structure.submit").click();
  await expect.poll(() => state(page)).toMatchObject({ status: "completed" });
  await expect(
    page.getByText("Weekly structure", { exact: true }),
  ).toBeVisible();
});
