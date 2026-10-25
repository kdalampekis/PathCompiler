import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import type { WorkflowV1 } from "@pathcompiler/workflow-ir";
import { expect, test } from "@playwright/test";
import { verifyCandidateWorkflows } from "../src/browser.js";
import { BrowserVerificationReportV2Schema } from "../src/index.js";

let workflows: WorkflowV1[];
test.beforeAll(async () => {
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  workflows = discoverWorkflows(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).report.candidates.map((candidate) => candidate.workflow);
});

test("runs the selected workflows against a candidate build and names its commit (I4)", async ({
  page,
  baseURL,
}) => {
  const candidateCommit = "c".repeat(40);
  const reports = await verifyCandidateWorkflows(workflows, {
    page,
    origin: baseURL ?? "",
    candidateCommit,
    select: ["clients.create", "plans.create"],
    inputs: {
      "client.form.name": "Candidate Client",
      "client.form.email": "candidate@example.test",
      "plan.form.title": "Candidate Plan",
      "plan.form.client": { index: 0 },
    },
    prepare: {
      "plans.create": async (current) => {
        const response = await current.request.post("/api/clients", {
          data: { name: "Prepared", email: "prepared@example.test" },
        });
        expect(response.status()).toBe(201);
      },
    },
  });
  expect(reports.map((report) => [report.workflowId, report.valid])).toEqual([
    ["clients.create", true],
    ["plans.create", true],
  ]);
  for (const report of reports) {
    expect(report.candidateCommit).toBe(candidateCommit);
    // The evaluator reads these reports through the Playwright-free schema.
    expect(BrowserVerificationReportV2Schema.parse(report)).toEqual(report);
  }
});
