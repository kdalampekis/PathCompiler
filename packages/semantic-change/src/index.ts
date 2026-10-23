import { discoverCapabilities } from "@pathcompiler/capability-engine";
import {
  buildFormalModel,
  type FormalAbstraction,
} from "@pathcompiler/formal-abstraction";
import type { CommitAnalysis, GraphDelta } from "@pathcompiler/graph-delta";
import {
  type ComparisonOptions,
  type ComparisonUncertainty,
  createProductReasoner,
  type FormalStateSnapshot,
  type ModelComparison,
  type ModelSummary,
  type ReachabilityChange,
} from "@pathcompiler/reasoner-core";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { compareText } from "@pathcompiler/source-model";
import type { EvidenceRef } from "@pathcompiler/workflow-ir";

export type SemanticChangeCode =
  | "reachability-removed"
  | "reachability-added"
  | "applicability-changed";
/** One semantic finding for a capability; impact analysis turns it into a workflow reason. */
export type SemanticWorkflowImpact = {
  capabilityId: string;
  goal: string;
  code: SemanticChangeCode;
  message: string;
};
export type SemanticChangeReport = {
  schemaVersion: 1;
  type: "semantic_change_report";
  commitRange: { base: string; head: string };
  method: "bounded-smt";
  newReachability: ReachabilityChange[];
  /** `changedAt`: files in the commit range that carry the root-cause evidence. */
  removedReachability: (ReachabilityChange & { changedAt: string[] })[];
  changedApplicability: ModelComparison["changedApplicability"];
  changedProperties: ModelComparison["changedProperties"];
  modelDiff: ModelComparison["modelDiff"];
  affectedWorkflows: SemanticWorkflowImpact[];
  models: Record<
    "base" | "head",
    ModelSummary & {
      transitions: FormalAbstraction["coverage"]["transitions"];
      uncertainties: number;
    }
  >;
  uncertainty: ComparisonUncertainty[];
  stats: ModelComparison["stats"];
};

/** Candidate Formal Product Model of one analyzed commit (R1 extraction). */
export function buildCommitModel(analysis: CommitAnalysis): FormalAbstraction {
  const capabilities = discoverCapabilities(analysis.mined.graph);
  return buildFormalModel(
    capabilities.graph,
    capabilities.report,
    analysis.mined.report,
  );
}

export function describeContext(context: FormalStateSnapshot): string {
  const entries = Object.entries(context);
  return entries.length === 0
    ? "any context"
    : entries.map(([name, value]) => `${name}=${String(value)}`).join(", ");
}

const key = (context: FormalStateSnapshot) =>
  JSON.stringify(Object.entries(context).sort(([a], [b]) => compareText(a, b)));
/**
 * Drops context variables the change does not depend on: if the selected
 * contexts cover every value of a variable for each setting of the others,
 * that variable is omitted ("role=editor" instead of one line per flag value).
 */
export function collapseContexts(
  selected: FormalStateSnapshot[],
  universe: FormalStateSnapshot[],
): FormalStateSnapshot[] {
  let current = selected;
  for (const name of Object.keys(universe[0] ?? {}).sort(compareText)) {
    const values = new Set(universe.map((item) => JSON.stringify(item[name])));
    const groups = new Map<string, Set<string>>();
    for (const item of current) {
      if (!(name in item)) continue;
      const { [name]: value, ...rest } = item;
      const group = groups.get(key(rest)) ?? new Set();
      group.add(JSON.stringify(value));
      groups.set(key(rest), group);
    }
    if (
      current.every((item) => name in item) &&
      [...groups.values()].every((group) => group.size === values.size)
    )
      current = [...groups.keys()].map(
        (item) => Object.fromEntries(JSON.parse(item)) as FormalStateSnapshot,
      );
  }
  return [...new Map(current.map((item) => [key(item), item])).values()].sort(
    (a, b) => compareText(key(a), key(b)),
  );
}

const evidenceFile = (ref: EvidenceRef) => {
  const file = ref.locator.split("#")[0] ?? "";
  return /\.[cm]?[jt]sx?$/.test(file) ? file : undefined;
};

/**
 * Semantic product diff of a commit range (reasoning spec §38–§42): both
 * commits' extracted models are compared goal by goal under every enumerable
 * context, and lost reachability is traced to changed files.
 */
export async function analyzeSemanticChange(
  input: { delta: GraphDelta; base: CommitAnalysis; head: CommitAnalysis },
  solver: SolverProvider,
  options: ComparisonOptions & {
    /** Prebuilt models of `base` and `head`, to avoid extracting twice. */
    models?: { base: FormalAbstraction; head: FormalAbstraction };
  } = {},
): Promise<SemanticChangeReport> {
  const { models, ...comparisonOptions } = options;
  const base = models?.base ?? buildCommitModel(input.base);
  const head = models?.head ?? buildCommitModel(input.head);
  const comparison = await createProductReasoner(solver).compareModels(
    base.model,
    head.model,
    comparisonOptions,
  );
  const changed = new Set(input.delta.summary.files.map((file) => file.path));
  const removedReachability = comparison.removedReachability.map((change) => {
    const cited = change.rootCause?.length
      ? change.rootCause
      : (change.explanation?.constraints ?? []);
    const changedAt = [
      ...new Set(
        cited.flatMap((item) =>
          item.evidence.flatMap((ref) => {
            const file = evidenceFile(ref);
            return file && changed.has(file) ? [file] : [];
          }),
        ),
      ),
    ].sort(compareText);
    return { ...change, changedAt };
  });
  const universe = new Map(
    comparison.goals.map((item) => [
      item.goal,
      item.contexts.map((row) => row.context),
    ]),
  );
  const affectedWorkflows: SemanticWorkflowImpact[] = [];
  const group = (
    changes: ReachabilityChange[],
    code: SemanticChangeCode,
    phrase: string,
  ) => {
    const byGoal = new Map<string, ReachabilityChange[]>();
    for (const change of changes)
      if (change.capabilityId)
        byGoal.set(change.goal, [...(byGoal.get(change.goal) ?? []), change]);
    for (const [goal, list] of [...byGoal].sort(([a], [b]) =>
      compareText(a, b),
    )) {
      const contexts = collapseContexts(
        list.map((item) => item.context),
        universe.get(goal) ?? [],
      );
      const causes = [
        ...new Set(
          list.flatMap((item) =>
            (item.rootCause ?? []).map((cause) => cause.description),
          ),
        ),
      ].sort(compareText);
      const files = [
        ...new Set(
          list.flatMap((item) =>
            "changedAt" in item ? (item.changedAt as string[]) : [],
          ),
        ),
      ].sort(compareText);
      affectedWorkflows.push({
        capabilityId: list[0]?.capabilityId as string,
        goal,
        code,
        message: `${goal} is ${phrase} for ${contexts.map(describeContext).join("; ")}${causes.length ? `: ${causes.join("; ")}` : ""}${files.length ? ` (changed in ${files.join(", ")})` : ""}.`,
      });
    }
  };
  group(removedReachability, "reachability-removed", "no longer reachable");
  group(comparison.newReachability, "reachability-added", "newly reachable");
  for (const change of comparison.changedApplicability)
    if (
      change.capabilityId &&
      !affectedWorkflows.some((item) => item.goal === change.goal)
    )
      affectedWorkflows.push({
        capabilityId: change.capabilityId,
        goal: change.goal,
        code: "applicability-changed",
        message: `${change.goal} is reachable under different contexts (before: ${change.before.map(describeContext).join("; ") || "none"}; after: ${change.after.map(describeContext).join("; ") || "none"}).`,
      });
  const model = (abstraction: FormalAbstraction, summary: ModelSummary) => ({
    ...summary,
    transitions: abstraction.coverage.transitions,
    uncertainties: abstraction.uncertainties.length,
  });
  return {
    schemaVersion: 1,
    type: "semantic_change_report",
    commitRange: {
      base: input.delta.base.commit,
      head: input.delta.head.commit,
    },
    method: "bounded-smt",
    newReachability: comparison.newReachability,
    removedReachability,
    changedApplicability: comparison.changedApplicability,
    changedProperties: comparison.changedProperties,
    modelDiff: comparison.modelDiff,
    affectedWorkflows,
    models: {
      base: model(base, comparison.before),
      head: model(head, comparison.after),
    },
    uncertainty: comparison.uncertainty,
    stats: comparison.stats,
  };
}

/** "Product logic" lines in the format of reasoning spec §42. */
export function summarizeSemanticChange(
  report: SemanticChangeReport,
): string[] {
  const removed = report.affectedWorkflows.filter(
    (item) => item.code === "reachability-removed",
  );
  const added = report.affectedWorkflows.filter(
    (item) => item.code === "reachability-added",
  );
  const applicability = report.affectedWorkflows.filter(
    (item) => item.code === "applicability-changed",
  );
  const lines: string[] = [];
  if (added.length)
    lines.push("NEW REACHABILITY", ...added.map((item) => `+ ${item.message}`));
  if (removed.length)
    lines.push(
      "REMOVED REACHABILITY",
      ...removed.map((item) => `- ${item.message}`),
    );
  if (applicability.length)
    lines.push(
      "CHANGED APPLICABILITY",
      ...applicability.map((item) => `~ ${item.message}`),
    );
  if (report.changedProperties.length)
    lines.push(
      "CHANGED PROPERTIES",
      ...report.changedProperties.map(
        (item) => `! invariant ${item.invariant} ${item.change}`,
      ),
    );
  const capabilities = new Set(
    report.affectedWorkflows.map((item) => item.capabilityId),
  );
  lines.push(
    "WORKFLOW IMPACT",
    capabilities.size === 0
      ? "No capability changed reachability."
      : `${capabilities.size} ${capabilities.size === 1 ? "capability requires" : "capabilities require"} review: ${[...capabilities].sort(compareText).join(", ")}`,
  );
  if (report.uncertainty.length)
    lines.push(
      `${report.uncertainty.length} uncertain comparisons (see the report).`,
    );
  return lines;
}
