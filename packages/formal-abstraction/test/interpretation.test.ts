import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { describe, expect, it } from "vitest";
import {
  type InterpretationHypothesis,
  interpretCapabilities,
} from "../src/index.js";

function analyze(files: Record<string, string>) {
  const graph = analyzeNextProject({
    repository: { commit: "a".repeat(40), dirty: false },
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
  }).graph;
  return {
    graph,
    capabilities: discoverCapabilities(graph).report.capabilities,
  };
}
// "Add Client" whose handler edits: the rule's create meaning is impossible.
const mislabeled = {
  "app/clients/page.tsx": `"use client";
async function save() { await fetch("/api/clients/1", { method: "PATCH" }); }
export default function Page() { return <button onClick={save}>Add Client</button>; }`,
  "app/api/clients/[id]/route.ts":
    "export async function PATCH() { return Response.json({}); }",
};
const hypothesis = (
  title: string,
  capabilityIds: string[],
  confidence = 0.8,
): InterpretationHypothesis => ({
  id: `h:${title}`,
  capabilityIds,
  title,
  confidence,
  status: "supported",
  rejections: [],
});

describe("capability interpretation", () => {
  it("keeps every deterministic meaning on the demo fixture", async () => {
    const project = await readSourceProject(
      fileURLToPath(new URL("../../../fixtures/next-demo/", import.meta.url)),
    );
    const mined = minePlaywrightTests(
      project,
      analyzeNextProject(project).graph,
    );
    const { capabilities } = discoverCapabilities(mined.graph).report;
    const report = interpretCapabilities({ graph: mined.graph, capabilities });
    expect(report.summary).toEqual({
      subjects: 6,
      changed: 0,
      ruleImpossible: 0,
      unresolved: 0,
    });
    for (const item of report.items) expect(item.best).toBe(item.subject);
  });

  it("removes meanings the handler's endpoint rules out and re-scores the rest", () => {
    const { graph, capabilities } = analyze(mislabeled);
    expect(capabilities.map((capability) => capability.id)).toEqual([
      "clients.create",
    ]);
    const report = interpretCapabilities({
      graph,
      capabilities,
      hypotheses: [
        hypothesis("Edit Client", ["clients.create"]),
        hypothesis("Edit Invoice", ["clients.create"], 0.9),
        hypothesis("Manage Client", ["clients.create"]),
        {
          ...hypothesis("Delete Client", ["clients.create"]),
          status: "rejected",
          rejections: ["unsupported-verb"],
        },
      ],
    });
    const [item] = report.items;
    expect(item).toMatchObject({
      subject: "clients.create",
      best: "clients.edit",
      changed: true,
      assessment: { confidence: { band: "low" } },
    });
    expect(
      item?.candidates.map((candidate) => [
        candidate.value,
        candidate.status,
        candidate.weight,
        candidate.violations.map((violation) => violation.split(":")[0]),
      ]),
    ).toEqual([
      ["clients.edit", "consistent", 1, []],
      ["clients.create", "impossible", 0, ["api-verb-mismatch"]],
      [
        "clients.delete",
        "impossible",
        0,
        ["api-verb-mismatch", "hypothesis-rejected"],
      ],
      ["invoices.edit", "impossible", 0, ["unknown-entity"]],
      ["unparsed:Manage Client", "impossible", 0, ["not-a-capability"]],
    ]);
    expect(report.summary).toEqual({
      subjects: 1,
      changed: 1,
      ruleImpossible: 1,
      unresolved: 0,
    });
    // Without a model, the impossible rule meaning leaves the subject unresolved.
    expect(
      interpretCapabilities({ graph, capabilities }).items[0],
    ).toMatchObject({
      best: null,
      changed: false,
    });
  });

  it("treats POST as compatible with any verb", () => {
    const { graph, capabilities } = analyze({
      "app/clients/page.tsx": `"use client";
async function send() { await fetch("/api/invitations", { method: "POST" }); }
export default function Page() { return <button onClick={send}>Invite Client</button>; }`,
      "app/api/invitations/route.ts":
        "export async function POST() { return Response.json({}); }",
    });
    const report = interpretCapabilities({ graph, capabilities });
    expect(report.items.map((item) => [item.subject, item.best])).toEqual([
      ["clients.invite", "clients.invite"],
    ]);
  });

  it("rejects a merge into another action with a different handler", () => {
    const { graph, capabilities } = analyze({
      "app/plans/page.tsx": `"use client";
async function make() { await fetch("/api/plans", { method: "POST" }); }
async function copy() { await fetch("/api/plans/1/duplicate", { method: "POST" }); }
export default function Page() { return <><button onClick={make}>Create Plan</button><button onClick={copy}>Duplicate Plan</button></>; }`,
      "app/api/plans/route.ts":
        "export async function POST() { return Response.json({}); }",
      "app/api/plans/[id]/duplicate/route.ts":
        "export async function POST() { return Response.json({}); }",
    });
    expect(capabilities.map((capability) => capability.id)).toEqual([
      "plans.create",
      "plans.duplicate",
    ]);
    const report = interpretCapabilities({
      graph,
      capabilities,
      subjects: ["plans.duplicate"],
      hypotheses: [
        hypothesis("Create Plan", ["plans.create", "plans.duplicate"]),
      ],
    });
    expect(report.items.map((item) => item.subject)).toEqual([
      "plans.duplicate",
    ]);
    expect(report.items[0]?.best).toBe("plans.duplicate");
    expect(report.items[0]?.candidates[1]).toMatchObject({
      value: "plans.create",
      status: "impossible",
    });
    expect(report.items[0]?.candidates[1]?.violations.join()).toContain(
      "duplicate-meaning",
    );
  });
});
