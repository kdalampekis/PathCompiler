import {
  type GraphNode,
  GraphSnapshotSchema,
  ProductGraph,
} from "@pathcompiler/graph-core";
import {
  compareText,
  RelativePathSchema,
  SourceProjectSchema,
} from "@pathcompiler/source-model";
import { type EvidenceRef, EvidenceRefSchema } from "@pathcompiler/workflow-ir";
import { z } from "zod";

export { type EvidenceRef, EvidenceRefSchema } from "@pathcompiler/workflow-ir";
export const SourceProvenanceSchema = z.strictObject({
  file: RelativePathSchema,
  locator: z.string().min(1),
  repositoryCommit: z.string().nullable(),
});
export type SourceProvenance = z.infer<typeof SourceProvenanceSchema>;
export const EvidenceBundleSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    repository: SourceProjectSchema.shape.repository,
    rootNodeIds: z.array(z.string().min(1)),
    graph: GraphSnapshotSchema,
    refs: z.array(EvidenceRefSchema),
  })
  .superRefine((bundle, context) => {
    try {
      const graph = ProductGraph.fromJSON(bundle.graph);
      if (
        new Set(bundle.rootNodeIds).size !== bundle.rootNodeIds.length ||
        new Set(bundle.refs.map((ref) => ref.id)).size !== bundle.refs.length
      )
        throw new Error("Evidence roots and reference IDs must be unique");
      for (const id of [
        ...bundle.rootNodeIds,
        ...bundle.refs.map((ref) => ref.id),
      ])
        if (!graph.getNode(id)) throw new Error(`Unknown evidence node: ${id}`);
      for (const node of bundle.graph.nodes) {
        if (node.type !== "Commit" && node.type !== "PullRequest")
          sourceProvenance(node, bundle.repository.commit);
      }
      for (const ref of bundle.refs) {
        const node = graph.getNode(ref.id);
        const commit =
          node?.type === "Commit"
            ? node.data?.sha
            : node?.type === "PullRequest"
              ? node.data?.headSha
              : bundle.repository.commit;
        if (ref.repositoryCommit !== commit)
          throw new Error(
            `Evidence reference ${ref.id} has a mismatched commit`,
          );
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "Invalid evidence graph",
      });
    }
  });
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

/** Preserve all locations; their commit must agree with the current source snapshot. */
export function sourceProvenance(
  node: GraphNode,
  repositoryCommit: string | null,
): SourceProvenance[] {
  const locations = z
    .array(SourceProvenanceSchema)
    .min(1)
    .parse(node.data?.evidence);
  if (
    locations.some((location) => location.repositoryCommit !== repositoryCommit)
  )
    throw new Error(
      `Stale source provenance for ${node.id}. Rescan before collecting evidence.`,
    );
  return locations.sort((a, b) =>
    compareText(JSON.stringify(a), JSON.stringify(b)),
  );
}

/** Selected nodes plus two bounded hops of explicit test/history/PR support. No prose inference or execution. */
export function collectGraphEvidence(
  graph: ProductGraph,
  rootNodeIds: string[],
): EvidenceBundle {
  const repository = SourceProjectSchema.shape.repository.parse({
    commit: graph.getNode("repository:.")?.data?.commit,
    dirty: graph.getNode("repository:.")?.data?.dirty,
  });
  const roots = [
    ...new Set(z.array(z.string().min(1)).parse(rootNodeIds)),
  ].sort(compareText);
  const snapshot = graph.toJSON();
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  for (const id of roots)
    if (!nodes.has(id)) throw new Error(`Unknown evidence root: ${id}`);
  const selected = new Set(roots);
  for (let hop = 0; hop < 2; hop++) {
    const current = new Set(selected);
    for (const edge of snapshot.edges) {
      if (
        current.has(edge.source) &&
        ["TESTED_BY", "CHANGED_BY", "SUPPORTED_BY"].includes(edge.type) &&
        ["Test", "Commit", "PullRequest"].includes(
          nodes.get(edge.target)?.type ?? "",
        )
      )
        selected.add(edge.target);
    }
  }
  const subset = snapshot.nodes.filter((node) => selected.has(node.id));
  const refs: EvidenceRef[] = [];
  for (const node of subset) {
    const type: EvidenceRef["type"] =
      node.type === "File"
        ? "source_file"
        : node.type === "Route"
          ? "route"
          : node.type === "APIEndpoint"
            ? "api"
            : node.type === "Test"
              ? "test"
              : node.type === "Commit"
                ? "commit"
                : node.type === "PullRequest"
                  ? "pull_request"
                  : "symbol";
    let commit = repository.commit;
    let locator = node.id;
    if (node.type === "Commit" || node.type === "PullRequest") {
      commit = z
        .string()
        .min(1)
        .parse(node.type === "Commit" ? node.data?.sha : node.data?.headSha);
      if (node.type === "PullRequest")
        locator = z.string().min(1).parse(node.data?.url);
    } else {
      const locations = sourceProvenance(node, repository.commit);
      locator = locations[0]?.locator ?? node.id;
    }
    // Approved workflow references require a commit; unborn source remains in the evidence graph without invented SHAs.
    if (commit !== null)
      refs.push(
        EvidenceRefSchema.parse({
          id: node.id,
          type,
          locator,
          repositoryCommit: commit,
        }),
      );
  }
  return EvidenceBundleSchema.parse({
    schemaVersion: 1,
    repository,
    rootNodeIds: roots,
    graph: {
      schemaVersion: 1,
      nodes: subset,
      edges: snapshot.edges.filter(
        (edge) => selected.has(edge.source) && selected.has(edge.target),
      ),
    },
    refs,
  });
}
