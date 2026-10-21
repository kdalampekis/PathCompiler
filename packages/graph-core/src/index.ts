import { z } from "zod";

const text = z
  .string()
  .min(1)
  .refine(
    (value) => value.trim() === value && value.length > 0,
    "IDs and locators must be nonempty with no surrounding whitespace",
  );

export const NodeTypeSchema = z.enum([
  "Repository",
  "File",
  "Symbol",
  "Component",
  "Route",
  "UIAction",
  "APIEndpoint",
  "DataEntity",
  "Permission",
  "FeatureFlag",
  "Test",
  "ProductSurface",
  "Capability",
  "WorkflowCandidate",
  "Commit",
  "PullRequest",
]);
export const EdgeTypeSchema = z.enum([
  "CONTAINS",
  "IMPORTS",
  "CALLS",
  "RENDERS",
  "HANDLES",
  "NAVIGATES_TO",
  "CALLS_API",
  "READS",
  "WRITES",
  "REQUIRES_PERMISSION",
  "GUARDED_BY_FLAG",
  "TESTED_BY",
  "SUPPORTED_BY",
  "CHANGED_BY",
  "IMPLEMENTS",
  "EXPOSES_ACTION",
  "NEXT_STATE",
]);
export const GraphNodeSchema = z.strictObject({
  id: text,
  type: NodeTypeSchema,
  data: z.record(z.string(), z.json()).optional(),
});
export const GraphEdgeSchema = z.strictObject({
  id: text,
  type: EdgeTypeSchema,
  source: text,
  target: text,
  data: z.record(z.string(), z.json()).optional(),
});
export const GraphSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});
export type NodeType = z.infer<typeof NodeTypeSchema>;
export type EdgeType = z.infer<typeof EdgeTypeSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;
type JsonValue = z.infer<ReturnType<typeof z.json>>;

const prefixes: Record<NodeType, string> = {
  Repository: "repository",
  File: "file",
  Symbol: "symbol",
  Component: "component",
  Route: "route",
  UIAction: "ui",
  APIEndpoint: "api",
  DataEntity: "entity",
  Permission: "permission",
  FeatureFlag: "flag",
  Test: "test",
  ProductSurface: "surface",
  Capability: "capability",
  WorkflowCandidate: "workflow",
  Commit: "commit",
  PullRequest: "pr",
};

/** Locators are repository-relative POSIX paths or semantic identifiers, normalized by adapters. */
export function createNodeId(type: NodeType, locator: string): string {
  return `${prefixes[NodeTypeSchema.parse(type)]}:${text.parse(locator)}`;
}

export function createEdgeId(
  type: EdgeType,
  source: string,
  target: string,
): string {
  return `edge:${JSON.stringify([EdgeTypeSchema.parse(type), text.parse(source), text.parse(target)])}`;
}

function canonical(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compare(a, b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function sorted<T extends { id: string }>(values: Iterable<T>): T[] {
  return [...values].sort((a, b) => compare(a.id, b.id));
}
function stableJson(value: unknown): string {
  return JSON.stringify(canonical(z.json().parse(value)));
}

export class ProductGraph {
  readonly #nodes = new Map<string, GraphNode>();
  readonly #edges = new Map<string, GraphEdge>();

  addNode(input: GraphNode): void {
    const node = GraphNodeSchema.parse(input);
    if (node.data === undefined) delete node.data;
    if (this.#nodes.has(node.id))
      throw new Error(`Duplicate node ID: ${node.id}`);
    this.#nodes.set(node.id, node);
  }

  addEdge(input: GraphEdge): void {
    const edge = GraphEdgeSchema.parse(input);
    if (edge.data === undefined) delete edge.data;
    if (this.#edges.has(edge.id))
      throw new Error(`Duplicate edge ID: ${edge.id}`);
    for (const id of [edge.source, edge.target]) {
      if (!this.#nodes.has(id))
        throw new Error(`Edge ${edge.id} references missing node: ${id}`);
    }
    this.#edges.set(edge.id, edge);
  }

  getNode(id: string): GraphNode | undefined {
    const node = this.#nodes.get(id);
    return node === undefined ? undefined : structuredClone(node);
  }

  nodesByType(type: NodeType): GraphNode[] {
    return structuredClone(
      sorted([...this.#nodes.values()].filter((node) => node.type === type)),
    );
  }

  neighbors(id: string, direction: "in" | "out" | "both" = "out"): GraphNode[] {
    if (!this.#nodes.has(id)) throw new Error(`Unknown node: ${id}`);
    const ids = new Set<string>();
    // ponytail: linear edge scan; add adjacency indexes when real scans warrant them.
    for (const edge of this.#edges.values()) {
      if (direction !== "in" && edge.source === id) ids.add(edge.target);
      if (direction !== "out" && edge.target === id) ids.add(edge.source);
    }
    return [...ids].sort(compare).map((neighbor) => {
      const node = this.getNode(neighbor);
      if (!node) throw new Error(`Missing neighbor: ${neighbor}`);
      return node;
    });
  }

  /** Breadth-first, excludes the starting node, visits each node once even in cycles. */
  traverse(
    id: string,
    maxDepth: number,
    direction: "in" | "out" | "both" = "out",
  ): GraphNode[] {
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0)
      throw new Error("maxDepth must be a nonnegative safe integer");
    if (!this.#nodes.has(id)) throw new Error(`Unknown node: ${id}`);
    const seen = new Set([id]);
    const result: GraphNode[] = [];
    let frontier = [id];
    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const neighbor of this.neighbors(current, direction)) {
          if (seen.has(neighbor.id)) continue;
          seen.add(neighbor.id);
          result.push(neighbor);
          next.push(neighbor.id);
        }
      }
      frontier = next;
    }
    return result;
  }

  toJSON(): GraphSnapshot {
    return structuredClone({
      schemaVersion: 1,
      nodes: sorted(this.#nodes.values()),
      edges: sorted(this.#edges.values()),
    });
  }

  serialize(): string {
    return stableJson(this.toJSON());
  }

  static fromJSON(input: unknown): ProductGraph {
    const snapshot = GraphSnapshotSchema.parse(input);
    const graph = new ProductGraph();
    for (const node of snapshot.nodes) graph.addNode(node);
    for (const edge of snapshot.edges) graph.addEdge(edge);
    return graph;
  }

  static deserialize(json: string): ProductGraph {
    return ProductGraph.fromJSON(JSON.parse(json));
  }
}

export type EntityDiff<T> = {
  added: T[];
  removed: T[];
  changed: { before: T; after: T }[];
};
export type GraphDiff = {
  nodes: EntityDiff<GraphNode>;
  edges: EntityDiff<GraphEdge>;
};

function diffEntities<T extends { id: string }>(
  before: T[],
  after: T[],
): EntityDiff<T> {
  const previous = new Map(before.map((entity) => [entity.id, entity]));
  const current = new Map(after.map((entity) => [entity.id, entity]));
  const changed: { before: T; after: T }[] = [];
  for (const entity of after) {
    const old = previous.get(entity.id);
    if (old && stableJson(old) !== stableJson(entity))
      changed.push({ before: old, after: entity });
  }
  return {
    added: after.filter((entity) => !previous.has(entity.id)),
    removed: before.filter((entity) => !current.has(entity.id)),
    changed,
  };
}

export function diffGraphs(
  before: ProductGraph,
  after: ProductGraph,
): GraphDiff {
  const a = before.toJSON();
  const b = after.toJSON();
  return {
    nodes: diffEntities(a.nodes, b.nodes),
    edges: diffEntities(a.edges, b.edges),
  };
}
