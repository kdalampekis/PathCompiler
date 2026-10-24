import {
  type FormalProductModel,
  formalModelHash,
  parseFormalModel,
} from "@pathcompiler/formal-model";
import { compareText } from "@pathcompiler/source-model";
import type { EvidenceRef } from "@pathcompiler/workflow-ir";
import type {
  ConstraintProvenance,
  ModelSummary,
  ProductReasoner,
  ReachabilityQuery,
} from "./index.js";

/**
 * Dead features and missing transitions (reasoning spec §34–§35). Findings
 * are candidates for review with possible causes; the report never decides
 * whether the product or the model is wrong.
 */
export type DeadFeatureFinding =
  | {
      kind: "unreachable-capability";
      capabilityId: string;
      goal: string;
      /** R4 constraints proving no context reaches the goal. */
      constraints: ConstraintProvenance[];
      possibleCauses: string[];
    }
  | {
      kind: "dead-action";
      actionId: string;
      capabilityId?: string;
      semanticTarget?: string;
      possibleCauses: string[];
      evidence: EvidenceRef[];
    }
  | {
      kind: "missing-transition";
      capabilityId: string;
      /** UI and API evidence that says the capability exists. */
      uiEvidence: string[];
      apiEvidence: string[];
      possibleCauses: string[];
    }
  | { kind: "unknown"; subject: string; reason: string };
export type DeadFeatureReport = {
  schemaVersion: 1;
  model: ModelSummary;
  meaning: "candidate";
  checked: { goals: number; actions: number; capabilities: number };
  findings: DeadFeatureFinding[];
};
/** What the static analysis knows about a capability, independent of the model. */
export type CapabilityEvidence = {
  id: string;
  uiEvidence: string[];
  apiEvidence: string[];
};

const UNREACHABLE_CAUSES = {
  role: "impossible permission combination",
  flag: "stale feature flag",
  state: "dead code, broken routing or orphaned UI",
  model: "incomplete model extraction",
};
const MISSING_CAUSES = [
  "analysis missing an edge (a test or handler the extraction did not connect)",
  "product wiring bug (the control does not reach its handler)",
];

export async function detectDeadFeatures(
  reasoner: ProductReasoner,
  input: FormalProductModel,
  options: Pick<ReachabilityQuery, "maxDepth" | "timeoutMs"> & {
    /** Capabilities from static analysis; those without a goal are checked for missing transitions. */
    capabilities?: CapabilityEvidence[];
  } = {},
): Promise<DeadFeatureReport> {
  const model = parseFormalModel(input);
  const limits = {
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  };
  const context = new Map(
    model.variables
      .filter((item) => item.scope === "context")
      .map((item) => [item.id, item]),
  );
  const findings: DeadFeatureFinding[] = [];

  // §34: every capability goal, with the context left free.
  const goals = model.goals
    .filter((goal) => goal.capabilityId)
    .sort((a, b) => compareText(a.id, b.id));
  for (const goal of goals) {
    const result = await reasoner.explainUnreachable(model, {
      goal: goal.id,
      ...limits,
    });
    if (result.status === "unknown") {
      findings.push({
        kind: "unknown",
        subject: goal.id,
        reason: result.reason,
      });
      continue;
    }
    if (result.status !== "unreachable") continue;
    const causes = new Set<string>();
    for (const item of result.explanation.constraints) {
      const contextual = item.variables.filter((id) => context.has(id));
      for (const id of contextual)
        causes.add(
          context.get(id)?.type === "boolean"
            ? UNREACHABLE_CAUSES.flag
            : UNREACHABLE_CAUSES.role,
        );
      if (contextual.length < item.variables.length || item.kind === "initial")
        causes.add(UNREACHABLE_CAUSES.state);
    }
    causes.add(UNREACHABLE_CAUSES.model);
    findings.push({
      kind: "unreachable-capability",
      capabilityId: goal.capabilityId as string,
      goal: goal.id,
      constraints: result.explanation.constraints,
      possibleCauses: [...causes],
    });
  }

  // Actions on product controls that can never be enabled.
  const actions = model.actions
    .filter((action) => action.capabilityId)
    .sort((a, b) => compareText(a.id, b.id));
  for (const action of actions) {
    const result = await reasoner.verifyProperty(
      model,
      {
        kind: "never",
        id: "dead_features.enabled",
        description: `${action.id} can be performed`,
        condition: action.precondition,
      },
      limits,
    );
    if (result.status === "unknown") {
      findings.push({
        kind: "unknown",
        subject: action.id,
        reason: result.reason,
      });
      continue;
    }
    if (result.status !== "holds") continue;
    findings.push({
      kind: "dead-action",
      actionId: action.id,
      ...(action.capabilityId ? { capabilityId: action.capabilityId } : {}),
      ...(action.semanticTarget
        ? { semanticTarget: action.semanticTarget }
        : {}),
      possibleCauses: [
        "its guard can never hold in any reachable state",
        UNREACHABLE_CAUSES.model,
      ],
      evidence: action.evidence ?? [],
    });
  }

  // §35: the code says a capability exists, the model has no way to do it.
  const modeled = new Set(goals.map((goal) => goal.capabilityId));
  const capabilities = [...(options.capabilities ?? [])].sort((a, b) =>
    compareText(a.id, b.id),
  );
  for (const capability of capabilities)
    if (
      !modeled.has(capability.id) &&
      capability.uiEvidence.length > 0 &&
      capability.apiEvidence.length > 0
    )
      findings.push({
        kind: "missing-transition",
        capabilityId: capability.id,
        uiEvidence: [...capability.uiEvidence].sort(compareText),
        apiEvidence: [...capability.apiEvidence].sort(compareText),
        possibleCauses: MISSING_CAUSES,
      });

  return {
    schemaVersion: 1,
    model: {
      id: model.id,
      hash: formalModelHash(model),
      repositoryCommit: model.metadata.repositoryCommit,
      source: model.metadata.source,
    },
    meaning: "candidate",
    checked: {
      goals: goals.length,
      actions: actions.length,
      capabilities: capabilities.length,
    },
    findings,
  };
}
