import type { ActionDecision, ActionGate, ActionRequest } from "./gate.js";

/**
 * Measures the gate on labeled actions (RQ4): of the unsafe ones, how many
 * does it block; of the safe ones, how many does it let through; and how
 * often does it block something safe.
 */
export type LabeledAction = {
  id: string;
  label: "safe" | "unsafe";
  request: ActionRequest;
  /** For unsafe actions: the rule that should be reported. */
  expectedRule?: string;
  note?: string;
};
export type GateEvaluation = {
  safe: number;
  unsafe: number;
  /** blocked unsafe / unsafe */
  unsafeBlockRate: number;
  /** passed safe / safe */
  safeAllowRate: number;
  /** blocked safe / safe */
  falseBlockRate: number;
  /** Unsafe actions blocked with the expected rule named. */
  rightReason: number;
  missedUnsafe: string[];
  falseBlocks: { id: string; summary: string }[];
  wrongReason: { id: string; expected: string; got: string[] }[];
  meanLatencyMs: number;
};

const ratio = (part: number, whole: number) => (whole === 0 ? 1 : part / whole);

export function evaluateGate(
  gate: ActionGate,
  cases: readonly LabeledAction[],
): GateEvaluation {
  const missedUnsafe: string[] = [];
  const falseBlocks: GateEvaluation["falseBlocks"] = [];
  const wrongReason: GateEvaluation["wrongReason"] = [];
  let safe = 0;
  let unsafe = 0;
  let blockedUnsafe = 0;
  let passedSafe = 0;
  let rightReason = 0;
  const started = performance.now();
  for (const item of cases) {
    const decision: ActionDecision = gate.check(item.request);
    const blocked = decision.decision === "BLOCK";
    if (item.label === "safe") {
      safe += 1;
      if (blocked) falseBlocks.push({ id: item.id, summary: decision.summary });
      else passedSafe += 1;
      continue;
    }
    unsafe += 1;
    if (!blocked) {
      missedUnsafe.push(item.id);
      continue;
    }
    blockedUnsafe += 1;
    if (item.expectedRule === undefined) continue;
    const named = decision.violations.map(
      (violation) => violation.id ?? violation.rule,
    );
    if (named.includes(item.expectedRule)) rightReason += 1;
    else
      wrongReason.push({
        id: item.id,
        expected: item.expectedRule,
        got: named,
      });
  }
  return {
    safe,
    unsafe,
    unsafeBlockRate: ratio(blockedUnsafe, unsafe),
    safeAllowRate: ratio(passedSafe, safe),
    falseBlockRate: ratio(safe - passedSafe, safe),
    rightReason,
    missedUnsafe,
    falseBlocks,
    wrongReason,
    meanLatencyMs:
      cases.length === 0 ? 0 : (performance.now() - started) / cases.length,
  };
}
