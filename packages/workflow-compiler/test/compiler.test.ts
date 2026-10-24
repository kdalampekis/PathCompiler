import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import {
  type ApprovedWorkflow,
  approveCandidate,
} from "@pathcompiler/workflow-review";
import { validateWorkflow } from "@pathcompiler/workflow-validator";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  COMPILER_VERSION,
  compileWorkflows,
  DocumentationSchema,
  escapeMarkdown,
  exportArtifacts,
  GENERATED_MARKER,
  RuntimeManifestSchema,
  renderHelpPages,
  renderWorkflowMarkdown,
  SearchIndexSchema,
} from "../src/index.js";

let approved: ApprovedWorkflow[];
beforeAll(async () => {
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  approved = discoverWorkflows(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).report.candidates.map((candidate) =>
    approveCandidate(candidate, {
      approvedBy: "Test Reviewer",
      approvedAt: "2026-10-22T10:00:00.000Z",
      validation: validateWorkflow(candidate.workflow, {
        graph: mined.graph,
        traces: mined.report,
      }),
      repository: { ...project.repository, dirty: false },
    }),
  );
});
function client(): ApprovedWorkflow {
  const record = approved.find((item) => item.workflow.id === "clients.create");
  if (!record) throw new Error("Missing fixture workflow");
  return structuredClone(record);
}

describe("workflow compiler", () => {
  it("compiles approved fixture workflows into search, runtime and documentation records", () => {
    const output = compileWorkflows(approved);
    expect(SearchIndexSchema.parse(output.searchIndex)).toEqual(
      output.searchIndex,
    );
    expect(RuntimeManifestSchema.parse(output.runtimeManifest)).toEqual(
      output.runtimeManifest,
    );
    expect(DocumentationSchema.parse(output.documentation)).toEqual(
      output.documentation,
    );
    expect(output.searchIndex.compilerVersion).toBe(COMPILER_VERSION);
    expect(output.searchIndex.workflows.map((item) => item.id)).toEqual([
      "clients.create",
      "clients.deactivate",
      "plans.archive",
      "plans.change_structure",
      "plans.create",
    ]);
    expect(output.searchIndex.workflows[0]).toMatchObject({
      id: "clients.create",
      title: "Create Client",
      aliases: [],
      action: "create",
      entity: "client",
      roles: [],
      routes: ["/clients"],
    });
    const runtime = output.runtimeManifest.workflows[0];
    expect(
      runtime?.steps.map((step) => [step.target, step.action.type]),
    ).toEqual([
      ["clients.create", "click"],
      ["client.form.name", "input"],
      ["client.form.email", "input"],
      ["client.form.submit", "click"],
    ]);
    expect(runtime?.terminal).toEqual(client().workflow.terminal);
    const docs = output.documentation.workflows[0];
    expect(docs?.steps.map((step) => step.text)).toEqual([
      "Click Create Client",
      "Enter Name",
      "Enter Email",
      "Click client.form.submit",
    ]);
    expect(docs?.steps[3]?.expected).toBe(
      'clients.feedback shows "Client created"',
    );
    expect(docs?.completion).toBe('clients.feedback shows "Client created"');
    expect(docs?.commit).toBe(client().workflow.repository.commit);
    expect(
      output.documentation.workflows.find(
        (item) => item.id === "plans.change_structure",
      )?.completion,
    ).toBe("dialog.container is no longer shown");
  });

  it("keeps repository, evidence, confidence and reviewer data out of the runtime manifest", () => {
    const output = compileWorkflows(approved);
    const runtime = JSON.stringify(output.runtimeManifest);
    const search = JSON.stringify(output.searchIndex);
    const record = client();
    for (const leaked of [
      record.workflow.repository.commit,
      "Test Reviewer",
      "evidence",
      "confidence",
      "tests/",
      "components/",
      ".tsx",
    ]) {
      expect(runtime).not.toContain(leaked);
      expect(search).not.toContain(leaked);
    }
  });

  it("is deterministic and bound to approved content, not order or reviewer", () => {
    const first = JSON.stringify(compileWorkflows(approved));
    expect(JSON.stringify(compileWorkflows([...approved].reverse()))).toBe(
      first,
    );
    const reviewer = client();
    reviewer.approval.approvedBy = "Someone Else";
    reviewer.approval.approvedAt = "2027-01-01T00:00:00.000Z";
    const changed = client();
    const step = changed.workflow.steps[0];
    if (!step) throw new Error("Missing step");
    step.instruction = { text: "Open the client form" };
    const revision = (record: ApprovedWorkflow) =>
      compileWorkflows([record]).runtimeManifest.workflows[0]?.revision;
    expect(revision(reviewer)).toBe(revision(client()));
    expect(revision(changed)).not.toBe(revision(client()));
    expect(revision(client())).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("refuses unapproved and duplicate input", () => {
    const candidate = client();
    candidate.workflow.status = "candidate";
    expect(() => compileWorkflows([candidate])).toThrow();
    expect(() => compileWorkflows([{ workflow: client().workflow }])).toThrow();
    expect(() => compileWorkflows([client(), client()])).toThrow(
      "Duplicate approved workflow",
    );
    expect(compileWorkflows([]).searchIndex.workflows).toEqual([]);
  });

  it("exposes context requirements and describes branches and prerequisites", () => {
    const record = client();
    record.workflow.roles = ["editor", "admin", "editor"];
    record.workflow.preconditions = [
      { type: "permission", permission: "clients.write" },
      { type: "feature_flag", flag: "planStructure", enabled: true },
      { type: "feature_flag", flag: "planStructure", enabled: true },
    ];
    const step = record.workflow.steps[0];
    if (!step) throw new Error("Missing step");
    step.branches = [
      {
        when: { type: "target_appears", target: "dialog.container" },
        next: "step.2",
      },
    ];
    const output = compileWorkflows([record]);
    expect(output.searchIndex.workflows[0]).toMatchObject({
      roles: ["admin", "editor"],
      permissions: ["clients.write"],
      featureFlags: [{ flag: "planStructure", enabled: true }],
    });
    expect(output.runtimeManifest.workflows[0]?.preconditions).toHaveLength(3);
    expect(output.documentation.workflows[0]?.prerequisites).toEqual([
      "You have the clients.write permission",
      "The planStructure feature is enabled",
      "The planStructure feature is enabled",
    ]);
    expect(output.documentation.workflows[0]?.steps[0]?.branches).toEqual([
      { when: "dialog.container appears", next: "step.2" },
    ]);
  });

  it("exports deterministic JSON, YAML and Markdown static artifacts", () => {
    const compiled = compileWorkflows(approved);
    const files = exportArtifacts(compiled, [
      "markdown",
      "yaml",
      "json",
      "json",
    ]);
    expect(files.map(([file]) => file)).toEqual([
      "generated/search-index.json",
      "generated/runtime-manifest.json",
      "generated/documentation.json",
      "generated/workflows.md",
      "generated/search-index.yaml",
      "generated/runtime-manifest.yaml",
      "generated/documentation.yaml",
    ]);
    expect(
      exportArtifacts(compileWorkflows([...approved].reverse()), [
        "json",
        "yaml",
        "markdown",
      ]),
    ).toEqual(files);
    const contents = new Map(files);
    for (const name of ["search-index", "runtime-manifest", "documentation"])
      expect(parse(contents.get(`generated/${name}.yaml`) ?? "")).toEqual(
        JSON.parse(contents.get(`generated/${name}.json`) ?? ""),
      );
    const markdown = contents.get("generated/workflows.md") ?? "";
    expect(markdown.startsWith(GENERATED_MARKER)).toBe(true);
    expect(markdown).toContain("## Create Client");
    expect(markdown).toContain("1. Click Create Client");
    expect(markdown).toContain(
      '**Done when:** clients.feedback shows "Client created"',
    );
    expect(exportArtifacts(compiled).map(([file]) => file)).toEqual([
      "generated/search-index.json",
      "generated/runtime-manifest.json",
      "generated/documentation.json",
    ]);
  });

  it("renders approved text literally in Markdown", () => {
    expect(escapeMarkdown("<script>alert(1)</script> *x* [a](b)\nnext")).toBe(
      "\\<script\\>alert\\(1\\)\\</script\\> \\*x\\* \\[a\\]\\(b\\) next",
    );
    const record = compileWorkflows([client()]).documentation.workflows[0];
    if (!record) throw new Error("Missing record");
    const page = renderWorkflowMarkdown({
      ...record,
      title: "Create <b>Client</b>",
      steps: [
        {
          ...record.steps[0],
          id: "a",
          text: "Open",
          optional: true,
          branches: [{ when: "x appears", next: "b" }],
        },
        { id: "b", text: "Save", optional: false, branches: [] },
      ] as typeof record.steps,
    });
    expect(page).toContain("# Create \\<b\\>Client\\</b\\>");
    expect(page).toContain("1. Open _(optional)_");
    expect(page).toContain("   - If x appears, continue at step 2.");
    expect(page).not.toContain("<b>");
  });

  it("renders one marked help page per approved workflow plus an index", () => {
    const pages = renderHelpPages(compileWorkflows(approved).documentation);
    expect(pages.map(([file]) => file)).toEqual([
      "index.md",
      "clients.create.md",
      "clients.deactivate.md",
      "plans.archive.md",
      "plans.change_structure.md",
      "plans.create.md",
    ]);
    for (const [, content] of pages)
      expect(content.startsWith(GENERATED_MARKER)).toBe(true);
    const index = new Map(pages).get("index.md") ?? "";
    expect(index).toContain("## clients");
    expect(index).toContain("- [Create Client](./clients.create.md)");
    const page = new Map(pages).get("clients.create.md") ?? "";
    expect(page).toContain("approved workflow clients.create (sha256:");
    expect(page).toContain("# Create Client");
    expect(page).toContain("## Steps");
    expect(renderHelpPages(compileWorkflows([]).documentation)).toEqual([
      ["index.md", expect.stringContaining("No approved workflows yet.")],
    ]);
  });
});
