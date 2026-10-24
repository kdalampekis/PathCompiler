// Generates candidate tests from the fixture into browser-test/generated/
// so the browser suite runs exactly what the generator produces.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import { createProductReasoner } from "@pathcompiler/reasoner-core";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import { generateTests, TestSetupSchema } from "../dist/index.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo/", import.meta.url),
);
const output = fileURLToPath(
  new URL("../browser-test/generated/", import.meta.url),
);
const project = await readSourceProject(fixture);
const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
const capabilities = discoverCapabilities(mined.graph);
const model = buildFormalModel(
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
  const report = await generateTests({
    reasoner: createProductReasoner(solver),
    model,
    graph: capabilities.graph,
    setup,
    terminals,
  });
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const test of report.tests)
    await writeFile(`${output}${test.file}`, test.content);
  await writeFile(
    `${output}report.json`,
    `${JSON.stringify({ ...report, tests: report.tests.map(({ content, ...rest }) => rest) }, null, 2)}\n`,
  );
  console.log(
    `Generated ${report.tests.length} candidate tests; skipped ${report.skipped.length}.`,
  );
} finally {
  await solver.close();
}
