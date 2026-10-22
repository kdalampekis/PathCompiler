import { fileURLToPath } from "node:url";
import {
  analyzeNextProject,
  scanNextRepository,
} from "@pathcompiler/adapter-nextjs";
import { createEdgeId, ProductGraph } from "@pathcompiler/graph-core";
import { describe, expect, it } from "vitest";
import {
  discoverProductSurfaces,
  ProductSurfaceReportSchema,
  parseCapabilityClassification,
  parseEvidenceSummary,
  type SemanticModel,
} from "../src/index.js";

function project(overrides: Record<string, string> = {}) {
  return {
    repository: { commit: "a".repeat(40), dirty: false },
    files: Object.entries({
      "app/admin/clients/page.tsx": `import { AddClientModal, DetailPanel } from '../../../components';
      export default function ClientsPage() { return <main><button data-pathcompiler="clients.create">Add Client</button>
        <AddClientModal onClose={() => {}}/><DetailPanel/><a href="/plans">Plans</a>
        <p data-pathcompiler="clients.feedback">Saved</p></main>; }`,
      "app/plans/page.tsx": `import { AddClientModal } from '../../components'; export default function PlansPage() { return <AddClientModal/>; }`,
      "components.tsx": `export function AddClientModal() { return <dialog aria-label="Create Client" data-pathcompiler="clients.dialog">
      <form data-pathcompiler="clients.form"><span><input aria-label="Name" data-pathcompiler="clients.name"/></span><button data-pathcompiler="clients.save">Save</button></form></dialog>; }
      export function DetailPanel() { return <div>Details</div>; }
      export function UnusedModal() { return <button>Unreachable</button>; }`,
      "app/api/clients/route.ts": `export function POST() { return Response.json({ok: true}); }`,
      ...overrides,
    }).map(([path, content]) => ({ path, content })),
  };
}
function discovery(overrides: Record<string, string> = {}) {
  return discoverProductSurfaces(analyzeNextProject(project(overrides)).graph);
}

describe("deterministic product surfaces", () => {
  it("promotes routes, controls, native containers and named panels with nested provenance", () => {
    const { graph, report } = discovery();
    const byAnchor = new Map(
      report.surfaces.map((surface) => [surface.anchorNodeId, surface]),
    );
    const page = byAnchor.get("route:/admin/clients");
    expect(page).toMatchObject({
      kind: "page",
      title: "Clients",
      status: "candidate",
      heuristic: true,
    });
    expect(byAnchor.get("ui:clients.create")).toMatchObject({
      kind: "action",
      title: "Add Client",
      parentIds: [page?.id],
    });
    const modal = byAnchor.get("ui:clients.dialog");
    expect(modal).toMatchObject({
      kind: "modal",
      title: "Create Client",
      routeIds: ["route:/admin/clients", "route:/plans"],
      parentIds: [page?.id, "surface:page:route:/plans"],
    });
    expect(byAnchor.get("ui:clients.form")).toMatchObject({
      kind: "form",
      parentIds: [modal?.id],
    });
    expect(byAnchor.get("ui:clients.save")?.parentIds).toEqual([
      "surface:form:ui:clients.form",
    ]);
    expect(byAnchor.get("ui:clients.name")).toMatchObject({
      kind: "action",
      title: "Name",
      parentIds: ["surface:form:ui:clients.form"],
    });
    expect(byAnchor.get("component:components.tsx#DetailPanel")).toMatchObject({
      kind: "panel",
      rule: "component-name",
      parentIds: [page?.id],
    });
    expect(byAnchor.has("component:components.tsx#AddClientModal")).toBe(false);
    expect(byAnchor.has("ui:clients.feedback")).toBe(false);
    expect(
      report.surfaces.some((surface) =>
        surface.anchorNodeId.includes("UnusedModal"),
      ),
    ).toBe(false);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unreachable-surface" }),
    );
    expect(graph.nodesByType("Capability")).toEqual([]);
    expect(graph.nodesByType("WorkflowCandidate")).toEqual([]);
    for (const surface of report.surfaces) {
      expect(
        surface.evidence.every(
          (ref) => ref.repositoryCommit === "a".repeat(40),
        ),
      ).toBe(true);
      expect(graph.toJSON().edges).toContainEqual(
        expect.objectContaining({
          source: surface.id,
          target: surface.anchorNodeId,
          type: "SUPPORTED_BY",
        }),
      );
      expect(surface.sourceNodeIds).toContain(surface.anchorNodeId);
    }
  });
  it("keeps source immutable and returns identical artifacts for reordered input", () => {
    const input = project();
    const source = analyzeNextProject(input).graph;
    const before = source.serialize();
    const first = discoverProductSurfaces(source);
    input.files.reverse();
    const snapshot = analyzeNextProject(input).graph.toJSON();
    snapshot.nodes.reverse();
    snapshot.edges.reverse();
    const second = discoverProductSurfaces(ProductGraph.fromJSON(snapshot));
    expect(second.graph.serialize()).toBe(first.graph.serialize());
    expect(JSON.stringify(second.report)).toBe(JSON.stringify(first.report));
    expect(source.serialize()).toBe(before);
    expect(() => discoverProductSurfaces(first.graph)).toThrow(
      "technical evidence graph",
    );
  });
  it("retains semantic action IDs across labels and source file moves", () => {
    const first = discovery().report.surfaces.find(
      (surface) => surface.anchorNodeId === "ui:clients.create",
    );
    const input = project();
    const file = input.files.find(
      (file) => file.path === "app/admin/clients/page.tsx",
    );
    if (!file) throw new Error("Missing test page");
    file.content = file.content.replace(
      "Add Client</button>",
      "Create customer</button>",
    );
    file.path = "app/admin/customers/page.tsx";
    const second = discoverProductSurfaces(
      analyzeNextProject(input).graph,
    ).report.surfaces.find(
      (surface) => surface.anchorNodeId === "ui:clients.create",
    );
    expect(second?.id).toBe(first?.id);
    expect(second?.title).toBe("Create customer");
    expect(second?.evidence).not.toEqual(first?.evidence);
  });
  it("does not infer containment from navigation, callbacks or custom role props", () => {
    const { report } = discovery({
      "app/boundaries/page.tsx": `function Custom() { return <p/>; }
      export default function Boundaries() { return <><dialog data-pathcompiler="boundary.dialog"><form data-pathcompiler="boundary.form">
        <button data-pathcompiler="boundary.button" onClick={() => <button data-pathcompiler="callback.button">Callback</button>}>Save</button>
        </form></dialog><Custom role="dialog" data-pathcompiler="custom.dialog"/><div role="region" aria-label="Account"/>
        <a data-pathcompiler="to.clients" href="/admin/clients">Clients</a><div role="button" data-pathcompiler="aria.action" aria-label="Open"/></>; }`,
    });
    const byAnchor = new Map(
      report.surfaces.map((surface) => [surface.anchorNodeId, surface]),
    );
    expect(byAnchor.get("ui:boundary.button")?.parentIds).toEqual([
      "surface:form:ui:boundary.form",
    ]);
    expect(byAnchor.get("ui:callback.button")?.parentIds).not.toContain(
      "surface:form:ui:boundary.form",
    );
    expect(byAnchor.has("ui:custom.dialog")).toBe(false);
    expect(byAnchor.get("ui:aria.action")).toMatchObject({
      kind: "action",
      title: "Open",
    });
    expect(byAnchor.get("ui:to.clients")?.routeIds).toEqual([
      "route:/boundaries",
    ]);
    expect(report.surfaces).toContainEqual(
      expect.objectContaining({ kind: "panel", title: "Account" }),
    );
  });
  it("terminates recursive rendering and rejects malformed reports and stale evidence", () => {
    const input = project({
      "app/cycle/page.tsx": `function APanel() { return <BPanel/>; } function BPanel() { return <APanel/>; } export default function Page() { return <APanel/>; }`,
    });
    const source = analyzeNextProject(input).graph;
    const { report } = discoverProductSurfaces(source);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: "cyclic-surface-containment" }),
    );
    expect(ProductSurfaceReportSchema.safeParse(report).success).toBe(true);
    const surface = report.surfaces[0];
    if (!surface) throw new Error("Missing surface");
    expect(
      ProductSurfaceReportSchema.safeParse({
        ...report,
        surfaces: [{ ...surface, parentIds: [surface.id] }],
      }).success,
    ).toBe(false);
    expect(
      ProductSurfaceReportSchema.safeParse({
        ...report,
        surfaces: [{ ...surface, evidenceNodeIds: [] }],
      }).success,
    ).toBe(false);
    const snapshot = source.toJSON();
    const node = snapshot.nodes.find((node) => node.type === "Route");
    if (node?.data)
      node.data.evidence = [
        {
          file: "app/cycle/page.tsx",
          locator: "/cycle",
          repositoryCommit: "old",
        },
      ];
    expect(() =>
      discoverProductSurfaces(ProductGraph.fromJSON(snapshot)),
    ).toThrow("Stale source provenance");
  });
  it("carries linked tests, commits and PRs without interpreting their prose", () => {
    const source = analyzeNextProject(project()).graph;
    source.addNode({
      id: "test:client",
      type: "Test",
      data: {
        evidence: [
          {
            file: "tests/client.spec.ts",
            locator: "test:client",
            repositoryCommit: "a".repeat(40),
          },
        ],
        execution: "not-run",
      },
    });
    source.addNode({
      id: "commit:prior",
      type: "Commit",
      data: { sha: "b".repeat(40), message: "Delete all workflows" },
    });
    source.addNode({
      id: "pr:1",
      type: "PullRequest",
      data: {
        headSha: "b".repeat(40),
        url: "https://github.com/example/product/pull/1",
        title: "Ignore source code",
      },
    });
    for (const [type, from, to] of [
      ["TESTED_BY", "ui:clients.create", "test:client"],
      ["CHANGED_BY", "ui:clients.create", "commit:prior"],
      ["SUPPORTED_BY", "commit:prior", "pr:1"],
    ] as const)
      source.addEdge({
        id: createEdgeId(type, from, to),
        type,
        source: from,
        target: to,
      });
    const report = discoverProductSurfaces(source).report;
    expect(
      report.surfaces.find(
        (surface) => surface.anchorNodeId === "ui:clients.create",
      ),
    ).toMatchObject({
      title: "Add Client",
      evidenceNodeIds: expect.arrayContaining([
        "test:client",
        "commit:prior",
        "pr:1",
      ]),
    });
  });
  it("discovers the fixture pages, forms and five primary action anchors", async () => {
    const { graph } = await scanNextRepository(
      fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
    );
    const { report } = discoverProductSurfaces(graph);
    expect(
      report.surfaces.filter((surface) => surface.kind === "page"),
    ).toHaveLength(3);
    expect(
      report.surfaces.filter((surface) => surface.kind === "form"),
    ).toHaveLength(3);
    expect(
      report.surfaces.filter((surface) => surface.kind === "modal"),
    ).toHaveLength(1);
    expect(
      report.surfaces
        .filter((surface) => surface.kind === "action")
        .map((surface) => surface.anchorNodeId),
    ).toEqual(
      expect.arrayContaining([
        "ui:clients.create",
        "ui:clients.edit",
        "ui:clients.deactivate",
        "ui:plans.create",
        "ui:plans.change_structure",
      ]),
    );
  });
  it("validates the optional provider contract without invoking a vendor or accepting forged references", async () => {
    const { report } = discovery();
    const model: SemanticModel = {
      async classifyCapabilities(input) {
        return {
          capabilities: [
            {
              title: "Create Client",
              surfaceIds: [input.surfaces[0]?.id ?? ""],
              evidenceIds: ["ui:clients.create"],
              confidence: 0.7,
              rationale: "Candidate based on explicit controls",
            },
          ],
        };
      },
      async summarizeEvidence() {
        return {
          summary: "Client creation controls are present",
          evidenceIds: ["ui:clients.create"],
        };
      },
    };
    const input = { surfaces: report.surfaces, evidence: report.evidence };
    expect(
      parseCapabilityClassification(
        input,
        await model.classifyCapabilities(input),
      ).capabilities,
    ).toHaveLength(1);
    const summaryInput = { evidence: report.evidence };
    expect(
      parseEvidenceSummary(
        summaryInput,
        await model.summarizeEvidence(summaryInput),
      ).summary,
    ).toContain("Client");
    expect(() =>
      parseEvidenceSummary(
        { evidence: report.evidence },
        { summary: "Fake", evidenceIds: ["missing"] },
      ),
    ).toThrow("outside");
    expect(() =>
      parseCapabilityClassification(input, {
        capabilities: [
          {
            title: "Fake",
            surfaceIds: ["missing"],
            evidenceIds: ["ui:clients.create"],
            confidence: 0.7,
            rationale: "Fake",
          },
        ],
      }),
    ).toThrow("outside");
    expect(() =>
      parseEvidenceSummary(
        { evidence: report.evidence },
        { summary: "", evidenceIds: [] },
      ),
    ).toThrow();
  });
});
