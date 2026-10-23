import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ProductGraph } from "@pathcompiler/graph-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzeCommitRange,
  computeGraphDelta,
  type GraphDelta,
  GraphDeltaSchema,
} from "../src/index.js";

const exec = promisify(execFile);
const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo", import.meta.url),
);
let repository: string;
let app: string;
let base: string;
let head: string;
let delta: GraphDelta;
const git = async (...args: string[]) =>
  (
    await exec("git", ["-C", repository, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.test",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.test",
      },
    })
  ).stdout.trim();
async function edit(file: string, from: string, to: string) {
  const target = path.join(app, file);
  const content = await readFile(target, "utf8");
  if (!content.includes(from)) throw new Error(`Missing ${from} in ${file}`);
  await writeFile(target, content.replace(from, to));
}

beforeAll(async () => {
  repository = await mkdtemp(
    path.join(os.tmpdir(), "pathcompiler-delta-repo-"),
  );
  app = path.join(repository, "apps/demo");
  await mkdir(app, { recursive: true });
  const tracked = (
    await exec("git", ["-C", fixture, "ls-files", "-z", "--", "."])
  ).stdout
    .split("\0")
    .filter(Boolean);
  for (const file of tracked) {
    await mkdir(path.dirname(path.join(app, file)), { recursive: true });
    await cp(path.join(fixture, file), path.join(app, file));
  }
  await git("init", "--quiet", "--initial-branch=main");
  await git("add", ".");
  await git("commit", "--quiet", "-m", "base");
  base = await git("rev-parse", "HEAD");
  await edit(
    "components/clients.tsx",
    "            Create Client\n",
    "            Add Client\n",
  );
  await edit(
    "components/plans.tsx",
    'data-pathcompiler="plans.change_structure"',
    'data-pathcompiler="plans.restructure"',
  );
  await mkdir(path.join(app, "app/reports"), { recursive: true });
  await writeFile(
    path.join(app, "app/reports/page.tsx"),
    "export default function Reports() {\n  return <h1>Reports</h1>;\n}\n",
  );
  await writeFile(path.join(app, "NOTES.md"), "release notes\n");
  await writeFile(path.join(repository, "outside.txt"), "not in scope\n");
  await git("add", ".");
  await git("commit", "--quiet", "-m", "head");
  head = await git("rev-parse", "HEAD");
  delta = await analyzeCommitRange({ directory: app, base, head });
}, 60_000);
afterAll(async () => {
  await rm(repository, { recursive: true, force: true });
});

describe("graph delta", () => {
  it("binds the delta to both commits and validates its schema", () => {
    expect(GraphDeltaSchema.parse(delta)).toEqual(delta);
    expect(delta.base.commit).toBe(base);
    expect(delta.head.commit).toBe(head);
  });

  it("lists exact changed files within the analyzed directory only", () => {
    expect(delta.summary.files).toEqual([
      { path: "NOTES.md", status: "added" },
      { path: "app/reports/page.tsx", status: "added" },
      { path: "components/clients.tsx", status: "modified" },
      { path: "components/plans.tsx", status: "modified" },
    ]);
  });

  it("summarizes changed routes, targets, symbols and APIs", () => {
    expect(delta.summary.routes).toEqual({
      added: ["route:/reports"],
      removed: [],
      changed: [],
    });
    expect(delta.summary.targets.added).toEqual(["plans.restructure"]);
    expect(delta.summary.targets.removed).toEqual(["plans.change_structure"]);
    expect(delta.summary.targets.changed).toContain("clients.create");
    expect(delta.summary.symbols.added).toContain(
      "component:app/reports/page.tsx#Reports",
    );
    expect(delta.summary.apis).toEqual({ added: [], removed: [], changed: [] });
  });

  it("records copy-only edits as content changes with the changed fields", () => {
    const create = delta.changedNodes.find(
      (item) => item.id === "ui:clients.create",
    );
    expect(create).toMatchObject({ type: "UIAction", kind: "content" });
    expect(create?.fields).toEqual(expect.arrayContaining(["label"]));
    expect(create?.fields).not.toContain("evidence");
    expect(create?.after.data?.label).toBe("Add Client");
  });

  it("never reports commit binding alone as a change", async () => {
    expect(delta.changedNodes.some((item) => item.id === "repository:.")).toBe(
      false,
    );
    const same = await analyzeCommitRange({ directory: app, base, head: base });
    expect({
      ...same,
      base: undefined,
      head: undefined,
    }).toEqual({
      schemaVersion: 1,
      base: undefined,
      head: undefined,
      addedNodes: [],
      removedNodes: [],
      changedNodes: [],
      addedEdges: [],
      removedEdges: [],
      changedEdges: [],
      summary: {
        files: [],
        symbols: { added: [], removed: [], changed: [] },
        routes: { added: [], removed: [], changed: [] },
        targets: { added: [], removed: [], changed: [] },
        apis: { added: [], removed: [], changed: [] },
      },
    });
  }, 60_000);

  it("classifies evidence-only moves as location changes", () => {
    const evidence = (file: string, commit: string) => [
      { file, locator: `${file}#Save`, repositoryCommit: commit },
    ];
    const graph = (file: string, commit: string, label: string) => {
      const value = new ProductGraph();
      value.addNode({
        id: "ui:notes.save",
        type: "UIAction",
        data: { label, evidence: evidence(file, commit) },
      });
      value.addNode({
        id: "repository:.",
        type: "Repository",
        data: { commit, dirty: false },
      });
      return value;
    };
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    const moved = computeGraphDelta(
      graph("components/notes.tsx", a, "Save"),
      graph("components/editor/notes.tsx", b, "Save"),
    );
    expect(moved.changedNodes).toEqual([
      expect.objectContaining({ kind: "location", fields: ["evidence"] }),
    ]);
    expect(moved.summary.targets.changed).toEqual([]);
    const rebound = computeGraphDelta(
      graph("components/notes.tsx", a, "Save"),
      graph("components/notes.tsx", b, "Save"),
    );
    expect(rebound.changedNodes).toEqual([]);
  });

  it("rejects unknown revisions without leaving temporary exports", async () => {
    await expect(
      analyzeCommitRange({ directory: app, base, head: "f".repeat(40) }),
    ).rejects.toThrow("revision and path");
    const leftovers = (await readdir(os.tmpdir())).filter(
      (name) =>
        name.startsWith("pathcompiler-delta-") &&
        !name.startsWith("pathcompiler-delta-repo-"),
    );
    expect(leftovers).toEqual([]);
  });
});
