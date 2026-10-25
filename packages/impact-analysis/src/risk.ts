import type { ImpactReason, WorkflowImpactReport } from "./index.js";

/**
 * Commit risk scoring, P4 (reasoning spec §56). Every impact is classified by
 * how it is known:
 * - definite: a fact the workflow as written cannot survive (a removed
 *   target, route, endpoint or access condition), or a reachability change
 *   proven by bounded SMT (R11);
 * - probable: a content change to something a step uses;
 * - uncertain: indirect or unanalyzed evidence (a moved target, changed copy,
 *   a shared file, an unanalyzed commit range, an unknown solver result).
 *
 * The risk level is a rule over those classes, never an incident
 * probability. A probability appears only with a calibration table that has
 * enough labeled outcomes for the level.
 */
export type RiskClass = "definite" | "probable" | "uncertain";
export type RiskLevel = "none" | "low" | "medium" | "high";
export const RISK_CLASS: Record<ImpactReason["code"], RiskClass> = {
  "target-removed": "definite",
  "condition-target-removed": "definite",
  "route-removed": "definite",
  "api-removed": "definite",
  "permission-changed": "definite",
  "reachability-removed": "definite",
  "reachability-added": "definite",
  "applicability-changed": "definite",
  "target-changed": "probable",
  "api-changed": "probable",
  "route-changed": "probable",
  "implementation-removed": "probable",
  "test-evidence-removed": "probable",
  "target-moved": "uncertain",
  "copy-changed": "uncertain",
  "implementation-changed": "uncertain",
  "test-evidence-changed": "uncertain",
  "source-file-changed": "uncertain",
  "baseline-mismatch": "uncertain",
};
export type RiskItem = {
  class: RiskClass;
  severity: ImpactReason["severity"];
  source: "static" | "formal";
  code: string;
  message: string;
  workflowId?: string;
  goal?: string;
};
/** Reviewed outcomes per level: how many changes at that level caused an incident. */
export type RiskCalibration = {
  id: string;
  minSamples: number;
  levels: { level: RiskLevel; samples: number; incidents: number }[];
};
export type CommitRiskReport = {
  schemaVersion: 1;
  kind: "commit-risk";
  base: { commit: string };
  head: { commit: string };
  level: RiskLevel;
  levelMeaning: "rule-level-not-probability";
  counts: Record<RiskClass, number>;
  items: RiskItem[];
  /** The rule that set the level. */
  rationale: string;
  incidentProbability:
    | { value: number; calibration: string; samples: number }
    | { value: null; reason: string };
};

const FORMAL = new Set([
  "reachability-removed",
  "reachability-added",
  "applicability-changed",
]);
const ORDER: Record<RiskClass, number> = {
  definite: 0,
  probable: 1,
  uncertain: 2,
};
const SEVERITY = { high: 0, medium: 1, low: 2 } as const;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function scoreCommitRisk(
  impact: WorkflowImpactReport,
  options: {
    /** R11 uncertainty entries (unknown results, contexts not enumerated). */
    uncertainty?: readonly { kind: string; goal?: string; message: string }[];
    calibration?: RiskCalibration;
  } = {},
): CommitRiskReport {
  const seen = new Set<string>();
  const items: RiskItem[] = [];
  for (const workflow of impact.impacts)
    for (const reason of workflow.reasons) {
      const key = `${workflow.workflowId}\u0000${reason.code}\u0000${reason.nodeId ?? reason.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        class: RISK_CLASS[reason.code],
        severity: reason.severity,
        source: FORMAL.has(reason.code) ? "formal" : "static",
        code: reason.code,
        message: reason.message,
        workflowId: workflow.workflowId,
      });
    }
  for (const entry of options.uncertainty ?? [])
    items.push({
      class: "uncertain",
      severity: "low",
      source: "formal",
      code: entry.kind,
      message: entry.message,
      ...(entry.goal ? { goal: entry.goal } : {}),
    });
  items.sort(
    (a, b) =>
      ORDER[a.class] - ORDER[b.class] ||
      SEVERITY[a.severity] - SEVERITY[b.severity] ||
      compare(a.workflowId ?? a.goal ?? "", b.workflowId ?? b.goal ?? "") ||
      compare(a.code, b.code),
  );
  const counts = { definite: 0, probable: 0, uncertain: 0 };
  for (const item of items) counts[item.class] += 1;
  const has = (cls: RiskClass, severities: ImpactReason["severity"][]) =>
    items.some(
      (item) => item.class === cls && severities.includes(item.severity),
    );
  const [level, rationale]: [RiskLevel, string] = has("definite", ["high"])
    ? [
        "high",
        "A definite high-severity impact: an approved workflow cannot run as written, or a goal became unreachable.",
      ]
    : has("definite", ["medium", "low"]) || has("probable", ["high", "medium"])
      ? [
          "medium",
          "A definite lower-severity or a probable impact needs a reviewed update.",
        ]
      : items.length > 0
        ? ["low", "Only uncertain or low-severity probable impacts."]
        : ["none", "No impact on approved workflows was found."];
  const entry = options.calibration?.levels.find(
    (item) => item.level === level,
  );
  return {
    schemaVersion: 1,
    kind: "commit-risk",
    base: impact.base,
    head: impact.head,
    level,
    levelMeaning: "rule-level-not-probability",
    counts,
    items,
    rationale,
    incidentProbability: !options.calibration
      ? {
          value: null,
          reason:
            "Not calibrated: the level is a rule over impact classes, not an incident probability.",
        }
      : !entry || entry.samples < options.calibration.minSamples
        ? {
            value: null,
            reason: `Calibration ${options.calibration.id} has ${entry?.samples ?? 0} reviewed ${level} changes; ${options.calibration.minSamples} are needed.`,
          }
        : {
            value: Math.round((entry.incidents / entry.samples) * 1000) / 1000,
            calibration: options.calibration.id,
            samples: entry.samples,
          },
  };
}
