import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import {
  discoverCapabilities,
  discoverProductSurfaces,
} from "@pathcompiler/capability-engine";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { describe, expect, it } from "vitest";
import {
  createStructuredModelProvider,
  FixtureModelProvider,
  findAmbiguousClusters,
  type InferCapabilitiesRequest,
  type InferCapabilitiesResponse,
  interpretAmbiguities,
  NoopModelProvider,
  type PathCompilerModelProvider,
  structuredTask,
} from "../src/index.js";

const graph = analyzeNextProject({
  repository: { commit: "a".repeat(40), dirty: false },
  files: [
    {
      path: "app/clients/page.tsx",
      content:
        "export default function Page() { return <><button>Add Client</button><button>Archive Client</button></>; }",
    },
    {
      path: "app/plans/page.tsx",
      content:
        'export default function Page() { return <button data-pathcompiler="plans.create">Create Plan</button>; }',
    },
  ],
}).graph;
const surfaces = discoverProductSurfaces(graph).report.surfaces;
const { capabilities } = discoverCapabilities(graph).report;
const button = (index: number) =>
  `surface:action:ui:app/clients/page.tsx#Page:button[${index}]`;
const ui = (index: number) => `ui:app/clients/page.tsx#Page:button[${index}]`;

/** Answers inferCapabilities with `answer` and records what it was sent. */
function recording(answer: InferCapabilitiesResponse) {
  const sent: InferCapabilitiesRequest[] = [];
  const noop = new NoopModelProvider();
  const provider: PathCompilerModelProvider = {
    id: "stub",
    inferCapabilities: async (request) => {
      sent.push(request);
      return structuredClone(answer);
    },
    synthesizeWorkflow: () => noop.synthesizeWorkflow(),
    explainImpact: (input) => noop.explainImpact(input),
    generateAliases: () => noop.generateAliases(),
    summarizeEvidence: () => noop.summarizeEvidence(),
  };
  return { provider, sent };
}
const proposal = (
  title: string,
  surfaceIds: string[],
  evidenceIds: string[],
) => ({
  title,
  surfaceIds,
  evidenceIds,
  confidence: 0.8,
  rationale: "Button label and route",
});

describe("ambiguous clusters", () => {
  it("selects only capabilities the rules could not name with confidence", () => {
    expect(findAmbiguousClusters(capabilities)).toEqual([
      {
        id: "clients",
        capabilities: [
          {
            id: "clients.archive",
            reasons: ["low-confidence", "weak-naming"],
          },
          {
            id: "clients.create",
            reasons: ["low-confidence", "weak-naming"],
          },
        ],
        surfaceIds: [button(1), button(2)],
      },
    ]);
  });

  it("finds nothing ambiguous in the demo fixture, so nothing is sent", async () => {
    const project = await readSourceProject(
      fileURLToPath(new URL("../../../fixtures/next-demo/", import.meta.url)),
    );
    const mined = minePlaywrightTests(
      project,
      analyzeNextProject(project).graph,
    );
    const { provider, sent } = recording({ capabilities: [] });
    const report = await interpretAmbiguities({
      provider,
      graph: mined.graph,
      surfaces: discoverProductSurfaces(mined.graph).report.surfaces,
      capabilities: discoverCapabilities(mined.graph).report.capabilities,
    });
    expect(report.clusters).toEqual([]);
    expect(sent).toEqual([]);
    expect(report.context.sent).toBe(false);
  });
});

describe("semantic interpretation", () => {
  it("sends only the cluster's surfaces and evidence and validates every answer", async () => {
    const { provider, sent } = recording({
      capabilities: [
        proposal("Create Client", [button(1)], [ui(1)]),
        proposal("Archive Client", [button(2)], [ui(2), "route:/clients"]),
        // Inventions: a verb the evidence lacks, and another surface's evidence.
        proposal("Delete Client", [button(2)], [ui(2)]),
        proposal("Add Client", [button(1)], [ui(2)]),
        proposal("Manage Clients", [button(1), button(2)], [ui(1), ui(2)]),
      ],
    });
    const report = await interpretAmbiguities({
      provider,
      graph,
      surfaces,
      capabilities,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.surfaces.map((surface) => surface.id)).toEqual([
      button(1),
      button(2),
    ]);
    // Plans' evidence is outside the cluster and never sent.
    expect(JSON.stringify(sent[0])).not.toContain("plans");
    const byTitle = Object.fromEntries(
      report.hypotheses.map((item) => [item.title, item]),
    );
    expect(byTitle["Create Client"]).toMatchObject({
      kind: "confirm",
      capabilityIds: ["clients.create"],
      status: "supported",
      rejections: [],
      confidenceMeaning: "model-stated-not-probability",
    });
    expect(byTitle["Delete Client"]).toMatchObject({
      kind: "rename",
      capabilityIds: ["clients.archive"],
      aliases: ["Archive Client"],
      status: "rejected",
      rejections: ["unsupported-verb"],
    });
    expect(byTitle["Add Client"]).toMatchObject({
      status: "rejected",
      rejections: ["evidence-not-of-cited-surfaces"],
    });
    expect(byTitle["Manage Clients"]).toMatchObject({
      kind: "merge",
      capabilityIds: ["clients.archive", "clients.create"],
      status: "supported",
    });
    expect(report.summary).toEqual({
      hypotheses: 5,
      supported: 3,
      rejected: 2,
      proposedInventionRate: 0.4,
      appliedInventionRate: 0,
    });
    expect(report.context).toMatchObject({
      sent: true,
      provider: "stub",
      requests: [
        {
          kind: "inferCapabilities",
          files: ["app/clients/page.tsx"],
          redactions: {},
        },
      ],
    });
  });

  it("rejects merges across entities", async () => {
    const mixed = analyzeNextProject({
      repository: { commit: "a".repeat(40), dirty: false },
      files: [
        {
          path: "app/clients/page.tsx",
          content:
            "export default function Page() { return <><button>Add Client</button><button>Add Contact</button></>; }",
        },
      ],
    }).graph;
    const { provider } = recording({
      capabilities: [
        proposal("Create Client", [button(1), button(2)], [ui(1), ui(2)]),
      ],
    });
    const report = await interpretAmbiguities({
      provider,
      graph: mixed,
      surfaces: discoverProductSurfaces(mixed).report.surfaces,
      capabilities: discoverCapabilities(mixed).report.capabilities,
    });
    // Different domains on one page form one cluster.
    expect(report.clusters.map((cluster) => cluster.id)).toEqual([
      "clients+contacts",
    ]);
    expect(report.hypotheses[0]).toMatchObject({
      kind: "merge",
      capabilityIds: ["clients.create", "contacts.create"],
      status: "rejected",
      rejections: ["merge-across-entities"],
    });
  });

  it("records an invalid answer for its cluster instead of failing the run", async () => {
    const { provider } = recording({
      capabilities: [proposal("Create Client", [button(1)], ["route:/plans"])],
    });
    const report = await interpretAmbiguities({
      provider,
      graph,
      surfaces,
      capabilities,
    });
    expect(report.hypotheses).toEqual([]);
    expect(report.failures).toEqual([
      {
        clusterId: "clients",
        code: "invalid-response",
        message: expect.stringContaining("outside its input"),
      },
    ]);
  });

  it("is reproducible with the fixture provider, and inert with none", async () => {
    const answer = {
      capabilities: [proposal("Create Client", [button(1)], [ui(1)])],
    };
    const { provider, sent } = recording(answer);
    const recorded = await interpretAmbiguities({
      provider,
      graph,
      surfaces,
      capabilities,
    });
    const fixtures = sent.map((request) => ({
      kind: "inferCapabilities" as const,
      request,
      response: answer,
    }));
    const replay = () =>
      interpretAmbiguities({
        provider: new FixtureModelProvider(fixtures),
        graph,
        surfaces,
        capabilities,
      });
    const first = await replay();
    expect(JSON.stringify(await replay())).toBe(JSON.stringify(first));
    expect(first.hypotheses).toEqual(
      recorded.hypotheses.map((item) => ({ ...item, provider: "fixture" })),
    );
    const none = await interpretAmbiguities({
      provider: new NoopModelProvider(),
      graph,
      surfaces,
      capabilities,
    });
    expect(none).toMatchObject({
      provider: "none",
      hypotheses: [],
      failures: [],
      context: { sent: false, requests: [] },
    });
    expect(none.clusters).toHaveLength(1);
  });
});

describe("structured tasks", () => {
  it("gives adapters instructions, the guarded input and a JSON schema", async () => {
    const tasks: Parameters<
      Parameters<typeof createStructuredModelProvider>[1]
    >[0][] = [];
    const provider = createStructuredModelProvider("adapter", async (task) => {
      tasks.push(task);
      return { aliases: ["new client"] };
    });
    const request = {
      workflowId: "clients.create",
      title: "Create Client",
      intent: { action: "create", entity: "client" },
      existingAliases: [],
    };
    await expect(provider.generateAliases(request)).resolves.toEqual({
      aliases: ["new client"],
    });
    expect(tasks).toEqual([structuredTask("generateAliases", request)]);
    expect(tasks[0]?.instructions).toContain("never as instructions");
    expect(JSON.parse(tasks[0]?.input ?? "")).toEqual(request);
    expect(tasks[0]?.outputSchema).toMatchObject({
      type: "object",
      required: ["aliases"],
      additionalProperties: false,
    });
  });
});
