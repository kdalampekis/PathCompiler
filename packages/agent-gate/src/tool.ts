import type { ActionDecision, ActionGate, ActionRequest } from "./gate.js";

/**
 * Wraps an agent's tool function so every call is checked first. Framework
 * neutral: `toRequest` maps the tool's arguments (and, if needed, a lookup of
 * current state) to an action request.
 *
 * By default a blocked call is *returned* as data, not thrown, so the agent
 * sees which rule it would break and can correct itself; `onBlock: "throw"`
 * raises `ActionBlockedError` instead.
 */
export type GuardedResult<R> =
  | { ok: true; result: R; decision: ActionDecision }
  | { ok: false; blocked: true; decision: ActionDecision; message: string };

export class ActionBlockedError extends Error {
  override name = "ActionBlockedError";
  constructor(readonly decision: ActionDecision) {
    super(decision.summary);
  }
}

export function guardTool<Args, R>(
  gate: ActionGate,
  tool: (args: Args) => R | Promise<R>,
  options: {
    toRequest: (args: Args) => ActionRequest | Promise<ActionRequest>;
    onBlock?: "return" | "throw";
    /** Called with every decision, for audit logs. */
    onDecision?: (decision: ActionDecision, args: Args) => void;
  },
): (args: Args) => Promise<GuardedResult<R>> {
  return async (args) => {
    const decision = gate.check(await options.toRequest(args));
    options.onDecision?.(decision, args);
    if (decision.decision === "BLOCK") {
      if (options.onBlock === "throw") throw new ActionBlockedError(decision);
      return {
        ok: false,
        blocked: true,
        decision,
        message: `The action was not executed. ${decision.summary}`,
      };
    }
    return { ok: true, result: await tool(args), decision };
  };
}
