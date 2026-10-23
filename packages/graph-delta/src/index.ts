import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { openGitRepository } from "@pathcompiler/git-intelligence";
import {
  GraphEdgeSchema,
  type GraphNode,
  GraphNodeSchema,
  type ProductGraph,
} from "@pathcompiler/graph-core";
import { compareText, readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { z } from "zod";

const sha = z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
const changeList = z.strictObject({
  added: z.array(z.string()),
  removed: z.array(z.string()),
  changed: z.array(z.string()),
});
export const GraphNodeChangeSchema = z.strictObject({
  id: z.string(),
  type: GraphNodeSchema.shape.type,
  /** `location`: only evidence locations moved; `content`: other data changed. */
  kind: z.enum(["location", "content"]),
  /** Top-level data keys whose values differ, ignoring commit binding. */
  fields: z.array(z.string()),
  before: GraphNodeSchema,
  after: GraphNodeSchema,
});
export const GraphDeltaSchema = z.strictObject({
  schemaVersion: z.literal(1),
  base: z.strictObject({ commit: sha }),
  head: z.strictObject({ commit: sha }),
  addedNodes: z.array(GraphNodeSchema),
  removedNodes: z.array(GraphNodeSchema),
  changedNodes: z.array(GraphNodeChangeSchema),
  addedEdges: z.array(GraphEdgeSchema),
  removedEdges: z.array(GraphEdgeSchema),
  /** Same edge ID with different data; not in the spec's minimal shape. */
  changedEdges: z.array(
    z.strictObject({ before: GraphEdgeSchema, after: GraphEdgeSchema }),
  ),
  summary: z.strictObject({
    files: z.array(
      z.strictObject({
        path: z.string(),
        status: z.enum(["added", "removed", "modified"]),
      }),
    ),
    symbols: changeList,
    routes: changeList,
    targets: changeList,
    apis: changeList,
  }),
});
export type GraphNodeChange = z.infer<typeof GraphNodeChangeSchema>;
export type GraphDelta = z.infer<typeof GraphDeltaSchema>;
type FileChange = GraphDelta["summary"]["files"][number];

/** Removes commit binding so identical facts at different commits compare equal. */
function unbound(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unbound);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "repositoryCommit")
        .sort(([a], [b]) => compareText(a, b))
        .map(([key, item]) => [key, unbound(item)]),
    );
  return value;
}
function nodeData(node: GraphNode): Record<string, unknown> {
  const data = { ...(node.data ?? {}) };
  if (node.type === "Repository") {
    delete data.commit;
    delete data.dirty;
  }
  return unbound(data) as Record<string, unknown>;
}
const json = (value: unknown) => JSON.stringify(value);
const byId = <T extends { id: string }>(a: T, b: T) => compareText(a.id, b.id);

/**
 * Pure, deterministic graph delta. Node and edge identity comes from stable
 * graph IDs; changes in commit binding alone are not reported.
 */
export function computeGraphDelta(
  base: ProductGraph,
  head: ProductGraph,
  files: FileChange[] = [],
): Omit<GraphDelta, "schemaVersion" | "base" | "head"> {
  const before = base.toJSON();
  const after = head.toJSON();
  const oldNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const newNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const changedNodes: GraphNodeChange[] = [];
  for (const node of after.nodes) {
    const old = oldNodes.get(node.id);
    if (!old) continue;
    const a = nodeData(old);
    const b = nodeData(node);
    if (old.type === node.type && json(a) === json(b)) continue;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(
      compareText,
    );
    const fields = keys.filter((key) => json(a[key]) !== json(b[key]));
    changedNodes.push({
      id: node.id,
      type: node.type,
      kind:
        old.type === node.type && fields.every((key) => key === "evidence")
          ? "location"
          : "content",
      fields,
      before: old,
      after: node,
    });
  }
  const oldEdges = new Map(before.edges.map((edge) => [edge.id, edge]));
  const newEdges = new Map(after.edges.map((edge) => [edge.id, edge]));
  const changedEdges = after.edges.flatMap((edge) => {
    const old = oldEdges.get(edge.id);
    return old && json(unbound(old)) !== json(unbound(edge))
      ? [{ before: old, after: edge }]
      : [];
  });
  const addedNodes = after.nodes.filter((node) => !oldNodes.has(node.id));
  const removedNodes = before.nodes.filter((node) => !newNodes.has(node.id));
  const list = (
    select: (node: GraphNode) => string | null,
    changed: (change: GraphNodeChange) => boolean = (change) =>
      change.kind === "content",
  ) => ({
    added: unique(addedNodes.map(select)),
    removed: unique(removedNodes.map(select)),
    changed: unique(
      changedNodes.filter(changed).map((change) => select(change.after)),
    ),
  });
  const ofType =
    (...types: GraphNode["type"][]) =>
    (node: GraphNode) =>
      types.includes(node.type) ? node.id : null;
  return {
    addedNodes: addedNodes.sort(byId),
    removedNodes: removedNodes.sort(byId),
    changedNodes: changedNodes.sort(byId),
    addedEdges: after.edges.filter((edge) => !oldEdges.has(edge.id)).sort(byId),
    removedEdges: before.edges
      .filter((edge) => !newEdges.has(edge.id))
      .sort(byId),
    changedEdges: changedEdges.sort((a, b) => byId(a.after, b.after)),
    summary: {
      files: [...files].sort((a, b) => compareText(a.path, b.path)),
      symbols: list(ofType("Symbol", "Component")),
      routes: list(ofType("Route")),
      targets: list((node) => semanticTarget(node)),
      apis: list(ofType("APIEndpoint")),
    },
  };
}

/** Semantic target ID of an annotated UI action, if any. */
function semanticTarget(node: GraphNode): string | null {
  if (node.type !== "UIAction") return null;
  const target = node.data?.target;
  return target &&
    typeof target === "object" &&
    !Array.isArray(target) &&
    typeof target.semanticId === "string"
    ? target.semanticId
    : null;
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value) => value !== null))].sort(
    compareText,
  );
}

export type CommitRangeOptions = {
  /** Repository working tree or the subdirectory to analyze (e.g. an app folder). */
  directory: string;
  base: string;
  head: string;
  exclude?: string[];
};

/**
 * Exports both commits with `git archive` (read-only), fully re-analyzes each
 * snapshot and diffs the graphs. Correctness over incremental speed.
 */
export async function analyzeCommitRange(
  options: CommitRangeOptions,
): Promise<GraphDelta> {
  const git = await openGitRepository(options.directory);
  const workspace = await mkdtemp(
    path.join(os.tmpdir(), "pathcompiler-delta-"),
  );
  try {
    const snapshots = [];
    for (const [name, revision] of [
      ["base", options.base],
      ["head", options.head],
    ] as const) {
      const directory = path.join(workspace, name);
      await mkdir(directory);
      const commit = await git.exportCommit(revision, directory);
      const project = await readSourceProject(directory, {
        exclude: options.exclude ?? [],
        snapshot: { commit },
      });
      const graph = minePlaywrightTests(
        project,
        analyzeNextProject(project).graph,
      ).graph;
      snapshots.push({ commit, directory, graph });
    }
    const [base, head] = snapshots;
    if (!base || !head) throw new Error("Unreachable: two snapshots expected");
    const files = await changedFiles(base.directory, head.directory);
    return GraphDeltaSchema.parse({
      schemaVersion: 1,
      base: { commit: base.commit },
      head: { commit: head.commit },
      ...computeGraphDelta(base.graph, head.graph, files),
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function hashes(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  async function walk(relative: string) {
    for (const entry of await readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() || entry.isSymbolicLink())
        result.set(
          file,
          createHash("sha256")
            .update(
              entry.isSymbolicLink()
                ? `link:${await readlink(path.join(root, file))}`
                : await readFile(path.join(root, file)),
            )
            .digest("hex"),
        );
    }
  }
  await walk("");
  return result;
}

/** Exact tracked-file changes between two exports, including non-source files. */
async function changedFiles(base: string, head: string): Promise<FileChange[]> {
  const [a, b] = await Promise.all([hashes(base), hashes(head)]);
  const changes: FileChange[] = [];
  for (const [file, digest] of b)
    if (!a.has(file)) changes.push({ path: file, status: "added" });
    else if (a.get(file) !== digest)
      changes.push({ path: file, status: "modified" });
  for (const file of a.keys())
    if (!b.has(file)) changes.push({ path: file, status: "removed" });
  return changes;
}
