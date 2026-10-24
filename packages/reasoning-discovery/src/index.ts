import {
  type CapabilityDiscoveryReport,
  CapabilityDiscoveryReportSchema,
} from "@pathcompiler/capability-engine";
import {
  type AbstractionUncertainty,
  buildFormalModel,
  type ModelCoverage,
} from "@pathcompiler/formal-abstraction";
import {
  type FormalProductModel,
  formalModelHash,
} from "@pathcompiler/formal-model";
import type { ProductGraph } from "@pathcompiler/graph-core";
import {
  createProductReasoner,
  type ModelSummary,
  type PlanStep,
  type ReachabilityQuery,
} from "@pathcompiler/reasoner-core";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import {
  type TestAssertion,
  type TestTraceReport,
  TestTraceReportSchema,
} from "@pathcompiler/test-miner-playwright";
import {
  type EvidenceRef,
  type WorkflowCondition,
  type WorkflowStep,
  type WorkflowV1,
  WorkflowV1Schema,
} from "@pathcompiler/workflow-ir";

/**
 * Reasoning-assisted workflow discovery (reasoning spec §23, §125):
 * Product Graph → formal abstraction → shortest plan → feasible trace →
 * workflow candidate. An alternative to test-backed discovery, compared
 * against it by the evaluation harness; never the default.
 */
export const REASONING_DISCOVERY_VERSION = "reasoning-discovery-rwi";

export type ReasoningCandidate = {
  capabilityId: string;
  goal: string;
  workflow: WorkflowV1;
  /** Shortest feasible plan the steps come from, including navigation. */
  plan: {
    actions: string[];
    context: Record<string, boolean | number | string>;
  };
  /** Steps of other capabilities the plan needs first (prerequisites). */
  prerequisiteCapabilities: string[];
  /** Why a reviewer must look closely: terminal not derived, applicability unknown. */
  ambiguities: { code: string; message: string }[];
  reviewRequired: true;
};
export type ReasoningDiscoveryReport = {
  schemaVersion: 1;
  strategy: "reasoning";
  version: typeof REASONING_DISCOVERY_VERSION;
  model: ModelSummary;
  coverage: ModelCoverage;
  uncertainties: AbstractionUncertainty[];
  candidates: ReasoningCandidate[];
  skipped: { capabilityId: string; goal?: string; reason: string }[];
};
export type ReasoningDiscoveryOptions = Pick<
  ReachabilityQuery,
  "maxDepth" | "timeoutMs"
>;

const OUTSIDE_ROLE = "unlisted";
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export async function discoverWorkflowsByReasoning(
  graph: ProductGraph,
  inputCapabilities: CapabilityDiscoveryReport,
  inputTraces: TestTraceReport,
  solver: SolverProvider,
  options: ReasoningDiscoveryOptions = {},
): Promise<ReasoningDiscoveryReport> {
  const capabilities = CapabilityDiscoveryReportSchema.parse(inputCapabilities);
  const traces = TestTraceReportSchema.parse(inputTraces);
  const commit = traces.repository.commit ?? "uncommitted";
  const abstraction = buildFormalModel(graph, capabilities, traces);
  const model: FormalProductModel = abstraction.model;
  const reasoner = createProductReasoner(solver);
  const query = {
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  };
  const roleVariable = model.variables.find(
    (item) => item.id === "role" && item.scope === "context",
  );
  const flagVariables = model.variables.filter(
    (item) => item.scope === "context" && item.type === "boolean",
  );
  const candidates: ReasoningCandidate[] = [];
  const skipped: ReasoningDiscoveryReport["skipped"] = [];

  for (const capability of [...capabilities.capabilities].sort((a, b) =>
    compare(a.id, b.id),
  )) {
    const goal = model.goals.find(
      (item) => item.capabilityId === capability.id,
    );
    if (!goal) {
      skipped.push({
        capabilityId: capability.id,
        reason: "The formal model has no goal for this capability.",
      });
      continue;
    }
    const result = await reasoner.findPlan(model, { goal: goal.id, ...query });
    if (result.status !== "found") {
      skipped.push({
        capabilityId: capability.id,
        goal: goal.id,
        reason:
          result.status === "impossible"
            ? `No plan reaches ${goal.id} in the model (proved by k-induction at depth ${result.proof.depth}).`
            : `Planning was inconclusive (${result.reason}): ${result.detail}`,
      });
      continue;
    }
    const entrypoints = capability.routeIds
      .flatMap((id) => {
        const route = graph.getNode(id)?.data?.path;
        return typeof route === "string" ? [route] : [];
      })
      .sort(compare);
    const own = result.plan.steps.filter(
      (step) => step.capabilityId === capability.id && step.semanticTarget,
    );
    if (entrypoints.length === 0 || own.length === 0) {
      skipped.push({
        capabilityId: capability.id,
        goal: goal.id,
        reason:
          entrypoints.length === 0
            ? "The capability has no page route to start from."
            : "The plan has no step on this capability's targets.",
      });
      continue;
    }
    const ambiguities: ReasoningCandidate["ambiguities"] = [];

    // Steps: one per planned capability action; repeated targets (two select
    // values on one selector) collapse into one step.
    const steps: WorkflowStep[] = [];
    for (const step of own) {
      const target = step.semanticTarget as string;
      if (steps.at(-1)?.target === target) continue;
      steps.push(workflowStep(graph, step, target, steps.length + 1, commit));
    }
    for (const [index, step] of steps.entries()) {
      const next = steps[index + 1];
      if (next) step.next = next.id;
    }

    // Applicability: which roles can reach the goal, which flags it needs.
    const roles: string[] = [];
    if (roleVariable?.type === "enum")
      for (const role of roleVariable.values.filter(
        (value) => value !== OUTSIDE_ROLE,
      )) {
        const reach = await reasoner.checkReachability(model, {
          goal: goal.id,
          context: { role },
          ...query,
        });
        if (reach.status === "reachable") roles.push(role);
        if (reach.status === "unknown")
          ambiguities.push({
            code: "applicability-unknown",
            message: `Whether role ${role} can reach ${goal.id} is unknown (${reach.reason}).`,
          });
      }
    const preconditions: WorkflowCondition[] = [];
    for (const variable of flagVariables) {
      const off = await reasoner.checkReachability(model, {
        goal: goal.id,
        context: { [variable.id]: false },
        ...query,
      });
      const flag = variable.evidence
        ?.find((ref) => ref.id.startsWith("flag:"))
        ?.id.slice("flag:".length);
      if (off.status === "unreachable" && flag)
        preconditions.push({ type: "feature_flag", flag, enabled: true });
      if (off.status === "unknown")
        ambiguities.push({
          code: "applicability-unknown",
          message: `Whether ${goal.id} needs ${variable.id} is unknown (${off.reason}).`,
        });
    }

    const terminal = traceTerminal(
      graph,
      traces,
      steps[0]?.target as string,
      steps.at(-1)?.target as string,
    );
    if (!terminal)
      ambiguities.push({
        code: "terminal-not-derived",
        message:
          "No test assertion follows this path's last step on a feedback element, so completion is confirmed by the user (explicit next).",
      });
    const evidence = dedupe([
      ...steps.flatMap((step) => step.evidence),
      ...(goal.evidence ?? []),
    ]);
    const prerequisites = [
      ...new Set(
        result.plan.steps.flatMap((step) =>
          step.capabilityId && step.capabilityId !== capability.id
            ? [step.capabilityId]
            : [],
        ),
      ),
    ].sort(compare);
    candidates.push({
      capabilityId: capability.id,
      goal: goal.id,
      workflow: WorkflowV1Schema.parse({
        schemaVersion: 1,
        id: capability.id,
        title: capability.title,
        domain: capability.domain,
        intent: {
          action: capability.verb,
          entity: capability.entity,
          ...(capability.qualifier
            ? { qualifiers: [capability.qualifier] }
            : {}),
        },
        ...(roleVariable?.type === "enum" ? { roles } : {}),
        entrypoints: entrypoints.map((route) => ({ route })),
        ...(preconditions.length > 0 ? { preconditions } : {}),
        steps,
        terminal: terminal ?? { type: "explicit_next" },
        provenance: { evidence },
        repository: { commit },
        confidence: {
          overall: Math.min(capability.confidence, terminal ? 0.7 : 0.5),
          dimensions: { plan: 0.7, terminal: terminal ? 0.7 : 0.3 },
        },
        status: "candidate",
      }),
      plan: {
        actions: result.plan.steps.map((step) => step.actionId),
        context: result.plan.context,
      },
      prerequisiteCapabilities: prerequisites,
      ambiguities,
      reviewRequired: true,
    });
  }

  return {
    schemaVersion: 1,
    strategy: "reasoning",
    version: REASONING_DISCOVERY_VERSION,
    model: {
      id: model.id,
      hash: formalModelHash(model),
      repositoryCommit: model.metadata.repositoryCommit,
      source: model.metadata.source,
    },
    coverage: abstraction.coverage,
    uncertainties: abstraction.uncertainties,
    candidates,
    skipped,
  };
}

function dedupe(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Map(refs.map((ref) => [ref.id, ref]));
  return [...seen.values()].sort((a, b) => compare(a.id, b.id));
}

function workflowStep(
  graph: ProductGraph,
  step: PlanStep,
  target: string,
  index: number,
  commit: string,
): WorkflowStep {
  const node = graph.getNode(`ui:${target}`);
  const label =
    typeof node?.data?.label === "string" ? node.data.label : target;
  const type =
    node?.data?.tag === "select"
      ? "select"
      : node?.data?.kind === "input"
        ? "input"
        : "click";
  const location = Array.isArray(node?.data?.evidence)
    ? (node.data.evidence[0] as { locator?: unknown } | undefined)?.locator
    : undefined;
  const evidence =
    step.evidence.length > 0
      ? step.evidence
      : node && typeof location === "string"
        ? [
            {
              id: node.id,
              type: "symbol" as const,
              locator: location,
              repositoryCommit: commit,
            },
          ]
        : [];
  if (evidence.length === 0)
    throw new Error(`Planned action ${step.actionId} has no evidence.`);
  return {
    id: `step.${index}`,
    target,
    action: { type },
    instruction: {
      text: `${type === "select" ? "Select" : type === "input" ? "Enter" : "Click"} ${label}`,
    },
    evidence: dedupe(evidence),
  };
}

/**
 * The completion signal tests check right after this path: in a trace that
 * activates the first target and later the last one, the first positive text
 * assertion on a single feedback element before the next UI action.
 * Traces are tried in ID order, so the result is deterministic.
 */
function traceTerminal(
  graph: ProductGraph,
  traces: TestTraceReport,
  first: string,
  last: string,
): WorkflowCondition | undefined {
  for (const trace of [...traces.traces].sort((a, b) => compare(a.id, b.id))) {
    const events = [
      ...trace.actions.map((item) => ({ kind: "action" as const, item })),
      ...trace.assertions.map((item) => ({ kind: "assertion" as const, item })),
    ]
      .filter((event) => event.item.phase === "test" && !event.item.conditional)
      .sort((a, b) => a.item.order - b.item.order);
    const hits = (index: number, target: string) => {
      const event = events[index];
      return (
        event?.kind === "action" &&
        event.item.target?.graphNodeIds.includes(`ui:${target}`) === true
      );
    };
    // Every activation of the last target until the path starts again: tests
    // often submit invalid input first and see a validation alert.
    for (const [start] of events.entries()) {
      if (!hits(start, first)) continue;
      for (let end = start + 1; end < events.length; end += 1) {
        if (hits(end, first)) break;
        if (!hits(end, last)) continue;
        for (const event of events.slice(end + 1)) {
          if (event.kind === "action" && event.item.kind === "ui") break;
          if (event.kind !== "assertion") continue;
          const condition = feedback(graph, event.item);
          if (condition) return condition;
        }
      }
    }
  }
}

function feedback(
  graph: ProductGraph,
  assertion: TestAssertion,
): WorkflowCondition | undefined {
  const expected =
    assertion.expected.kind === "literal"
      ? assertion.expected.value
      : undefined;
  const ids = assertion.target?.graphNodeIds ?? [];
  if (
    assertion.negated ||
    assertion.soft ||
    !["toHaveText", "toContainText"].includes(assertion.matcher) ||
    typeof expected !== "string" ||
    !expected.trim() ||
    ids.length !== 1
  )
    return;
  const node = graph.getNode(ids[0] as string);
  const semanticId = (
    node?.data?.target as { semanticId?: unknown } | undefined
  )?.semanticId;
  if (node?.data?.kind !== "observe" || typeof semanticId !== "string") return;
  return {
    type: "element_text",
    target: semanticId,
    text: expected,
    match: assertion.matcher === "toHaveText" ? "exact" : "contains",
  };
}
