import { createHash } from "node:crypto";
import {
  type Capability,
  CapabilityVerbSchema,
  type ProductSurface,
} from "@pathcompiler/capability-engine";
import { collectGraphEvidence } from "@pathcompiler/evidence";
import type { ProductGraph } from "@pathcompiler/graph-core";
import {
  guardModelProvider,
  type ModelContextEntry,
  ModelProviderError,
  type PathCompilerModelProvider,
} from "./index.js";

/**
 * Evidence-first semantic interpretation (C9, spec §45). Deterministic rules
 * pick the ambiguous capabilities; only their surfaces and evidence are sent;
 * the model's answers become hypotheses that deterministic evidence checks
 * accept or reject. Nothing here changes a capability: hypotheses are for
 * review, and a rejected one is never used.
 */
export type AmbiguityReason =
  | "low-confidence"
  | "weak-naming"
  | "label-conflict"
  | "possible-duplicate";
export type AmbiguousCluster = {
  /** The capability domain the cluster covers. */
  id: string;
  capabilities: { id: string; reasons: AmbiguityReason[] }[];
  surfaceIds: string[];
};
export type SemanticHypothesis = {
  id: string;
  meaning: "hypothesis";
  kind: "confirm" | "rename" | "merge" | "interpretation";
  clusterId: string;
  /** Existing capabilities whose surfaces the hypothesis covers. */
  capabilityIds: string[];
  title: string;
  /** Current titles that differ from the proposed one (alias candidates). */
  aliases: string[];
  surfaceIds: string[];
  evidenceIds: string[];
  confidence: number;
  confidenceMeaning: "model-stated-not-probability";
  rationale: string;
  provider: string;
  status: "supported" | "rejected";
  /** Why a hypothesis was rejected; empty when supported. */
  rejections: (
    | "evidence-not-of-cited-surfaces"
    | "unsupported-verb"
    | "unsupported-entity"
    | "merge-across-entities"
  )[];
};
export type ModelContextReport = {
  schemaVersion: 1;
  kind: "model-context";
  provider: string;
  sent: boolean;
  requests: ModelContextEntry[];
  neverSent: string[];
};
export type SemanticInterpretationReport = {
  schemaVersion: 1;
  meaning: "hypothesis";
  provider: string;
  clusters: AmbiguousCluster[];
  hypotheses: SemanticHypothesis[];
  /** Clusters whose answer was refused or invalid; their capabilities stay as they are. */
  failures: {
    clusterId: string;
    code: "refused" | "invalid-response";
    message: string;
  }[];
  summary: {
    hypotheses: number;
    supported: number;
    rejected: number;
    /** Rejected share of what the model proposed (unsupported inventions). */
    proposedInventionRate: number;
    /** Always 0: rejected hypotheses are never applied. */
    appliedInventionRate: 0;
  };
  context: ModelContextReport;
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const unique = (values: Iterable<string>) => [...new Set(values)].sort(compare);
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const singular = (word: string) =>
  word.endsWith("ies")
    ? `${word.slice(0, -3)}y`
    : word.endsWith("s") && !word.endsWith("ss")
      ? word.slice(0, -1)
      : word;
export const NEVER_SENT = [
  "file contents (privacy.source_upload is always false)",
  "hidden files and directories, including .env",
  "binary files",
  "paths excluded with --exclude or Git ignore rules",
  "capabilities and surfaces outside the ambiguous clusters",
];

/** Deterministic: which capabilities the rules could not name with confidence. */
export function findAmbiguousClusters(
  capabilities: readonly Capability[],
): AmbiguousCluster[] {
  const reasons = new Map<string, Set<AmbiguityReason>>();
  const flag = (id: string, reason: AmbiguityReason) =>
    reasons.set(id, (reasons.get(id) ?? new Set()).add(reason));
  for (const capability of capabilities) {
    if (capability.confidenceBand === "low")
      flag(capability.id, "low-confidence");
    if (
      !capability.inferences.some(
        (inference) => inference.rule === "semantic-target",
      )
    )
      flag(capability.id, "weak-naming");
    if (capability.reviewReasons.includes("semantic-label-conflict"))
      flag(capability.id, "label-conflict");
    // Same domain and verb under different qualifiers may be one capability.
    if (
      capabilities.some(
        (other) =>
          other.id !== capability.id &&
          other.domain === capability.domain &&
          other.verb === capability.verb,
      )
    )
      flag(capability.id, "possible-duplicate");
  }
  // Ambiguous capabilities sharing a domain or a route are interpreted
  // together, so the model can tell them apart or merge them.
  const ambiguous = capabilities.filter((capability) =>
    reasons.has(capability.id),
  );
  const parent = ambiguous.map((_, index) => index);
  const root = (index: number): number =>
    parent[index] === index ? index : root(parent[index] as number);
  ambiguous.forEach((capability, index) => {
    ambiguous.forEach((other, before) => {
      if (
        before < index &&
        (other.domain === capability.domain ||
          other.routeIds.some((id) => capability.routeIds.includes(id)))
      )
        parent[root(index)] = root(before);
    });
  });
  const groups = new Map<number, Capability[]>();
  ambiguous.forEach((capability, index) => {
    groups.set(root(index), [...(groups.get(root(index)) ?? []), capability]);
  });
  return [...groups.values()]
    .map((members) => ({
      // Components never share a domain, so the domain set is a unique ID.
      id: unique(members.map((capability) => capability.domain)).join("+"),
      capabilities: members
        .map((capability) => ({
          id: capability.id,
          reasons: [...(reasons.get(capability.id) ?? [])].sort(compare),
        }))
        .sort((a, b) => compare(a.id, b.id)),
      surfaceIds: unique(
        members.flatMap((capability) => capability.surfaceIds),
      ),
    }))
    .sort((a, b) => compare(a.id, b.id));
}

/**
 * Sends each ambiguous cluster's surfaces and evidence (and nothing else) to
 * the provider, and validates every answer against that evidence.
 */
export async function interpretAmbiguities(input: {
  provider: PathCompilerModelProvider;
  /** The technical graph the surfaces were discovered from. */
  graph: ProductGraph;
  surfaces: readonly ProductSurface[];
  capabilities: readonly Capability[];
}): Promise<SemanticInterpretationReport> {
  const { provider, graph, surfaces, capabilities } = input;
  const clusters = findAmbiguousClusters(capabilities);
  const requests: ModelContextEntry[] = [];
  const guarded = guardModelProvider(provider, {
    onContext: (entry) => requests.push(entry),
  });
  const surfaceById = new Map(surfaces.map((surface) => [surface.id, surface]));
  const roots = (ids: readonly string[]) =>
    unique(
      ids.flatMap((id) => {
        const surface = surfaceById.get(id);
        if (!surface) throw new Error(`Unknown product surface: ${id}`);
        return [...surface.sourceNodeIds, ...surface.evidenceNodeIds];
      }),
    );
  const hypotheses: SemanticHypothesis[] = [];
  const failures: SemanticInterpretationReport["failures"] = [];
  // No provider: nothing is sent and nothing is hypothesized.
  if (provider.id !== "none")
    for (const cluster of clusters) {
      const sent = cluster.surfaceIds.map(
        (id) => surfaceById.get(id) as ProductSurface,
      );
      let result: Awaited<ReturnType<typeof guarded.inferCapabilities>>;
      try {
        result = await guarded.inferCapabilities({
          surfaces: sent,
          evidence: collectGraphEvidence(graph, roots(cluster.surfaceIds)),
        });
      } catch (error) {
        // One bad answer is recorded, not fatal; transport and key errors are.
        if (
          error instanceof ModelProviderError &&
          (error.code === "refused" || error.code === "invalid-response")
        ) {
          failures.push({
            clusterId: cluster.id,
            code: error.code,
            message: error.message,
          });
          continue;
        }
        throw error;
      }
      for (const proposal of result.capabilities)
        hypotheses.push(
          validate(cluster.id, proposal, provider.id, capabilities, (ids) =>
            collectGraphEvidence(graph, roots(ids)).graph.nodes.map(
              (node) => node.id,
            ),
          ),
        );
    }
  hypotheses.sort((a, b) => compare(a.id, b.id));
  const rejected = hypotheses.filter((item) => item.status === "rejected");
  return {
    schemaVersion: 1,
    meaning: "hypothesis",
    provider: provider.id,
    clusters,
    hypotheses,
    failures,
    summary: {
      hypotheses: hypotheses.length,
      supported: hypotheses.length - rejected.length,
      rejected: rejected.length,
      proposedInventionRate:
        hypotheses.length === 0
          ? 0
          : Math.round((rejected.length / hypotheses.length) * 1000) / 1000,
      appliedInventionRate: 0,
    },
    context: {
      schemaVersion: 1,
      kind: "model-context",
      provider: provider.id,
      sent: requests.length > 0,
      requests,
      neverSent: NEVER_SENT,
    },
  };
}

function validate(
  clusterId: string,
  proposal: {
    title: string;
    surfaceIds: string[];
    evidenceIds: string[];
    confidence: number;
    rationale: string;
  },
  provider: string,
  capabilities: readonly Capability[],
  evidenceOf: (surfaceIds: string[]) => string[],
): SemanticHypothesis {
  const surfaceIds = unique(proposal.surfaceIds);
  const covered = capabilities
    .filter((capability) =>
      capability.surfaceIds.some((id) => surfaceIds.includes(id)),
    )
    .sort((a, b) => compare(a.id, b.id));
  const rejections: SemanticHypothesis["rejections"] = [];
  const allowed = new Set(evidenceOf(surfaceIds));
  if (proposal.evidenceIds.some((id) => !allowed.has(id)))
    rejections.push("evidence-not-of-cited-surfaces");
  const titleWords = words(proposal.title).map(singular);
  const verbs = new Set(covered.map((capability) => capability.verb));
  if (
    titleWords.some(
      (word) =>
        (CapabilityVerbSchema.options as string[]).includes(word) &&
        !verbs.has(word as Capability["verb"]),
    )
  )
    rejections.push("unsupported-verb");
  const nouns = new Set(
    covered.flatMap((capability) =>
      [capability.entity, capability.domain].flatMap((token) =>
        token.split("_").map(singular),
      ),
    ),
  );
  if (!titleWords.some((word) => nouns.has(word)))
    rejections.push("unsupported-entity");
  if (new Set(covered.map((capability) => capability.entity)).size > 1)
    rejections.push("merge-across-entities");
  const same = (title: string) =>
    words(title).join(" ") === words(proposal.title).join(" ");
  const kind: SemanticHypothesis["kind"] =
    covered.length === 0
      ? "interpretation"
      : covered.length > 1
        ? "merge"
        : same(covered[0]?.title ?? "")
          ? "confirm"
          : "rename";
  const capabilityIds = covered.map((capability) => capability.id);
  return {
    id: `${clusterId}:${createHash("sha256")
      .update(JSON.stringify([kind, capabilityIds, proposal.title, surfaceIds]))
      .digest("hex")
      .slice(0, 12)}`,
    meaning: "hypothesis",
    kind,
    clusterId,
    capabilityIds,
    title: proposal.title,
    aliases: unique(
      covered
        .map((capability) => capability.title)
        .filter((title) => !same(title)),
    ),
    surfaceIds,
    evidenceIds: unique(proposal.evidenceIds),
    confidence: proposal.confidence,
    confidenceMeaning: "model-stated-not-probability",
    rationale: proposal.rationale,
    provider,
    status: rejections.length ? "rejected" : "supported",
    rejections,
  };
}
