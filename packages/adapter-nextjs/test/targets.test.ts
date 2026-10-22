import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  analyzeNextProject,
  SemanticTargetIdSchema,
  scanNextRepository,
  suggestTargets,
  TargetReportSchema,
} from "../src/index.js";

function analyze(jsx: string, extra: Record<string, string> = {}) {
  return analyzeNextProject({
    files: Object.entries({
      "app/page.tsx": `export default function Page({ dynamic, items, props }) { return <>${jsx}</>; }`,
      ...extra,
    }).map(([path, content]) => ({ path, content })),
    repository: { commit: "a".repeat(40), dirty: false },
  });
}
const report = (jsx: string) => suggestTargets(analyze(jsx));

describe("semantic targets", () => {
  it("keeps explicit identity through file moves, owner changes and reordered/renamed UI", () => {
    const before = analyze(
      '<button data-pathcompiler="clients.create" onClick={create}>Create Client</button>',
      { "actions.ts": "export function create() {}" },
    );
    const after = analyze("<main />", {
      "components/renamed.tsx":
        'export function Renamed() { return <><button>Other</button><button data-pathcompiler="clients.create">Add customer</button></>; }',
    });
    expect(
      before.graph.getNode("ui:clients.create")?.data?.target,
    ).toMatchObject({
      semanticId: "clients.create",
      source: "annotation",
      confidence: 1,
    });
    expect(after.graph.getNode("ui:clients.create")?.data?.evidence).toEqual([
      {
        file: "components/renamed.tsx",
        locator: "components/renamed.tsx#Renamed:button[2]",
        repositoryCommit: "a".repeat(40),
      },
    ]);
    expect(after.graph.toJSON().edges).toContainEqual(
      expect.objectContaining({
        type: "EXPOSES_ACTION",
        target: "ui:clients.create",
      }),
    );
  });

  it("preserves event and navigation edges on annotated nodes", () => {
    const result = analyze(
      '<button data-pathcompiler="clients.create" onClick={create}>Create</button><a href="/" data-pathcompiler="nav.home">Home</a>',
      {
        "app/page.tsx":
          'function create() {} export default function Page() { return <><button data-pathcompiler="clients.create" onClick={create}>Create</button><a href="/" data-pathcompiler="nav.home">Home</a></>; }',
      },
    );
    expect(result.graph.toJSON().edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "HANDLES",
          source: "symbol:app/page.tsx#create",
          target: "ui:clients.create",
        }),
        expect.objectContaining({
          type: "NAVIGATES_TO",
          source: "ui:nav.home",
          target: "route:/",
        }),
      ]),
    );
  });

  it("prefers annotations, then test IDs, then accessible role/name", () => {
    const { targets } = report(
      '<button data-pathcompiler="clients.create" data-testid="legacy" aria-label="New client">Create</button><button data-testid="save-client">Save</button><button><span>Cancel</span></button>',
    );
    expect(
      targets.find((item) => item.target.semanticId)?.target,
    ).toMatchObject({
      source: "annotation",
      testId: "legacy",
      role: "button",
      name: "New client",
      confidence: 1,
    });
    expect(
      targets.find((item) => item.target.testId === "save-client"),
    ).toMatchObject({
      suggestedTarget: "page.save.client",
      target: { source: "test-id", name: "Save", confidence: 0.8 },
    });
    expect(targets.find((item) => item.target.name === "Cancel")).toMatchObject(
      {
        suggestedTarget: "page.cancel",
        target: { source: "accessible", role: "button", confidence: 0.6 },
      },
    );
  });

  it("captures literal labelledby, aria-label and native labels without guessing dynamic names", () => {
    const { targets } = report(
      '<span id="heading">Primary name</span><input aria-labelledby="heading" aria-label="Secondary" /><label htmlFor="email">Email</label><input id="email" type="email" /><label>Structure<select><option>Simple</option></select></label><button aria-label={dynamic}>Partial</button><button>Delete {dynamic}</button><input type="password" aria-label="Password" />',
    );
    const names = targets.map((item) => item.target.name);
    expect(names).toEqual(
      expect.arrayContaining(["Primary name", "Email", "Structure"]),
    );
    expect(names).not.toContain("Secondary");
    expect(names).not.toContain("Partial");
    expect(names).not.toContain("Delete");
    expect(
      targets.filter((item) => item.target.source === "unresolved"),
    ).toHaveLength(3);
  });

  it("reports conflicting declarations across files without merging nodes or suggesting replacements", () => {
    const result = analyze(
      '<button data-pathcompiler="clients.create">Create</button>',
      {
        "duplicate.tsx":
          'export function Duplicate() { return <button data-pathcompiler="clients.create">Another</button>; }',
      },
    );
    const output = suggestTargets(result);
    expect(result.graph.nodesByType("UIAction")).toHaveLength(2);
    expect(result.graph.getNode("ui:clients.create")).toBeUndefined();
    expect(
      output.targets.every(
        (item) =>
          item.target.issues[0]?.includes("Duplicate") &&
          item.suggestedTarget === null,
      ),
    ).toBe(true);
    expect(
      output.diagnostics.filter((item) => item.code === "semantic-target"),
    ).toHaveLength(2);
  });

  it("rejects dynamic, invalid, possibly overridden and unverified component annotations", () => {
    const { targets, diagnostics } = report(
      '<button data-pathcompiler={dynamic} /><button data-pathcompiler="invalid id" /><button data-pathcompiler="overridden" {...props} /><Custom data-pathcompiler="custom" /><ui.Button data-pathcompiler="custom.property" /><button {...props} data-pathcompiler="safe" /><p data-pathcompiler="feedback">{dynamic}</p>',
    );
    expect(
      targets
        .filter((item) => item.target.semanticId)
        .map((item) => item.target.semanticId)
        .sort(),
    ).toEqual(["feedback", "safe"]);
    expect(
      diagnostics.filter((item) => item.code === "semantic-target"),
    ).toHaveLength(5);
    expect(
      targets.find((item) => item.target.semanticId === "feedback")?.target
        .confidence,
    ).toBe(1);
    expect(SemanticTargetIdSchema.safeParse("bad/id").success).toBe(false);
  });

  it("treats a repeated declaration as one semantic identity and never claims DOM uniqueness", () => {
    const { graph } = analyze(
      '{items.map(item => <button key={item.id} data-pathcompiler="clients.edit">Edit</button>)}',
    );
    expect(graph.nodesByType("UIAction")).toHaveLength(1);
    expect(graph.getNode("ui:clients.edit")).toBeDefined();
  });

  it("produces deterministic, distinct suggestions that avoid existing annotations", () => {
    const jsx =
      '<button data-pathcompiler="page.save">Already annotated</button><button>Save</button><button data-testid="save">Save</button><button aria-label={dynamic} />';
    const first = report(jsx);
    expect(report(jsx)).toEqual(first);
    const suggestions = first.targets
      .map((item) => item.suggestedTarget)
      .filter(Boolean);
    expect(suggestions).toEqual(["page.save.2", "page.save.3"]);
    expect(JSON.stringify(first)).not.toContain("selector");
    expect(TargetReportSchema.parse(first)).toEqual(first);
    expect(() =>
      TargetReportSchema.parse({ ...first, schemaVersion: 2 }),
    ).toThrow();
  });

  it("exposes every fixture workflow action and observation through explicit targets", async () => {
    const result = await scanNextRepository(
      fileURLToPath(new URL("../../../fixtures/next-demo/", import.meta.url)),
    );
    const required = [
      "clients.create",
      "clients.edit",
      "clients.deactivate",
      "clients.row",
      "clients.feedback",
      "client.form",
      "client.form.name",
      "client.form.email",
      "client.form.submit",
      "client.form.error",
      "client.deactivate.confirm",
      "client.deactivate.error",
      "plans.create",
      "plans.change_structure",
      "plans.row",
      "plans.feedback",
      "plan.form",
      "plan.form.title",
      "plan.form.client",
      "plan.form.submit",
      "plan.form.error",
      "plan.structure.form",
      "plan.structure.selector",
      "plan.structure.submit",
      "plan.structure.confirm",
      "plan.structure.back",
      "plan.structure.error",
      "dialog.container",
      "dialog.close",
      "nav.clients",
      "nav.plans",
      "nav.home",
      "demo.role",
      "demo.plan_structure",
    ];
    for (const id of required)
      expect(result.graph.getNode(`ui:${id}`)?.data?.target).toMatchObject({
        source: "annotation",
        semanticId: id,
        confidence: 1,
      });
    expect(
      result.summary.diagnostics.filter(
        (item) => item.code === "semantic-target",
      ),
    ).toEqual([]);
  });
});
