import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { compileWorkflows } from "@pathcompiler/workflow-compiler";
import { beforeAll, describe, expect, it } from "vitest";
import {
  analyzeFixture,
  approveAllCandidates,
  baselineDiscovery,
  baselineStrategy,
  compareDiscoveryStrategies,
  type DiscoveryEvaluationReport,
  type DiscoveryStrategy,
  evaluateCapabilityExtraction,
  evaluateImpact,
  evaluateResolverAccuracy,
  evaluateWorkflowDiscovery,
  type FixtureAnalysis,
  type GroundTruth,
  loadGroundTruth,
  reasoningStrategy,
} from "../src/index.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo/", import.meta.url),
);
const golden = (name: string) => `./golden/${name}`;
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
/** Revisions hash workflow content including provenance; keep goldens readable. */
const redact = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value).replace(
      /"revision":"[^"]+"/g,
      '"revision":"<revision>"',
    ),
  );
let analysis: FixtureAnalysis;
let truth: GroundTruth;
beforeAll(async () => {
  [analysis, truth] = await Promise.all([
    analyzeFixture(fixture),
    loadGroundTruth(path.join(fixture, "eval")),
  ]);
});

describe("ground truth", () => {
  it("loads every reviewed file of the fixture", () => {
    expect(truth.capabilities).toHaveLength(6);
    expect(truth.workflows.map((item) => item.id)).toEqual([
      "clients.create",
      "clients.deactivate",
      "clients.edit",
      "plans.archive",
      "plans.change_structure",
      "plans.create",
    ]);
    expect(truth.impactCases.map((item) => item.id)).toEqual([
      "copy-change",
      "rename-structure-target",
    ]);
    expect(truth.queries?.cases.length).toBeGreaterThanOrEqual(20);
  });

  it("rejects invalid files with their path and the failing key", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "pathcompiler-truth-"),
    );
    try {
      await mkdir(path.join(directory, "workflows"));
      const file = path.join(directory, "workflows", "bad.yaml");
      await writeFile(
        file,
        "id: x\nentrypoint: /x\nsteps: []\nterminal:\n  type: route\n",
      );
      await expect(loadGroundTruth(directory)).rejects.toThrow(
        `Invalid ground truth ${file}: steps:`,
      );
      await rm(file);
      // Missing files are empty sets, not errors.
      expect(await loadGroundTruth(directory)).toMatchObject({
        capabilities: [],
        workflows: [],
        impactCases: [],
        queries: null,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("evaluation reports", () => {
  it("are deterministic and match the reviewed goldens", async () => {
    const run = async () => [
      evaluateCapabilityExtraction(analysis, truth),
      await evaluateWorkflowDiscovery(analysis, truth),
      evaluateResolverAccuracy(analysis, truth),
    ];
    const reports = await run();
    expect(reports).toEqual(await run());
    for (const report of reports)
      await expect(json(report)).toMatchFileSnapshot(
        golden(`${report.family}.report.json`),
      );
  });

  it("scores impact on edited Git copies of the fixture", async () => {
    const report = await evaluateImpact(fixture, truth);
    await expect(json(report)).toMatchFileSnapshot(
      golden("impact.report.json"),
    );
    expect(report.affectedRecall).toBe(1);
  }, 120_000);

  it("compares an alternative discovery strategy against the same truth", async () => {
    // Drops the first step, swaps the order of the input fields and invents a step.
    const mutated: DiscoveryStrategy = {
      name: "mutated",
      discover: (input) =>
        baselineDiscovery(input).map((workflow) =>
          workflow.id === "clients.create"
            ? {
                ...workflow,
                steps: [
                  ...workflow.steps.slice(1).reverse(),
                  {
                    ...(workflow.steps.at(
                      -1,
                    ) as (typeof workflow.steps)[number]),
                    id: "x",
                    target: "clients.extra",
                  },
                ],
              }
            : workflow,
        ),
    };
    const { strategies } = await compareDiscoveryStrategies(analysis, truth, [
      baselineStrategy,
      mutated,
    ]);
    const [baseline, worse] = strategies as [
      DiscoveryEvaluationReport,
      DiscoveryEvaluationReport,
    ];
    const item = (report: DiscoveryEvaluationReport) =>
      report.cases.find((entry) => entry.id === "clients.create");
    expect(worse.strategy).toBe("mutated");
    expect(item(baseline)).toMatchObject({
      majorStepScore: 1,
      editDistance: 0,
    });
    expect(item(worse)?.majorStepScore).toBeLessThan(1);
    expect(item(worse)?.editDistance).toBe(2);
    expect(item(worse)?.inventedSteps).toEqual(["clients.extra"]);
    expect(worse.inventedStepCount).toBe(baseline.inventedStepCount + 1);
    expect(worse.inventedStepRate).toBeGreaterThan(baseline.inventedStepRate);
  });

  it("compares reasoning-assisted discovery with the baseline", async () => {
    const solver = await createZ3SolverProvider();
    try {
      const report = await compareDiscoveryStrategies(analysis, truth, [
        baselineStrategy,
        reasoningStrategy(solver),
      ]);
      await expect(json(report)).toMatchFileSnapshot(
        golden("workflow-discovery-comparison.report.json"),
      );
      const [baseline, reasoning] = report.strategies as [
        DiscoveryEvaluationReport,
        DiscoveryEvaluationReport,
      ];
      expect(reasoning.recall).toBeGreaterThan(baseline.recall);
      expect(reasoning.inventedStepCount).toBe(0);
      expect(reasoning.applicabilityAccuracy).toBe(1);
    } finally {
      await solver.close();
    }
  }, 120_000);
});

describe("golden outputs", () => {
  it("summarize the product graph", async () => {
    const count = (items: { type: string }[]) =>
      Object.fromEntries(
        [...new Set(items.map((item) => item.type))]
          .sort()
          .map((type) => [
            type,
            items.filter((item) => item.type === type).length,
          ]),
      );
    const { nodes, edges } = analysis.capabilities.graph.toJSON();
    await expect(
      json({
        nodes: count(nodes),
        edges: count(edges),
        uiActions: nodes
          .filter((node) => node.type === "UIAction")
          .map((node) => node.id)
          .sort(),
      }),
    ).toMatchFileSnapshot(golden("graph.summary.json"));
  });

  it("summarize discovered candidates and the compiled runtime manifest", async () => {
    await expect(
      json(
        baselineDiscovery(analysis).map((workflow) => ({
          id: workflow.id,
          entrypoints: workflow.entrypoints.map((entry) => entry.route),
          steps: workflow.steps.map((step) =>
            `${step.action.type} ${step.target ?? ""}`.trim(),
          ),
          terminal: workflow.terminal,
        })),
      ),
    ).toMatchFileSnapshot(golden("candidates.summary.json"));
    await expect(
      json(
        redact(
          compileWorkflows(approveAllCandidates(analysis)).runtimeManifest,
        ),
      ),
    ).toMatchFileSnapshot(golden("runtime-manifest.json"));
  });
});
