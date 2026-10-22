import { createEdgeId, ProductGraph } from "@pathcompiler/graph-core";
import { describe, expect, it } from "vitest";
import { collectGraphEvidence, EvidenceBundleSchema } from "../src/index.js";

const sha = "a".repeat(40);
function graph(commit: string | null = sha) {
  const result = new ProductGraph();
  result.addNode({
    id: "repository:.",
    type: "Repository",
    data: { commit, dirty: false },
  });
  for (const [id, type] of [
    ["ui:create", "UIAction"],
    ["test:create", "Test"],
    ["ui:unrelated", "UIAction"],
  ] as const)
    result.addNode({
      id,
      type,
      data: {
        evidence: [
          { file: "app/page.tsx", locator: id, repositoryCommit: commit },
        ],
      },
    });
  result.addNode({
    id: "commit:old",
    type: "Commit",
    data: { sha: "b".repeat(40), message: "Historical intent" },
  });
  result.addNode({
    id: "pr:12",
    type: "PullRequest",
    data: {
      headSha: "c".repeat(40),
      url: "https://github.com/example/product/pull/12",
      title: "Proposed change",
    },
  });
  for (const [type, source, target] of [
    ["TESTED_BY", "ui:create", "test:create"],
    ["CHANGED_BY", "ui:create", "commit:old"],
    ["SUPPORTED_BY", "commit:old", "pr:12"],
    ["CALLS", "ui:create", "ui:unrelated"],
  ] as const)
    result.addEdge({
      id: createEdgeId(type, source, target),
      type,
      source,
      target,
      data: { heuristic: true },
    });
  return result;
}

describe("selected graph evidence", () => {
  it("preserves bounded source/test/history/PR evidence and individual commit identities", () => {
    const source = graph();
    const before = source.serialize();
    const bundle = collectGraphEvidence(source, ["ui:create", "ui:create"]);
    expect(bundle.rootNodeIds).toEqual(["ui:create"]);
    expect(bundle.graph.nodes.map((node) => node.id)).toEqual([
      "commit:old",
      "pr:12",
      "test:create",
      "ui:create",
    ]);
    expect(bundle.graph.edges).toHaveLength(3);
    expect(bundle.refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ui:create",
          type: "symbol",
          repositoryCommit: sha,
        }),
        expect.objectContaining({
          id: "test:create",
          type: "test",
          repositoryCommit: sha,
        }),
        expect.objectContaining({
          id: "commit:old",
          type: "commit",
          repositoryCommit: "b".repeat(40),
        }),
        expect.objectContaining({
          id: "pr:12",
          type: "pull_request",
          repositoryCommit: "c".repeat(40),
        }),
      ]),
    );
    expect(source.serialize()).toBe(before);
    const snapshot = source.toJSON();
    snapshot.nodes.reverse();
    snapshot.edges.reverse();
    expect(
      collectGraphEvidence(ProductGraph.fromJSON(snapshot), ["ui:create"]),
    ).toEqual(bundle);
  });
  it("keeps unborn source evidence without inventing commit-bound workflow references", () => {
    const bundle = collectGraphEvidence(graph(null), ["ui:create"]);
    expect(bundle.repository.commit).toBeNull();
    expect(bundle.graph.nodes.some((node) => node.id === "ui:create")).toBe(
      true,
    );
    expect(bundle.refs.map((ref) => ref.id)).toEqual(["commit:old", "pr:12"]);
  });
  it("rejects unknown roots, stale source snapshots and invalid bundle references", () => {
    expect(() => collectGraphEvidence(graph(), ["missing"])).toThrow(
      "Unknown evidence root",
    );
    const snapshot = graph().toJSON();
    const repo = snapshot.nodes.find((node) => node.id === "repository:.");
    if (repo?.data) repo.data.commit = "d".repeat(40);
    expect(() =>
      collectGraphEvidence(ProductGraph.fromJSON(snapshot), ["ui:create"]),
    ).toThrow("Stale source provenance");
    const bundle = collectGraphEvidence(graph(), ["ui:create"]);
    expect(
      EvidenceBundleSchema.safeParse({ ...bundle, rootNodeIds: ["missing"] })
        .success,
    ).toBe(false);
    expect(
      EvidenceBundleSchema.safeParse({
        ...bundle,
        refs: [...bundle.refs, bundle.refs[0]],
      }).success,
    ).toBe(false);
    expect(
      EvidenceBundleSchema.safeParse({
        ...bundle,
        graph: { ...bundle.graph, nodes: [] },
      }).success,
    ).toBe(false);
  });
});
