import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import type { WorkflowV1 } from "@pathcompiler/workflow-ir";
import { expect, test } from "@playwright/test";
import {
  BrowserVerificationReportSchema,
  verifyFixtureWorkflow,
} from "../src/browser.js";
import { validateWorkflow } from "../src/index.js";

let workflow: WorkflowV1;
const inputs = {
  "client.form.name": "Phase Ten Client",
  "client.form.email": "phase-ten@example.test",
};
test.beforeAll(async () => {
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  const candidate = discoverWorkflows(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).report.candidates.find(
    (candidate) => candidate.workflow.id === "clients.create",
  );
  if (!candidate)
    throw new Error("Expected automatically discovered clients.create");
  expect(
    validateWorkflow(candidate.workflow, {
      graph: mined.graph,
      traces: mined.report,
    }).valid,
  ).toBe(true);
  workflow = candidate.workflow;
});

test("verifies automatically discovered clients.create and writes browser evidence", async ({
  page,
  baseURL,
}, info) => {
  const report = await verifyFixtureWorkflow(workflow, {
    page,
    baseURL: baseURL ?? "",
    inputs,
  });
  expect(report.failure).toBeUndefined();
  expect(report.valid).toBe(true);
  expect(report.steps).toHaveLength(4);
  expect(report.steps.every((step) => step.status === "passed")).toBe(true);
  expect(report.steps.at(-1)?.expected).toBe("passed");
  expect(report.terminal).toBe("passed");
  expect(report.candidateCommit).toBe(workflow.repository.commit);
  expect(BrowserVerificationReportSchema.parse(report)).toEqual(report);
  const json = JSON.stringify(report, null, 2);
  expect(json).not.toContain(inputs["client.form.name"]);
  expect(json).not.toContain(inputs["client.form.email"]);
  await expect(
    page.getByRole("heading", {
      name: inputs["client.form.name"],
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: inputs["client.form.name"],
      exact: true,
    }),
  ).toBeVisible();
  const output = info.outputPath("browser-evidence.json");
  await writeFile(output, `${json}\n`);
  await info.attach("browser-evidence", {
    path: output,
    contentType: "application/json",
  });
});

test("fails usefully when a previously discovered semantic target disappears", async ({
  page,
  baseURL,
}, info) => {
  await page.addInitScript(() => {
    const removeTarget = () => {
      for (const element of document.querySelectorAll(
        '[data-pathcompiler="clients.create"]',
      ))
        element.removeAttribute("data-pathcompiler");
    };
    new MutationObserver(removeTarget).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-pathcompiler"],
    });
  });
  const report = await verifyFixtureWorkflow(workflow, {
    page,
    baseURL: baseURL ?? "",
    inputs,
    timeoutMs: 500,
  });
  expect(report.valid).toBe(false);
  expect(report.failure).toMatchObject({
    code: "target-not-found",
    stage: "resolve",
    stepId: "step.1",
    target: "clients.create",
  });
  expect(report.failure?.message).toContain("stale annotations");
  expect(report.steps.slice(1).every((step) => step.status === "not-run")).toBe(
    true,
  );
  expect(report.terminal).toBe("not-run");
  await info.attach("stale-target-evidence", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
});

test("refuses ambiguous rendered targets before clicking", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () => {
      const duplicate = document.createElement("button");
      duplicate.setAttribute("data-pathcompiler", "clients.create");
      document.body.append(duplicate);
    }),
  );
  const report = await verifyFixtureWorkflow(workflow, {
    page,
    baseURL: baseURL ?? "",
    inputs,
    timeoutMs: 500,
  });
  expect(report.failure).toMatchObject({
    code: "ambiguous-target",
    stage: "resolve",
  });
  expect(report.steps[0]?.status).toBe("failed");
});

test("honors the supplied viewer session and stops before the unavailable action", async ({
  page,
  baseURL,
}) => {
  const response = await page.request.post("/api/session", {
    data: { role: "viewer", planStructure: true },
  });
  expect(response.ok()).toBe(true);
  const report = await verifyFixtureWorkflow(workflow, {
    page,
    baseURL: baseURL ?? "",
    inputs,
    timeoutMs: 500,
  });
  // Viewers never receive the Create Client control, so nothing is clicked.
  expect(report.failure).toMatchObject({
    code: "target-not-found",
    stage: "resolve",
    stepId: "step.1",
  });
  expect(report.valid).toBe(false);
  expect(report.steps.slice(1).every((step) => step.status === "not-run")).toBe(
    true,
  );
  expect(report.terminal).toBe("not-run");
});

test("reports failed expected transitions and terminal assertions separately", async ({
  page,
  baseURL,
  context,
}) => {
  const wrongExpected = structuredClone(workflow);
  const first = wrongExpected.steps[0];
  if (!first) throw new Error("Missing step");
  first.expected = {
    type: "element_text",
    target: "clients.feedback",
    match: "exact",
    text: "No such success",
  };
  const expected = await verifyFixtureWorkflow(wrongExpected, {
    page,
    baseURL: baseURL ?? "",
    inputs,
    timeoutMs: 500,
  });
  expect(expected.failure?.stage).toBe("expected");
  expect(expected.steps[0]?.expected).toBe("failed");
  expect(expected.terminal).toBe("not-run");
  const otherPage = await context.newPage();
  const wrongTerminal = structuredClone(workflow);
  wrongTerminal.terminal = {
    type: "element_text",
    target: "clients.feedback",
    match: "exact",
    text: "No such success",
  };
  const terminal = await verifyFixtureWorkflow(wrongTerminal, {
    page: otherPage,
    baseURL: baseURL ?? "",
    inputs,
    timeoutMs: 1_000,
  });
  expect(terminal.failure?.stage).toBe("terminal");
  expect(terminal.terminal).toBe("failed");
  expect(terminal.steps.every((step) => step.status === "passed")).toBe(true);
});

test("rejects unsupported destinations, stale plans and missing bindings without opening the app", async ({
  page,
  baseURL,
}) => {
  const remote = await verifyFixtureWorkflow(workflow, {
    page,
    baseURL: "https://example.test",
    inputs,
  });
  expect(remote.failure?.code).toBe("unsupported-fixture-url");
  expect(page.url()).toBe("about:blank");
  const stale = structuredClone(workflow);
  const first = stale.steps[0];
  if (!first) throw new Error("Missing step");
  first.target = "clients.stale";
  const plan = await verifyFixtureWorkflow(stale, {
    page,
    baseURL: baseURL ?? "",
    inputs,
  });
  expect(plan.failure?.code).toBe("unsupported-fixture-step");
  expect(page.url()).toBe("about:blank");
  const missing = await verifyFixtureWorkflow(workflow, {
    page,
    baseURL: baseURL ?? "",
    inputs: { ...inputs, "client.form.name": "" },
  });
  expect(missing.failure?.code).toBe("invalid-options");
  expect(page.url()).toBe("about:blank");
  expect(missing.steps).toEqual([]);
});
