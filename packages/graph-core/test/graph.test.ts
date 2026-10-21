import { describe, expect, it } from "vitest";
import {
  createEdgeId,
  createNodeId,
  diffGraphs,
  ProductGraph,
} from "../src/index.js";

function graph(reverse = false) {
  const result = new ProductGraph();
  const nodes = [
    { id: "file:a", type: "File" as const, data: { nested: { z: 2, a: 1 } } },
    { id: "file:b", type: "File" as const },
    { id: "file:c", type: "File" as const },
    { id: "route:/clients", type: "Route" as const },
  ];
  const edges = [
    ["file:a", "file:b"],
    ["file:b", "file:c"],
    ["file:c", "file:a"],
  ] as const;
  for (const node of reverse ? nodes.reverse() : nodes) result.addNode(node);
  for (const [source, target] of reverse ? [...edges].reverse() : edges) {
    result.addEdge({
      id: createEdgeId("IMPORTS", source, target),
      type: "IMPORTS",
      source,
      target,
    });
  }
  return result;
}

describe("product graph", () => {
  it("normalizes omitted metadata to JSON-safe snapshots", () => {
    const value = new ProductGraph();
    value.addNode({ id: "file:a", type: "File", data: undefined });
    value.addEdge({
      id: "self",
      type: "CALLS",
      source: "file:a",
      target: "file:a",
      data: undefined,
    });
    expect(ProductGraph.deserialize(value.serialize()).toJSON()).toEqual({
      schemaVersion: 1,
      nodes: [{ id: "file:a", type: "File" }],
      edges: [
        { id: "self", type: "CALLS", source: "file:a", target: "file:a" },
      ],
    });
  });

  it("uses deterministic readable node IDs and unambiguous edge IDs", () => {
    expect(createNodeId("File", "src/clients.ts")).toBe("file:src/clients.ts");
    expect(createNodeId("APIEndpoint", "POST:/api/clients")).toBe(
      "api:POST:/api/clients",
    );
    expect(createNodeId("UIAction", "clients.create")).toBe(
      "ui:clients.create",
    );
    expect(createNodeId("Symbol", "src/clients.ts#Client")).toBe(
      createNodeId("Symbol", "src/clients.ts#Client"),
    );
    expect(createEdgeId("CALLS", "a:b", "c")).not.toBe(
      createEdgeId("CALLS", "a", "b:c"),
    );
    expect(() => createNodeId("File", " ")).toThrow();
  });

  it("serializes deterministically regardless of insertion or object key order", () => {
    const a = graph();
    const snapshot = graph(true).toJSON();
    const first = snapshot.nodes[0];
    if (!first) throw new Error("Expected fixture node");
    first.data = { nested: { a: 1, z: 2 } };
    expect(a.serialize()).toBe(ProductGraph.fromJSON(snapshot).serialize());
    expect(ProductGraph.deserialize(a.serialize()).toJSON()).toEqual(
      a.toJSON(),
    );
  });

  it("queries types and inbound/outbound neighbors", () => {
    const value = graph();
    expect(value.nodesByType("Route").map((node) => node.id)).toEqual([
      "route:/clients",
    ]);
    expect(value.neighbors("file:a").map((node) => node.id)).toEqual([
      "file:b",
    ]);
    expect(value.neighbors("file:a", "in").map((node) => node.id)).toEqual([
      "file:c",
    ]);
    expect(value.neighbors("file:a", "both").map((node) => node.id)).toEqual([
      "file:b",
      "file:c",
    ]);
  });

  it("traverses cycles once and respects the maximum depth", () => {
    const value = graph();
    expect(value.traverse("file:a", 0)).toEqual([]);
    expect(value.traverse("file:a", 1).map((node) => node.id)).toEqual([
      "file:b",
    ]);
    expect(value.traverse("file:a", 20).map((node) => node.id)).toEqual([
      "file:b",
      "file:c",
    ]);
    expect(value.traverse("file:a", 1, "in").map((node) => node.id)).toEqual([
      "file:c",
    ]);
    expect(() => value.traverse("file:a", -1)).toThrow("maxDepth");
    expect(() => value.traverse("file:a", 0.5)).toThrow("maxDepth");
    expect(() => value.traverse("missing", 0)).toThrow("Unknown node");
  });

  it("diffs added, removed and changed nodes and edges", () => {
    const before = graph();
    const snapshot = before.toJSON();
    const first = snapshot.nodes[0];
    const edge = snapshot.edges[0];
    if (!first || !edge) throw new Error("Expected fixture graph");
    first.data = { changed: true };
    edge.data = { confidence: 0.5 };
    snapshot.nodes = snapshot.nodes.filter((node) => node.type !== "Route");
    snapshot.nodes.push({ id: "test:create", type: "Test" });
    const removed = snapshot.edges.pop();
    const added = {
      id: "support",
      type: "SUPPORTED_BY" as const,
      source: "file:a",
      target: "test:create",
    };
    snapshot.edges.push(added);
    const diff = diffGraphs(before, ProductGraph.fromJSON(snapshot));
    expect(diff.nodes.added.map((node) => node.id)).toEqual(["test:create"]);
    expect(diff.nodes.removed.map((node) => node.id)).toEqual([
      "route:/clients",
    ]);
    expect(diff.nodes.changed).toEqual([
      { before: before.getNode("file:a"), after: first },
    ]);
    expect(diff.edges.added).toEqual([added]);
    expect(diff.edges.removed).toEqual([removed]);
    expect(diff.edges.changed).toHaveLength(1);
    expect(diffGraphs(before, graph(true))).toEqual({
      nodes: { added: [], removed: [], changed: [] },
      edges: { added: [], removed: [], changed: [] },
    });
  });

  it("rejects duplicates, dangling edges and invalid serialized inputs", () => {
    const value = graph();
    expect(() => value.addNode({ id: "file:a", type: "File" })).toThrow(
      "Duplicate node",
    );
    const edge = value.toJSON().edges[0];
    if (!edge) throw new Error("Expected edge");
    expect(() => value.addEdge(edge)).toThrow("Duplicate edge");
    expect(() =>
      value.addEdge({
        id: "missing",
        type: "CALLS",
        source: "file:a",
        target: "missing",
      }),
    ).toThrow("missing node");
    expect(() =>
      ProductGraph.fromJSON({ ...value.toJSON(), schemaVersion: 2 }),
    ).toThrow();
    expect(() => ProductGraph.deserialize("invalid")).toThrow();
    expect(() =>
      ProductGraph.fromJSON({ ...value.toJSON(), nodes: [] }),
    ).toThrow("missing node");
  });

  it("does not leak mutable graph state through reads or inputs", () => {
    const value = new ProductGraph();
    const input = {
      id: "file:a",
      type: "File" as const,
      data: { name: "original" },
    };
    value.addNode(input);
    input.data.name = "changed";
    const read = value.getNode("file:a");
    if (!read?.data) throw new Error("Expected node metadata");
    read.data.name = "also changed";
    expect(value.getNode("file:a")?.data?.name).toBe("original");
  });
});
