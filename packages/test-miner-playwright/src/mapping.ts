import {
  createEdgeId,
  type GraphEdge,
  type ProductGraph,
} from "@pathcompiler/graph-core";
import type { TargetHint, TestTarget, TestTrace, TestValue } from "./schema.js";

export function stringValue(value: TestValue): string | undefined {
  return value.kind === "literal" && typeof value.value === "string"
    ? value.value
    : undefined;
}
function option(value: TestValue, name: string): unknown {
  return value.kind === "literal" &&
    value.value !== null &&
    typeof value.value === "object" &&
    !Array.isArray(value.value)
    ? value.value[name]
    : undefined;
}

export function mapTarget(
  graph: ProductGraph,
  page: string,
  hints: TargetHint[],
): TestTarget {
  const hint = [...hints]
    .reverse()
    .find((item) => !["filter", "first", "last", "nth"].includes(item.method));
  const text = hint && stringValue(hint.argument);
  let confidence = 0;
  const graphNodeIds: string[] = [];
  if (hint && text !== undefined && hint.options.kind !== "dynamic") {
    if (
      hint.method === "goto" &&
      text.startsWith("/") &&
      !text.startsWith("//")
    ) {
      const route = text.split(/[?#]/)[0]?.replace(/\/$/, "") || "/";
      for (const node of graph.nodesByType("Route"))
        if (node.data?.path === route) graphNodeIds.push(node.id);
      confidence = 1;
    } else {
      const semantic =
        hint.method === "locator"
          ? /^\[data-pathcompiler=(["'])([A-Za-z][A-Za-z0-9_.:-]*)\1\]$/.exec(
              text,
            )?.[2]
          : undefined;
      const name =
        hint.method === "getByRole" ? option(hint.options, "name") : text;
      const exact = option(hint.options, "exact") === true;
      for (const node of graph.nodesByType("UIAction")) {
        const data = node.data?.target;
        if (!data || typeof data !== "object" || Array.isArray(data)) continue;
        const matchesName =
          typeof name === "string" &&
          typeof data.name === "string" &&
          (exact
            ? data.name === name
            : data.name.toLowerCase().includes(name.toLowerCase()));
        if (
          semantic &&
          data.semanticId === semantic &&
          data.source === "annotation"
        ) {
          graphNodeIds.push(node.id);
          confidence = 1;
        } else if (hint.method === "getByTestId" && data.testId === text) {
          graphNodeIds.push(node.id);
          confidence = 0.8;
        } else if (
          (hint.method === "getByRole" &&
            data.role === text &&
            (name === undefined || matchesName)) ||
          (hint.method === "getByLabel" &&
            ["input", "select", "textarea"].includes(String(node.data?.tag)) &&
            matchesName)
        ) {
          graphNodeIds.push(node.id);
          confidence = 0.6;
        }
      }
    }
  }
  return {
    page,
    hints,
    graphNodeIds,
    resolution:
      graphNodeIds.length === 1
        ? "matched"
        : graphNodeIds.length
          ? "ambiguous"
          : "unresolved",
    confidence: graphNodeIds.length ? confidence : 0,
  };
}

/** Only unambiguous source-declaration mappings create TESTED_BY edges. */
export function addTraceEvidence(
  graph: ProductGraph,
  trace: TestTrace,
  repositoryCommit: string | null,
): void {
  graph.addNode({
    id: trace.id,
    type: "Test",
    data: {
      testName: trace.testName,
      sourceFile: trace.sourceFile,
      mode: trace.mode,
      partial: trace.partial,
      evidenceOnly: true,
      execution: "not-run",
      evidence: [
        { file: trace.sourceFile, locator: trace.id, repositoryCommit },
      ],
    },
  });
  const edges = new Map<string, GraphEdge>();
  for (const event of [...trace.actions, ...trace.assertions].sort(
    (a, b) => a.order - b.order,
  )) {
    if (event.target?.resolution !== "matched") continue;
    const source = event.target.graphNodeIds[0];
    if (!source) continue;
    const id = createEdgeId("TESTED_BY", source, trace.id);
    const edge = edges.get(id) ?? {
      id,
      type: "TESTED_BY" as const,
      source,
      target: trace.id,
      data: { confidence: event.target.confidence, evidence: [] },
    };
    const evidence = edge.data?.evidence;
    if (Array.isArray(evidence))
      evidence.push({
        ...event.evidence,
        order: event.order,
        phase: event.phase,
        conditional: event.conditional,
        kind: "matcher" in event ? "assertion" : event.kind,
      });
    edges.set(id, edge);
  }
  for (const edge of edges.values()) graph.addEdge(edge);
}
