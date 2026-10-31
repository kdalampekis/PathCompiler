import { z } from "zod";
import type { ActionDecision, ActionGate, ActionRequest } from "./gate.js";

/**
 * The answer check: what an agent is about to say, checked before it is
 * rendered to a customer or returned to a caller. Two deterministic parts, and
 * a place for a model to help without deciding:
 *
 *  - **Claims.** An answer that says "I refunded 6000" or "you are approved"
 *    commits the business to an action. Whoever has the answer (the agent, a
 *    harness, a model reading the text) lists those claims as action requests;
 *    each is checked by the action gate against the rules, exactly like an
 *    action the agent takes. The model finds the claims; the gate judges them.
 *  - **Policies.** Statements a person declared must or must not appear in an
 *    answer (no guarantees, a required disclaimer), as patterns. A person
 *    approves them; they are not inferred.
 */
const text = z.string().trim().min(1);
const OutputPolicySchema = z
  .strictObject({
    id: text,
    description: text,
    kind: z.enum(["forbid", "require"]),
    /** A regular expression, matched case-insensitively. */
    pattern: text.max(300),
    /** `require` policies apply only to answers that claim one of these operations; none means every answer. */
    whenClaims: z.array(text).optional(),
    /** Only answers for these channels (chat, email, ...); none means every channel. */
    channels: z.array(text).optional(),
  })
  .superRefine((policy, context) => {
    try {
      new RegExp(policy.pattern, "i");
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: `Policy ${policy.id} has an invalid pattern: ${(error as Error).message}`,
      });
    }
  });
export const OutputPoliciesFileSchema = z.strictObject({
  declaredBy: text,
  reference: text.optional(),
  policies: z.array(OutputPolicySchema).max(200),
});
export type OutputPolicies = z.infer<typeof OutputPoliciesFileSchema>;
export const OUTPUT_POLICIES_FILE = "spec/output-policies.json";

export type OutputClaim = ActionRequest;
export type OutputCandidate = {
  text: string;
  /** What the answer commits to, as action requests (performed or promised). */
  claims?: readonly OutputClaim[];
  channel?: string;
};
export type OutputViolation = {
  source: "claim" | "policy";
  id?: string;
  explanation: string;
};
export type OutputDecision = {
  decision: "PASS" | "BLOCK";
  violations: OutputViolation[];
  /** The gate's decision for each claim, in order. */
  claims: ActionDecision[];
  warnings: string[];
  /** Instructions for the agent to rewrite the answer. */
  correction: string;
  summary: string;
};

const MAX_CHARS = 50_000;

export function parseOutputPolicies(content: string): OutputPolicies {
  return OutputPoliciesFileSchema.parse(JSON.parse(content));
}

export function checkOutput(
  gate: ActionGate,
  policies: OutputPolicies | undefined,
  output: OutputCandidate,
): OutputDecision {
  const violations: OutputViolation[] = [];
  const warnings: string[] = [];
  const claims = (output.claims ?? []).map((claim) => gate.check(claim));
  for (const decision of claims)
    if (decision.decision === "BLOCK")
      violations.push({
        source: "claim",
        ...(decision.violations[0]?.id
          ? { id: decision.violations[0].id }
          : {}),
        explanation: `The answer commits to an action the rules do not allow. ${decision.summary}`,
      });
  const body = output.text.slice(0, MAX_CHARS);
  if (output.text.length > MAX_CHARS)
    warnings.push(
      `Only the first ${MAX_CHARS} characters were checked against policies.`,
    );
  const claimed = new Set(
    (output.claims ?? []).map((claim) => claim.operation),
  );
  for (const policy of policies?.policies ?? []) {
    if (
      policy.channels &&
      (output.channel === undefined ||
        !policy.channels.includes(output.channel))
    )
      continue;
    const matches = new RegExp(policy.pattern, "i").test(body);
    if (policy.kind === "forbid" && matches)
      violations.push({
        source: "policy",
        id: policy.id,
        explanation: `${policy.description} (the answer matches /${policy.pattern}/).`,
      });
    if (
      policy.kind === "require" &&
      !matches &&
      (!policy.whenClaims || policy.whenClaims.some((op) => claimed.has(op)))
    )
      violations.push({
        source: "policy",
        id: policy.id,
        explanation: `${policy.description} (the answer does not contain /${policy.pattern}/).`,
      });
  }
  const blocked = violations.length > 0;
  return {
    decision: blocked ? "BLOCK" : "PASS",
    violations,
    claims,
    warnings,
    correction: blocked
      ? `Do not send this answer. Rewrite it so that: ${violations.map((v) => v.explanation).join(" ")}`
      : "",
    summary: blocked
      ? `BLOCK answer: ${violations.length} problem(s). ${violations[0]?.explanation}`
      : "PASS answer",
  };
}

export type GuardedOutput =
  | { ok: true; text: string; decision: OutputDecision }
  | { ok: false; blocked: true; decision: OutputDecision; message: string };

/**
 * Wraps whatever produces an answer so it is checked before it is returned.
 * `toOutput` turns the produced value into the text and the claims it makes.
 */
export function guardOutput<Args>(
  gate: ActionGate,
  policies: OutputPolicies | undefined,
  produce: (args: Args) => string | Promise<string>,
  options: {
    claimsOf?: (
      args: Args,
      text: string,
    ) => readonly OutputClaim[] | Promise<readonly OutputClaim[]>;
    channel?: string;
    onDecision?: (decision: OutputDecision, args: Args, text: string) => void;
  } = {},
): (args: Args) => Promise<GuardedOutput> {
  return async (args) => {
    const produced = await produce(args);
    const decision = checkOutput(gate, policies, {
      text: produced,
      claims: (await options.claimsOf?.(args, produced)) ?? [],
      ...(options.channel ? { channel: options.channel } : {}),
    });
    options.onDecision?.(decision, args, produced);
    return decision.decision === "BLOCK"
      ? { ok: false, blocked: true, decision, message: decision.correction }
      : { ok: true, text: produced, decision };
  };
}
