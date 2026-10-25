import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import type { FormalProductModel } from "@pathcompiler/formal-model";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type BrowserVerificationReportV2,
  diagnoseBrowserFailure,
} from "../src/index.js";

let model: FormalProductModel;
let sourceTargets: string[];
beforeAll(async () => {
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
});
/** A failed run of Archive Plan, stopped at `failure`. */
function failed(
  failure: NonNullable<BrowserVerificationReportV2["failure"]>,
  passed = 1,
): BrowserVerificationReportV2 {
  return {
    schemaVersion: 2,
    kind: "browser-verification",
    evidenceClass: "browser",
    workflowId: "plans.archive",
    workflowVersion: null,
    candidateCommit: null,
    origin: "http://127.0.0.1:3101",
    startedAt: "2026-10-24T10:00:00.000Z",
    finishedAt: "2026-10-24T10:00:01.000Z",
    valid: false,
    steps: [
      ...Array.from({ length: passed }, (_, index) => ({
        stepId: `step.${index + 1}`,
        target: "nav.plans",
        action: "click" as const,
        status: "passed" as const,
        expected: "passed" as const,
      })),
      ...(failure.stepId
        ? [
            {
              stepId: failure.stepId,
              target: failure.target ?? null,
              action: "click" as const,
              status: "failed" as const,
              expected: "not-run" as const,
            },
          ]
        : []),
    ],
    terminal: failure.stage === "terminal" ? "failed" : "not-run",
    destructiveAllowed: [],
    failure,
  };
}
const blocked = (target = "plans.archive") =>
  failed({
    code: "target-not-found",
    stage: "resolve",
    message: `${target} not found`,
    stepId: "step.2",
    target,
  });
const allOn = {
  role: "admin",
  plan_archive_enabled: true,
  plan_structure_enabled: true,
};

describe("browser failure diagnosis", () => {
  it("ranks a role the action's guard excludes first", () => {
    const diagnosis = diagnoseBrowserFailure({
      report: blocked(),
      model,
      sourceTargets,
      context: { ...allOn, role: "editor" },
    });
    expect(diagnosis.top).toBe("permission-mismatch");
    expect(diagnosis.causes[0]?.assessment.confidence.band).toBe("high");
  });

  it("ranks a disabled feature flag first", () => {
    const diagnosis = diagnoseBrowserFailure({
      report: blocked(),
      model,
      sourceTargets,
      context: { ...allOn, plan_archive_enabled: false },
    });
    expect(diagnosis.top).toBe("flag-mismatch");
  });

  it("ranks a target that is gone from the source first", () => {
    const diagnosis = diagnoseBrowserFailure({
      report: blocked("plans.archive_old"),
      model,
      sourceTargets,
      context: allOn,
    });
    expect(diagnosis.top).toBe("stale-target");
  });

  it("ranks the formal model first when it allowed what the page blocked", () => {
    const diagnosis = diagnoseBrowserFailure({
      report: blocked(),
      model,
      sourceTargets,
      context: allOn,
    });
    expect(diagnosis.top).toBe("formal-model-wrong");
  });

  it("separates backend changes from wrong outcomes with endpoint evidence", () => {
    const outcome = failed(
      {
        code: "terminal-failed",
        stage: "terminal",
        message: "Plan archived text not visible",
      },
      3,
    );
    expect(
      diagnoseBrowserFailure({
        report: outcome,
        model,
        sourceTargets,
        changedEndpoints: ["api:POST:/api/plans/:id/archive"],
      }).top,
    ).toBe("backend-changed");
    expect(
      diagnoseBrowserFailure({
        report: outcome,
        model,
        sourceTargets,
        changedEndpoints: [],
      }).top,
    ).toBe("formal-model-wrong");
  });

  it("ranks transport failures as network issues", () => {
    const diagnosis = diagnoseBrowserFailure({
      report: failed(
        {
          code: "origin-unavailable",
          stage: "open",
          message: "page.goto: net::ERR_CONNECTION_REFUSED",
        },
        0,
      ),
      model,
      sourceTargets,
    });
    expect(diagnosis.top).toBe("network-issue");
    expect(diagnosis.causes.map((item) => item.rank)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it("does not diagnose a passing run, and stays a hypothesis without evidence", () => {
    const passing = {
      ...failed({ code: "x", stage: "action", message: "x" }, 1),
      valid: true,
      terminal: "passed" as const,
    };
    const { failure: _failure, ...clean } = passing;
    expect(diagnoseBrowserFailure({ report: clean })).toMatchObject({
      top: null,
      causes: [],
    });
    // Without source, model or context, a blocked control is ambiguous.
    const bare = diagnoseBrowserFailure({ report: blocked() });
    expect(bare.meaning).toBe("hypothesis");
    expect(
      bare.causes
        .filter((item) => item.assessment.status === "supported")
        .every((item) => item.assessment.confidence.band !== "high"),
    ).toBe(true);
  });
});
