import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverProductSurfaces } from "@pathcompiler/capability-engine";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { beforeAll, describe, expect, it } from "vitest";
import {
  FixtureModelProvider,
  fixtureKey,
  guardModelProvider,
  type InferCapabilitiesRequest,
  type ModelContextEntry,
  ModelProviderError,
  NoopModelProvider,
  type PathCompilerModelProvider,
  redactSecrets,
  semanticModelFromProvider,
} from "../src/index.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo/", import.meta.url),
);
let request: InferCapabilitiesRequest;
beforeAll(async () => {
  const project = await readSourceProject(fixture);
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const { report } = discoverProductSurfaces(mined.graph);
  request = { surfaces: report.surfaces, evidence: report.evidence };
});
const createSurface = () =>
  request.surfaces.find(
    (surface) => surface.anchorNodeId === "ui:clients.create",
  );
/** A provider whose unlisted methods behave like the no-op provider. */
function stub(
  overrides: Partial<PathCompilerModelProvider>,
): PathCompilerModelProvider {
  const noop = new NoopModelProvider();
  return {
    id: "stub",
    inferCapabilities: () => noop.inferCapabilities(),
    synthesizeWorkflow: () => noop.synthesizeWorkflow(),
    explainImpact: (input) => noop.explainImpact(input),
    generateAliases: () => noop.generateAliases(),
    summarizeEvidence: () => noop.summarizeEvidence(),
    ...overrides,
  };
}
const classification = () => ({
  capabilities: [
    {
      title: "Create Client",
      surfaceIds: [createSurface()?.id as string],
      evidenceIds: ["ui:clients.create"],
      confidence: 0.7,
      rationale: "Explicit control and handler",
    },
  ],
});

describe("model providers", () => {
  it("defaults to a deterministic no-op provider", async () => {
    const noop = new NoopModelProvider();
    expect(await noop.inferCapabilities()).toEqual({ capabilities: [] });
    expect(
      await noop.explainImpact({
        workflowId: "clients.create",
        severity: "high",
        reasons: [{ code: "target-removed", message: "Target was removed." }],
      }),
    ).toEqual({
      explanation: "Target was removed.",
      reasonCodes: ["target-removed"],
    });
    await expect(noop.summarizeEvidence()).rejects.toMatchObject({
      code: "no-provider",
    });
  });

  it("replays fixtures by request and refuses to guess", async () => {
    const provider = new FixtureModelProvider([
      { kind: "inferCapabilities", request, response: classification() },
    ]);
    expect(await provider.inferCapabilities(request)).toEqual(classification());
    const other = { ...request, surfaces: request.surfaces.slice(1) };
    await expect(provider.inferCapabilities(other)).rejects.toThrow(
      `No model fixture for ${fixtureKey("inferCapabilities", other)}.`,
    );
    // Key order does not change the key.
    expect(fixtureKey("generateAliases", { a: 1, b: 2 })).toBe(
      fixtureKey("generateAliases", { b: 2, a: 1 }),
    );
  });

  it("guards requests: secrets redacted before the provider sees them, context recorded", async () => {
    const seen: unknown[] = [];
    const entries: ModelContextEntry[] = [];
    const spy = stub({
      id: "spy",
      async generateAliases(input) {
        seen.push(input);
        return { aliases: ["add a customer"] };
      },
    });
    const guarded = guardModelProvider(spy, {
      onContext: (entry) => entries.push(entry),
    });
    await guarded.generateAliases({
      workflowId: "clients.create",
      title: "Create Client with key sk-abcdefghijklmnopqrstuv",
      intent: { action: "create", entity: "client" },
      existingAliases: ['token = "ghp_abcdefghijklmnopqrstuvwxyz0123"'],
    });
    expect(JSON.stringify(seen)).not.toMatch(/sk-abc|ghp_abc/);
    expect(seen[0]).toMatchObject({
      title: "Create Client with key [REDACTED]",
      existingAliases: ['token = "[REDACTED]"'],
    });
    expect(entries).toEqual([
      expect.objectContaining({
        kind: "generateAliases",
        provider: "spy",
        redactions: { "github-token": 1, "provider-key": 1 },
      }),
    ]);
  });

  it("validates responses against schemas and the evidence they may cite", async () => {
    const answering = (response: unknown) =>
      stub({
        inferCapabilities: async () => response as never,
        explainImpact: async () => response as never,
      });
    const entries: ModelContextEntry[] = [];
    const ok = guardModelProvider(answering(classification()), {
      onContext: (entry) => entries.push(entry),
    });
    expect((await ok.inferCapabilities(request)).capabilities).toHaveLength(1);
    expect(entries[0]?.files).toContain("components/clients.tsx");
    expect(entries[0]?.evidenceNodes.UIAction).toBeGreaterThan(0);
    const forged = classification();
    (forged.capabilities[0] as { evidenceIds: string[] }).evidenceIds = [
      "ui:invented",
    ];
    await expect(
      guardModelProvider(answering(forged)).inferCapabilities(request),
    ).rejects.toThrow(/invalid inferCapabilities response.*outside its input/);
    await expect(
      guardModelProvider(
        answering({ explanation: "x", reasonCodes: ["made-up"] }),
      ).explainImpact({
        workflowId: "w",
        severity: "low",
        reasons: [{ code: "real", message: "Real." }],
      }),
    ).rejects.toBeInstanceOf(ModelProviderError);
    await expect(
      guardModelProvider(answering({ capabilities: "lots" })).inferCapabilities(
        request,
      ),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("routes capability-engine's SemanticModel through the boundary", async () => {
    const model = semanticModelFromProvider(
      new FixtureModelProvider([
        { kind: "inferCapabilities", request, response: classification() },
      ]),
    );
    expect(
      (await model.classifyCapabilities(request)).capabilities[0]?.title,
    ).toBe("Create Client");
  });

  it("redacts obvious secrets and leaves ordinary text alone", () => {
    const text = [
      "AKIAABCDEFGHIJKLMNOP",
      "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
      "xoxb-1234567890-abcdef",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fw",
      'password: "hunter22hunter"',
      "Create Client",
      "token count is 3",
    ].join("\n");
    const result = redactSecrets(text);
    expect(result.text).toBe(
      [
        "[REDACTED]",
        "[REDACTED]",
        "[REDACTED]",
        "[REDACTED]",
        'password: "[REDACTED]"',
        "Create Client",
        "token count is 3",
      ].join("\n"),
    );
    expect(Object.values(result.redactions).reduce((a, b) => a + b, 0)).toBe(5);
  });

  it("keeps vendor SDKs out of every package but its adapter (ADR 0071)", async () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const vendors =
      /^(openai|@anthropic-ai\/|@google\/(genai|generative-ai)|@mistralai\/|cohere-ai|ollama|@aws-sdk\/client-bedrock)/;
    // The one adapter allowed an SDK, and the only package that may load it.
    const adapters: Record<string, string[]> = {
      "model-provider-anthropic": ["@anthropic-ai/sdk"],
    };
    const loaders = new Set(["cli"]);
    for (const name of await readdir(root)) {
      const manifest = JSON.parse(
        await readFile(`${root}${name}/package.json`, "utf8").catch(() => "{}"),
      );
      const dependencies = Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      });
      expect(
        dependencies.filter((dependency) => vendors.test(dependency)),
        name,
      ).toEqual(adapters[name] ?? []);
      if (!loaders.has(name))
        expect(
          dependencies.filter((dependency) =>
            Object.keys(adapters).some(
              (adapter) => dependency === `@pathcompiler/${adapter}`,
            ),
          ),
          name,
        ).toEqual([]);
    }
  });
});
