import type { ActionDecision, ActionGate, ActionRequest } from "./gate.js";

/**
 * Replays recorded actions through the gate: which actions that already
 * happened would the specification have blocked? This is the OBSERVED but not
 * ALLOWED comparison — violations that occurred, found from a log instead of
 * a change. It judges the actions by the rules as they are now, so a rule
 * added later flags older actions too, and it needs the log to carry the
 * values the rules read (inputs, acting context, the relevant state).
 */
export type RecordedAction = ActionRequest & {
  /** The log's own identifier for the action, echoed in findings. */
  id?: string;
  at?: string;
};
export type AuditFinding = {
  /** Position in the log, from 1. */
  index: number;
  id?: string;
  at?: string;
  operation: string;
  summary: string;
  /** Violated rules by ID (or text when a rule has none). */
  rules: string[];
};
export type AuditReport = {
  total: number;
  /** Actions no rule is violated by. */
  clean: number;
  /** Actions that violate at least one rule. */
  violating: number;
  /** Actions the gate could not judge for lack of values in the log. */
  unresolved: number;
  /** Values the log lacked, most often first. */
  missingValues: { id: string; actions: number }[];
  /** How many violating actions break each rule. */
  byRule: { rule: string; actions: number }[];
  findings: AuditFinding[];
};

const count = (items: string[]) => {
  const tally = new Map<string, number>();
  for (const item of items) tally.set(item, (tally.get(item) ?? 0) + 1);
  return [...tally]
    .map(([key, actions]) => ({ key, actions }))
    .sort((a, b) => b.actions - a.actions || (a.key < b.key ? -1 : 1));
};

export function auditActions(
  gate: ActionGate,
  actions: readonly RecordedAction[],
): AuditReport {
  const findings: AuditFinding[] = [];
  const missing: string[] = [];
  const rules: string[] = [];
  let unresolved = 0;
  for (const [position, action] of actions.entries()) {
    const { id, at, ...request } = action;
    const decision: ActionDecision = gate.check(request);
    const broken = decision.violations
      .filter((item) => item.enforced)
      .map((item) => item.id ?? item.rule);
    if (broken.length > 0) {
      findings.push({
        index: position + 1,
        ...(id ? { id } : {}),
        ...(at ? { at } : {}),
        operation: action.operation,
        summary: decision.summary,
        rules: broken,
      });
      rules.push(...new Set(broken));
    } else if (decision.status === "UNKNOWN") {
      unresolved += 1;
      missing.push(
        ...new Set(decision.unresolved.flatMap((item) => item.missing)),
      );
    }
  }
  return {
    total: actions.length,
    clean: actions.length - findings.length - unresolved,
    violating: findings.length,
    unresolved,
    missingValues: count(missing).map(({ key, actions: n }) => ({
      id: key,
      actions: n,
    })),
    byRule: count(rules).map(({ key, actions: n }) => ({
      rule: key,
      actions: n,
    })),
    findings,
  };
}
