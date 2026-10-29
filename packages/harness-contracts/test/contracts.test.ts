import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseConfig } from "@pathcompiler/config";
import { deriveFindings } from "@pathcompiler/findings";
import { gateFindings } from "@pathcompiler/improvement-gate";
import { recommend } from "@pathcompiler/recommendation-engine";
import type { SemanticChangeReport } from "@pathcompiler/semantic-change";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  contractJsonSchemas,
  createHarnessTask,
  evaluationCriteria,
  HarnessContractError,
  parseHarnessTask,
  parseMutationResult,
  runFixtureHarness,
} from "../src/index.js";

const at = "2026-10-25T12:00:00.000Z";
const base = "a".repeat(40);
// Editors lost Create Client (R11), confirmed by observed sessions.
const findings = deriveFindings(
  {
    semantic: {
      type: "semantic_change_report",
      commitRange: { base, head: "b".repeat(40) },
      removedReachability: [
        {
          goal: "clients.created",
          capabilityId: "clients.create",
          context: { role: "editor" },
        },
      ],
      newReachability: [],
      affectedWorkflows: [],
    } as unknown as SemanticChangeReport,
  },
  { detectedAt: at },
);
const policy = parseConfig("version: 1\n").improvement_policy;
function setup(autonomous: boolean) {
  const gate = gateFindings(
    findings,
    {
      ...policy,
      min_confidence: 0.5,
      autonomous_mutation: autonomous,
      max_autonomous_mutations: 1,
    },
    { usage: { "clients.create": { affected: 400, eligible: 800 } } },
  );
  const [recommendation] = recommend({
    findings,
    gate,
    approvedWorkflows: ["clients.create", "plans.create"],
    properties: [
      {
        id: "viewer-never-creates",
        kind: "never",
        description: "Viewers never create clients",
      },
    ],
    generatedAt: at,
  }).recommendations;
  if (!recommendation) throw new Error("expected a recommendation");
  const decision = gate.decisions.find(
    (item) => item.opportunityId === recommendation.opportunityId,
  );
  if (!decision) throw new Error("expected a gate decision");
  return { recommendation, decision };
}
const examples = fileURLToPath(
  new URL("../../../examples/harness-contract/", import.meta.url),
);
const fixtures = fileURLToPath(
  new URL("../../../fixtures/harness/", import.meta.url),
);
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));

describe("harness contract", () => {
  it("creates a task only for an eligible gate decision, with lineage and criteria", () => {
    const { recommendation, decision } = setup(true);
    const task = createHarnessTask({
      recommendation,
      gate: decision,
      projectId: "next-demo",
      baseCommit: base,
    });
    expect(task).toMatchObject({
      schemaVersion: CONTRACT_VERSION,
      recommendationId: recommendation.id,
      findingIds: recommendation.findingIds,
      repository: { projectId: "next-demo", baseCommit: base },
      objective: {
        desiredSemanticChange: [
          {
            kind: "restore-reachability",
            goal: "clients.created",
            context: "role=editor",
          },
        ],
      },
      constraints: {
        protectedBehaviors: [{ id: "viewer-never-creates" }],
        hard: ["approved workflow plans.create must stay valid"],
      },
      outputContract: { artifact: "MutationResult", schemaVersion: "1.0" },
    });
    expect(evaluationCriteria(task)).toEqual({
      expectedChanges: [
        {
          goal: "clients.created",
          change: "reachability-added",
          context: { role: "editor" },
        },
      ],
      recommendationId: recommendation.id,
    });
    const blocked = setup(false);
    expect(() =>
      createHarnessTask({
        recommendation: blocked.recommendation,
        gate: blocked.decision,
        projectId: "next-demo",
        baseCommit: base,
      }),
    ).toThrow(HarnessContractError);
  });

  it("round-trips results, keeps lineage and rejects unsafe input", () => {
    const { recommendation, decision } = setup(true);
    const task = createHarnessTask({
      recommendation,
      gate: decision,
      projectId: "next-demo",
      baseCommit: base,
    });
    const done = runFixtureHarness(task, {
      outcome: "complete",
      candidateCommit: "c".repeat(40),
    });
    expect(parseMutationResult(JSON.parse(JSON.stringify(done)), task)).toEqual(
      done,
    );
    expect(evaluationCriteria(task, done).mutation).toMatchObject({
      id: done.id,
      claimedOutcome: "success",
    });
    const blocked = runFixtureHarness(task, {
      outcome: "block",
      reason: "A compliance test requires the confirmation step.",
    });
    expect(blocked).toMatchObject({
      status: "blocked",
      unresolvedQuestions: [expect.stringContaining("compliance")],
    });
    expect(evaluationCriteria(task, blocked).mutation?.claimedOutcome).toBe(
      "failed",
    );
    expect(() => parseHarnessTask({ ...task, schemaVersion: "2.0" })).toThrow(
      "Unsupported major version",
    );
    expect(() => parseHarnessTask({ ...task, deployNow: true })).toThrow();
    expect(() =>
      parseMutationResult({ ...done, harnessTaskId: "task:other" }, task),
    ).toThrow("answers task:other");
    expect(() =>
      parseMutationResult({ ...done, repository: { baseCommit: base } }),
    ).toThrow("names no candidate commit");
  });

  it("ships example and fixture files that match the contract and the published schemas", async () => {
    expect(await json(`${examples}HarnessTaskSpec.schema.json`)).toEqual(
      contractJsonSchemas().HarnessTaskSpec,
    );
    expect(await json(`${examples}MutationResult.schema.json`)).toEqual(
      contractJsonSchemas().MutationResult,
    );
    const task = parseHarnessTask(await json(`${examples}task.json`));
    parseMutationResult(await json(`${examples}result.json`), task);
    parseMutationResult(await json(`${examples}blocked-result.json`), task);
    const partial = parseMutationResult(
      await json(`${examples}partial-result.json`),
      task,
    );
    expect(partial.harnessMetadata.previousRunId).toBe("example-blocked");
    parseMutationResult(
      await json(`${examples}unexpected-change-result.json`),
      task,
    );
    const fixtureTask = parseHarnessTask(
      await json(`${fixtures}tasks/restore-editor-create-client.json`),
    );
    parseMutationResult(
      await json(
        `${fixtures}results/restore-editor-create-client.completed.json`,
      ),
      fixtureTask,
    );
    parseMutationResult(
      await json(
        `${fixtures}results/restore-editor-create-client.blocked.json`,
      ),
      fixtureTask,
    );
    for (const name of ["partial", "unexpected-change"])
      parseMutationResult(
        await json(
          `${fixtures}results/restore-editor-create-client.${name}.json`,
        ),
        fixtureTask,
      );
  });
});
