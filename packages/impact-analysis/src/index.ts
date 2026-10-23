import {
  type GraphDelta,
  GraphDeltaSchema,
  type GraphNodeChange,
} from "@pathcompiler/graph-delta";
import type {
  WorkflowCondition,
  WorkflowTerminalCondition,
  WorkflowV1,
} from "@pathcompiler/workflow-ir";
import { ApprovedWorkflowSchema } from "@pathcompiler/workflow-review";
import { z } from "zod";

const severity = z.enum(["none", "low", "medium", "high"]);
export type ImpactSeverity = z.infer<typeof severity>;
const RANK: Record<ImpactSeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export const ImpactReasonSchema = z.strictObject({
  code: z.enum([
    "target-removed",
    "condition-target-removed",
    "api-removed",
    "route-removed",
    "route-changed",
    "permission-changed",
    "target-changed",
    "api-changed",
    "implementation-removed",
    "test-evidence-removed",
    "baseline-mismatch",
    "target-moved",
    "copy-changed",
    "implementation-changed",
    "test-evidence-changed",
    "source-file-changed",
  ]),
  severity: severity.exclude(["none"]),
  message: z.string(),
  nodeId: z.string().optional(),
  stepIds: z.array(z.string()),
});
export const WorkflowImpactSchema = z.strictObject({
  workflowId: z.string(),
  severity,
  reasons: z.array(ImpactReasonSchema),
  affectedSteps: z.array(z.string()),
});
export const WorkflowImpactReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  base: z.strictObject({ commit: z.string() }),
  head: z.strictObject({ commit: z.string() }),
  /** Deterministic rules only; no model inference. */
  method: z.literal("deterministic-rules"),
  impacts: z.array(WorkflowImpactSchema),
});
export type ImpactReason = z.infer<typeof ImpactReasonSchema>;
export type WorkflowImpact = z.infer<typeof WorkflowImpactSchema>;
export type WorkflowImpactReport = z.infer<typeof WorkflowImpactReportSchema>;

/**
 * Pure: applies deterministic impact rules to a graph delta for each approved
 * workflow. Sorted by severity (highest first), then workflow ID.
 */
export function analyzeWorkflowImpact(
  deltaInput: unknown,
  approved: readonly unknown[],
): WorkflowImpactReport {
  const delta = GraphDeltaSchema.parse(deltaInput);
  const impacts = approved
    .map((record) =>
      impactFor(ApprovedWorkflowSchema.parse(record).workflow, delta),
    )
    .sort(
      (a, b) =>
        RANK[b.severity] - RANK[a.severity] ||
        compare(a.workflowId, b.workflowId),
    );
  return WorkflowImpactReportSchema.parse({
    schemaVersion: 1,
    base: delta.base,
    head: delta.head,
    method: "deterministic-rules",
    impacts,
  });
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
type Uses = Map<string, Set<string>>;
function add(uses: Uses, key: string, stepId: string) {
  const steps = uses.get(key) ?? new Set();
  steps.add(stepId);
  uses.set(key, steps);
}
function conditionTargets(
  condition: WorkflowCondition | WorkflowTerminalCondition,
): string[] {
  if ("any" in condition) return condition.any.flatMap(conditionTargets);
  if ("all" in condition) return condition.all.flatMap(conditionTargets);
  return "target" in condition ? [condition.target] : [];
}
/** File part of an evidence locator, e.g. `components/a.tsx#A:button[1]`. */
function locatorFile(locator: string): string | null {
  const file = locator.split(/#|:\d/)[0] ?? "";
  return /\.[cm]?[jt]sx?$/.test(file) ? file : null;
}
function uiTarget(change: {
  data?: Record<string, unknown> | undefined;
}): string | null {
  const target = change.data?.target;
  return target &&
    typeof target === "object" &&
    !Array.isArray(target) &&
    typeof (target as Record<string, unknown>).semanticId === "string"
    ? ((target as Record<string, unknown>).semanticId as string)
    : null;
}
function evidenceFiles(
  node: { data?: Record<string, unknown> | undefined } | undefined,
): string[] {
  const evidence = node?.data?.evidence;
  return Array.isArray(evidence)
    ? evidence.flatMap((item) =>
        item &&
        typeof item === "object" &&
        typeof (item as { file?: unknown }).file === "string"
          ? [(item as { file: string }).file]
          : [],
      )
    : [];
}
/** Only the visible label (and the target's derived name) changed. */
function copyOnly(change: GraphNodeChange): boolean {
  if (
    !change.fields.every((field) =>
      ["label", "target", "evidence"].includes(field),
    )
  )
    return false;
  const before = { ...(change.before.data?.target as object) } as Record<
    string,
    unknown
  >;
  const after = { ...(change.after.data?.target as object) } as Record<
    string,
    unknown
  >;
  delete before.name;
  delete after.name;
  return JSON.stringify(before) === JSON.stringify(after);
}

function impactFor(workflow: WorkflowV1, delta: GraphDelta): WorkflowImpact {
  const ALL = "*";
  const stepTargets: Uses = new Map();
  const conditionUses: Uses = new Map();
  const evidence: Uses = new Map();
  const files: Uses = new Map();
  for (const step of workflow.steps) {
    if (step.target) add(stepTargets, step.target, step.id);
    for (const condition of [
      ...(step.expected ? [step.expected] : []),
      ...(step.branches ?? []).map((branch) => branch.when),
    ])
      for (const target of conditionTargets(condition))
        add(conditionUses, target, step.id);
    for (const ref of step.evidence) {
      add(evidence, ref.id, step.id);
      const file = locatorFile(ref.locator);
      if (file && ref.type !== "test") add(files, file, step.id);
    }
  }
  for (const target of conditionTargets(workflow.terminal))
    add(conditionUses, target, ALL);
  for (const condition of workflow.preconditions ?? [])
    for (const target of conditionTargets(condition))
      add(conditionUses, target, ALL);
  for (const ref of workflow.provenance.evidence) {
    if (!evidence.has(ref.id)) evidence.set(ref.id, new Set());
    const file = locatorFile(ref.locator);
    if (file && ref.type !== "test" && !files.has(file))
      files.set(file, new Set());
  }
  const routes: Uses = new Map();
  for (const entry of workflow.entrypoints)
    if (entry.route) routes.set(`route:${entry.route}`, new Set());
  for (const step of workflow.steps)
    if (step.action.type === "navigate")
      add(routes, `route:${step.action.route}`, step.id);

  const reasons: ImpactReason[] = [];
  const steps = (...sets: (Set<string> | undefined)[]) =>
    [...new Set(sets.flatMap((set) => [...(set ?? [])]))]
      .filter((id) => id !== ALL)
      .sort();
  const reason = (
    code: ImpactReason["code"],
    level: ImpactReason["severity"],
    message: string,
    nodeId: string | undefined,
    stepIds: string[],
  ) =>
    reasons.push({
      code,
      severity: level,
      message,
      ...(nodeId === undefined ? {} : { nodeId }),
      stepIds,
    });

  if (workflow.repository.commit !== delta.base.commit)
    reason(
      "baseline-mismatch",
      "medium",
      `Approved at ${workflow.repository.commit.slice(0, 12)}, but the delta starts at ${delta.base.commit.slice(0, 12)}; earlier changes were not analyzed.`,
      undefined,
      [],
    );
  const readded = new Set(delta.summary.targets.added);
  for (const node of delta.removedNodes) {
    const target = node.type === "UIAction" ? uiTarget(node) : null;
    if (target && !readded.has(target)) {
      if (stepTargets.has(target))
        reason(
          "target-removed",
          "high",
          `Semantic target ${target} was removed.`,
          node.id,
          steps(stepTargets.get(target), conditionUses.get(target)),
        );
      else if (conditionUses.has(target))
        reason(
          "condition-target-removed",
          "high",
          `Target ${target}, used by an expected or completion condition, was removed.`,
          node.id,
          steps(conditionUses.get(target)),
        );
      continue;
    }
    if (routes.has(node.id))
      reason(
        "route-removed",
        "high",
        `Workflow route ${node.id.slice(6)} was removed.`,
        node.id,
        steps(routes.get(node.id)),
      );
    else if (!evidence.has(node.id)) continue;
    else if (node.type === "APIEndpoint")
      reason(
        "api-removed",
        "high",
        `API ${node.id} used by the workflow was removed.`,
        node.id,
        steps(evidence.get(node.id)),
      );
    else if (node.type === "Permission" || node.type === "FeatureFlag")
      reason(
        "permission-changed",
        "high",
        `Access condition ${node.id} was removed.`,
        node.id,
        steps(evidence.get(node.id)),
      );
    else if (node.type === "Test")
      reason(
        "test-evidence-removed",
        "medium",
        `Supporting test ${node.id} was removed.`,
        node.id,
        steps(evidence.get(node.id)),
      );
    else if (node.type !== "UIAction")
      reason(
        "implementation-removed",
        "medium",
        `Implementation ${node.id} was removed.`,
        node.id,
        steps(evidence.get(node.id)),
      );
  }
  for (const change of delta.changedNodes) {
    const target = change.type === "UIAction" ? uiTarget(change.after) : null;
    if (target && (stepTargets.has(target) || conditionUses.has(target))) {
      const stepIds = steps(stepTargets.get(target), conditionUses.get(target));
      if (change.kind === "location")
        reason(
          "target-moved",
          "low",
          `Target ${target} moved; its behavior is unchanged.`,
          change.id,
          stepIds,
        );
      else if (copyOnly(change))
        reason(
          "copy-changed",
          "low",
          `Visible text of ${target} changed; review instructions.`,
          change.id,
          stepIds,
        );
      else
        reason(
          "target-changed",
          "medium",
          `Target ${target} changed (${change.fields.join(", ")}).`,
          change.id,
          stepIds,
        );
      continue;
    }
    if (routes.has(change.id)) {
      reason(
        change.kind === "content" ? "route-changed" : "implementation-changed",
        change.kind === "content" ? "high" : "low",
        `Workflow route ${change.id.slice(6)} changed (${change.fields.join(", ")}).`,
        change.id,
        steps(routes.get(change.id)),
      );
      continue;
    }
    if (!evidence.has(change.id)) continue;
    const stepIds = steps(evidence.get(change.id));
    if (change.type === "Permission" || change.type === "FeatureFlag")
      reason(
        "permission-changed",
        "high",
        `Access condition ${change.id} changed.`,
        change.id,
        stepIds,
      );
    else if (change.type === "APIEndpoint")
      reason(
        change.kind === "content" ? "api-changed" : "implementation-changed",
        change.kind === "content" ? "medium" : "low",
        `API ${change.id} changed (${change.fields.join(", ")}).`,
        change.id,
        stepIds,
      );
    else if (change.type === "Test")
      reason(
        "test-evidence-changed",
        "low",
        `Supporting test ${change.id} changed.`,
        change.id,
        stepIds,
      );
    else if (change.type !== "UIAction")
      reason(
        "implementation-changed",
        "low",
        `Implementation ${change.id} changed (${change.fields.join(", ")}).`,
        change.id,
        stepIds,
      );
  }
  for (const edge of [...delta.addedEdges, ...delta.removedEdges])
    if (
      (edge.type === "REQUIRES_PERMISSION" ||
        edge.type === "GUARDED_BY_FLAG") &&
      (evidence.has(edge.source) || evidence.has(edge.target))
    )
      reason(
        "permission-changed",
        "high",
        `Access guard ${edge.type} between ${edge.source} and ${edge.target} was ${delta.addedEdges.includes(edge) ? "added" : "removed"}.`,
        edge.target,
        steps(evidence.get(edge.source), evidence.get(edge.target)),
      );
  // Files already explained by a node-level reason need no file-level fallback.
  const nodes = new Map(
    [
      ...delta.removedNodes,
      ...delta.changedNodes.flatMap((change) => [change.before, change.after]),
    ].map((node) => [node.id, node]),
  );
  const explained = new Set(
    reasons.flatMap((item) => evidenceFiles(nodes.get(item.nodeId ?? ""))),
  );
  for (const file of delta.summary.files)
    if (
      file.status !== "added" &&
      files.has(file.path) &&
      !explained.has(file.path)
    )
      reason(
        "source-file-changed",
        "low",
        `Workflow source file ${file.path} was ${file.status}; no specific workflow element changed. Review if behavior moved within the file.`,
        undefined,
        [],
      );

  const level = reasons.reduce<ImpactSeverity>(
    (max, item) => (RANK[item.severity] > RANK[max] ? item.severity : max),
    "none",
  );
  return {
    workflowId: workflow.id,
    severity: level,
    reasons: reasons.sort(
      (a, b) =>
        RANK[b.severity] - RANK[a.severity] ||
        compare(a.code, b.code) ||
        compare(a.nodeId ?? "", b.nodeId ?? "") ||
        compare(a.message, b.message),
    ),
    affectedSteps: [...new Set(reasons.flatMap((item) => item.stepIds))].sort(),
  };
}
