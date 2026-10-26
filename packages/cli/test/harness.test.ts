import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseConfig } from "@pathcompiler/config";
import { deriveFindings } from "@pathcompiler/findings";
import { gateFindings } from "@pathcompiler/improvement-gate";
import { recommend } from "@pathcompiler/recommendation-engine";
import type { SemanticChangeReport } from "@pathcompiler/semantic-change";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => rm(item, { recursive: true, force: true })),
  );
});
const findings = deriveFindings(
  {
    semantic: {
      type: "semantic_change_report",
      commitRange: { base: "a".repeat(40), head: "b".repeat(40) },
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
  { detectedAt: "2026-10-25T12:00:00.000Z" },
);

describe("harness task", () => {
  it("writes a task only when the gate made the recommendation eligible", async () => {
    const policy = parseConfig("version: 1\n").improvement_policy;
    for (const autonomous of [false, true]) {
      const cwd = await mkdtemp(
        path.join(os.tmpdir(), "pathcompiler-harness-"),
      );
      temporary.push(cwd);
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
      const recommendations = recommend({ findings, gate });
      await mkdir(path.join(cwd, "out", "reports"), { recursive: true });
      await writeFile(
        path.join(cwd, "out", "reports", "gate-decisions.json"),
        JSON.stringify(gate),
      );
      await writeFile(
        path.join(cwd, "out", "reports", "recommendations.json"),
        JSON.stringify(recommendations),
      );
      const id = recommendations.recommendations[0]?.id as string;
      const run = runCli(
        ["harness", "task", id, "a".repeat(40), "--out", "out"],
        cwd,
      );
      if (!autonomous) {
        await expect(run).rejects.toThrow(
          "harness tasks need eligible_for_harness",
        );
        continue;
      }
      expect(await run).toContain(
        "Intended: restore-reachability clients.created [role=editor]",
      );
      expect(
        await readdir(path.join(cwd, "out", "harness", "tasks")),
      ).toHaveLength(1);
    }
  });
});
