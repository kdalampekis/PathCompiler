import {
  type FormalExpr,
  type FormalProductModel,
  f,
  formalModelHash,
  parseFormalModel,
} from "@pathcompiler/formal-model";
import { compareText } from "@pathcompiler/source-model";
import type { EvidenceRef } from "@pathcompiler/workflow-ir";
import {
  type ConstraintProvenance,
  describeFormalExpr,
  type FormalValue,
  type ModelSummary,
  type ProductReasoner,
  type ReachabilityQuery,
  type ReasoningTrace,
} from "./index.js";

/**
 * Minimal correction sets (reasoning spec §26, §72): the fewest policy
 * constraints — fixed context values and role/flag/permission guards — whose
 * removal makes an unreachable goal reachable. Diagnostic only: the result
 * describes changes; nothing here changes a model, a permission or a flag.
 */
export type EnablementChange = {
  kind: "context" | "guard";
  /** The constraint ID in the explanation (R4) that proposed this change. */
  constraintId: string;
  description: string;
  condition: FormalExpr;
  variable?: string;
  actionId?: string;
  capabilityId?: string;
  evidence: EvidenceRef[];
  /** What the change would mean in product terms, for a human to decide. */
  suggestion: string;
};
export type MinimalEnablementResult = {
  goal: string;
  context: Record<string, FormalValue>;
  status: "already-reachable" | "enableable" | "not-enableable" | "unknown";
  /** Every correction set of the minimum size found, each with a witness. */
  corrections: { changes: EnablementChange[]; witness: ReasoningTrace }[];
  /** True when every smaller (and equally small) set was checked. */
  minimum: boolean;
  /** Why the search stopped early, when it did. */
  limit?: string;
  checked: number;
  diagnosticOnly: true;
  model: ModelSummary;
};
export type EnablementOptions = Pick<
  ReachabilityQuery,
  "maxDepth" | "timeoutMs"
> & {
  /** Largest correction set considered. Default 3. */
  maxChanges?: number;
  /** Reachability checks before giving up. Default 200. */
  maxChecks?: number;
};

type Candidate = Omit<EnablementChange, "suggestion">;
const keyOf = (item: Candidate) =>
  item.kind === "context"
    ? `context:${item.variable}`
    : `guard:${item.actionId}:${JSON.stringify(item.condition)}`;
const conjuncts = (expr: FormalExpr): FormalExpr[] =>
  expr.type === "and" ? expr.expressions.flatMap(conjuncts) : [expr];

export async function findMinimalEnablement(
  reasoner: ProductReasoner,
  input: FormalProductModel,
  query: Pick<ReachabilityQuery, "goal" | "context">,
  options: EnablementOptions = {},
): Promise<MinimalEnablementResult> {
  const model = parseFormalModel(input);
  const context = { ...(query.context ?? {}) };
  const maxChanges = options.maxChanges ?? 3;
  const maxChecks = options.maxChecks ?? 200;
  const limits = {
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  };
  const contextScope = new Set(
    model.variables
      .filter((item) => item.scope === "context")
      .map((item) => item.id),
  );
  // Only policy constraints can be corrected: context values, and action
  // preconditions that mention nothing but context (role, flag, permission).
  const relaxable = (item: ConstraintProvenance): Candidate | undefined => {
    if (item.kind === "context")
      return {
        kind: "context",
        constraintId: item.id,
        description: item.description,
        condition: item.condition,
        variable: item.variables[0] as string,
        evidence: item.evidence,
      };
    if (
      item.kind === "precondition" &&
      item.actionId &&
      item.variables.length > 0 &&
      item.variables.every((id) => contextScope.has(id))
    )
      return {
        kind: "guard",
        constraintId: item.id,
        description: item.description,
        condition: item.condition,
        actionId: item.actionId,
        ...(item.capabilityId ? { capabilityId: item.capabilityId } : {}),
        evidence: item.evidence,
      };
  };
  const apply = (set: Candidate[]) => {
    const freed = new Set(
      set
        .filter((item) => item.kind === "context")
        .map((item) => item.variable),
    );
    const dropped = new Set(
      set.filter((item) => item.kind === "guard").map(keyOf),
    );
    const relaxed = structuredClone(model);
    for (const action of relaxed.actions) {
      const kept = conjuncts(action.precondition).filter(
        (item) => !dropped.has(`guard:${action.id}:${JSON.stringify(item)}`),
      );
      action.precondition =
        kept.length === 0
          ? f.bool(true)
          : kept.length === 1
            ? (kept[0] as FormalExpr)
            : f.and(...kept);
    }
    return {
      model: relaxed,
      context: Object.fromEntries(
        Object.entries(context).filter(([id]) => !freed.has(id)),
      ),
    };
  };
  const summary: ModelSummary = {
    id: model.id,
    hash: formalModelHash(model),
    repositoryCommit: model.metadata.repositoryCommit,
    source: model.metadata.source,
  };
  const result = (
    status: MinimalEnablementResult["status"],
    rest: Partial<MinimalEnablementResult> = {},
  ): MinimalEnablementResult => ({
    goal: query.goal,
    context,
    status,
    corrections: [],
    minimum: false,
    checked,
    diagnosticOnly: true,
    model: summary,
    ...rest,
  });

  let checked = 0;
  let unknown = false;
  let limit: string | undefined;
  let found: { set: Candidate[]; witness: ReasoningTrace }[] = [];
  const seen = new Set<string>([""]);
  const queue: Candidate[][] = [[]];
  while (queue.length > 0) {
    const set = queue.shift() as Candidate[];
    if (found.length > 0 && set.length > (found[0]?.set.length ?? 0)) break;
    if (set.length > maxChanges) {
      limit = `Correction sets larger than ${maxChanges} were not searched.`;
      break;
    }
    if (checked >= maxChecks) {
      limit = `Stopped after ${maxChecks} reachability checks.`;
      break;
    }
    const relaxed = apply(set);
    checked += 1;
    const answer = await reasoner.explainUnreachable(relaxed.model, {
      goal: query.goal,
      context: relaxed.context,
      ...limits,
    });
    if (answer.status === "reachable") {
      if (set.length === 0)
        return result("already-reachable", { minimum: true, checked });
      found.push({ set, witness: answer.trace });
      continue;
    }
    if (answer.status === "unknown") {
      unknown = true;
      continue;
    }
    // Every correction set must relax at least one member of this core.
    for (const item of answer.explanation.constraints) {
      const candidate = relaxable(item);
      if (!candidate) continue;
      const next = [...set, candidate].sort((a, b) =>
        compareText(keyOf(a), keyOf(b)),
      );
      const key = next.map(keyOf).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  found = found.sort((a, b) =>
    compareText(a.set.map(keyOf).join("|"), b.set.map(keyOf).join("|")),
  );
  if (found.length === 0)
    return result(unknown || limit ? "unknown" : "not-enableable", {
      minimum: !unknown && !limit,
      ...(limit ? { limit } : {}),
    });
  return result("enableable", {
    corrections: found.map(({ set, witness }) => ({
      changes: set.map((item) => ({
        ...item,
        suggestion:
          item.kind === "context"
            ? `Run with a different ${item.variable}: the witness uses ${item.variable} = ${String(witness.context[item.variable as string])}.`
            : `Let ${item.actionId} run without requiring ${describeFormalExpr(item.condition)} (a policy decision; the guard is enforced at ${item.evidence[0]?.locator ?? "its handler"}).`,
      })),
      witness,
    })),
    // Breadth-first by size: smaller sets were all ruled out, unless the
    // solver gave up on some of them.
    minimum: !unknown,
    ...(limit ? { limit } : {}),
  });
}
