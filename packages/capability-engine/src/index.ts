import { collectGraphEvidence, sourceProvenance } from "@pathcompiler/evidence";
import {
  createEdgeId,
  createNodeId,
  type GraphNode,
  ProductGraph,
} from "@pathcompiler/graph-core";
import {
  type AnalysisDiagnostic,
  compareText,
} from "@pathcompiler/source-model";
import { z } from "zod";
import {
  type ProductSurface,
  type ProductSurfaceReport,
  ProductSurfaceReportSchema,
} from "./schema.js";

export * from "./model.js";
export * from "./schema.js";

type Candidate = Pick<
  ProductSurface,
  "kind" | "title" | "titleSource" | "rule" | "confidence"
>;
const interaction = z.object({
  tag: z.string().min(1),
  kind: z.enum(["navigate", "submit", "input", "click", "observe"]),
  target: z.object({
    name: z.string().optional(),
    semanticId: z.string().optional(),
    role: z.string().optional(),
  }),
});
function humanize(value: string): string {
  const text = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim();
  return text ? text[0]?.toUpperCase() + text.slice(1) : "";
}
function candidate(node: GraphNode): Candidate | undefined {
  if (node.type === "Route") {
    const route = z.string().min(1).parse(node.data?.path);
    return {
      kind: "page",
      title: humanize(route.split("/").filter(Boolean).at(-1) ?? "Home"),
      titleSource: "route",
      rule: "route",
      confidence: 0.9,
    };
  }
  if (node.type === "Component") {
    const name = z.string().min(1).parse(node.data?.name);
    const suffix = /(Panel|Modal|Dialog|Form)$/.exec(name)?.[1];
    if (!suffix) return;
    const kind =
      suffix === "Panel" ? "panel" : suffix === "Form" ? "form" : "modal";
    return {
      kind,
      title: humanize(name),
      titleSource: "component-name",
      rule: "component-name",
      confidence: 0.6,
    };
  }
  if (node.type !== "UIAction") return;
  const data = interaction.parse(node.data);
  // Custom JSX props do not establish DOM semantics, except analyzer-resolved navigation.
  if (!/^[a-z]/.test(data.tag) && data.kind !== "navigate") return;
  const role = data.target.role;
  const kind =
    data.tag === "form" || role === "form"
      ? "form"
      : data.tag === "dialog" || role === "dialog" || role === "alertdialog"
        ? "modal"
        : ["region", "tabpanel", "complementary"].includes(role ?? "")
          ? "panel"
          : data.kind !== "observe" ||
              [
                "button",
                "link",
                "checkbox",
                "radio",
                "switch",
                "textbox",
                "combobox",
                "menuitem",
                "tab",
              ].includes(role ?? "")
            ? "action"
            : undefined;
  if (!kind) return;
  const title = data.target.name?.trim();
  const semanticTitle = data.target.semanticId
    ? humanize(data.target.semanticId)
    : undefined;
  return {
    kind,
    title:
      title || semanticTitle || humanize(kind === "action" ? data.tag : kind),
    titleSource: title
      ? "accessible-name"
      : semanticTitle
        ? "semantic-id"
        : "fallback",
    rule: kind === "action" ? "interaction" : "element",
    confidence: title ? 0.9 : semanticTitle ? 0.8 : 0.6,
  };
}

/** Compile static, reviewable surface candidates. Does not execute code or call a model. */
export function discoverProductSurfaces(source: ProductGraph): {
  graph: ProductGraph;
  report: ProductSurfaceReport;
} {
  if (source.nodesByType("ProductSurface").length)
    throw new Error(
      "Expected a technical evidence graph without ProductSurface nodes. Rescan before discovering surfaces.",
    );
  const snapshot = source.toJSON();
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const parents = new Map<string, Set<string>>();
  const diagnostics: AnalysisDiagnostic[] = [];
  const warn = (code: string, message: string) =>
    diagnostics.push({ code, message });
  const addParent = (child: string, parent: string) => {
    const set = parents.get(child) ?? new Set<string>();
    set.add(parent);
    parents.set(child, set);
  };
  const nested = new Set(
    snapshot.edges
      .filter(
        (edge) =>
          edge.type === "CONTAINS" &&
          nodes.get(edge.source)?.type === "UIAction" &&
          nodes.get(edge.target)?.type === "UIAction",
      )
      .map((edge) => edge.target),
  );
  for (const edge of snapshot.edges) {
    const from = nodes.get(edge.source)?.type;
    const to = nodes.get(edge.target)?.type;
    if (
      (edge.type === "RENDERS" &&
        to === "Component" &&
        (from === "Route" || from === "Component")) ||
      (edge.type === "CONTAINS" && from === "UIAction" && to === "UIAction") ||
      (edge.type === "EXPOSES_ACTION" &&
        to === "UIAction" &&
        !nested.has(edge.target))
    )
      addParent(edge.target, edge.source);
  }
  // ponytail: per-anchor graph walks are sufficient for local repositories; index closures if scans warrant it.
  function ancestors(
    start: string,
    stop?: (id: string) => boolean,
  ): Set<string> {
    const seen = new Set<string>();
    const pending = [...(parents.get(start) ?? [])];
    while (pending.length) {
      const id = pending.pop();
      if (!id || id === start || seen.has(id)) continue;
      seen.add(id);
      if (!stop?.(id)) pending.push(...(parents.get(id) ?? []));
    }
    return seen;
  }
  const candidates = new Map<string, Candidate>();
  for (const node of snapshot.nodes) {
    const value = candidate(node);
    if (value) candidates.set(node.id, value);
  }
  for (const [id, value] of candidates) {
    // Prefer actual native/ARIA containers over a duplicate suffix-based component guess.
    if (
      value.rule === "component-name" &&
      snapshot.edges.some(
        (edge) =>
          edge.type === "EXPOSES_ACTION" &&
          edge.source === id &&
          candidates.get(edge.target)?.kind === value.kind,
      )
    )
      candidates.delete(id);
  }
  const paths = new Map<string, string[]>();
  for (const [id, value] of candidates) {
    const path = [id, ...ancestors(id)].sort(compareText);
    if (
      value.kind !== "page" &&
      !path.some((item) => nodes.get(item)?.type === "Route")
    ) {
      candidates.delete(id);
      warn(
        "unreachable-surface",
        `${id}: no static render path from a page; candidate omitted.`,
      );
    } else {
      if (value.kind === "page") {
        for (const edge of snapshot.edges)
          if (
            edge.type === "RENDERS" &&
            edge.source === id &&
            nodes.get(edge.target)?.type === "Component"
          )
            path.push(edge.target);
      }
      paths.set(id, [...new Set(path)].sort(compareText));
    }
  }
  const roots = [...new Set([...paths.values()].flat())].sort(compareText);
  const evidence = collectGraphEvidence(source, roots);
  if (
    evidence.repository.commit === null ||
    evidence.repository.dirty !== false
  )
    warn(
      "uncommitted-surface-evidence",
      "Evidence includes uncommitted or unknown source state; candidates are not release-bound approvals.",
    );
  const surfaces: ProductSurface[] = [];
  for (const [anchorNodeId, value] of candidates) {
    const sourceNodeIds = paths.get(anchorNodeId) ?? [];
    const container = (id: string) =>
      candidates.has(id) && candidates.get(id)?.kind !== "action";
    const parentIds = [...ancestors(anchorNodeId, container)]
      .filter(container)
      .map((id) =>
        createNodeId("ProductSurface", `${candidates.get(id)?.kind}:${id}`),
      )
      .sort(compareText);
    const packet = collectGraphEvidence(source, sourceNodeIds);
    const locations = sourceNodeIds.flatMap((id) => {
      const node = nodes.get(id);
      if (!node) throw new Error(`Missing source node: ${id}`);
      return sourceProvenance(node, evidence.repository.commit);
    });
    const unique = new Map(
      locations.map((location) => [JSON.stringify(location), location]),
    );
    const id = createNodeId("ProductSurface", `${value.kind}:${anchorNodeId}`);
    surfaces.push({
      ...value,
      id,
      anchorNodeId,
      sourceNodeIds,
      parentIds,
      evidenceNodeIds: packet.graph.nodes.map((node) => node.id),
      routeIds: sourceNodeIds.filter(
        (nodeId) => nodes.get(nodeId)?.type === "Route",
      ),
      evidence: [...unique.entries()]
        .sort(([a], [b]) => compareText(a, b))
        .map(([, location]) => location),
      heuristic: true,
      status: "candidate",
    });
    if (value.titleSource === "fallback")
      warn(
        "surface-label-unresolved",
        `${id}: no static accessible name or semantic ID; review the fallback title.`,
      );
    if (
      value.kind === "page" &&
      !snapshot.edges.some(
        (edge) => edge.source === anchorNodeId && edge.type === "RENDERS",
      )
    )
      warn(
        "page-render-unresolved",
        `${id}: page route has no resolved rendered component (it may redirect).`,
      );
  }
  surfaces.sort((a, b) => compareText(a.id, b.id));
  // Recursive components can make source render edges cyclic. Retain evidence but omit cyclic containment.
  const accepted = new Map<string, string[]>();
  for (const surface of surfaces) {
    const safe: string[] = [];
    for (const parent of surface.parentIds) {
      const pending = [parent];
      const seen = new Set<string>();
      while (pending.length) {
        const id = pending.pop();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        pending.push(...(accepted.get(id) ?? []));
      }
      if (seen.has(surface.id))
        warn(
          "cyclic-surface-containment",
          `${surface.id}: omitted cyclic parent ${parent}; review recursive rendering.`,
        );
      else safe.push(parent);
    }
    surface.parentIds = safe;
    accepted.set(surface.id, safe);
  }
  const report = ProductSurfaceReportSchema.parse({
    schemaVersion: 1,
    evidenceOnly: true,
    repository: evidence.repository,
    surfaces,
    evidence,
    diagnostics: diagnostics.sort((a, b) =>
      compareText(JSON.stringify(a), JSON.stringify(b)),
    ),
  });
  const graph = ProductGraph.fromJSON(snapshot);
  for (const surface of surfaces)
    graph.addNode({
      id: surface.id,
      type: "ProductSurface",
      data: z.record(z.string(), z.json()).parse(surface),
    });
  for (const surface of surfaces) {
    for (const parent of surface.parentIds)
      graph.addEdge({
        id: createEdgeId("CONTAINS", parent, surface.id),
        type: "CONTAINS",
        source: parent,
        target: surface.id,
        data: { heuristic: true },
      });
    for (const target of surface.evidenceNodeIds)
      graph.addEdge({
        id: createEdgeId("SUPPORTED_BY", surface.id, target),
        type: "SUPPORTED_BY",
        source: surface.id,
        target,
      });
  }
  return { graph, report };
}
