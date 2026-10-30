import { createHash } from "node:crypto";
import type { Literal } from "@pathcompiler/behavior-ir";
import type { Counterexample, RuleBasis } from "@pathcompiler/verification";

/**
 * A counterexample worth keeping: a concrete action, in a concrete state, that
 * breaks a rule. It is what turns a one-off finding into a regression test.
 */
export type CounterexampleTrigger =
  | "pr_guard"
  | "verification"
  | "agent_gate"
  | "manual";
export type CounterexampleRecord = {
  schemaVersion: 1;
  /** Content hash of the rule, operation and values: the same finding has the same ID. */
  id: string;
  rule: Pick<RuleBasis, "id" | "kind" | "text" | "humanBacked" | "confidence">;
  trigger: CounterexampleTrigger;
  operation: string;
  /** What was asked: parameters and acting context. */
  action: {
    inputs: Record<string, Literal>;
    context: Record<string, Literal>;
  };
  state: Record<string, Literal>;
  /** The state the action would have produced, when it was computed. */
  after?: Record<string, Literal>;
  /** The variables that matter to this violation, when known. */
  relevant?: string[];
  /** What is wrong, in words. */
  violation: string;
  /** The commit the problem was observed at. */
  commit: string | null;
  /** Hash of the specification it was found against. */
  specHash: string | null;
  observedAt: string;
  status: "open" | "fixed";
  fixedAt?: string;
  fixedBy?: string;
};

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
};

export function counterexampleId(input: {
  rule: string;
  operation: string;
  inputs: Record<string, Literal>;
  context: Record<string, Literal>;
  state: Record<string, Literal>;
}): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(canonical(input)))
    .digest("hex");
  return `cx-${hash.slice(0, 12)}`;
}

export type RecordInput = {
  rule: RuleBasis;
  counterexample: Counterexample;
  trigger: CounterexampleTrigger;
  commit?: string | null;
  specHash?: string | null;
  /** Injected so records are reproducible in tests. */
  now: string;
  violation?: string;
};

export function createRecord(input: RecordInput): CounterexampleRecord {
  const { counterexample: cex } = input;
  return {
    schemaVersion: 1,
    id: counterexampleId({
      rule: input.rule.id,
      operation: cex.operation,
      inputs: cex.inputs,
      context: cex.context,
      state: cex.state,
    }),
    rule: {
      id: input.rule.id,
      kind: input.rule.kind,
      text: input.rule.text,
      humanBacked: input.rule.humanBacked,
      confidence: input.rule.confidence,
    },
    trigger: input.trigger,
    operation: cex.operation,
    action: { inputs: cex.inputs, context: cex.context },
    state: cex.state,
    ...(cex.after ? { after: cex.after } : {}),
    ...(cex.relevant ? { relevant: cex.relevant } : {}),
    violation: input.violation ?? `${cex.operation} violates ${cex.violated}`,
    commit: input.commit ?? null,
    specHash: input.specHash ?? null,
    observedAt: input.now,
    status: "open",
  };
}
