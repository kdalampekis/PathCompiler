import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import type { FormalProductModel } from "@pathcompiler/formal-model";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import type { WorkflowV1 } from "@pathcompiler/workflow-ir";
import { expect, type Page, test } from "@playwright/test";
import { verifyWorkflowInBrowser } from "../src/browser.js";
import { diagnoseBrowserFailure } from "../src/index.js";

let archive: WorkflowV1;
let model: FormalProductModel;
let sourceTargets: string[];
test.beforeAll(async () => {
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  model = buildFormalModel(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).model;
  sourceTargets = mined.graph.nodesByType("UIAction").flatMap((node) => {
    const id = (node.data?.target as { semanticId?: string } | undefined)
      ?.semanticId;
    return id ? [id] : [];
  });
  archive = discoverWorkflows(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).report.candidates.find(
    (candidate) => candidate.workflow.id === "plans.archive",
  )?.workflow as WorkflowV1;
});
/** A plan, and the session's role and flags; returns the formal context used. */
function seed(role: string, planArchive: boolean) {
  return async (page: Page) => {
    const client = await page.request.post("/api/clients", {
      data: { name: "Seed Client", email: "seed@example.test" },
    });
    const clientId = (await client.json()).id as string;
    await page.request.post("/api/plans", {
      data: { title: "Seed Plan", clientId },
    });
    await page.request.post("/api/session", {
      data: { role, planStructure: true, planArchive },
    });
  };
}
const options = (page: Page, origin: string) => ({
  page,
  origin,
  policy: {
    allowDestructive: ["plans.archive", "plans.archive_old"],
    timeoutMs: 3000,
  },
});

test("ranks the seeded cause first for real browser failures", async ({
  page,
  baseURL,
}) => {
  const origin = baseURL ?? "";
  const cases: [string, WorkflowV1, string, boolean, string][] = [
    ["editor role", archive, "editor", true, "permission-mismatch"],
    ["flag off", archive, "admin", false, "flag-mismatch"],
    [
      "renamed target",
      {
        ...archive,
        steps: archive.steps.map((step) =>
          step.target === "plans.archive"
            ? { ...step, target: "plans.archive_old" }
            : step,
        ),
      },
      "admin",
      true,
      "stale-target",
    ],
  ];
  for (const [name, workflow, role, planArchive, cause] of cases) {
    await page.context().clearCookies();
    const report = await verifyWorkflowInBrowser(workflow, {
      ...options(page, origin),
      prepare: seed(role, planArchive),
    });
    expect(report.valid, name).toBe(false);
    const diagnosis = diagnoseBrowserFailure({
      report,
      model,
      sourceTargets,
      context: {
        role,
        plan_archive_enabled: planArchive,
        plan_structure_enabled: true,
      },
    });
    expect(diagnosis.top, `${name}: ${report.failure?.code}`).toBe(cause);
  }
  // A policy refusal is not a product failure: no cause is supported.
  const refused = await verifyWorkflowInBrowser(archive, { page, origin });
  expect(refused.failure?.code).toBe("destructive-action-not-allowed");
  expect(
    diagnoseBrowserFailure({ report: refused, model, sourceTargets }).top,
  ).toBeNull();
  // Nothing listens on port 9: a transport failure.
  const offline = await verifyWorkflowInBrowser(archive, {
    ...options(page, "http://127.0.0.1:9"),
  });
  expect(
    diagnoseBrowserFailure({ report: offline, model, sourceTargets }).top,
  ).toBe("network-issue");
});
