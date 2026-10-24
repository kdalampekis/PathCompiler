import {
  type Capability,
  CapabilityVerbSchema,
  capabilityMeaning,
} from "@pathcompiler/capability-engine";
import type { ProductGraph } from "@pathcompiler/graph-core";
import {
  type InterpretationCandidate,
  type InterpretationOutcome,
  interpretCandidates,
  type JointSelection,
  selectInterpretations,
} from "@pathcompiler/probabilistic-evidence";
import type { SolverProvider } from "@pathcompiler/solver-provider";

/**
 * P1 over capabilities (reasoning spec §48–§49): each capability's meaning is
 * a categorical naming claim. Candidates come from the deterministic rule and
 * from C9 model hypotheses. Hard constraints come from deterministic facts:
 * - the endpoints the action's handler calls (`PATCH /api/clients/:id`
 *   cannot create; `POST /api/plans/:id/archive` can only archive);
 * - the product's vocabulary (an entity no route, endpoint or capability
 *   mentions does not exist);
 * - one capability ID per handler action (two actions with different
 *   handlers cannot both be `clients.create`).
 */
export type InterpretationHypothesis = {
  id: string;
  capabilityIds: string[];
  title: string;
  confidence: number;
  status: "supported" | "rejected";
  rejections: string[];
};
export type CapabilityInterpretation = InterpretationOutcome & {
  /** The best value differs from the deterministic capability ID. */
  changed: boolean;
};
export type CapabilityInterpretationReport = {
  schemaVersion: 1;
  meaning: "hypothesis";
  items: CapabilityInterpretation[];
  summary: {
    subjects: number;
    changed: number;
    /** Subjects whose deterministic meaning violates a hard constraint. */
    ruleImpossible: number;
    /** Subjects with no consistent candidate left. */
    unresolved: number;
  };
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const words = (text: string) =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const singular = (word: string) =>
  word.endsWith("ies")
    ? `${word.slice(0, -3)}y`
    : /[^s]s$/.test(word) && !word.endsWith("us")
      ? word.slice(0, -1)
      : word;
/**
 * Verbs an endpoint method clearly cannot perform. Deliberately narrower than
 * discovery's association heuristic: hard constraints must be facts, and APIs
 * use POST for almost anything, so POST rules nothing out.
 */
const IMPOSSIBLE: Record<string, readonly string[]> = {
  PATCH: ["create", "delete"],
  PUT: ["delete"],
  DELETE: [
    "create",
    "edit",
    "change",
    "activate",
    "restore",
    "invite",
    "duplicate",
    "import",
    "export",
    "assign",
  ],
  GET: CapabilityVerbSchema.options.filter((verb) => verb !== "export"),
};
const VERBS = new Set<string>(CapabilityVerbSchema.options);
/** Endpoints the capability's own handler calls (not component context). */
function handlerEndpoints(graph: ProductGraph, capability: Capability) {
  return capability.apiEvidence
    .filter((item) => item.association === "handler")
    .flatMap((item) => {
      const { method, path } = graph.getNode(item.nodeId)?.data ?? {};
      return typeof method === "string" && typeof path === "string"
        ? [{ id: item.nodeId, method, path }]
        : [];
    })
    .sort((a, b) => compare(a.id, b.id));
}

export function interpretCapabilities(input: {
  graph: ProductGraph;
  /** Every discovered capability (vocabulary and uniqueness). */
  capabilities: readonly Capability[];
  /** The capabilities to interpret; default all. */
  subjects?: readonly string[];
  hypotheses?: readonly InterpretationHypothesis[];
}): CapabilityInterpretationReport {
  const { graph, capabilities } = input;
  const data = (id: string) => graph.getNode(id)?.data ?? {};
  const routePaths = (capability: Capability) =>
    capability.routeIds.flatMap((id) => {
      const value = data(id).path;
      return typeof value === "string" ? [value] : [];
    });
  const endpoints = (capability: Capability) =>
    handlerEndpoints(graph, capability);
  // Product vocabulary: route and endpoint path segments, and capability terms.
  const vocabulary = new Set<string>();
  for (const node of graph.toJSON().nodes)
    if (
      (node.type === "Route" || node.type === "APIEndpoint") &&
      typeof node.data?.path === "string"
    )
      for (const segment of node.data.path.split("/"))
        if (!segment.startsWith(":") && !segment.startsWith("["))
          for (const word of words(segment)) vocabulary.add(singular(word));
  for (const capability of capabilities)
    for (const term of [capability.entity, capability.domain])
      for (const word of term.split("_")) vocabulary.add(singular(word));
  const handlerOf = new Map(
    capabilities.map((capability) => [
      capability.id,
      endpoints(capability).map((endpoint) => endpoint.id),
    ]),
  );

  const violations = (
    capability: Capability,
    meaning: { id: string; verb: string; entity: string; domain: string },
  ) => {
    const found: string[] = [];
    const calls = endpoints(capability);
    if (
      calls.length > 0 &&
      !calls.some((endpoint) => {
        const suffix = endpoint.path.split("/").at(-1) ?? "";
        return VERBS.has(suffix)
          ? suffix === meaning.verb
          : !IMPOSSIBLE[endpoint.method.toUpperCase()]?.includes(meaning.verb);
      })
    )
      found.push(
        `api-verb-mismatch: ${calls.map((endpoint) => `${endpoint.method} ${endpoint.path}`).join(", ")} cannot ${meaning.verb}`,
      );
    const unknown = [meaning.entity, meaning.domain]
      .flatMap((term) => term.split("_"))
      .map(singular)
      .filter((word) => !vocabulary.has(word));
    if (unknown.length > 0)
      found.push(
        `unknown-entity: ${[...new Set(unknown)].join(", ")} appears in no route, endpoint or capability`,
      );
    const mine = calls.map((endpoint) => endpoint.id);
    const theirs = handlerOf.get(meaning.id);
    if (
      meaning.id !== capability.id &&
      theirs &&
      theirs.length > 0 &&
      mine.length > 0 &&
      !theirs.some((id) => mine.includes(id))
    )
      found.push(
        `duplicate-meaning: ${meaning.id} is another action with a different handler`,
      );
    return found;
  };

  const wanted = new Set(
    input.subjects ?? capabilities.map((capability) => capability.id),
  );
  const items = capabilities
    .filter((capability) => wanted.has(capability.id))
    .sort((a, b) => compare(a.id, b.id))
    .map((capability): CapabilityInterpretation => {
      const candidates: InterpretationCandidate[] = [
        {
          value: capability.id,
          prior: capability.confidence,
          // Naming evidence: the nodes the rule read the name from.
          items: [
            ...new Set(capability.inferences.map((item) => item.nodeId)),
          ].map((nodeId) => ({
            id: nodeId,
            class: "static" as const,
            current: true,
            summary: `Rule-derived name from ${nodeId}`,
          })),
          violations: violations(capability, capability),
        },
      ];
      for (const hypothesis of input.hypotheses ?? []) {
        if (!hypothesis.capabilityIds.includes(capability.id)) continue;
        const meaning = capabilityMeaning(
          hypothesis.title,
          routePaths(capability),
        );
        candidates.push({
          value: meaning?.id ?? `unparsed:${hypothesis.title}`,
          prior: hypothesis.confidence,
          items: [
            {
              id: hypothesis.id,
              class: "model",
              current: true,
              summary: `Model hypothesis "${hypothesis.title}"`,
            },
          ],
          violations: [
            ...hypothesis.rejections.map(
              (reason) => `hypothesis-rejected: ${reason}`,
            ),
            ...(meaning
              ? violations(capability, meaning)
              : [
                  `not-a-capability: "${hypothesis.title}" does not start with a capability verb`,
                ]),
          ],
        });
      }
      const outcome = interpretCandidates(
        {
          id: `naming:${capability.id}`,
          type: "naming",
          subject: capability.id,
          statement: `What capability ${capability.surfaceIds.join(", ")} implements`,
          categorical: true,
        },
        candidates,
      );
      return {
        ...outcome,
        changed: outcome.best !== null && outcome.best !== capability.id,
      };
    });
  return {
    schemaVersion: 1,
    meaning: "hypothesis",
    items,
    summary: {
      subjects: items.length,
      changed: items.filter((item) => item.changed).length,
      ruleImpossible: items.filter((item) =>
        item.candidates.some(
          (candidate) =>
            candidate.value === item.subject &&
            candidate.status === "impossible",
        ),
      ).length,
      unresolved: items.filter((item) =>
        item.candidates.every((candidate) => candidate.status === "impossible"),
      ).length,
    },
  };
}

/**
 * P2 over capabilities: one joint choice of meanings. Two capabilities whose
 * handlers call different endpoints are different actions, so they never
 * end up with the same meaning; capabilities without handler evidence may
 * merge.
 */
export async function selectCapabilityInterpretations(input: {
  report: CapabilityInterpretationReport;
  graph: ProductGraph;
  capabilities: readonly Capability[];
  solver: SolverProvider;
  timeoutMs?: number;
}): Promise<JointSelection> {
  const byId = new Map(
    input.capabilities.map((capability) => [capability.id, capability]),
  );
  const handlers = input.report.items.map((item) => {
    const capability = byId.get(item.subject);
    return {
      subject: item.subject,
      ids: capability
        ? handlerEndpoints(input.graph, capability).map(
            (endpoint) => endpoint.id,
          )
        : [],
    };
  });
  const exclusive: [string, string][] = [];
  handlers.forEach((a, index) => {
    for (const b of handlers.slice(index + 1))
      if (
        a.ids.length > 0 &&
        b.ids.length > 0 &&
        !a.ids.some((id) => b.ids.includes(id))
      )
        exclusive.push([a.subject, b.subject]);
  });
  return selectInterpretations({
    outcomes: input.report.items,
    exclusive,
    solver: input.solver,
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
  });
}
