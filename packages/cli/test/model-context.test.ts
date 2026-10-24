import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import {
  discoverCapabilities,
  discoverProductSurfaces,
} from "@pathcompiler/capability-engine";
import {
  type InferCapabilitiesRequest,
  interpretAmbiguities,
  NoopModelProvider,
} from "@pathcompiler/model-provider";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo/", import.meta.url),
);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => rm(item, { recursive: true, force: true })),
  );
});
async function directory() {
  const result = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-context-"));
  temporary.push(result);
  return result;
}

describe("scan --explain-model-context", () => {
  it("lists exactly what would be sent, without file contents", async () => {
    const cwd = await directory();
    const output = await runCli(
      ["scan", fixture, "--explain-model-context"],
      cwd,
    );
    expect(output).toMatch(
      /^Model context dry run \(provider: none; nothing sent\)\.\ninferCapabilities: \d+ bytes, \d+ surfaces, evidence /,
    );
    expect(output).toContain("components/clients.tsx");
    const context = JSON.parse(
      await readFile(
        path.join(cwd, ".pathcompiler", "reports", "model-context.json"),
        "utf8",
      ),
    );
    expect(context).toMatchObject({
      kind: "model-context",
      sent: false,
      provider: "none",
    });
    const payload = JSON.stringify(context.requests[0].payload);
    expect(context.requests[0].bytes).toBe(Buffer.byteLength(payload));
    // Evidence locators, never source text.
    expect(payload).not.toContain("export default function");
    expect(payload).not.toContain("useState");
  });

  it("redacts secrets and never reads hidden files", async () => {
    const root = await directory();
    await mkdir(path.join(root, "app"));
    await writeFile(
      path.join(root, ".env"),
      "SECRET_TOKEN=do-not-send-123456\n",
    );
    await writeFile(
      path.join(root, "app", "page.tsx"),
      'export default function Page() { return <button data-pathcompiler="keys.rotate" aria-label="Rotate sk-abcdefghijklmnopqrstuv">Rotate</button>; }\n',
    );
    const cwd = await directory();
    const output = await runCli(
      ["scan", root, "--explain-model-context", "--json"],
      cwd,
    );
    expect(output).not.toContain("do-not-send");
    expect(output).not.toContain("sk-abcdefghijklmnopqrstuv");
    const context = JSON.parse(output);
    expect(context.requests[0].redactions).toEqual({
      "provider-key": expect.any(Number),
    });
    await expect(
      runCli(["diff", "a", "b", "--explain-model-context"], cwd),
    ).rejects.toThrow("--explain-model-context is only supported by scan.");
  });
});

describe("analyze", () => {
  async function ambiguousProject() {
    const root = await directory();
    await mkdir(path.join(root, "app", "clients"), { recursive: true });
    await writeFile(
      path.join(root, "app", "clients", "page.tsx"),
      "export default function Page() { return <><button>Add Client</button><button>Archive Client</button></>; }\n",
    );
    return root;
  }

  it("sends nothing without a provider, and nothing for the unambiguous fixture", async () => {
    const cwd = await directory();
    expect(await runCli(["analyze", fixture], cwd)).toContain(
      "0 ambiguous clusters of 6 capabilities",
    );
    const output = await runCli(["analyze", await ambiguousProject()], cwd);
    expect(output).toContain(
      "1 ambiguous clusters of 2 capabilities.\n  clients: clients.archive (low-confidence, weak-naming); clients.create (low-confidence, weak-naming)\nNo model provider is configured; nothing was sent.",
    );
    const report = JSON.parse(
      await readFile(
        path.join(cwd, ".pathcompiler", "reports", "semantic-hypotheses.json"),
        "utf8",
      ),
    );
    expect(report).toMatchObject({
      provider: "none",
      hypotheses: [],
      context: { sent: false, requests: [] },
    });
  });

  it("replays recorded model answers as validated hypotheses", async () => {
    const root = await ambiguousProject();
    // Record the exact request the CLI will send.
    const project = await readSourceProject(root);
    const mined = minePlaywrightTests(
      project,
      analyzeNextProject(project).graph,
    );
    const sent: InferCapabilitiesRequest[] = [];
    const noop = new NoopModelProvider();
    await interpretAmbiguities({
      provider: {
        id: "recorder",
        inferCapabilities: async (request) => {
          sent.push(request);
          return { capabilities: [] };
        },
        synthesizeWorkflow: () => noop.synthesizeWorkflow(),
        explainImpact: (input) => noop.explainImpact(input),
        generateAliases: () => noop.generateAliases(),
        summarizeEvidence: () => noop.summarizeEvidence(),
      },
      graph: mined.graph,
      surfaces: discoverProductSurfaces(mined.graph).report.surfaces,
      capabilities: discoverCapabilities(mined.graph).report.capabilities,
    });
    const cwd = await directory();
    const surface = "surface:action:ui:app/clients/page.tsx#Page:button[2]";
    await writeFile(
      path.join(cwd, "answers.json"),
      JSON.stringify([
        {
          kind: "inferCapabilities",
          request: sent[0],
          response: {
            capabilities: [
              {
                title: "Delete Client",
                surfaceIds: [surface],
                evidenceIds: ["ui:app/clients/page.tsx#Page:button[2]"],
                confidence: 0.9,
                rationale: "Button label",
              },
            ],
          },
        },
      ]),
    );
    const output = await runCli(
      ["analyze", root, "--model-fixtures", "answers.json"],
      cwd,
    );
    expect(output).toContain(
      'Hypotheses: 0 supported, 1 rejected (never applied).\n  - rename clients.archive → "Delete Client" [unsupported-verb]\nSent 1 requests,',
    );
    expect(output).toContain(
      "Interpretations: 2 capabilities, 0 with a different best meaning, 0 whose rule meaning violates a hard constraint, 0 unresolved.\nJoint selection: 0 meanings differ from the per-capability best.",
    );
    const interpretations = JSON.parse(
      await readFile(
        path.join(
          cwd,
          ".pathcompiler",
          "reports",
          "semantic-interpretations.json",
        ),
        "utf8",
      ),
    );
    expect(interpretations.joint).toMatchObject({ status: "optimal" });
    // The rejected hypothesis is an impossible candidate; the rule meaning stands.
    expect(
      interpretations.items.find(
        (item: { subject: string }) => item.subject === "clients.archive",
      ),
    ).toMatchObject({
      best: "clients.archive",
      candidates: [
        { value: "clients.archive", status: "consistent" },
        { value: "clients.delete", status: "impossible" },
      ],
    });
    await expect(
      runCli(["scan", root, "--model-fixtures", "answers.json"], cwd),
    ).rejects.toThrow("--model-fixtures is only supported by analyze.");
  });

  it("needs the configured key in the environment", async () => {
    const cwd = await directory();
    await writeFile(
      path.join(cwd, "pathcompiler.yaml"),
      "version: 1\nmodel_provider:\n  provider: anthropic\n  api_key_env: PATHCOMPILER_TEST_MISSING_KEY\n",
    );
    await expect(
      runCli(["analyze", await ambiguousProject()], cwd),
    ).rejects.toThrow(
      "model_provider.provider is anthropic but $PATHCOMPILER_TEST_MISSING_KEY is not set.",
    );
    await writeFile(
      path.join(cwd, "pathcompiler.yaml"),
      "version: 1\nmodel_provider:\n  provider: openai\n  api_key_env: HOME\n",
    );
    await expect(
      runCli(["analyze", await ambiguousProject()], cwd),
    ).rejects.toThrow("set model_provider.model to the model to use.");
  });
});
