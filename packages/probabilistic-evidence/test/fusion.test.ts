import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { describe, expect, it } from "vitest";
import {
  calibrate,
  type EvidenceClaim,
  type EvidenceItem,
  fuseEvidence,
  graphEvidenceItems,
} from "../src/index.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo/", import.meta.url),
);
const exists: EvidenceClaim = {
  id: "clients.deactivate.exists",
  type: "existence",
  subject: "clients.deactivate",
  statement: "Users can deactivate clients.",
};
const item = (
  id: string,
  evidenceClass: EvidenceItem["class"],
  stance: "supports" | "contradicts" = "supports",
  current = true,
): EvidenceItem => ({
  id,
  class: evidenceClass,
  stance,
  current,
  summary: id,
});

describe("evidence fusion", () => {
  it("settles deactivate vs archive on fixture evidence and flags the old docs as stale", async () => {
    const project = await readSourceProject(fixture);
    const mined = minePlaywrightTests(
      project,
      analyzeNextProject(project).graph,
    );
    const { graph, report } = discoverCapabilities(mined.graph);
    const capability = report.capabilities.find(
      (entry) => entry.id === "clients.deactivate",
    );
    const fromGraph = graphEvidenceItems(
      graph,
      capability?.evidenceNodeIds ?? [],
      {
        value: "clients.deactivate",
      },
    );
    expect(new Set(fromGraph.map((entry) => entry.class))).toEqual(
      new Set(["static", "test"]),
    );
    const result = fuseEvidence(
      {
        id: "clients.deactivate.name",
        type: "naming",
        subject: "clients.deactivate",
        statement: "The canonical name of this capability.",
        categorical: true,
      },
      [
        ...fromGraph,
        {
          id: "pr:42",
          class: "pr",
          value: "clients.deactivate",
          current: true,
          summary: 'PR title "Deactivate Client"',
        },
        {
          id: "docs/old/clients.md",
          class: "historical",
          value: "clients.archive",
          current: false,
          summary: 'Old docs say "Archive Client"',
        },
      ],
    );
    expect(result).toMatchObject({
      status: "supported",
      canonical: "clients.deactivate",
      confidence: { band: "high", meaning: "rule-strength-not-probability" },
      probability: { value: null },
      contradicting: ["docs/old/clients.md"],
    });
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        kind: "likely-stale-artifact",
        disagreeing: ["docs/old/clients.md"],
      }),
    ]);
  });

  it("follows the strongest tier instead of averaging", () => {
    const weakNoise = Array.from({ length: 20 }, (_, index) =>
      item(`model:${index}`, "model", "contradicts"),
    );
    const result = fuseEvidence(exists, [
      item("test:deactivate", "test"),
      item("ui:clients.deactivate", "static"),
      ...weakNoise,
    ]);
    expect(result.status).toBe("supported");
    expect(result.confidence.band).toBe("high");
    expect(result.conflicts.map((entry) => entry.kind)).toEqual([
      "unsupported-hypothesis",
    ]);
    // The same claim with twenty weak supporters and one strong contradiction.
    const reversed = fuseEvidence(exists, [
      item("test:deactivate", "test", "contradicts"),
      ...Array.from({ length: 20 }, (_, index) =>
        item(`docs:${index}`, "docs"),
      ),
    ]);
    expect(reversed.status).toBe("contradicted");
    expect(reversed.conflicts.map((entry) => entry.kind)).toEqual([
      "likely-stale-artifact",
    ]);
  });

  it("counts repeated evidence of one class once", () => {
    const result = fuseEvidence(
      exists,
      Array.from({ length: 10 }, (_, index) =>
        item(`symbol:${index}`, "static"),
      ),
    );
    expect(result.confidence.band).toBe("medium");
  });

  it("keeps uncertainty for contested and unexplained contradictions", () => {
    const contested = fuseEvidence(exists, [
      item("ui:a", "static"),
      item("ui:b", "static", "contradicts"),
    ]);
    expect(contested).toMatchObject({
      status: "contested",
      confidence: { band: "low" },
      probability: {
        value: null,
        reason: "Contested claims are not calibrated.",
      },
    });
    expect(contested.conflicts[0]?.kind).toBe("unresolved");
    const unexplained = fuseEvidence(exists, [
      item("test:a", "test"),
      item("ui:a", "static"),
      item("api:guard", "static", "contradicts"),
    ]);
    expect(unexplained.confidence.band).toBe("medium");
    expect(unexplained.conflicts.map((entry) => entry.kind)).toEqual([
      "unexplained-contradiction",
    ]);
    // A non-current item of a strong class reads as stale, not unexplained.
    const old = fuseEvidence(exists, [
      item("test:a", "test"),
      item("ui:a", "static"),
      item("ui:old", "static", "contradicts", false),
    ]);
    expect(old.confidence.band).toBe("high");
    expect(old.conflicts[0]?.kind).toBe("likely-stale-artifact");
  });

  it("ranks evidence by claim type: observed usage does not prove permission", () => {
    const permission: EvidenceClaim = {
      ...exists,
      id: "viewer.cannot",
      type: "permission",
      statement: "Viewers cannot deactivate clients.",
    };
    expect(
      fuseEvidence(permission, [
        item("events:viewer", "observed", "contradicts"),
        item("test:viewer", "test"),
      ]).status,
    ).toBe("supported");
    expect(
      fuseEvidence(exists, [
        item("events:usage", "observed"),
        item("test:a", "test", "contradicts"),
      ]).status,
    ).toBe("supported");
  });

  it("reports a probability only from a calibration with enough samples", () => {
    const items = [item("test:a", "test"), item("ui:a", "static")];
    expect(fuseEvidence(exists, items).probability).toEqual({
      value: null,
      reason:
        "No calibration table: the score is rule strength, not a probability.",
    });
    const few = calibrate("fixture", [{ band: "high", correct: true }]);
    expect(
      fuseEvidence(exists, items, { calibration: few }).probability,
    ).toEqual({
      value: null,
      reason: "Calibration fixture has 1 labeled high samples; 30 are needed.",
    });
    const enough = calibrate(
      "fixture",
      Array.from({ length: 40 }, (_, index) => ({
        band: "high" as const,
        correct: index < 36,
      })),
    );
    expect(
      fuseEvidence(exists, items, { calibration: enough }).probability,
    ).toEqual({
      value: 0.9,
      calibration: "fixture",
      samples: 40,
    });
  });

  it("is order-independent and validates its input", () => {
    const items = [
      item("test:a", "test"),
      item("ui:a", "static"),
      item("docs:old", "historical", "contradicts", false),
    ];
    expect(fuseEvidence(exists, [...items].reverse())).toEqual(
      fuseEvidence(exists, items),
    );
    expect(fuseEvidence(exists, []).status).toBe("insufficient");
    expect(() =>
      fuseEvidence(exists, [
        { id: "x", class: "static", current: true, summary: "x" },
      ]),
    ).toThrow("Evidence x needs a stance for claim clients.deactivate.exists.");
  });
});
