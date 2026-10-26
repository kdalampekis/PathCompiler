import type {
  DropOffReport,
  PathEfficiencyReport,
  ReconciliationReport,
} from "@pathcompiler/behavior-reconciliation";
import type { WorkflowImpactReport } from "@pathcompiler/impact-analysis";
import type { ReleaseBehaviorDiff } from "@pathcompiler/observed-graph";
import {
  type ConfidenceAssessment,
  type EvidenceItem,
  fuseEvidence,
} from "@pathcompiler/probabilistic-evidence";
import type { SemanticChangeReport } from "@pathcompiler/semantic-change";

/**
 * Finding model, I0 (reasoning spec §175–§177, §241, §255). A finding is an
 * evidence-backed statement about the product, derived deterministically
 * from existing reasoning, impact and analytics reports, with lineage to the
 * report entries it came from. A finding is not a recommendation (I1), and
 * its confidence is that the finding is real, never that a change would help.
 */
export type FindingKind =
  | "release_regression"
  | "permission_regression"
  | "workflow_friction"
  | "low_adoption"
  | "runtime_formal_discrepancy";
export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";
export type ProductTarget = {
  kind: "workflow" | "goal" | "target";
  id: string;
  /** Role or context the finding is about, when it is context-specific. */
  context?: string;
};
/** Where a finding's evidence came from: report and entry, for lineage. */
export type FindingSource = { report: string; entry: string };
export type FindingEvidenceBundle = {
  items: EvidenceItem[];
  sources: FindingSource[];
};
export type ProductFinding = {
  id: string;
  kind: FindingKind;
  target: ProductTarget;
  summary: string;
  evidence: FindingEvidenceBundle;
  severity: FindingSeverity;
  /** That the finding is real (P0 fusion), not that any intervention would help. */
  confidence: ConfidenceAssessment;
  detectedAt: string;
  /** Commit or model the evidence was computed at. */
  modelVersion: string;
  release?: string;
  /** Files the R11 root cause traces to; findings sharing one share a cause. */
  rootCause?: string[];
};
export type PriorityComponent = { name: string; value: number; reason: string };
export type PriorityAssessment = {
  score: number;
  scoreMeaning: "ordering-not-probability";
  components: PriorityComponent[];
  rationale: string;
};
export type ImprovementOpportunity = {
  id: string;
  /** The workflow, capability or goal the findings share (the first of `subjects`). */
  subject: string;
  /** Every capability the opportunity covers; several when one root cause affects them all. */
  subjects: string[];
  findingIds: string[];
  kinds: FindingKind[];
  priority: PriorityAssessment;
};
export type FindingsReport = {
  schemaVersion: 1;
  kind: "findings";
  meaning: "hypothesis";
  findings: ProductFinding[];
  opportunities: ImprovementOpportunity[];
};
export type FindingInputs = {
  semantic?: SemanticChangeReport;
  impact?: WorkflowImpactReport;
  releaseDiff?: ReleaseBehaviorDiff;
  efficiency?: PathEfficiencyReport;
  dropOffs?: DropOffReport;
  reconciliation?: ReconciliationReport;
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const SEVERITY_ORDER: FindingSeverity[] = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
];
const SEVERITY_VALUE: Record<FindingSeverity, number> = {
  info: 0.1,
  low: 0.3,
  medium: 0.5,
  high: 0.8,
  critical: 1,
};
const REGRESSIONS = new Set<FindingKind>([
  "release_regression",
  "permission_regression",
  "runtime_formal_discrepancy",
]);
const DEFINITE_BREAKS = new Set([
  "target-removed",
  "condition-target-removed",
  "route-removed",
  "api-removed",
]);
const describe = (context: Record<string, unknown>) =>
  Object.entries(context)
    .sort(([a], [b]) => compare(a, b))
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(", ") || "any context";
const hasRole = (context: Record<string, unknown>) => "role" in context;
/** Permission findings are about a role; other context values are evidence detail. */
const roleOf = (context: Record<string, unknown>) =>
  `role=${String(context.role)}`;

export function deriveFindings(
  inputs: FindingInputs,
  options: {
    /** Timestamp for every finding (pass it for reproducible output). */
    detectedAt?: string;
    modelVersion?: string;
    release?: string;
    /** Goal → capability (workflow) ID, so findings about one capability group together. */
    goalCapabilities?: Readonly<Record<string, string>>;
  } = {},
): FindingsReport {
  const detectedAt = options.detectedAt ?? new Date().toISOString();
  const modelVersion =
    options.modelVersion ??
    inputs.semantic?.commitRange.head ??
    inputs.impact?.head.commit ??
    "unknown";
  type Draft = {
    kind: FindingKind;
    target: ProductTarget;
    summaries: string[];
    severity: FindingSeverity;
    items: EvidenceItem[];
    sources: FindingSource[];
    rootCause: Set<string>;
  };
  const drafts = new Map<string, Draft>();
  const add = (
    kind: FindingKind,
    target: ProductTarget,
    severity: FindingSeverity,
    summary: string,
    item: Omit<EvidenceItem, "id" | "current" | "stance"> & { id: string },
    source: FindingSource,
    rootCause: readonly string[] = [],
  ) => {
    const id = `finding:${kind}:${target.kind}:${target.id}${target.context ? `@${target.context}` : ""}`;
    const draft = drafts.get(id) ?? {
      kind,
      target,
      summaries: [],
      severity,
      items: [],
      sources: [],
      rootCause: new Set<string>(),
    };
    for (const file of rootCause) draft.rootCause.add(file);
    if (!draft.summaries.includes(summary)) draft.summaries.push(summary);
    if (
      SEVERITY_ORDER.indexOf(severity) > SEVERITY_ORDER.indexOf(draft.severity)
    )
      draft.severity = severity;
    if (!draft.items.some((existing) => existing.id === item.id))
      draft.items.push({ ...item, stance: "supports", current: true });
    if (
      !draft.sources.some(
        (existing) =>
          existing.report === source.report && existing.entry === source.entry,
      )
    )
      draft.sources.push(source);
    drafts.set(id, draft);
  };

  // R11: reachability lost or gained. Role-specific changes are permission
  // regressions; others are release regressions.
  const semantic = inputs.semantic;
  if (semantic) {
    const report = `semantic-change ${semantic.commitRange.base.slice(0, 12)}..${semantic.commitRange.head.slice(0, 12)}`;
    semantic.removedReachability.forEach((change, index) => {
      const role = hasRole(change.context);
      add(
        role ? "permission_regression" : "release_regression",
        {
          kind: "goal",
          id: change.goal,
          ...(role ? { context: roleOf(change.context) } : {}),
        },
        "high",
        `${change.goal} is no longer reachable for ${role ? roleOf(change.context) : describe(change.context)}.`,
        {
          id: `formal:removed:${change.goal}:${describe(change.context)}`,
          class: "formal",
          summary: `Bounded SMT: reachable before, unreachable after, for ${describe(change.context)}.`,
        },
        { report, entry: `removedReachability[${index}]` },
        change.changedAt,
      );
    });
    semantic.newReachability.forEach((change, index) => {
      // New reachability for a specific role may be a permission leak.
      if (!hasRole(change.context)) return;
      add(
        "permission_regression",
        { kind: "goal", id: change.goal, context: roleOf(change.context) },
        "high",
        `${change.goal} became reachable for ${roleOf(change.context)}; check that this access is intended.`,
        {
          id: `formal:new:${change.goal}:${describe(change.context)}`,
          class: "formal",
          summary: `Bounded SMT: unreachable before, reachable after, for ${describe(change.context)}.`,
        },
        { report, entry: `newReachability[${index}]` },
      );
    });
  }

  // Impact: definite breaks of approved workflows, and removed access conditions.
  const impact = inputs.impact;
  if (impact)
    impact.impacts.forEach((workflow, index) => {
      for (const reason of workflow.reasons) {
        const kind = DEFINITE_BREAKS.has(reason.code)
          ? "release_regression"
          : reason.code === "permission-changed"
            ? "permission_regression"
            : undefined;
        if (!kind) continue;
        add(
          kind,
          { kind: "workflow", id: workflow.workflowId },
          "high",
          `Approved workflow ${workflow.workflowId}: ${reason.message}`,
          {
            id: `static:${reason.code}:${reason.nodeId ?? workflow.workflowId}`,
            class: "static",
            summary: reason.message,
          },
          {
            report: "workflow-impact",
            entry: `impacts[${index}].${reason.code}`,
          },
        );
      }
    });

  // O12: observed goal reach dropped between releases.
  const diff = inputs.releaseDiff;
  if (diff)
    diff.goals.forEach((goal, index) => {
      if (goal.observed !== "down") return;
      add(
        "release_regression",
        { kind: "goal", id: goal.goal },
        goal.class === "unexplained-behavior-change" ? "high" : "medium",
        `Sessions reaching ${goal.goal} fell from ${goal.base.share} to ${goal.head.share} between ${diff.baseRelease} and ${diff.headRelease}${goal.class === "unexplained-behavior-change" ? " with no formal change to explain it" : ""}.`,
        {
          id: `observed:release-down:${goal.goal}`,
          class: "observed",
          summary: `95% intervals ${goal.base.interval.join("–")} → ${goal.head.interval.join("–")}.`,
        },
        { report: "release-behavior", entry: `goals[${index}]` },
      );
    });

  // O9 and O10: users spend much more effort than needed, or give up at a point.
  const efficiency = inputs.efficiency;
  if (efficiency)
    efficiency.friction.forEach((item, index) => {
      add(
        "workflow_friction",
        { kind: "goal", id: item.goal, context: item.role },
        item.ratio >= 3 ? "high" : "medium",
        `Completing ${item.goal} takes ${item.ratio}× the minimum formal path for role ${item.role}.`,
        {
          id: `observed:efficiency:${item.goal}:${item.role}`,
          class: "observed",
          summary: `Path efficiency ratio ${item.ratio}.`,
        },
        { report: "path-efficiency", entry: `friction[${index}]` },
      );
    });
  const dropOffs = inputs.dropOffs;
  if (dropOffs)
    dropOffs.items.forEach((item, index) => {
      for (const point of item.friction)
        add(
          "workflow_friction",
          { kind: "goal", id: item.goal, context: item.role },
          point.share >= 0.4 ? "high" : "medium",
          `${Math.round(point.share * 100)}% of attempts at ${item.goal} (role ${item.role}) end after ${point.target}.`,
          {
            id: `observed:drop-off:${item.goal}:${item.role}:${point.target}`,
            class: "observed",
            summary: `${item.dropOffs} of ${item.attempts} attempts dropped off.`,
          },
          { report: "drop-offs", entry: `items[${index}].${point.target}` },
        );
    });

  // O8: possible but unused goals, and behavior the model says cannot happen.
  const reconciliation = inputs.reconciliation;
  if (reconciliation) {
    reconciliation.items.forEach((item, index) => {
      if (item.kind !== "goal" || item.class !== "possible-unobserved") return;
      add(
        "low_adoption",
        { kind: "goal", id: item.id, context: item.role },
        "low",
        `${item.id} is formally reachable for role ${item.role} but no session reached it in ${item.roleSessions} sessions.`,
        {
          id: `observed:unused:${item.id}:${item.role}`,
          class: "observed",
          summary: `0 of ${item.roleSessions} sessions.`,
        },
        { report: "reconciliation", entry: `items[${index}]` },
      );
      // Formal reachability is what makes the absence notable.
      add(
        "low_adoption",
        { kind: "goal", id: item.id, context: item.role },
        "low",
        `${item.id} is formally reachable for role ${item.role} but no session reached it in ${item.roleSessions} sessions.`,
        {
          id: `formal:reachable:${item.id}:${item.role}`,
          class: "formal",
          summary: "The formal model reaches it in this context.",
        },
        { report: "reconciliation", entry: `items[${index}].formal` },
      );
    });
    reconciliation.discrepancies.forEach((item, index) => {
      if (item.type !== "unexpected_observed") return;
      add(
        "runtime_formal_discrepancy",
        {
          kind: item.kind === "goal" ? "goal" : "target",
          id: item.id,
          context: item.role,
        },
        "high",
        `${item.id} was observed ${item.observed.count} times for role ${item.role}, though the formal model says it cannot happen${item.formalReason.length ? ` (${item.formalReason[0]})` : ""}.`,
        {
          id: `observed:unexpected:${item.id}:${item.role}`,
          class: "observed",
          summary: `${item.observed.sessions} sessions.`,
        },
        { report: "reconciliation", entry: `discrepancies[${index}]` },
      );
    });
  }

  const findings: ProductFinding[] = [...drafts]
    .map(([id, draft]) => ({
      id,
      kind: draft.kind,
      target: draft.target,
      summary: draft.summaries.join(" "),
      evidence: { items: draft.items, sources: draft.sources },
      severity: draft.severity,
      confidence: fuseEvidence(
        {
          id,
          type: "behavior",
          subject: draft.target.id,
          statement: `${draft.kind} for ${draft.target.id}`,
        },
        draft.items,
      ),
      detectedAt,
      modelVersion,
      ...(options.release ? { release: options.release } : {}),
      ...(draft.rootCause.size
        ? { rootCause: [...draft.rootCause].sort(compare) }
        : {}),
    }))
    .sort((a, b) => compare(a.id, b.id));

  // Opportunities: findings about the same capability, so one noisy metric
  // does not become its own recommendation (§177).
  // R11 knows which capability each changed goal belongs to.
  const goalCapabilities: Record<string, string> = {};
  for (const change of [
    ...(semantic?.removedReachability ?? []),
    ...(semantic?.newReachability ?? []),
    ...(semantic?.affectedWorkflows ?? []),
  ])
    if (change.capabilityId)
      goalCapabilities[change.goal] = change.capabilityId;
  Object.assign(goalCapabilities, options.goalCapabilities);
  const subjectOf = (finding: ProductFinding) =>
    finding.target.kind === "goal"
      ? (goalCapabilities[finding.target.id] ?? finding.target.id)
      : finding.target.id;
  // Subjects whose findings trace to the same root-cause file are one
  // opportunity: fixing the cause fixes them together (ISSUES_LOG #48).
  const parent = new Map<string, string>();
  const root = (subject: string): string => {
    const next = parent.get(subject) ?? subject;
    return next === subject ? subject : root(next);
  };
  const byFile = new Map<string, string>();
  for (const finding of findings) {
    const subject = subjectOf(finding);
    if (!parent.has(subject)) parent.set(subject, subject);
    for (const file of finding.rootCause ?? []) {
      const other = byFile.get(file);
      if (other === undefined) byFile.set(file, subject);
      else {
        const [a, b] = [root(other), root(subject)].sort(compare) as [
          string,
          string,
        ];
        if (a !== b) parent.set(b, a);
      }
    }
  }
  const groups = new Map<string, ProductFinding[]>();
  for (const finding of findings) {
    const key = root(subjectOf(finding));
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  const opportunities = [...groups]
    .map(([, members]): ImprovementOpportunity => {
      const subjects = [...new Set(members.map(subjectOf))].sort(compare);
      const subject = subjects[0] as string;
      const shared = subjects.length > 1;
      const severity = members.reduce<FindingSeverity>(
        (worst, item) =>
          SEVERITY_ORDER.indexOf(item.severity) > SEVERITY_ORDER.indexOf(worst)
            ? item.severity
            : worst,
        "info",
      );
      const confidence = Math.max(
        ...members.map((item) => item.confidence.confidence.score),
      );
      const regression = members.some((item) => REGRESSIONS.has(item.kind));
      const components: PriorityComponent[] = [
        {
          name: "severity",
          value: SEVERITY_VALUE[severity],
          reason: `Worst finding severity: ${severity}.`,
        },
        {
          name: "confidence",
          value: confidence,
          reason:
            "Strongest finding confidence (rule strength, not probability).",
        },
        {
          name: "regression",
          value: regression ? 1 : 0.5,
          reason: regression
            ? "A regression or discrepancy: something changed or contradicts the model."
            : "Behavioral evidence only; nothing regressed.",
        },
        {
          name: "corroboration",
          value: Math.min(1, 0.5 + 0.25 * (members.length - 1)),
          reason: `${members.length} finding(s) about ${subjects.join(", ")}.`,
        },
      ];
      const score =
        Math.round(
          components.reduce((product, item) => product * item.value, 1) * 1000,
        ) / 1000;
      const kinds = [...new Set(members.map((item) => item.kind))].sort(
        compare,
      );
      return {
        id: `opportunity:${subjects.join("+")}`,
        subject,
        subjects,
        findingIds: members.map((item) => item.id),
        kinds,
        priority: {
          score,
          scoreMeaning: "ordering-not-probability",
          components,
          rationale: `${kinds.join(", ")} for ${subjects.join(", ")}${shared ? " (one shared root cause)" : ""}: severity × confidence × regression × corroboration.`,
        },
      };
    })
    .sort((a, b) => b.priority.score - a.priority.score || compare(a.id, b.id));
  return {
    schemaVersion: 1,
    kind: "findings",
    meaning: "hypothesis",
    findings,
    opportunities,
  };
}
