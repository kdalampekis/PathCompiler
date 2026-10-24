import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import { createProductReasoner } from "@pathcompiler/reasoner-core";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import { beforeAll, describe, expect, it } from "vitest";
import {
  freshStateModel,
  GENERATED_TEST_MARKER,
  type GenerationReport,
  generateTests,
  TestSetupSchema,
} from "../src/index.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo/", import.meta.url),
);
let report: GenerationReport;
let withoutSetup: GenerationReport;
let model: ReturnType<typeof buildFormalModel>["model"];
beforeAll(async () => {
  const project = await readSourceProject(fixture);
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  model = buildFormalModel(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).model;
  const terminals = Object.fromEntries(
    discoverWorkflows(
      capabilities.graph,
      capabilities.report,
      mined.report,
    ).report.candidates.map((candidate) => [
      candidate.capabilityId,
      candidate.workflow.terminal,
    ]),
  );
  const setup = TestSetupSchema.parse(
    JSON.parse(await readFile(`${fixture}eval/test-setup.json`, "utf8")),
  );
  const solver = await createZ3SolverProvider();
  try {
    const reasoner = createProductReasoner(solver);
    const input = { reasoner, model, graph: capabilities.graph, terminals };
    report = await generateTests({ ...input, setup });
    withoutSetup = await generateTests({ ...input, goals: ["plans.archived"] });
  } finally {
    await solver.close();
  }
}, 300_000);
const test = (file: string) => report.tests.find((item) => item.file === file);

describe("test generation", () => {
  it("starts plans from an empty product", () => {
    const fresh = freshStateModel(model);
    expect(JSON.stringify(fresh.initial)).toContain('"id":"client_exists"');
    expect(JSON.stringify(fresh.initial)).toContain('"id":"plan_exists"');
  });

  it("writes a positive test per goal and a negative test per proven block", () => {
    expect(report).toMatchObject({ reviewRequired: true, skipped: [] });
    expect(
      report.tests.filter((item) => item.kind === "positive"),
    ).toHaveLength(6);
    expect(
      report.tests
        .filter((item) => item.kind === "negative")
        .map((item) => item.file),
    ).toEqual([
      "clients.created.negative.role-unlisted.spec.ts",
      "clients.deactivated.negative.role-unlisted.spec.ts",
      "clients.edited.negative.role-unlisted.spec.ts",
      "plans.archived.negative.role-editor.spec.ts",
      "plans.archived.negative.role-unlisted.spec.ts",
      "plans.archived.negative.plan_archive_enabled-false.spec.ts",
      "plans.created.negative.role-unlisted.spec.ts",
      "plans.structure_changed.negative.role-unlisted.spec.ts",
      "plans.structure_changed.negative.plan_structure_enabled-false.spec.ts",
    ]);
    for (const item of report.tests)
      expect(item.content.startsWith(GENERATED_TEST_MARKER)).toBe(true);
  });

  it("creates prerequisites, sets context through the setup and asserts the terminal", () => {
    const archive = test("plans.archived.positive.spec.ts");
    // An empty product: create a client, then a plan, then archive it.
    expect(
      archive?.actions.filter(
        (id) => id.endsWith(".submit") || id.endsWith(".archive"),
      ),
    ).toEqual([
      "clients.create.submit",
      "plans.create.submit",
      "plans.archive.archive",
    ]);
    expect(archive?.content).toContain(
      'await page.locator("[data-pathcompiler=\\"demo.role\\"]").first().selectOption("admin");',
    );
    expect(archive?.content).toContain(
      'await page.locator("[data-pathcompiler=\\"demo.plan_archive\\"]").first().setChecked(true);',
    );
    expect(archive?.content).toContain('toHaveText("Plan archived");');
    expect(archive?.weakAssertion).toBe(false);
    // The model's catch-all role is set as the product's Viewer.
    expect(
      test("clients.created.negative.role-unlisted.spec.ts")?.content,
    ).toContain('selectOption("viewer")');
    // No completion signal for Edit Client: a weak, flagged assertion.
    const edit = test("clients.edited.positive.spec.ts");
    expect(edit?.weakAssertion).toBe(true);
    expect(edit?.content).toContain("// Review: no completion signal is known");
  });

  it("negative tests stop at a blocked control and assert the goal was not reached", () => {
    const negative =
      test("plans.archived.negative.role-editor.spec.ts")?.content ?? "";
    expect(negative).toContain("async function attempt(");
    expect(negative).toContain(
      'if (!(await attempt(page.locator("[data-pathcompiler=\\"plans.archive\\"]").first(), (target) => target.click()))) return;',
    );
    expect(negative).toContain('not.toHaveText("Plan archived");');
  });

  it("skips contexts the setup cannot establish instead of guessing", () => {
    expect(withoutSetup.tests).toEqual([]);
    expect(withoutSetup.skipped.map((item) => item.reason)).toContain(
      "The setup cannot establish plan_archive_enabled=true, plan_structure_enabled=true, role=admin.",
    );
  });
});
