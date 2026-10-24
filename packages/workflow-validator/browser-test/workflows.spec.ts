import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import type { WorkflowV1 } from "@pathcompiler/workflow-ir";
import { expect, type Page, test } from "@playwright/test";
import {
  browserEvidenceItem,
  verifyWorkflowInBrowser,
  type WorkflowVerificationOptions,
} from "../src/browser.js";

let workflows: Map<string, WorkflowV1>;
test.beforeAll(async () => {
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  workflows = new Map(
    discoverWorkflows(
      capabilities.graph,
      capabilities.report,
      mined.report,
    ).report.candidates.map((candidate) => [
      candidate.workflow.id,
      candidate.workflow,
    ]),
  );
});
const inputs: WorkflowVerificationOptions["inputs"] = {
  "client.form.name": "Browser Client",
  "client.form.email": "browser@example.test",
  "plan.form.title": "Browser Plan",
  "plan.form.client": { index: 0 },
  "plan.structure.selector": "weekly",
};
const policy = {
  allowDestructive: [
    "client.form.deactivate",
    "client.deactivate.confirm",
    "plans.archive",
  ],
};
async function client(page: Page) {
  const response = await page.request.post("/api/clients", {
    data: { name: "Prepared Client", email: "prepared@example.test" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id as string;
}
async function plan(page: Page) {
  const clientId = await client(page);
  expect(
    (
      await page.request.post("/api/plans", {
        data: { title: "Prepared Plan", clientId },
      })
    ).status(),
  ).toBe(201);
}
const prepare: Record<string, (page: Page) => Promise<void>> = {
  "clients.create": async () => {},
  "clients.deactivate": async (page) => void (await client(page)),
  "plans.create": async (page) => void (await client(page)),
  "plans.change_structure": plan,
  "plans.archive": async (page) => {
    await plan(page);
    expect(
      (
        await page.request.post("/api/session", {
          data: { role: "admin", planStructure: true, planArchive: true },
        })
      ).status(),
    ).toBe(200);
  },
};

test("verifies every discovered fixture workflow and emits browser evidence", async ({
  page,
  baseURL,
}) => {
  expect([...workflows.keys()].sort()).toEqual(Object.keys(prepare).sort());
  for (const [id, workflow] of [...workflows].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    await page.context().clearCookies();
    const report = await verifyWorkflowInBrowser(workflow, {
      page,
      origin: baseURL ?? "",
      inputs,
      policy,
      ...(prepare[id] ? { prepare: prepare[id] } : {}),
    });
    expect(report.failure, id).toBeUndefined();
    expect(report).toMatchObject({
      valid: true,
      terminal: "passed",
      evidenceClass: "browser",
    });
    expect(browserEvidenceItem(report)).toMatchObject({
      class: "browser",
      stance: "supports",
    });
  }
});

test("refuses a destructive control the policy does not allow, before any action", async ({
  page,
  baseURL,
}) => {
  const report = await verifyWorkflowInBrowser(
    workflows.get("clients.deactivate"),
    {
      page,
      origin: baseURL ?? "",
      inputs,
    },
  );
  expect(report.failure).toMatchObject({
    stage: "preflight",
    code: "destructive-action-not-allowed",
  });
  expect(report.steps).toEqual([]);
  expect(page.url()).toBe("about:blank");
  expect(browserEvidenceItem(report).stance).toBe("contradicts");
});

test("fails clearly on stale and ambiguous targets", async ({
  page,
  baseURL,
}) => {
  const create = workflows.get("clients.create") as WorkflowV1;
  const stale = {
    ...create,
    steps: create.steps.map((step, index) =>
      index === 0 ? { ...step, target: "clients.create_old" } : step,
    ),
  };
  const missing = await verifyWorkflowInBrowser(stale, {
    page,
    origin: baseURL ?? "",
    inputs,
  });
  expect(missing.failure).toMatchObject({
    stage: "resolve",
    code: "target-not-found",
    stepId: "step.1",
    target: "clients.create_old",
  });
  // Two clients: the row-level Edit Client button is ambiguous.
  await page.context().clearCookies();
  const report = await verifyWorkflowInBrowser(
    workflows.get("clients.deactivate"),
    {
      page,
      origin: baseURL ?? "",
      inputs,
      policy,
      prepare: async (current) => {
        await client(current);
        await client(current);
      },
    },
  );
  expect(report.failure).toMatchObject({
    stage: "resolve",
    code: "ambiguous-target",
  });
  expect(report.steps[0]?.status).toBe("failed");
});

test("checks origins and input bindings before acting, and reports a seeded regression", async ({
  page,
  baseURL,
}) => {
  const create = workflows.get("clients.create") as WorkflowV1;
  expect(
    (
      await verifyWorkflowInBrowser(create, {
        page,
        origin: "https://preview.example.test",
        inputs,
      })
    ).failure?.code,
  ).toBe("unsupported-origin");
  expect(
    (await verifyWorkflowInBrowser(create, { page, origin: baseURL ?? "" }))
      .failure,
  ).toMatchObject({ stage: "preflight", code: "missing-input-binding" });
  // Seeded regression: the completion text the workflow expects is gone.
  const changed = {
    ...create,
    terminal: {
      type: "element_text" as const,
      target: "clients.feedback",
      text: "Client registered",
      match: "exact" as const,
    },
  };
  const report = await verifyWorkflowInBrowser(changed, {
    page,
    origin: baseURL ?? "",
    inputs,
    policy: { timeoutMs: 1_500 },
  });
  expect(report).toMatchObject({
    valid: false,
    terminal: "failed",
    failure: { stage: "terminal" },
  });
  expect(report.steps.every((step) => step.status === "passed")).toBe(true);
});
