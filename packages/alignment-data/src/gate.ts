import type { ActionDecision, ActionRequest } from "@pathcompiler/agent-gate";
import type { FeedbackInput, FeedbackRecorder } from "./events.js";

/** The feedback record for one gate decision. */
export function gateEvent(
  decision: ActionDecision,
  request: ActionRequest,
  who: { agent?: string; session?: string; specHash?: string } = {},
): FeedbackInput {
  return {
    kind: "action_check",
    ...(who.agent ? { agent: who.agent } : {}),
    ...(who.session ? { session: who.session } : {}),
    ...(who.specHash ? { specHash: who.specHash } : {}),
    verdict: decision.decision === "PASS" ? "pass" : "block",
    subject: {
      operation: decision.operation,
      request: request as unknown as Record<string, unknown>,
    },
    checks: [
      ...decision.violations.map((item) => ({
        ...(item.id ? { rule: item.id } : {}),
        kind: item.kind,
        status: "violated",
        explanation: item.explanation,
        ...(item.basis ? { humanBacked: item.basis.humanBacked } : {}),
      })),
      ...decision.unresolved.map((item) => ({
        ...(item.id ? { rule: item.id } : {}),
        kind: item.kind,
        status: "unknown",
        explanation: `missing ${item.missing.join(", ")}`,
      })),
    ],
    ...(decision.counterexample
      ? {
          counterexample: decision.counterexample as unknown as Record<
            string,
            unknown
          >,
        }
      : {}),
  };
}

/**
 * Plugs into `guardTool`'s `onDecision` so every check the agent meets is
 * recorded. `toRequest` is the same mapping the guard uses.
 */
export function recordGateDecisions<Args>(
  recorder: FeedbackRecorder,
  toRequest: (args: Args) => ActionRequest,
  who: { agent?: string; session?: string; specHash?: string } = {},
) {
  return async (decision: ActionDecision, args: Args) =>
    recorder.record(gateEvent(decision, toRequest(args), who));
}
