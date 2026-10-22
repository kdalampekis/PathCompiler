import {
  createEdgeId,
  createNodeId,
  ProductGraph,
} from "@pathcompiler/graph-core";
import { compareText } from "@pathcompiler/source-model";
import { z } from "zod";
import type { LocalGitRepository } from "./git.js";
import { filesForNode } from "./provenance.js";
import {
  type Commit,
  type GitEvidenceReport,
  GitEvidenceReportSchema,
} from "./schema.js";

export { LocalGitRepository, openGitRepository } from "./git.js";
export * from "./provider.js";
export * from "./schema.js";

/** Current node → provenance files → bounded path history → commit evidence. Input graph is unchanged. */
export async function enrichNodeHistory(
  repository: LocalGitRepository,
  sourceGraph: ProductGraph,
  nodeId: string,
  options: { limit?: number } = {},
): Promise<{ graph: ProductGraph; report: GitEvidenceReport }> {
  const { limit } = z
    .strictObject({ limit: z.number().int().min(1).max(100).default(20) })
    .parse(options);
  const selected = sourceGraph.getNode(nodeId);
  if (!selected) throw new Error(`Unknown graph node: ${nodeId}`);
  const files = filesForNode(selected);
  if (!files.length)
    throw new Error("Select a graph node with source-file provenance.");
  if (files.length > 5)
    throw new Error(
      "Node history is limited to five source files. Select a more specific node.",
    );
  const snapshot = await repository.getSnapshot();
  if (!snapshot.commit)
    throw new Error(
      "Create an initial Git commit before inspecting node history.",
    );
  const sourceRepository = sourceGraph.getNode("repository:.");
  if (
    sourceRepository?.data?.commit !== snapshot.commit ||
    sourceRepository.data.dirty !== snapshot.dirty
  )
    throw new Error(
      "Source graph and Git snapshot differ. Rescan the selected directory before inspecting history.",
    );
  const report: GitEvidenceReport = {
    schemaVersion: 1,
    evidenceOnly: true,
    nodeId,
    repository: { ...snapshot, commit: snapshot.commit },
    defaultBranch: await repository.getDefaultBranch(),
    histories: [],
    commits: [],
    diagnostics: [],
  };
  if (snapshot.dirty)
    report.diagnostics.push({
      code: "dirty-working-tree",
      message:
        "History describes committed files. Associations to current uncommitted declarations require review.",
    });
  if (snapshot.shallow)
    report.diagnostics.push({
      code: "shallow-history",
      message:
        "Only locally available history is considered. Shallow boundaries can omit commits and blame origins.",
    });
  const commits = new Map<string, Commit>();
  for (const file of files) {
    const history = await repository.getCommitsForPath(file, {
      revision: snapshot.commit,
      limit,
    });
    report.histories.push(history);
    if (history.limited)
      report.diagnostics.push({
        code: "history-limit",
        file,
        message: `Only the newest ${limit} relevant commits are included.`,
      });
    for (const commit of history.commits) commits.set(commit.sha, commit);
    if (commits.size > 100)
      throw new Error(
        "Node history exceeds 100 unique commits. Reduce --limit or select a more specific node.",
      );
  }
  const graph = ProductGraph.fromJSON(sourceGraph.toJSON());
  const nodes = sourceGraph
    .toJSON()
    .nodes.map((node) => ({ node, files: filesForNode(node) }));
  const existingEdges = new Set(
    sourceGraph.toJSON().edges.map((edge) => edge.id),
  );
  for (const commit of [...commits.values()].sort((a, b) =>
    compareText(a.sha, b.sha),
  )) {
    const parent = commit.parents[0] ?? null;
    const diff =
      parent !== null && !(await repository.hasCommit(parent))
        ? null
        : await repository.getDiff(parent, commit.sha, { paths: files });
    if (diff === null)
      report.diagnostics.push({
        code: "missing-parent",
        message: `Diff for ${commit.sha} is unavailable because its first parent is not present locally.`,
      });
    report.commits.push({ commit, diff });
    const id = createNodeId("Commit", commit.sha);
    if (!graph.getNode(id))
      graph.addNode({
        id,
        type: "Commit",
        data: { ...commit, messageRole: "intent-evidence" },
      });
    const changedFiles =
      diff?.changes.map((change) => change.path) ??
      report.histories
        .filter((history) =>
          history.commits.some((item) => item.sha === commit.sha),
        )
        .map((history) => history.path);
    for (const item of nodes) {
      const associated = item.files.filter((file) =>
        changedFiles.includes(file),
      );
      if (!associated.length) continue;
      const edgeId = createEdgeId("CHANGED_BY", item.node.id, id);
      if (existingEdges.has(edgeId)) continue;
      // ponytail: source nodes have no line ranges; only File changes are proven by a diff.
      // Symbol-level attribution needs source ranges and historical symbol matching in a later phase.
      const exactFile = item.node.type === "File" && diff !== null;
      graph.addEdge({
        id: edgeId,
        type: "CHANGED_BY",
        source: item.node.id,
        target: id,
        data: {
          basis: exactFile
            ? "file-change"
            : diff === null
              ? "path-history"
              : "file-association",
          confidence: exactFile ? 1 : 0.5,
          heuristic: !exactFile,
          files: associated,
          repositoryCommit: snapshot.commit,
          changedCommit: commit.sha,
          comparison: "first-parent",
          workingTreeDirty: snapshot.dirty,
        },
      });
    }
  }
  const after = await repository.getSnapshot();
  if (JSON.stringify(after) !== JSON.stringify(snapshot))
    throw new Error(
      "Repository changed while inspecting history. Rescan and retry.",
    );
  return { graph, report: GitEvidenceReportSchema.parse(report) };
}
