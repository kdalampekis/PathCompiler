import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { createEdgeId, ProductGraph } from "@pathcompiler/graph-core";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { describe, expect, it } from "vitest";
import {
  CapabilityDiscoveryReportSchema,
  CapabilityExpectationsSchema,
  discoverCapabilities,
  evaluateCapabilities,
} from "../src/index.js";

function project(files: Record<string, string>) {
  return {
    repository: { commit: "a".repeat(40), dirty: false },
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
  };
}
function source(content: string) {
  return analyzeNextProject(
    project({
      "app/clients/page.tsx": `export default function Page() { return <>${content}</>; }`,
    }),
  ).graph;
}

describe("capability discovery", () => {
  it("identifies all six fixture capabilities and measures false positives independently", async () => {
    const directory = fileURLToPath(
      new URL("../../../fixtures/next-demo", import.meta.url),
    );
    const expected = CapabilityExpectationsSchema.parse(
      JSON.parse(
        await readFile(`${directory}/capabilities.expected.json`, "utf8"),
      ),
    );
    const input = await readSourceProject(directory);
    const technical = minePlaywrightTests(
      input,
      analyzeNextProject(input).graph,
    ).graph;
    const before = technical.serialize();
    const { graph, report } = discoverCapabilities(technical, {
      expectedCapabilityIds: expected.capabilityIds,
    });
    expect(report.capabilities.map((capability) => capability.id)).toEqual(
      expected.capabilityIds,
    );
    expect(report.evaluation).toMatchObject({
      status: "evaluated",
      falsePositiveCount: 0,
      falseNegativeCount: 0,
      matchedIds: expected.capabilityIds,
    });
    for (const capability of report.capabilities) {
      expect(capability).toMatchObject({
        status: "candidate",
        // Roles come from each endpoint's server guard: Archive Plan's
        // handler requires admin; the others require editor (or admin).
        roles:
          capability.id === "plans.archive" ? ["admin"] : ["admin", "editor"],
        rolesAreAuthoritative: false,
        reviewRequired: true,
        confidenceMeaning: "rule-strength-not-probability",
      });
      expect(capability.surfaceIds.length).toBeGreaterThan(0);
      expect(capability.apiEvidence).toEqual([
        {
          nodeId:
            capability.verb === "create"
              ? `api:POST:/api/${capability.domain}`
              : capability.verb === "archive"
                ? `api:POST:/api/${capability.domain}/:id/archive`
                : `api:PATCH:/api/${capability.domain}/:id`,
          association: "component-context",
        },
      ]);
      expect(
        capability.apiEvidence.every(
          (api) => api.association === "component-context",
        ),
      ).toBe(true);
      expect(
        capability.evidenceNodeIds.some((id) => id.startsWith("test:")),
      ).toBe(true);
      expect(
        capability.evidence.every(
          (ref) => ref.repositoryCommit === input.repository.commit,
        ),
      ).toBe(true);
      expect(graph.getNode(`capability:${capability.id}`)?.type).toBe(
        "Capability",
      );
    }
    expect(graph.nodesByType("WorkflowCandidate")).toEqual([]);
    expect(technical.serialize()).toBe(before);
    const unevaluated = discoverCapabilities(technical);
    expect(unevaluated.report.capabilities).toEqual(report.capabilities);
    expect(unevaluated.report.evaluation).toEqual({
      status: "not-evaluated",
      falsePositiveCount: null,
      falseNegativeCount: null,
    });
    expect(
      discoverCapabilities(technical, {
        expectedCapabilityIds: ["other.create"],
      }).report.capabilities,
    ).toEqual(report.capabilities);
    expect(() => discoverCapabilities(graph)).toThrow(
      "without Capability nodes",
    );
  });
  it("merges annotation, label and component inferences without losing their evidence", () => {
    const input = project({
      "app/clients/page.tsx": `import { AddClientModal } from '../../modal'; export default function Page({ role }) { if (role === 'editor') {} return <>
        <button data-pathcompiler="clients.create">Add Client</button><button>Create Client</button><AddClientModal/>
        <button>Save</button><button>Cancel</button><button>Back</button><p data-pathcompiler="clients.feedback">Create Client</p>
        <input data-pathcompiler="clients.import" aria-label="Import Client"/></>; }`,
      "modal.tsx": `export function AddClientModal() { async function submit() { await fetch('/api/clients', {method:'POST'}); } return <dialog><form aria-label="Create Client" onSubmit={submit}><button>Save</button></form></dialog>; }`,
      "app/api/clients/route.ts": `export function POST() { return Response.json({ok:true}); }`,
      "app/api/unrelated/route.ts": `export function DELETE() { return Response.json({ok:true}); }`,
    });
    const { report } = discoverCapabilities(analyzeNextProject(input).graph);
    expect(report.capabilities).toHaveLength(1);
    const capability = report.capabilities[0];
    expect(capability).toMatchObject({
      id: "clients.create",
      domain: "clients",
      verb: "create",
      entity: "client",
      roles: ["editor"],
      qualifier: null,
    });
    expect(capability?.inferences.map((inference) => inference.rule)).toEqual(
      expect.arrayContaining([
        "semantic-target",
        "accessible-name",
        "component-name",
      ]),
    );
    expect(capability?.surfaceIds.length).toBeGreaterThanOrEqual(4);
    expect(capability?.sourceNodeIds).toEqual(
      expect.arrayContaining([
        "ui:clients.create",
        "component:modal.tsx#AddClientModal",
        "api:POST:/api/clients",
      ]),
    );
    expect(capability?.sourceNodeIds).not.toContain(
      "api:DELETE:/api/unrelated",
    );
    expect(capability?.apiEvidence).toEqual([
      { nodeId: "api:POST:/api/clients", association: "handler" },
    ]);
    expect(capability?.confidence).toBe(0.85);
  });
  it("keeps semantic identity through moves, label conflicts, alias verbs and input reordering", () => {
    const first = source(
      '<button data-pathcompiler="clients.add">Add Client</button><button data-pathcompiler="clients.create">Create Client</button>',
    );
    const result = discoverCapabilities(first);
    expect(
      result.report.capabilities.map((capability) => capability.id),
    ).toEqual(["clients.create"]);
    expect(result.report.capabilities[0]?.confidence).toBe(0.8);
    const moved = analyzeNextProject(
      project({
        "app/renamed/page.tsx":
          'export default function Renamed() { return <button data-pathcompiler="clients.create">Delete Customer</button>; }',
      }),
    ).graph;
    const changed = discoverCapabilities(moved);
    expect(changed.report.capabilities[0]?.id).toBe("clients.create");
    expect(changed.report.capabilities[0]?.reviewReasons).toContain(
      "semantic-label-conflict",
    );
    const snapshot = first.toJSON();
    snapshot.nodes.reverse();
    snapshot.edges.reverse();
    const reversed = discoverCapabilities(ProductGraph.fromJSON(snapshot));
    expect(reversed.graph.serialize()).toBe(result.graph.serialize());
    expect(JSON.stringify(reversed.report)).toBe(JSON.stringify(result.report));
  });
  it("keeps weak naming evidence low-confidence and always requires review", () => {
    const { report } = discoverCapabilities(
      source(
        "<button>Add Client</button><button>Archive Client</button><button>Deactivate Client</button>",
      ),
    );
    expect(report.capabilities.map((capability) => capability.id)).toEqual([
      "clients.archive",
      "clients.create",
      "clients.deactivate",
    ]);
    for (const capability of report.capabilities) {
      expect(capability).toMatchObject({
        confidence: 0.6,
        confidenceBand: "low",
        reviewRequired: true,
        roles: [],
      });
      expect(capability.reviewReasons).toEqual(
        expect.arrayContaining(["low-confidence", "roles-unresolved"]),
      );
    }
    const component = analyzeNextProject(
      project({
        "app/clients/page.tsx":
          "function InviteClientDialog() { return <dialog/>; } export default function Page() { return <InviteClientDialog/>; }",
      }),
    ).graph;
    expect(
      discoverCapabilities(component).report.capabilities[0],
    ).toMatchObject({
      id: "clients.invite",
      confidence: 0.5,
      confidenceBand: "low",
    });
  });
  it("does not promote observation/confirmation controls, API-only code, unused components or prose", () => {
    const input = project({
      "app/clients/page.tsx": `export default function Page() { return <><p data-pathcompiler="clients.delete">Delete Client</p><button data-pathcompiler="client.deactivate.confirm">Confirm Deactivation</button><button data-pathcompiler="client.form.submit">Save Client</button><button>Close</button><input aria-label="Create Client"/></>; }`,
      "unused.tsx": `export function DeleteClientDialog() { return <button>Delete Client</button>; }`,
      "app/api/clients/route.ts": `export function POST() { return Response.json({ok:true}); }`,
    });
    const graph = analyzeNextProject(input).graph;
    graph.addNode({
      id: "pr:1",
      type: "PullRequest",
      data: {
        title: "Create Client",
        headSha: "b".repeat(40),
        url: "https://github.com/example/product/pull/1",
      },
    });
    expect(discoverCapabilities(graph).report.capabilities).toEqual([]);
  });
  it("uses mapped test actions as evidence strength without claiming execution or inflating duplicate support", () => {
    const input = project({
      "app/clients/page.tsx":
        'export default function Page() { return <button data-pathcompiler="clients.create">Create Client</button>; }',
      "tests/create.spec.ts": `import {test,expect} from '@playwright/test'; test('create', async ({page}) => { await page.locator('[data-pathcompiler="clients.create"]').click(); });`,
    });
    const run = () =>
      discoverCapabilities(
        minePlaywrightTests(input, analyzeNextProject(input).graph).graph,
      ).report.capabilities[0];
    expect(run()?.confidence).toBe(0.9);
    const test = input.files[1];
    if (!test) throw new Error("Missing test source");
    test.content = test.content.replace("test('create'", "test.skip('create'");
    expect(run()?.confidence).toBe(0.8);
    test.content = `import {test,expect} from '@playwright/test'; test('disabled', async ({page}) => { await expect(page.locator('[data-pathcompiler="clients.create"]')).toBeDisabled(); });`;
    expect(run()?.confidence).toBe(0.8);
  });
  it("retains linked history and PR provenance and rejects dangling or stale report evidence", () => {
    const technical = source(
      '<button data-pathcompiler="clients.create">Create Client</button>',
    );
    technical.addNode({
      id: "commit:old",
      type: "Commit",
      data: { sha: "b".repeat(40), message: "Historical intent" },
    });
    technical.addNode({
      id: "pr:1",
      type: "PullRequest",
      data: {
        headSha: "c".repeat(40),
        url: "https://github.com/example/product/pull/1",
      },
    });
    for (const [type, from, to] of [
      ["CHANGED_BY", "ui:clients.create", "commit:old"],
      ["SUPPORTED_BY", "commit:old", "pr:1"],
    ] as const)
      technical.addEdge({
        id: createEdgeId(type, from, to),
        type,
        source: from,
        target: to,
      });
    const { report } = discoverCapabilities(technical, {
      expectedCapabilityIds: ["clients.create"],
    });
    expect(report.capabilities[0]?.evidenceNodeIds).toEqual(
      expect.arrayContaining(["commit:old", "pr:1"]),
    );
    expect(report.evidence.refs).toContainEqual(
      expect.objectContaining({
        id: "commit:old",
        repositoryCommit: "b".repeat(40),
      }),
    );
    const capability = report.capabilities[0];
    if (!capability) throw new Error("Missing capability");
    for (const invalid of [
      { id: "clients.edit" },
      { id: "malformed" },
      { sourceNodeIds: ["missing"] },
      { roles: ["admin"] },
      { reviewRequired: false },
      { confidence: 0.2 },
      {
        evidence: [
          {
            file: "app/clients/page.tsx",
            locator: "fake",
            repositoryCommit: "old",
          },
        ],
      },
    ])
      expect(
        CapabilityDiscoveryReportSchema.safeParse({
          ...report,
          capabilities: [{ ...capability, ...invalid }],
        }).success,
      ).toBe(false);
    expect(
      CapabilityDiscoveryReportSchema.safeParse({
        ...report,
        evaluation: { ...report.evaluation, falsePositiveCount: 9 },
      }).success,
    ).toBe(false);
  });
  it("reports false positives and negatives without hiding unknown ground truth or duplicates", () => {
    expect(
      evaluateCapabilities(
        ["clients.create", "clients.delete"],
        ["clients.create", "clients.edit"],
      ),
    ).toEqual({
      status: "evaluated",
      expectedIds: ["clients.create", "clients.edit"],
      matchedIds: ["clients.create"],
      falsePositiveIds: ["clients.delete"],
      falseNegativeIds: ["clients.edit"],
      falsePositiveCount: 1,
      falseNegativeCount: 1,
    });
    expect(() =>
      evaluateCapabilities([], ["clients.create", "clients.create"]),
    ).toThrow("unique");
    expect(evaluateCapabilities([], [])).toMatchObject({
      status: "evaluated",
      falsePositiveCount: 0,
    });
  });
});
