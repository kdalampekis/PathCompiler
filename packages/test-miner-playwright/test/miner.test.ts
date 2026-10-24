import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { ProductGraph } from "@pathcompiler/graph-core";
import { readSourceProject } from "@pathcompiler/source-model";
import { describe, expect, it } from "vitest";
import { minePlaywrightTests, TestTraceReportSchema } from "../src/index.js";

const app = `export default function Clients() { return <><button data-pathcompiler="clients.create" data-testid="create" aria-label="Create Client">Create Client</button><label>Name<input data-pathcompiler="client.form.name" /></label><button data-pathcompiler="client.form.submit">Save Client</button><p data-pathcompiler="clients.feedback" role="status" /></>; }`;
function project(test: string, extra: Record<string, string> = {}) {
  return {
    files: Object.entries({
      "app/clients/page.tsx": app,
      "tests/clients.spec.ts": test,
      ...extra,
    }).map(([path, content]) => ({ path, content })),
    repository: { commit: "a".repeat(40), dirty: false },
  };
}
const imports = `import { test, expect } from '@playwright/test';`;
function mine(test: string, extra: Record<string, string> = {}) {
  const input = project(imports + test, extra);
  return minePlaywrightTests(input, analyzeNextProject(input).graph);
}
function first(test: string) {
  const trace = mine(test).report.traces[0];
  if (!trace) throw new Error("Expected a trace");
  return trace;
}

describe("Playwright static test mining", () => {
  it("extracts ordered actions and assertions, route, hints, terminal assertion and graph evidence", () => {
    const input = project(
      imports +
        `test('Create Client', async ({ page }) => {
      await page.goto('/clients');
      await page.getByRole('button', { name: 'Create Client', exact: true }).click();
      await page.getByLabel('Name', { exact: true }).fill('Ada');
      await page.locator('[data-pathcompiler="client.form.submit"]').click();
      await expect(page.locator('[data-pathcompiler="clients.feedback"]')).toHaveText('Client created');
      await expect(page).toHaveURL(/clients$/);
    });`,
    );
    const base = analyzeNextProject(input).graph;
    const before = base.serialize();
    const { graph, report } = minePlaywrightTests(input, base);
    const trace = report.traces[0];
    expect(trace).toMatchObject({
      testName: "Create Client",
      startRoute: "/clients",
      partial: false,
      terminalAssertion: {
        matcher: "toHaveURL",
        expected: { kind: "regex", pattern: "clients$", flags: "" },
      },
    });
    expect(trace?.actions.map((item) => item.operation)).toEqual([
      "goto",
      "click",
      "fill",
      "click",
    ]);
    expect(trace?.actions.map((item) => item.target?.graphNodeIds)).toEqual([
      ["route:/clients"],
      ["ui:clients.create"],
      ["ui:client.form.name"],
      ["ui:client.form.submit"],
    ]);
    expect(trace?.assertions.map((item) => item.order)).toEqual([4, 5]);
    expect(trace?.actions[0]?.evidence).toMatchObject({
      file: "tests/clients.spec.ts",
      repositoryCommit: "a".repeat(40),
      callSites: [],
    });
    expect(graph.nodesByType("Test")).toHaveLength(1);
    expect(graph.toJSON().edges).toContainEqual(
      expect.objectContaining({
        type: "TESTED_BY",
        source: "ui:clients.create",
        target: trace?.id,
      }),
    );
    expect(graph.nodesByType("WorkflowCandidate")).toEqual([]);
    expect(base.serialize()).toBe(before);
    expect(report).toMatchObject({ evidenceOnly: true, execution: "not-run" });
  });

  it("inlines same-file helpers, parameters, defaults and const locator aliases with call provenance", () => {
    const trace = first(`async function create(page, name = 'Ada') {
      const button = page.locator('[data-pathcompiler="clients.create"]');
      await page.goto('/clients'); await button.click(); await page.getByLabel('Name').fill(name);
      await expect(page.locator('[data-pathcompiler="clients.feedback"]')).toHaveText('Client created');
    }
    test('helpers', async ({page}) => { await create(page); await create(page, 'Grace'); });`);
    expect(trace.partial).toBe(false);
    expect(
      trace.actions
        .filter((item) => item.operation === "fill")
        .map((item) => item.value),
    ).toEqual([
      { kind: "literal", value: "Ada" },
      { kind: "literal", value: "Grace" },
    ]);
    expect(
      trace.actions.every((item) => item.evidence.callSites.length === 1),
    ).toBe(true);
    expect(trace.assertions).toHaveLength(2);
  });

  it("recognizes imported aliases and namespaces but ignores unrelated or shadowed test/expect names", () => {
    const input =
      project(`import { test as scenario, expect as check } from '@playwright/test';
      import * as pw from '@playwright/test';
      scenario('aliased', async ({page: tab}) => { await tab.goto('/clients'); await check(tab).not.toHaveURL('/bad'); });
      pw.test('namespaced', async ({page}) => { await pw.expect.soft(page).toHaveURL('/clients'); });
      function outer(test) { test('fake', () => {}); }
      scenario('shadow', async ({page}) => { function expect() { return {}; } expect(page).toHaveURL('/fake'); });`);
    const { report } = minePlaywrightTests(input);
    expect(report.traces.map((item) => item.testName)).toEqual([
      "aliased",
      "namespaced",
      "shadow",
    ]);
    expect(report.traces[0]?.assertions[0]?.negated).toBe(true);
    expect(report.traces[1]?.assertions[0]?.soft).toBe(true);
    expect(report.traces[2]?.assertions).toEqual([]);
  });

  it("preserves nested suite modes, hook phases and body terminal assertions", () => {
    const { report } =
      mine(`test.beforeEach(async ({ page }) => { await page.goto('/clients'); });
      test.afterEach(async ({page}) => { await expect(page).toHaveURL('/cleanup'); });
      test.describe.skip('suite', () => {
        test.beforeEach(async ({page}) => { await page.getByTestId('create').click(); });
        test('nested', async ({page}) => { await expect(page).toHaveURL('/clients'); });
      });`);
    const trace = report.traces[0];
    expect(trace).toMatchObject({
      testName: "suite › nested",
      mode: "skip",
      startRoute: "/clients",
      terminalAssertion: { phase: "test", expected: { value: "/clients" } },
    });
    expect(trace?.actions.map((item) => item.phase)).toEqual([
      "setup",
      "setup",
    ]);
    expect(trace?.assertions.map((item) => item.phase)).toEqual([
      "test",
      "teardown",
    ]);
  });

  it("retains direct API shortcuts and negative assertions without inventing UI actions or routes", () => {
    const trace = first(`test('negative', async ({ request }) => {
      const response = await request.post('/api/clients', {data: {password: 'do-not-retain'}});
      expect(response.status()).toBe(400);
      expect((await request.get('/api/clients')).ok()).toBe(false);
    });`);
    expect(trace.startRoute).toBeNull();
    expect(trace.partial).toBe(false);
    expect(trace.actions.map((item) => item.kind)).toEqual([
      "request",
      "request",
    ]);
    expect(trace.assertions.map((item) => item.expected)).toEqual([
      { kind: "literal", value: 400 },
      { kind: "literal", value: false },
    ]);
    expect(JSON.stringify(trace)).not.toContain("do-not-retain");
  });

  it("does not turn branches, loops, callbacks or recursion into a fabricated straight-line workflow", () => {
    const trace =
      first(`async function recursive(page) { await recursive(page); }
      test('partial', async ({ page }) => {
        if (dynamic) await page.getByTestId('create').click();
        for (const x of values) await page.getByLabel('Name').fill(x);
        await page.evaluate(() => { throw new Error('never execute'); });
        await recursive(page); await expect(page).toHaveURL('/clients');
      });`);
    expect(trace.partial).toBe(true);
    expect(trace.actions.some((item) => item.kind === "ui")).toBe(false);
    expect(trace.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "control-flow",
        "unsupported-call",
        "helper-limit",
      ]),
    );
    expect(trace.terminalAssertion?.conditional).toBe(true);
  });

  it("keeps ambiguous, regex, CSS and dynamic locator hints unresolved without false graph edges", () => {
    const { report, graph } = mine(
      `test('uncertain', async ({page}) => {
      await page.getByRole('button', {name: 'Create Client'}).click();
      await page.getByRole('button', {name: /Create/}).click();
      await page.getByRole('button', {name: dynamic}).click();
      await page.locator('.btn:nth-child(2)').click();
    });`,
      {
        "components/other.tsx":
          'export function Other() { return <button aria-label="Create Client" />; }',
      },
    );
    expect(
      report.traces[0]?.actions.map((item) => item.target?.resolution),
    ).toEqual(["ambiguous", "unresolved", "unresolved", "unresolved"]);
    expect(
      graph.toJSON().edges.filter((edge) => edge.type === "TESTED_BY"),
    ).toEqual([]);
  });

  it("retains locator scope and filters while mapping the final semantic declaration", () => {
    const trace = first(`test('scope', async ({page}) => {
      const row = page.locator(dynamicSelector).filter({hasText: 'Ada'});
      await row.locator('[data-pathcompiler="clients.create"]').click();
    });`);
    expect(trace.actions[0]?.target).toMatchObject({
      graphNodeIds: ["ui:clients.create"],
      hints: [
        { method: "locator", argument: { kind: "dynamic" } },
        { method: "filter" },
        { method: "locator" },
      ],
    });
  });

  it("keeps the first navigation unknown instead of substituting a later route", () => {
    const trace = first(
      `test('dynamic route', async ({page}) => { await page.goto(dynamic); await page.goto('/clients'); });`,
    );
    expect(trace.startRoute).toBeNull();
  });

  it("does not reuse reassigned helper values or claim a terminal assertion before a later action", () => {
    const trace =
      first(`async function fill(page, name) { name = dynamic; await page.getByLabel('Name').fill(name); }
      test('mutation', async ({page}) => { await fill(page, 'Stale'); await expect(page).toHaveURL('/clients'); await page.reload(); });`);
    expect(trace.partial).toBe(true);
    expect(
      trace.actions.find((item) => item.operation === "fill")?.value,
    ).toEqual({ kind: "dynamic" });
    expect(trace.terminalAssertion).toBeNull();
  });

  it("produces deterministic reports and validates source, syntax and snapshot consistency", () => {
    const input = project(
      imports +
        `test('same', async ({page}) => { await page.goto('/clients'); });`,
    );
    const source = analyzeNextProject(input).graph;
    const first = minePlaywrightTests(input, source);
    const second = minePlaywrightTests(
      { ...input, files: [...input.files].reverse() },
      source,
    );
    expect(second.report).toEqual(first.report);
    expect(second.graph.serialize()).toBe(first.graph.serialize());
    expect(TestTraceReportSchema.parse(first.report)).toEqual(first.report);
    expect(() =>
      minePlaywrightTests(
        { ...input, repository: { ...input.repository, commit: "different" } },
        source,
      ),
    ).toThrow("snapshots differ");
    expect(() => minePlaywrightTests(project("export const = ;"))).toThrow(
      "tests/clients.spec.ts",
    );
    expect(() =>
      minePlaywrightTests({ files: [{ path: "../private.ts", content: "" }] }),
    ).toThrow();
    expect(
      minePlaywrightTests(
        { files: [], repository: { commit: null, dirty: null } },
        new ProductGraph(),
      ).report.traces,
    ).toEqual([]);
  });

  it("mines all fixture tests and reconstructs clients.create from helper evidence", async () => {
    const input = await readSourceProject(
      fileURLToPath(new URL("../../../fixtures/next-demo/", import.meta.url)),
    );
    const { report, graph } = minePlaywrightTests(
      input,
      analyzeNextProject(input).graph,
    );
    expect(report.traces).toHaveLength(9);
    expect(
      report.traces.every((trace) => trace.terminalAssertion !== null),
    ).toBe(true);
    const trace = report.traces.find(
      (item) =>
        item.testName === "viewer permissions are enforced in both UI and API",
    );
    expect(trace?.startRoute).toBe("/clients");
    const prefix = trace?.actions.slice(0, 5);
    expect(prefix?.map((item) => item.operation)).toEqual([
      "goto",
      "click",
      "fill",
      "fill",
      "click",
    ]);
    expect(prefix?.map((item) => item.target?.graphNodeIds[0])).toEqual([
      "route:/clients",
      "ui:clients.create",
      "ui:client.form.name",
      "ui:client.form.email",
      "ui:client.form.submit",
    ]);
    expect(trace?.assertions[0]).toMatchObject({
      matcher: "toHaveText",
      expected: { value: "Client created" },
      target: { graphNodeIds: ["ui:clients.feedback"] },
    });
    expect(graph.nodesByType("Test")).toHaveLength(9);
    expect(graph.nodesByType("WorkflowCandidate")).toEqual([]);
  });
});
