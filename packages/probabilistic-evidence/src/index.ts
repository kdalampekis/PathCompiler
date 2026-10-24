import type { GraphNode, ProductGraph } from "@pathcompiler/graph-core";
import { EvidenceRefSchema } from "@pathcompiler/workflow-ir";
import { z } from "zod";

/**
 * Probabilistic evidence model, P0 (reasoning spec §43–§47). Claims collect
 * supporting and contradicting evidence; fusion is rule-based and documented
 * (never an average); conflicts are first-class; a confidence score is never
 * called a probability unless a calibration backs it (§44).
 */
export const EVIDENCE_CLASSES = [
  /** Browser verification against a running build. */
  "browser",
  /** Production runtime events. */
  "observed",
  /** Current end-to-end tests that assert it (mined, not necessarily run). */
  "test",
  /** A formal-model result (derived from static facts and tests). */
  "formal",
  /** Current source code: UI, routes, handlers, guards. */
  "static",
  /** Recent pull-request intent. */
  "pr",
  /** Recent commit message. */
  "commit",
  /** Current documentation. */
  "docs",
  /** Old documentation or other historical prose. */
  "historical",
  /** A language-model hypothesis. */
  "model",
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];
export const CLAIM_TYPES = [
  "existence",
  "behavior",
  "naming",
  "permission",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

/**
 * Reliability tiers per claim type (§45); higher decides. Prose and model
 * hypotheses never outrank code or tests. Runtime events show what users did,
 * not what is permitted, so they rank low for permission claims.
 */
export const RELIABILITY: Record<ClaimType, Record<EvidenceClass, number>> = {
  existence: {
    browser: 6,
    observed: 6,
    test: 5,
    formal: 4,
    static: 4,
    pr: 3,
    commit: 2,
    docs: 2,
    historical: 1,
    model: 1,
  },
  behavior: {
    browser: 6,
    observed: 5,
    test: 5,
    formal: 4,
    static: 4,
    pr: 3,
    commit: 2,
    docs: 2,
    historical: 1,
    model: 1,
  },
  naming: {
    static: 5,
    browser: 5,
    test: 4,
    pr: 4,
    docs: 3,
    commit: 3,
    observed: 2,
    formal: 2,
    historical: 1,
    model: 1,
  },
  permission: {
    browser: 6,
    test: 5,
    formal: 4,
    static: 4,
    observed: 3,
    pr: 2,
    commit: 2,
    docs: 2,
    historical: 1,
    model: 1,
  },
};
/** Classes whose disagreement with stronger current evidence reads as a stale artifact. */
const STALE_PRONE = new Set<EvidenceClass>([
  "docs",
  "historical",
  "commit",
  "pr",
]);

export const EvidenceClaimSchema = z.strictObject({
  id: z.string().min(1),
  type: z.enum(CLAIM_TYPES),
  /** The capability, workflow or entity the claim is about. */
  subject: z.string().min(1),
  statement: z.string().min(1),
  /** Categorical claims choose among values (e.g. a canonical name); binary claims omit it. */
  categorical: z.boolean().optional(),
});
export type EvidenceClaim = z.infer<typeof EvidenceClaimSchema>;
export const EvidenceItemSchema = z.strictObject({
  id: z.string().min(1),
  class: z.enum(EVIDENCE_CLASSES),
  /** Binary claims: whether this item supports or contradicts the statement. */
  stance: z.enum(["supports", "contradicts"]).optional(),
  /** Categorical claims: the value this item points to. */
  value: z.string().min(1).optional(),
  /** False when the item describes an older state (an old commit, superseded docs). */
  current: z.boolean(),
  summary: z.string().min(1),
  ref: EvidenceRefSchema.optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type ConfidenceBand = "high" | "medium" | "low";
export type EvidenceConflict = {
  id: string;
  kind: /** Weaker, stale-prone evidence disagrees with stronger current evidence. */
    | "likely-stale-artifact"
    /** A model hypothesis disagrees with stronger evidence. */
    | "unsupported-hypothesis"
    /** Code- or test-level evidence disagrees with the decision; nothing explains it. */
    | "unexplained-contradiction"
    /** The strongest tier disagrees with itself; no side wins. */
    | "unresolved";
  /** Items on the deciding side, and the items that disagree with it. */
  deciding: string[];
  disagreeing: string[];
  explanation: string;
};
export type CalibrationTable = {
  id: string;
  /** Minimum labeled samples a band needs before it yields a probability. */
  minSamples: number;
  bands: { band: ConfidenceBand; samples: number; correct: number }[];
};
export type ConfidenceAssessment = {
  claimId: string;
  status: "supported" | "contradicted" | "contested" | "insufficient";
  /** Categorical claims: the value the evidence settles on; null if contested or empty. */
  canonical: string | null;
  confidence: {
    band: ConfidenceBand;
    score: number;
    meaning: "rule-strength-not-probability";
  };
  /** Only from a calibration table with enough labeled samples for the band. */
  probability:
    | { value: number; calibration: string; samples: number }
    | { value: null; reason: string };
  decidingTier: number | null;
  supporting: string[];
  contradicting: string[];
  conflicts: EvidenceConflict[];
  /** The fusion rules that fired, in order. */
  rationale: string[];
};

const SCORES: Record<ConfidenceBand, number> = {
  high: 0.9,
  medium: 0.6,
  low: 0.3,
};
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Fusion rules (documented in ADR 0056):
 * 1. Each item counts once per evidence class: ten source nodes are one
 *    `static` witness, so repeated evidence is not independent evidence.
 * 2. The highest reliability tier present decides. Categorical claims pick
 *    the value backed by the highest tier, then by more distinct classes at
 *    that tier; a remaining tie is contested.
 * 3. Disagreement below the deciding tier becomes a conflict: a likely stale
 *    artifact for prose, docs, commits and PRs (or non-current items), an
 *    unsupported hypothesis for model output, and otherwise an unexplained
 *    contradiction, which caps confidence at medium.
 * 4. Band: high needs a deciding tier of at least 5 and two distinct current
 *    classes at tier 4 or more on the deciding side; medium needs tier 4;
 *    anything else is low. Contested claims are low.
 */
export function fuseEvidence(
  inputClaim: EvidenceClaim,
  inputItems: readonly EvidenceItem[],
  options: { calibration?: CalibrationTable } = {},
): ConfidenceAssessment {
  const claim = EvidenceClaimSchema.parse(inputClaim);
  const items = inputItems
    .map((item) => EvidenceItemSchema.parse(item))
    .sort((a, b) => compare(a.id, b.id));
  for (const item of items)
    if (claim.categorical ? !item.value : !item.stance)
      throw new Error(
        `Evidence ${item.id} needs ${claim.categorical ? "a value" : "a stance"} for claim ${claim.id}.`,
      );
  const tiers = RELIABILITY[claim.type];
  const tier = (item: EvidenceItem) => tiers[item.class];
  const rationale: string[] = [];
  const empty = (reason: string): ConfidenceAssessment => ({
    claimId: claim.id,
    status: "insufficient",
    canonical: null,
    confidence: {
      band: "low",
      score: SCORES.low,
      meaning: "rule-strength-not-probability",
    },
    probability: { value: null, reason: "No decision to calibrate." },
    decidingTier: null,
    supporting: [],
    contradicting: [],
    conflicts: [],
    rationale: [reason],
  });
  if (items.length === 0) return empty("No evidence for the claim.");

  // Sides: binary stances, or one side per categorical value.
  const sides = new Map<string, EvidenceItem[]>();
  for (const item of items) {
    const key = claim.categorical
      ? (item.value as string)
      : (item.stance as string);
    sides.set(key, [...(sides.get(key) ?? []), item]);
  }
  const strength = (side: EvidenceItem[]) => {
    const top = Math.max(...side.map(tier));
    return {
      top,
      classes: new Set(
        side.filter((item) => tier(item) === top).map((item) => item.class),
      ).size,
    };
  };
  const ranked = [...sides]
    .map(([key, side]) => ({ key, side, ...strength(side) }))
    .sort(
      (a, b) => b.top - a.top || b.classes - a.classes || compare(a.key, b.key),
    );
  const [best, second] = ranked as [
    (typeof ranked)[number],
    (typeof ranked)[number] | undefined,
  ];
  rationale.push(
    `Deciding tier ${best.top} (${[...new Set(best.side.filter((item) => tier(item) === best.top).map((item) => item.class))].sort(compare).join(", ")}).`,
  );
  const contested =
    second !== undefined &&
    second.top === best.top &&
    second.classes === best.classes;
  const others = ranked.slice(1).flatMap((entry) => entry.side);
  const conflicts: EvidenceConflict[] = [];
  if (contested) {
    rationale.push(
      "The strongest tier disagrees with itself with as many classes on each side: contested.",
    );
    conflicts.push({
      id: `${claim.id}:unresolved`,
      kind: "unresolved",
      deciding: best.side.map((item) => item.id),
      disagreeing: others.map((item) => item.id),
      explanation: `Evidence at reliability tier ${best.top} points both ways; more decisive evidence (browser verification or a test) is needed.`,
    });
  } else {
    const groups = new Map<EvidenceConflict["kind"], EvidenceItem[]>();
    for (const item of others) {
      const kind: EvidenceConflict["kind"] =
        item.class === "model"
          ? "unsupported-hypothesis"
          : STALE_PRONE.has(item.class) || !item.current
            ? "likely-stale-artifact"
            : "unexplained-contradiction";
      groups.set(kind, [...(groups.get(kind) ?? []), item]);
    }
    for (const kind of [
      "likely-stale-artifact",
      "unsupported-hypothesis",
      "unexplained-contradiction",
    ] as const) {
      const group = groups.get(kind);
      if (!group) continue;
      const classes = [...new Set(group.map((item) => item.class))]
        .sort(compare)
        .join(", ");
      conflicts.push({
        id: `${claim.id}:${kind}`,
        kind,
        deciding: best.side.map((item) => item.id),
        disagreeing: group.map((item) => item.id),
        explanation:
          kind === "likely-stale-artifact"
            ? `Weaker ${classes} evidence disagrees with current tier-${best.top} evidence; likely stale. Review and update it.`
            : kind === "unsupported-hypothesis"
              ? "A model hypothesis disagrees with stronger evidence and is not adopted."
              : `${classes} evidence disagrees with the decision and nothing marks it stale; uncertainty is retained.`,
      });
    }
  }

  let band: ConfidenceBand;
  if (contested) band = "low";
  else {
    const strongClasses = new Set(
      best.side
        .filter((item) => item.current && tier(item) >= 4)
        .map((item) => item.class),
    );
    band =
      best.top >= 5 && strongClasses.size >= 2
        ? "high"
        : best.top >= 4
          ? "medium"
          : "low";
    rationale.push(
      `${strongClasses.size} distinct current class(es) at tier 4 or more on the deciding side: ${band}.`,
    );
    if (
      band === "high" &&
      conflicts.some((item) => item.kind === "unexplained-contradiction")
    ) {
      band = "medium";
      rationale.push("An unexplained contradiction caps confidence at medium.");
    }
  }

  const binarySupported = claim.categorical || best.key === "supports";
  // Binary claims split by stance; categorical ones by the winning value
  // (when contested, the first-ranked value stands in for "supporting").
  const support = claim.categorical
    ? best.side
    : items.filter((item) => item.stance === "supports");
  const against = claim.categorical
    ? others
    : items.filter((item) => item.stance === "contradicts");
  return {
    claimId: claim.id,
    status: contested
      ? "contested"
      : binarySupported
        ? "supported"
        : "contradicted",
    canonical: claim.categorical && !contested ? best.key : null,
    confidence: {
      band,
      score: SCORES[band],
      meaning: "rule-strength-not-probability",
    },
    probability: calibrated(band, contested, options.calibration),
    decidingTier: best.top,
    supporting: support.map((item) => item.id).sort(compare),
    contradicting: against.map((item) => item.id).sort(compare),
    conflicts,
    rationale,
  };
}

function calibrated(
  band: ConfidenceBand,
  contested: boolean,
  table: CalibrationTable | undefined,
): ConfidenceAssessment["probability"] {
  if (contested)
    return { value: null, reason: "Contested claims are not calibrated." };
  if (!table)
    return {
      value: null,
      reason:
        "No calibration table: the score is rule strength, not a probability.",
    };
  const entry = table.bands.find((item) => item.band === band);
  if (!entry || entry.samples < table.minSamples)
    return {
      value: null,
      reason: `Calibration ${table.id} has ${entry?.samples ?? 0} labeled ${band} samples; ${table.minSamples} are needed.`,
    };
  return {
    value: Math.round((entry.correct / entry.samples) * 1000) / 1000,
    calibration: table.id,
    samples: entry.samples,
  };
}

/**
 * Builds a calibration table from reviewed outcomes: for each band, how often
 * an assessment in that band turned out right (e.g. from evaluation ground
 * truth or review decisions).
 */
export function calibrate(
  id: string,
  outcomes: readonly { band: ConfidenceBand; correct: boolean }[],
  minSamples = 30,
): CalibrationTable {
  return {
    id,
    minSamples,
    bands: (["high", "medium", "low"] as const).map((band) => {
      const relevant = outcomes.filter((item) => item.band === band);
      return {
        band,
        samples: relevant.length,
        correct: relevant.filter((item) => item.correct).length,
      };
    }),
  };
}

const CLASS_BY_NODE: Partial<Record<GraphNode["type"], EvidenceClass>> = {
  UIAction: "static",
  Component: "static",
  Symbol: "static",
  Route: "static",
  File: "static",
  APIEndpoint: "static",
  Permission: "static",
  FeatureFlag: "static",
  Test: "test",
  Commit: "commit",
  PullRequest: "pr",
};
/**
 * Evidence items for "this capability exists" from graph nodes: source nodes
 * are `static`, tests `test`, commits and pull requests `commit`/`pr`. Callers
 * add docs, runtime or model items they hold. Node data never leaves as prose.
 */
export function graphEvidenceItems(
  graph: ProductGraph,
  nodeIds: readonly string[],
  options: { value?: string } = {},
): EvidenceItem[] {
  const commit = graph.getNode("repository:.")?.data?.commit;
  return [...new Set(nodeIds)].sort(compare).flatMap((id): EvidenceItem[] => {
    const node = graph.getNode(id);
    const evidenceClass = node ? CLASS_BY_NODE[node.type] : undefined;
    if (!node || !evidenceClass) return [];
    return [
      {
        id: node.id,
        class: evidenceClass,
        ...(options.value === undefined
          ? { stance: "supports" as const }
          : { value: options.value }),
        current: true,
        summary: `${node.type} ${node.id}`,
        ...(typeof commit === "string"
          ? {
              ref: {
                id: node.id,
                type:
                  node.type === "Test"
                    ? ("test" as const)
                    : node.type === "Route"
                      ? ("route" as const)
                      : node.type === "APIEndpoint"
                        ? ("api" as const)
                        : node.type === "Commit"
                          ? ("commit" as const)
                          : node.type === "PullRequest"
                            ? ("pull_request" as const)
                            : node.type === "File"
                              ? ("source_file" as const)
                              : ("symbol" as const),
                locator: node.id,
                repositoryCommit: commit,
              },
            }
          : {}),
      },
    ];
  });
}
