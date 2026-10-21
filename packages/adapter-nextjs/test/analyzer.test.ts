import { fileURLToPath } from "node:url";
import { diffGraphs } from "@pathcompiler/graph-core";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  analyzeNextProject,
  discoverRoute,
  scanNextRepository,
} from "../src/index.js";

function project(overrides: Record<string, string> = {}) {
  const files = {
    "app/page.tsx": `import Link from 'next/link'; export default function Home() { return <Link href="/clients">Clients</Link>; }`,
    "app/clients/page.tsx": `
      import { ClientButton as Button, useClients } from '@/components/button';
      import { useRouter as useNavigation } from 'next/navigation';
      import { Widget } from '@demo/widgets';
      import { archive } from '../../actions';
      export default function Clients({ role, featureFlags }) {
        const router = useNavigation(); useClients();
        if (role === 'editor' && featureFlags.clients && can('clients.write')) {}
        return <main><Button /><Widget /><button onClick={() => router.push('/clients/123')}>Open</button>
          <form onSubmit={archive}><button type="submit">Archive</button></form></main>;
      }`,
    "app/(admin)/clients/[id]/page.tsx": `export default function Detail() { return <main>Client</main>; }`,
    "components/button.tsx": `
      async function create() { await fetch('/api/clients', { method: 'POST' }); }
      export function ClientButton() { return <button onClick={create}>Create Client</button>; }
      export const useClients = () => ({ ready: true });`,
    "app/api/clients/route.ts": `export async function POST() { return Response.json({ ok: true }); }`,
    "app/api/clients/[id]/route.ts": `export const PATCH = async () => Response.json({ ok: true });`,
    "packages/widgets/src/index.tsx": `export const Widget = () => <aside>Widget</aside>;`,
    "actions.ts": `'use server'; export async function archive() { return true; }`,
    ...overrides,
  };
  return {
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
    configs: {
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./*"]}}}',
      "packages/widgets/package.json":
        '{"name":"@demo/widgets","exports":"./src/index.tsx"}',
    },
    repository: { commit: "a".repeat(40), dirty: false },
    diagnostics: [],
  };
}

describe("Next.js analyzer", () => {
  it.each([
    ["app/page.tsx", "/"],
    ["app/(admin)/clients/[id]/page.tsx", "/clients/:id"],
    ["app/docs/[...slug]/page.js", "/docs/:slug+"],
    ["app/docs/[[...slug]]/page.tsx", "/docs/:slug*"],
    ["app/@modal/clients/page.tsx", "/clients"],
  ])("normalizes route %s", (file, expected) => {
    expect(discoverRoute(file, "app")?.path).toBe(expected);
  });

  it("supports src/app and excludes private, layout and interception routes", () => {
    expect(discoverRoute("src/app/clients/page.jsx", "src/app")?.path).toBe(
      "/clients",
    );
    for (const file of [
      "app/_private/page.tsx",
      "app/layout.tsx",
      "app/(.)clients/page.tsx",
      "pages/index.tsx",
    ])
      expect(discoverRoute(file, "app")).toBeUndefined();
  });

  it("extracts routes, exported functions, hooks and aliased component relationships", () => {
    const { graph } = analyzeNextProject(project());
    expect(graph.nodesByType("Route").map((node) => node.id)).toEqual([
      "route:/",
      "route:/clients",
      "route:/clients/:id",
    ]);
    expect(
      graph.getNode("symbol:components/button.tsx#useClients")?.data,
    ).toMatchObject({ kind: "hook", exported: true });
    const edges = graph.toJSON().edges;
    expect(edges).toContainEqual(
      expect.objectContaining({
        type: "RENDERS",
        source: "component:app/clients/page.tsx#Clients",
        target: "component:components/button.tsx#ClientButton",
      }),
    );
    expect(edges).toContainEqual(
      expect.objectContaining({
        type: "RENDERS",
        target: "component:packages/widgets/src/index.tsx#Widget",
      }),
    );
    expect(edges).toContainEqual(
      expect.objectContaining({
        type: "IMPORTS",
        source: "file:app/clients/page.tsx",
        target: "file:components/button.tsx",
      }),
    );
  });

  it("extracts UI events, handlers, Link/router navigation and API edges", () => {
    const { graph } = analyzeNextProject(project());
    const button = graph
      .nodesByType("UIAction")
      .find((node) => node.data?.label === "Create Client");
    expect(button?.data).toMatchObject({ tag: "button", events: ["onClick"] });
    const edges = graph.toJSON().edges;
    expect(edges).toContainEqual(
      expect.objectContaining({
        type: "HANDLES",
        source: "symbol:components/button.tsx#create",
        target: button?.id,
      }),
    );
    expect(edges).toContainEqual(
      expect.objectContaining({
        type: "NAVIGATES_TO",
        target: "route:/clients",
      }),
    );
    expect(edges).toContainEqual(
      expect.objectContaining({
        type: "NAVIGATES_TO",
        source: "component:app/clients/page.tsx#Clients",
        target: "route:/clients/:id",
      }),
    );
    expect(edges).toContainEqual(
      expect.objectContaining({
        type: "CALLS_API",
        source: "symbol:components/button.tsx#create",
        target: "api:POST:/api/clients",
      }),
    );
    expect(edges).toContainEqual(
      expect.objectContaining({
        type: "HANDLES",
        source: "symbol:actions.ts#archive",
      }),
    );
  });

  it("marks permission and flag observations as uncertain with provenance", () => {
    const { graph } = analyzeNextProject(project());
    expect(graph.getNode("permission:role:editor")?.data).toMatchObject({
      confidence: 0.5,
      heuristic: true,
    });
    expect(graph.getNode("permission:clients.write")?.data?.evidence).toEqual([
      {
        file: "app/clients/page.tsx",
        locator: "Clients",
        repositoryCommit: "a".repeat(40),
      },
    ]);
    expect(graph.getNode("flag:clients")?.data).toMatchObject({
      heuristic: true,
    });
    expect(
      graph.toJSON().edges.filter((edge) => edge.type === "GUARDED_BY_FLAG"),
    ).toHaveLength(1);
  });

  it("produces byte-identical output after formatting, comments and input reordering", () => {
    const input = project();
    const before = analyzeNextProject(input);
    const printer = ts.createPrinter({
      newLine: ts.NewLineKind.CarriageReturnLineFeed,
    });
    const formatted = {
      ...input,
      files: [...input.files].reverse().map((file) => ({
        ...file,
        content: `/* formatting only */\n${printer.printFile(ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true))}`,
      })),
    };
    const after = analyzeNextProject(formatted);
    expect(after.graph.serialize()).toBe(before.graph.serialize());
    expect(after.summary).toEqual(before.summary);
    expect(diffGraphs(before.graph, after.graph).nodes.changed).toEqual([]);
  });

  it("resolves literal/template calls through a fetch wrapper and declared server actions", () => {
    const input = project({
      "transport.ts": `export async function send(url: string, method: string) { return fetch(url, { method }); }`,
      "app/tools/page.tsx": `import { send } from '../../transport'; import { archive } from '../../actions';
        export default function Tools() { async function update(id: string) { await send(\`/api/clients/\${id}\`, 'PATCH'); await archive(); }
        return <button onClick={() => update('123')}>Update</button>; }`,
    });
    const { graph } = analyzeNextProject(input);
    expect(graph.toJSON().edges).toContainEqual(
      expect.objectContaining({
        type: "CALLS_API",
        source: "symbol:app/tools/page.tsx#Tools.update",
        target: "api:PATCH:/api/clients/:id",
        data: expect.objectContaining({ heuristic: true }),
      }),
    );
    expect(graph.toJSON().edges).toContainEqual(
      expect.objectContaining({
        type: "CALLS_API",
        target: "api:ACTION:actions.ts#archive",
      }),
    );
  });

  it("does not invent edges for shadowed fetch/router names or dynamic requests", () => {
    const input = project({
      "app/shadow/page.tsx": `
      function fetch(url: string) { return url; }
      export default function Shadow({ url }) { const router = { push(value) { return value; } };
        fetch('/api/clients'); router.push('/clients'); return <button>Fake calls</button>; }`,
    });
    const { graph } = analyzeNextProject(input);
    expect(
      graph
        .toJSON()
        .edges.filter(
          (edge) =>
            edge.source.includes("app/shadow") &&
            ["NAVIGATES_TO", "CALLS_API"].includes(edge.type),
        ),
    ).toEqual([]);
    const dynamic = analyzeNextProject(
      project({
        "app/dynamic/page.tsx": `export default function Dynamic({ url, method }) { fetch(url, { method }); return <main />; }`,
      }),
    );
    expect(dynamic.summary.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "dynamic-api-call",
        file: "app/dynamic/page.tsx",
      }),
    );
  });

  it("rejects syntax errors and repositories without App Router routes", () => {
    expect(() =>
      analyzeNextProject(project({ "bad.ts": "export const = ;" })),
    ).toThrow("bad.ts");
    expect(() =>
      analyzeNextProject({
        files: [],
        repository: { commit: null, dirty: null },
      }),
    ).toThrow("App Router");
  });

  it("scans the actual fixture repeatably and connects its client/plan API mutations", async () => {
    const directory = fileURLToPath(
      new URL("../../../fixtures/next-demo/", import.meta.url),
    );
    const first = await scanNextRepository(directory);
    const second = await scanNextRepository(directory);
    expect(first.graph.serialize()).toBe(second.graph.serialize());
    expect(first.summary).toEqual(second.summary);
    expect(first.graph.nodesByType("Route").map((node) => node.id)).toEqual([
      "route:/",
      "route:/clients",
      "route:/plans",
    ]);
    const apiTargets = first.graph
      .toJSON()
      .edges.filter((edge) => edge.type === "CALLS_API")
      .map((edge) => edge.target);
    expect(apiTargets).toEqual(
      expect.arrayContaining([
        "api:POST:/api/clients",
        "api:PATCH:/api/clients/:id",
        "api:POST:/api/plans",
        "api:PATCH:/api/plans/:id",
      ]),
    );
    expect(first.graph.serialize()).not.toContain(directory);
  });

  it("recognizes anonymous default components and re-exported route handlers", () => {
    const { graph } = analyzeNextProject(
      project({
        "components/anonymous.tsx":
          "export default () => <button>Anonymous</button>;",
        "app/anonymous/page.tsx":
          "export { default } from '../../components/anonymous';",
        "handlers.ts":
          "export async function handle() { return new Response(); }",
        "app/api/alias/route.ts":
          "export { handle as GET } from '../../../handlers';",
      }),
    );
    expect(
      graph.getNode("component:components/anonymous.tsx#default"),
    ).toBeDefined();
    expect(graph.toJSON().edges).toContainEqual(
      expect.objectContaining({
        type: "RENDERS",
        source: "route:/anonymous",
        target: "component:components/anonymous.tsx#default",
      }),
    );
    expect(graph.toJSON().edges).toContainEqual(
      expect.objectContaining({
        type: "HANDLES",
        source: "symbol:handlers.ts#handle",
        target: "api:GET:/api/alias",
      }),
    );
  });

  it("does not guess a GET method when options are dynamic or overridden", () => {
    const { graph, summary } = analyzeNextProject(
      project({
        "app/api/status/route.ts":
          "export function GET() { return new Response(); }",
        "transport.ts": `export async function send(url: string) { return fetch(url, { method: getMethod() }); }`,
        "app/options/page.tsx": `import { send } from '../../transport';
        export default function Options({ extra }) { fetch('/api/status', { method: 'GET', ...extra });
          send('/api/status'); return <main />; }`,
      }),
    );
    expect(
      graph
        .toJSON()
        .edges.filter(
          (edge) =>
            edge.type === "CALLS_API" && edge.target === "api:GET:/api/status",
        ),
    ).toEqual([]);
    expect(summary.diagnostics).toContainEqual(
      expect.objectContaining({ code: "dynamic-api-call" }),
    );
  });
});
