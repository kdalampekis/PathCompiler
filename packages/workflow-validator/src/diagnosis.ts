import type {
  FormalExpr,
  FormalProductModel,
} from "@pathcompiler/formal-model";
import {
  type ConfidenceAssessment,
  type EvidenceItem,
  fuseEvidence,
} from "@pathcompiler/probabilistic-evidence";
import {
  type BrowserVerificationReportV2,
  BrowserVerificationReportV2Schema,
} from "./browser-report.js";

/**
 * Browser failure diagnosis, P3 (reasoning spec §54). Each candidate cause is
 * a binary claim; deterministic signals become evidence items for or against
 * it, P0 fusion assesses each claim, and the causes are ranked. A diagnosis is
 * a hypothesis for a developer, never a verdict.
 */
export const FAILURE_CAUSES = [
  "stale-target",
  "permission-mismatch",
  "flag-mismatch",
  "backend-changed",
  "formal-model-wrong",
  "network-issue",
] as const;
export type FailureCause = (typeof FAILURE_CAUSES)[number];
export type DiagnosisInput = {
  report: BrowserVerificationReportV2;
  /** Semantic targets in the candidate's current source analysis. */
  sourceTargets?: readonly string[];
  /** The formal product model of the candidate (R1). */
  model?: FormalProductModel;
  /** Context the run used: role and flags, by formal context variable ID. */
  context?: Readonly<Record<string, string | boolean>>;
  /** Endpoints changed between the approved commit and the candidate; omit when unknown. */
  changedEndpoints?: readonly string[];
};
export type DiagnosedCause = {
  cause: FailureCause;
  rank: number;
  assessment: ConfidenceAssessment;
  evidence: EvidenceItem[];
};
export type FailureDiagnosis = {
  schemaVersion: 1;
  meaning: "hypothesis";
  workflowId: string | null;
  failure: BrowserVerificationReportV2["failure"] | null;
  /** The best-supported cause; null when nothing failed or nothing is supported. */
  top: FailureCause | null;
  causes: DiagnosedCause[];
};

const NETWORK =
  /net::ERR_|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED/i;
const BAND = { high: 3, medium: 2, low: 1 } as const;

type Guard = { roles: Set<string> | null; flags: Map<string, boolean> };
/** Context requirements in an action precondition: allowed roles and required flag values. */
function guardOf(
  expression: FormalExpr,
  model: FormalProductModel,
  guard: Guard = { roles: null, flags: new Map() },
): Guard {
  const context = new Map(
    model.variables
      .filter((variable) => variable.scope === "context")
      .map((variable) => [variable.id, variable]),
  );
  const roleValue = (item: FormalExpr): string | undefined =>
    item.type === "eq" &&
    item.left.type === "var" &&
    context.get(item.left.id)?.type === "enum" &&
    item.left.id === "role" &&
    item.right.type === "const"
      ? String(item.right.value)
      : undefined;
  const flag = (item: FormalExpr): [string, boolean] | undefined =>
    item.type === "var" && context.get(item.id)?.type === "boolean"
      ? [item.id, true]
      : item.type === "not" &&
          item.expr.type === "var" &&
          context.get(item.expr.id)?.type === "boolean"
        ? [item.expr.id, false]
        : undefined;
  const atoms =
    expression.type === "and" ? expression.expressions : [expression];
  for (const atom of atoms) {
    const role = roleValue(atom);
    const roles =
      role !== undefined
        ? [role]
        : atom.type === "or" &&
            atom.expressions.every((item) => roleValue(item))
          ? atom.expressions.map((item) => roleValue(item) as string)
          : undefined;
    if (roles)
      guard.roles = new Set(
        guard.roles ? roles.filter((item) => guard.roles?.has(item)) : roles,
      );
    const required = flag(atom);
    if (required) guard.flags.set(required[0], required[1]);
  }
  return guard;
}

export function diagnoseBrowserFailure(
  input: DiagnosisInput,
): FailureDiagnosis {
  const report = BrowserVerificationReportV2Schema.parse(input.report);
  const failure = report.failure ?? null;
  if (report.valid || !failure)
    return {
      schemaVersion: 1,
      meaning: "hypothesis",
      workflowId: report.workflowId,
      failure: null,
      top: null,
      causes: [],
    };
  const items = new Map<FailureCause, EvidenceItem[]>(
    FAILURE_CAUSES.map((cause) => [cause, []]),
  );
  const add = (
    cause: FailureCause,
    id: string,
    evidenceClass: EvidenceItem["class"],
    stance: "supports" | "contradicts",
    summary: string,
  ) =>
    items.get(cause)?.push({
      id: `${cause}:${id}`,
      class: evidenceClass,
      stance,
      current: true,
      summary,
    });
  const target = failure.target;
  const networkLike =
    failure.code === "origin-unavailable" || NETWORK.test(failure.message);
  const resolveFailed =
    failure.code === "target-not-found" || failure.code === "ambiguous-target";
  // The control was missing or could not be used: something blocked the user.
  const blocked =
    !networkLike && (resolveFailed || (failure.stage === "action" && !!target));
  const outcomeFailed =
    !networkLike &&
    (failure.stage === "expected" || failure.stage === "terminal");
  const reached = report.steps.some((step) => step.status === "passed");

  // Network: the origin did not answer, or the browser reported a transport error.
  if (networkLike)
    add("network-issue", "transport", "browser", "supports", failure.message);
  else if (reached || failure.stage !== "open")
    add(
      "network-issue",
      "responded",
      "browser",
      "contradicts",
      "The application responded; the failure is not in transport.",
    );

  // Stale target: the browser could not find it; is it still in the source?
  if (resolveFailed)
    add(
      "stale-target",
      "resolve",
      "browser",
      "supports",
      `${target} was ${failure.code === "ambiguous-target" ? "ambiguous" : "not found"} in the page.`,
    );
  else if (blocked || outcomeFailed)
    add(
      "stale-target",
      "resolved",
      "browser",
      "contradicts",
      "Every target the run reached resolved in the page.",
    );
  if (target && input.sourceTargets) {
    const present = input.sourceTargets.includes(target);
    add(
      "stale-target",
      "source",
      "static",
      present ? "contradicts" : "supports",
      present
        ? `${target} is still in the current source.`
        : `${target} is not in the current source: the workflow refers to a removed or renamed target.`,
    );
  }

  // Context guards on the failing target, from the formal model.
  const actions =
    target && input.model
      ? input.model.actions.filter((action) => action.semanticTarget === target)
      : [];
  const guards = actions.map((action) =>
    guardOf(action.precondition, input.model as FormalProductModel),
  );
  const role = input.context?.role;
  const roleBlocks =
    guards.length > 0 && typeof role === "string"
      ? guards.every((guard) => guard.roles !== null && !guard.roles.has(role))
      : undefined;
  const flagBlocks =
    guards.length > 0 && input.context
      ? guards.every((guard) =>
          [...guard.flags].some(
            ([flag, value]) =>
              typeof input.context?.[flag] === "boolean" &&
              input.context[flag] !== value,
          ),
        )
      : undefined;
  for (const [cause, blocks, what] of [
    ["permission-mismatch", roleBlocks, `role ${role}`],
    ["flag-mismatch", flagBlocks, "the run's feature flags"],
  ] as const) {
    if (blocked)
      add(
        cause,
        "blocked",
        "browser",
        "supports",
        `${target} could not be used in the page.`,
      );
    else
      add(
        cause,
        "not-blocked",
        "browser",
        "contradicts",
        "No control was blocked; the failure came later or elsewhere.",
      );
    if (blocks !== undefined)
      add(
        cause,
        "guard",
        "formal",
        blocks ? "supports" : "contradicts",
        blocks
          ? `The formal model requires a context ${what} does not provide for ${target}.`
          : `The formal model allows ${target} with ${what}.`,
      );
  }

  // Backend: the UI accepted every action but the outcome never appeared.
  if (outcomeFailed)
    add(
      "backend-changed",
      "outcome",
      "browser",
      "supports",
      "Every action succeeded but the expected outcome did not appear.",
    );
  else
    add(
      "backend-changed",
      "early",
      "browser",
      "contradicts",
      "The run failed before any backend outcome was checked.",
    );
  if (input.changedEndpoints)
    add(
      "backend-changed",
      "endpoints",
      "static",
      input.changedEndpoints.length ? "supports" : "contradicts",
      input.changedEndpoints.length
        ? `Changed endpoints: ${input.changedEndpoints.join(", ")}.`
        : "No endpoint changed since the approved commit.",
    );

  // Formal model wrong: it predicted success where the browser failed, and
  // nothing else explains the failure.
  const predictedOk =
    actions.length > 0 && roleBlocks === false && flagBlocks === false;
  if (blocked || outcomeFailed)
    add(
      "formal-model-wrong",
      "failed",
      "browser",
      "supports",
      "The browser contradicts the workflow the model allowed.",
    );
  else
    add(
      "formal-model-wrong",
      "transport",
      "browser",
      "contradicts",
      "The failure is not in product behavior.",
    );
  if (blocked && target && input.model)
    add(
      "formal-model-wrong",
      "prediction",
      "formal",
      predictedOk ? "supports" : "contradicts",
      predictedOk
        ? `The formal model allows ${target} in this context, but the page blocked it.`
        : `The formal model does not predict ${target} to work in this context.`,
    );
  if (outcomeFailed && input.changedEndpoints?.length === 0)
    add(
      "formal-model-wrong",
      "no-backend-change",
      "static",
      "supports",
      "No endpoint changed, so the expected outcome itself may be modeled wrong.",
    );
  if (target && input.sourceTargets && !input.sourceTargets.includes(target))
    add(
      "formal-model-wrong",
      "stale",
      "static",
      "contradicts",
      `${target} is gone from the source; a stale workflow explains the failure.`,
    );

  const assessed = FAILURE_CAUSES.map((cause) => {
    const evidence = items.get(cause) ?? [];
    return {
      cause,
      evidence,
      assessment: fuseEvidence(
        {
          id: `diagnosis:${cause}`,
          type: "behavior",
          subject: report.workflowId ?? "workflow",
          statement: `${cause} explains the browser failure`,
        },
        evidence,
      ),
    };
  });
  const order = (entry: (typeof assessed)[number]) => [
    entry.assessment.status === "supported" ? 1 : 0,
    BAND[entry.assessment.confidence.band],
    entry.assessment.decidingTier ?? 0,
    entry.evidence.filter((item) => item.stance === "supports").length -
      entry.evidence.filter((item) => item.stance === "contradicts").length,
  ];
  const ranked = [...assessed].sort((a, b) => {
    const left = order(a);
    const right = order(b);
    for (let index = 0; index < left.length; index += 1)
      if ((right[index] ?? 0) !== (left[index] ?? 0))
        return (right[index] ?? 0) - (left[index] ?? 0);
    // Equal evidence: the spec's order (§54).
    return FAILURE_CAUSES.indexOf(a.cause) - FAILURE_CAUSES.indexOf(b.cause);
  });
  const causes = ranked.map((entry, index) => ({ ...entry, rank: index + 1 }));
  const first = causes[0];
  return {
    schemaVersion: 1,
    meaning: "hypothesis",
    workflowId: report.workflowId,
    failure,
    top: first && first.assessment.status === "supported" ? first.cause : null,
    causes,
  };
}
