import { collectGraphEvidence, sourceProvenance } from "@pathcompiler/evidence";
import {
  createEdgeId,
  createNodeId,
  type GraphNode,
  type ProductGraph,
} from "@pathcompiler/graph-core";
import { compareText } from "@pathcompiler/source-model";
import { z } from "zod";
import {
  type Capability,
  type CapabilityDiscoveryReport,
  CapabilityDiscoveryReportSchema,
  CapabilityIdSchema,
  CapabilityVerbSchema,
  evaluateCapabilities,
} from "./capability-schema.js";
import type { ProductSurface } from "./schema.js";
import { discoverProductSurfaces } from "./surfaces.js";

type Meaning = Pick<
  Capability,
  "id" | "domain" | "verb" | "entity" | "qualifier" | "title"
>;
type Seed = Meaning & {
  surface: ProductSurface;
  inference: Capability["inferences"][number];
};
const aliases: Record<string, string> = {
  add: "create",
  new: "create",
  update: "edit",
  modify: "edit",
};
const unique = (values: Iterable<string>) =>
  [...new Set(values)].sort(compareText);
function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
// ponytail: conservative regular English inflection; irregular vocabulary needs explicit semantic IDs.
function singular(value: string): string {
  return value.endsWith("ies")
    ? `${value.slice(0, -3)}y`
    : /[^s]s$/.test(value) && !value.endsWith("us")
      ? value.slice(0, -1)
      : value;
}
function plural(value: string): string {
  return /[^aeiou]y$/.test(value)
    ? `${value.slice(0, -1)}ies`
    : value.endsWith("s")
      ? value
      : `${value}s`;
}
function meaning(
  domain: string,
  action: string,
  entity: string,
  qualifier: string | null,
): Meaning | undefined {
  const verb = CapabilityVerbSchema.safeParse(aliases[action] ?? action);
  const valid = (value: string) =>
    /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value);
  if (
    !verb.success ||
    !valid(domain) ||
    !valid(entity) ||
    (qualifier !== null && !valid(qualifier))
  )
    return;
  const id = `${domain}.${verb.data}${qualifier ? `_${qualifier}` : ""}`;
  return {
    id,
    domain,
    verb: verb.data,
    entity,
    qualifier,
    title: [verb.data, entity, qualifier ?? ""]
      .flatMap(words)
      .map((word) => word[0]?.toUpperCase() + word.slice(1))
      .join(" "),
  };
}
function semantic(value: string): Meaning | undefined {
  const match = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/.exec(value);
  if (!match?.[1] || !match[2]) return;
  const [verb, ...qualifier] = match[2].split("_");
  return verb
    ? meaning(match[1], verb, singular(match[1]), qualifier.join("_") || null)
    : undefined;
}
function named(
  value: string,
  surface: ProductSurface,
  nodes: Map<string, GraphNode>,
): Meaning | undefined {
  const [verb, ...rest] = words(
    value.replace(/(?:Button|Action|Modal|Dialog|Form|Panel)$/, ""),
  );
  if (
    !verb ||
    !CapabilityVerbSchema.safeParse(aliases[verb] ?? verb).success ||
    !rest.length
  )
    return;
  const domains = unique(
    surface.routeIds.flatMap((id) => {
      const route = nodes.get(id)?.data?.path;
      const segment =
        typeof route === "string"
          ? route.split("/").filter(Boolean).at(-1)
          : undefined;
      return segment && /^[a-z][a-z0-9_-]*$/.test(segment)
        ? [words(segment).join("_")]
        : [];
    }),
  );
  const routeDomain = domains.find(
    (domain) =>
      rest.join("_") === singular(domain) ||
      rest.join("_").startsWith(`${singular(domain)}_`),
  );
  const entity = routeDomain ? singular(routeDomain) : singular(rest.join("_"));
  const qualifier = routeDomain
    ? rest.slice(entity.split("_").length).join("_") || null
    : null;
  return meaning(routeDomain ?? plural(entity), verb, entity, qualifier);
}

/** Infer reviewable capabilities from technical evidence; expected IDs affect evaluation only. */
export function discoverCapabilities(
  source: ProductGraph,
  options: { expectedCapabilityIds?: string[] } = {},
): { graph: ProductGraph; report: CapabilityDiscoveryReport } {
  const parsed = z
    .strictObject({
      expectedCapabilityIds: z.array(CapabilityIdSchema).optional(),
    })
    .parse(options);
  if (source.nodesByType("Capability").length)
    throw new Error(
      "Expected a technical graph without Capability nodes. Rescan before discovering capabilities.",
    );
  const { graph, report: surfaceReport } = discoverProductSurfaces(source);
  const snapshot = source.toJSON();
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const diagnostics = [...surfaceReport.diagnostics];
  const groups = new Map<string, Seed[]>();
  for (const surface of surfaceReport.surfaces) {
    if (surface.kind === "page") continue;
    const anchor = nodes.get(surface.anchorNodeId);
    if (!anchor)
      throw new Error(`Missing surface anchor: ${surface.anchorNodeId}`);
    const target = z
      .object({ semanticId: z.string().optional() })
      .parse(anchor.data?.target ?? {});
    if (surface.kind === "action" && anchor.data?.kind === "input") continue;
    let value = target.semanticId ? semantic(target.semanticId) : undefined;
    let rule: Capability["inferences"][number]["rule"] = "semantic-target";
    let nodeId = anchor.id;
    if (!value && surface.titleSource === "accessible-name") {
      value = named(surface.title, surface, nodes);
      rule = "accessible-name";
    }
    if (!value) {
      const owners =
        anchor.type === "Component"
          ? [anchor]
          : snapshot.edges
              .filter(
                (edge) =>
                  edge.type === "EXPOSES_ACTION" && edge.target === anchor.id,
              )
              .flatMap((edge) => nodes.get(edge.source) ?? []);
      for (const owner of owners) {
        const name = owner.data?.name;
        if (
          owner.type !== "Component" ||
          typeof name !== "string" ||
          !(
            surface.kind === "action"
              ? /(?:Button|Action)$/
              : /(?:Modal|Dialog|Form|Panel)$/
          ).test(name)
        )
          continue;
        value = named(name, surface, nodes);
        if (value) {
          rule = "component-name";
          nodeId = owner.id;
          break;
        }
      }
    }
    if (!value) continue;
    if (
      rule === "semantic-target" &&
      surface.titleSource === "accessible-name"
    ) {
      const label = named(surface.title, surface, nodes);
      if (label && label.id !== value.id)
        diagnostics.push({
          code: "capability-label-conflict",
          message: `${anchor.id}: semantic ID proposes ${value.id}, while its label suggests ${label.id}; review the annotation.`,
        });
    }
    const seeds = groups.get(value.id) ?? [];
    seeds.push({
      ...value,
      surface,
      inference: { surfaceId: surface.id, rule, nodeId },
    });
    groups.set(value.id, seeds);
  }
  const capabilities: Capability[] = [];
  for (const [id, seeds] of [...groups].sort(([a], [b]) => compareText(a, b))) {
    const primary = seeds[0];
    if (!primary) continue;
    const roots = new Set(
      seeds.flatMap((seed) => [
        ...seed.surface.sourceNodeIds,
        seed.inference.nodeId,
      ]),
    );
    const anchors = new Set(seeds.map((seed) => seed.surface.anchorNodeId));
    const components = [...roots].flatMap((root) => {
      const node = nodes.get(root);
      return node?.type === "Component" ? [node] : [];
    });
    const directHandlers = snapshot.edges
      .filter(
        (edge) =>
          edge.type === "HANDLES" &&
          anchors.has(edge.target) &&
          nodes.get(edge.source)?.type === "Symbol",
      )
      .map((edge) => edge.source);
    const contextHandlers = snapshot.nodes
      .filter(
        (node) =>
          node.type === "Symbol" &&
          components.some(
            (component) =>
              node.data?.file === component.data?.file &&
              typeof node.data?.name === "string" &&
              typeof component.data?.name === "string" &&
              (node.data.name === component.data.name ||
                node.data.name.startsWith(`${component.data.name}.`)),
          ),
      )
      .map((node) => node.id);
    const apiEvidence = new Map<string, "handler" | "component-context">();
    // Explicit handler calls are stronger evidence than other functions owned by the same component.
    for (const [association, starts] of [
      ["component-context", contextHandlers],
      ["handler", directHandlers],
    ] as const) {
      const visited = new Set<string>();
      const pending = starts.map((nodeId) => [nodeId]);
      while (pending.length) {
        const path = pending.pop();
        const current = path?.at(-1);
        if (!current || !path || visited.has(current)) continue;
        visited.add(current);
        for (const edge of snapshot.edges) {
          if (edge.source !== current) continue;
          if (
            edge.type === "CALLS" &&
            nodes.get(edge.target)?.type === "Symbol"
          )
            pending.push([...path, edge.target]);
          if (edge.type !== "CALLS_API") continue;
          const api = nodes.get(edge.target);
          if (api?.type !== "APIEndpoint") continue;
          const methods =
            primary.verb === "create"
              ? ["POST"]
              : primary.verb === "delete"
                ? ["DELETE"]
                : ["PATCH", "PUT"];
          if (
            association === "component-context" &&
            !(
              typeof api.data?.path === "string" &&
              api.data.path
                .split("/")
                .some(
                  (part) => part === primary.domain || part === primary.entity,
                ) &&
              methods.includes(String(api.data.method))
            )
          )
            continue;
          apiEvidence.set(api.id, association);
          roots.add(api.id);
          for (const nodeId of path) roots.add(nodeId);
        }
      }
    }
    for (const handler of directHandlers) roots.add(handler);
    const roleIds: string[] = [];
    for (const edge of snapshot.edges)
      if (edge.type === "REQUIRES_PERMISSION" && roots.has(edge.source)) {
        const role = nodes.get(edge.target);
        if (
          role?.type === "Permission" &&
          typeof role.data?.role === "string"
        ) {
          roots.add(role.id);
          roleIds.push(role.id);
        }
      }
    const sourceNodeIds = unique(roots);
    const packet = collectGraphEvidence(source, sourceNodeIds);
    const inferences = seeds
      .map((seed) => seed.inference)
      .sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
    const base = inferences.some((item) => item.rule === "semantic-target")
      ? 0.8
      : inferences.some((item) => item.rule === "accessible-name")
        ? 0.6
        : 0.5;
    const exercised = snapshot.edges.some(
      (edge) =>
        edge.type === "TESTED_BY" &&
        anchors.has(edge.source) &&
        ["normal", "only"].includes(
          String(nodes.get(edge.target)?.data?.mode),
        ) &&
        Array.isArray(edge.data?.evidence) &&
        edge.data.evidence.some((item) => {
          const event = z
            .object({ phase: z.string(), kind: z.string() })
            .safeParse(item);
          return (
            event.success &&
            event.data.phase === "test" &&
            event.data.kind === "ui"
          );
        }),
    );
    const directApi = [...apiEvidence.values()].includes("handler");
    const confidence = Math.min(
      0.95,
      Math.round(
        (base + (exercised ? 0.1 : 0) + (directApi ? 0.05 : 0)) * 100,
      ) / 100,
    );
    const reviewReasons = ["inferred-capability"];
    if (confidence < 0.7) reviewReasons.push("low-confidence");
    if (!exercised) reviewReasons.push("no-mapped-test-action");
    if ([...apiEvidence.values()].includes("component-context"))
      reviewReasons.push("api-context-not-action-proof");
    reviewReasons.push(
      roleIds.length
        ? "role-observations-not-authorization"
        : "roles-unresolved",
    );
    if (
      surfaceReport.repository.commit === null ||
      surfaceReport.repository.dirty !== false
    )
      reviewReasons.push("uncommitted-source-evidence");
    if (
      diagnostics.some(
        (item) =>
          item.code === "capability-label-conflict" &&
          [...anchors].some((anchor) => item.message.startsWith(`${anchor}:`)),
      )
    )
      reviewReasons.push("semantic-label-conflict");
    const locations = sourceNodeIds.flatMap((nodeId) => {
      const node = nodes.get(nodeId);
      if (!node) throw new Error(`Missing capability evidence: ${nodeId}`);
      return sourceProvenance(node, packet.repository.commit);
    });
    const provenance = new Map(
      locations.map((location) => [JSON.stringify(location), location]),
    );
    capabilities.push({
      id,
      domain: primary.domain,
      verb: primary.verb,
      entity: primary.entity,
      qualifier: primary.qualifier,
      title: primary.title,
      status: "candidate",
      heuristic: true,
      roles: unique(
        roleIds.map((nodeId) => String(nodes.get(nodeId)?.data?.role)),
      ),
      rolesAreAuthoritative: false,
      roleEvidenceNodeIds: unique(roleIds),
      surfaceIds: unique(seeds.map((seed) => seed.surface.id)),
      routeIds: unique(seeds.flatMap((seed) => seed.surface.routeIds)),
      sourceNodeIds,
      evidenceNodeIds: packet.graph.nodes.map((node) => node.id),
      evidence: [...provenance.entries()]
        .sort(([a], [b]) => compareText(a, b))
        .map(([, location]) => location),
      inferences,
      apiEvidence: [...apiEvidence]
        .sort(([a], [b]) => compareText(a, b))
        .map(([nodeId, association]) => ({ nodeId, association })),
      confidence,
      confidenceMeaning: "rule-strength-not-probability",
      confidenceBand:
        confidence < 0.7 ? "low" : confidence < 0.85 ? "medium" : "high",
      reviewRequired: true,
      reviewReasons: unique(reviewReasons),
    });
  }
  const evidence = collectGraphEvidence(
    source,
    unique([
      ...surfaceReport.evidence.rootNodeIds,
      ...capabilities.flatMap((capability) => capability.sourceNodeIds),
    ]),
  );
  const report = CapabilityDiscoveryReportSchema.parse({
    ...surfaceReport,
    capabilities,
    evidence,
    diagnostics: diagnostics.sort((a, b) =>
      compareText(JSON.stringify(a), JSON.stringify(b)),
    ),
    evaluation: evaluateCapabilities(
      capabilities.map((capability) => capability.id),
      parsed.expectedCapabilityIds,
    ),
  });
  for (const capability of capabilities) {
    const nodeId = createNodeId("Capability", capability.id);
    graph.addNode({
      id: nodeId,
      type: "Capability",
      data: z.record(z.string(), z.json()).parse(capability),
    });
    for (const surface of capability.surfaceIds)
      graph.addEdge({
        id: createEdgeId("IMPLEMENTS", surface, nodeId),
        type: "IMPLEMENTS",
        source: surface,
        target: nodeId,
        data: { heuristic: true },
      });
    for (const target of capability.evidenceNodeIds)
      graph.addEdge({
        id: createEdgeId("SUPPORTED_BY", nodeId, target),
        type: "SUPPORTED_BY",
        source: nodeId,
        target,
      });
  }
  return { graph, report };
}
