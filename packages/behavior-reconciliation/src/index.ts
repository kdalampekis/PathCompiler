import {
  type FormalProductModel,
  formalModelHash,
  normalizeFormalModel,
} from "@pathcompiler/formal-model";
import type { ProductRuntimeEvent } from "@pathcompiler/observability-core";
import {
  createProductReasoner,
  type ModelSummary,
  type ProductReasoner,
} from "@pathcompiler/reasoner-core";
import type { SolverProvider } from "@pathcompiler/solver-provider";

export * from "./drop-offs.js";
export * from "./efficiency.js";

/**
 * Possible-vs-observed reconciliation (reasoning spec §142–§144). The formal
 * model says what can happen; events say what did. Discrepancies are reported
 * with evidence and candidate causes, never labeled as bugs.
 */
export type FormalStatus = "possible" | "impossible" | "unknown";
export type ReconciliationClass =
  /** A: possible and observed. */
  | "possible-observed"
  /** B: possible, not observed in enough sessions. */
  | "possible-unobserved"
  /** C: observed although the model says it cannot happen (high priority). */
  | "unexpected-observed"
  /** D: impossible and not observed. */
  | "impossible-unobserved"
  /** Possible, not observed, but too few sessions to say anything. */
  | "insufficient-data"
  /** The solver could not decide. */
  | "unknown";
export type ReconciliationItem = {
  kind: "goal" | "target";
  /** Goal ID, or semantic target ID. */
  id: string;
  /** Observed role, or `(none)` when events carry no role (context left free). */
  role: string;
  formal: FormalStatus;
  observed: { count: number; sessions: number };
  /** Sessions observed for this role at all (the denominator for "unobserved"). */
  roleSessions: number;
  class: ReconciliationClass;
};
export type BehaviorDiscrepancy =
  | {
      type: "unexpected_observed";
      priority: "high";
      kind: "goal" | "target";
      id: string;
      role: string;
      observed: { count: number; sessions: number };
      /** Why the model says it is impossible (product sentences, from R4). */
      formalReason: string[];
      /** Candidates only; the report never decides which one is true. */
      possibleCauses: string[];
    }
  | {
      type: "unobserved_reachable";
      priority: "low";
      kind: "goal" | "target";
      id: string;
      role: string;
      roleSessions: number;
      /** A shortest way to reach it, from the model. */
      witness: string[];
      possibleExplanations: string[];
    };
export type ReconciliationReport = {
  schemaVersion: 1;
  model: ModelSummary;
  minSessions: number;
  roles: { role: string; sessions: number }[];
  items: ReconciliationItem[];
  discrepancies: BehaviorDiscrepancy[];
};
export type ReconciliationOptions = {
  /** Sessions a role needs before "not observed" means anything. Default 30. */
  minSessions?: number;
  /** Role value used when an observed role is not in the model. Default `unlisted`. */
  otherRole?: string;
  maxDepth?: number;
  timeoutMs?: number;
};

const UNEXPECTED_CAUSES = [
  "authorization or business-rule bug",
  "formal-model extraction error (a missing transition)",
  "role or context reported incorrectly",
  "event-mapping or instrumentation error",
];
const UNOBSERVED_EXPLANATIONS = [
  "hard to discover",
  "rare eligible cohort",
  "new functionality",
  "instrumentation gap",
  "formal-model over-approximation",
];
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export async function reconcileBehavior(
  input: FormalProductModel,
  events: readonly ProductRuntimeEvent[],
  solver: SolverProvider,
  options: ReconciliationOptions = {},
): Promise<ReconciliationReport> {
  const model = normalizeFormalModel(input);
  const minSessions = options.minSessions ?? 30;
  const otherRole = options.otherRole ?? "unlisted";
  const query = {
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  };
  const reasoner: ProductReasoner = createProductReasoner(solver);
  const roleVariable = model.variables.find(
    (item) => item.id === "role" && item.scope === "context",
  );
  const contextFor = (role: string): Record<string, string> => {
    if (role === "(none)" || roleVariable?.type !== "enum") return {};
    if (roleVariable.values.includes(role)) return { role };
    return roleVariable.values.includes(otherRole) ? { role: otherRole } : {};
  };

  // Observed side: sessions per role, goal and target occurrences per role.
  const sessionKey = (event: ProductRuntimeEvent) =>
    `${event.projectId}\u0000${event.sessionId}`;
  const roleSessions = new Map<string, Set<string>>();
  const seen = new Map<string, { count: number; sessions: Set<string> }>();
  const note = (key: string, session: string) => {
    const entry = seen.get(key) ?? { count: 0, sessions: new Set<string>() };
    entry.count += 1;
    entry.sessions.add(session);
    seen.set(key, entry);
  };
  for (const event of events) {
    const role = event.role ?? "(none)";
    const session = sessionKey(event);
    roleSessions.set(
      role,
      new Set([...(roleSessions.get(role) ?? []), session]),
    );
    if (event.type === "goal.reached")
      note(`goal\u0000${event.goalId}\u0000${role}`, session);
    if (event.type === "semantic_target.activated")
      note(`target\u0000${event.semanticTarget}\u0000${role}`, session);
  }
  const roles = [...roleSessions.keys()].sort(compare);
  const observed = (kind: string, id: string, role: string) => {
    const entry = seen.get(`${kind}\u0000${id}\u0000${role}`);
    return { count: entry?.count ?? 0, sessions: entry?.sessions.size ?? 0 };
  };

  const items: ReconciliationItem[] = [];
  const discrepancies: BehaviorDiscrepancy[] = [];
  const classify = (
    formal: FormalStatus,
    sessions: number,
    total: number,
  ): ReconciliationClass =>
    formal === "unknown"
      ? "unknown"
      : formal === "possible"
        ? sessions > 0
          ? "possible-observed"
          : total >= minSessions
            ? "possible-unobserved"
            : "insufficient-data"
        : sessions > 0
          ? "unexpected-observed"
          : "impossible-unobserved";

  // Goals: R2 reachability, with R4 reasons when unreachable.
  for (const goal of model.goals)
    for (const role of roles) {
      const context = contextFor(role);
      const result = await reasoner.explainUnreachable(model, {
        goal: goal.id,
        context,
        ...query,
      });
      const formal: FormalStatus =
        result.status === "reachable"
          ? "possible"
          : result.status === "unreachable"
            ? "impossible"
            : "unknown";
      const seenHere = observed("goal", goal.id, role);
      const total = roleSessions.get(role)?.size ?? 0;
      const item: ReconciliationItem = {
        kind: "goal",
        id: goal.id,
        role,
        formal,
        observed: seenHere,
        roleSessions: total,
        class: classify(formal, seenHere.sessions, total),
      };
      items.push(item);
      if (
        item.class === "unexpected-observed" &&
        result.status === "unreachable"
      )
        discrepancies.push({
          type: "unexpected_observed",
          priority: "high",
          kind: "goal",
          id: goal.id,
          role,
          observed: seenHere,
          formalReason: result.explanation.summary,
          possibleCauses: UNEXPECTED_CAUSES,
        });
      if (item.class === "possible-unobserved" && result.status === "reachable")
        discrepancies.push({
          type: "unobserved_reachable",
          priority: "low",
          kind: "goal",
          id: goal.id,
          role,
          roleSessions: total,
          witness: result.trace.actions.map((step) => step.actionId),
          possibleExplanations: UNOBSERVED_EXPLANATIONS,
        });
    }

  // Targets: possible when any action on that target can become enabled (R8).
  const targets = new Map<string, typeof model.actions>();
  for (const action of model.actions)
    if (action.semanticTarget)
      targets.set(action.semanticTarget, [
        ...(targets.get(action.semanticTarget) ?? []),
        action,
      ]);
  for (const [target, actions] of [...targets].sort(([a], [b]) =>
    compare(a, b),
  ))
    for (const role of roles) {
      const context = contextFor(role);
      let formal: FormalStatus = "impossible";
      let witness: string[] = [];
      const reasons: string[] = [];
      for (const action of actions) {
        const result = await reasoner.verifyProperty(
          model,
          {
            kind: "never",
            id: "reconcile.enabled",
            description: `${action.id} can be performed`,
            condition: action.precondition,
            context,
          },
          query,
        );
        if (result.status === "violated") {
          formal = "possible";
          // The counterexample reaches a state where the action is enabled.
          witness = [
            ...result.counterexample.actions.map((step) => step.actionId),
            action.id,
          ];
          break;
        }
        if (result.status === "unknown") formal = "unknown";
        else reasons.push(`${action.id} can never be enabled here`);
      }
      const seenHere = observed("target", target, role);
      const total = roleSessions.get(role)?.size ?? 0;
      const item: ReconciliationItem = {
        kind: "target",
        id: target,
        role,
        formal,
        observed: seenHere,
        roleSessions: total,
        class: classify(formal, seenHere.sessions, total),
      };
      items.push(item);
      if (item.class === "unexpected-observed")
        discrepancies.push({
          type: "unexpected_observed",
          priority: "high",
          kind: "target",
          id: target,
          role,
          observed: seenHere,
          formalReason: reasons,
          possibleCauses: UNEXPECTED_CAUSES,
        });
      if (item.class === "possible-unobserved")
        discrepancies.push({
          type: "unobserved_reachable",
          priority: "low",
          kind: "target",
          id: target,
          role,
          roleSessions: total,
          witness,
          possibleExplanations: UNOBSERVED_EXPLANATIONS,
        });
    }

  return {
    schemaVersion: 1,
    model: {
      id: model.id,
      hash: formalModelHash(model),
      repositoryCommit: model.metadata.repositoryCommit,
      source: model.metadata.source,
    },
    minSessions,
    roles: roles.map((role) => ({
      role,
      sessions: roleSessions.get(role)?.size ?? 0,
    })),
    items,
    discrepancies: discrepancies.sort(
      (a, b) =>
        (a.priority === b.priority ? 0 : a.priority === "high" ? -1 : 1) ||
        compare(a.kind, b.kind) ||
        compare(a.id, b.id) ||
        compare(a.role, b.role),
    ),
  };
}
