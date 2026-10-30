import {
  type Expr,
  ExprSchema,
  formatExpression,
  parseExpression,
} from "@pathcompiler/behavior-ir";
import { z } from "zod";
import {
  type ExtractedFragment,
  emptyFragment,
  permissionText,
  provenanceOf,
  type SourceFile,
} from "./common.js";

/**
 * Rules a person declares and approves, because no artifact states them
 * ("a refund above 5000 needs manager approval" may live only in a policy
 * document). They enter the specification as HUMAN_DECLARATION /
 * HUMAN_APPROVED, the only provenance a verifier may treat as authoritative.
 * Expressions use the BehaviorIR text syntax.
 */
const id = z.string().min(1);
const expression = z
  .string()
  .min(1)
  .transform((text, context): Expr => {
    try {
      return ExprSchema.parse(parseExpression(text));
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: `Cannot parse "${text}": ${(error as Error).message}`,
      });
      return { op: "lit", value: true };
    }
  });
export const ApprovedRulesSchema = z.strictObject({
  declaredBy: z.string().min(1),
  /** Where the rule is documented (a policy document, a ticket). */
  reference: z.string().min(1).optional(),
  invariants: z
    .array(
      z.strictObject({
        id,
        description: z.string().optional(),
        expression,
      }),
    )
    .default([]),
  businessRules: z
    .array(
      z.strictObject({
        id,
        description: z.string().optional(),
        when: expression,
        must: expression,
        appliesTo: z.array(id).optional(),
      }),
    )
    .default([]),
  permissions: z
    .array(
      z.strictObject({
        id,
        description: z.string().optional(),
        role: z.string().min(1),
        action: z.string().min(1),
        resource: z.string().optional(),
        effect: z.enum(["allow", "deny"]),
        constraint: expression.optional(),
      }),
    )
    .default([]),
});

export function extractApprovedRules(file: SourceFile): ExtractedFragment {
  const out = emptyFragment();
  const parsed = ApprovedRulesSchema.parse(JSON.parse(file.content));
  const provenance = () =>
    provenanceOf({
      sourceType: "HUMAN_DECLARATION",
      origin: "HUMAN_APPROVED",
      extractionMethod: "HUMAN",
      confidence: "HIGH",
      file: file.path,
    });
  const approved = () => ({
    ...provenance(),
    declaredBy: parsed.declaredBy,
  });
  for (const item of parsed.invariants) {
    out.invariants.push({
      id: item.id,
      ...(item.description ? { description: item.description } : {}),
      expression: item.expression,
      provenance: [approved()],
    });
    out.ledger.push({
      kind: "invariant",
      text: formatExpression(item.expression),
      provenance: approved(),
    });
  }
  for (const item of parsed.businessRules) {
    out.businessRules.push({
      id: item.id,
      ...(item.description ? { description: item.description } : {}),
      when: item.when,
      must: item.must,
      ...(item.appliesTo ? { appliesTo: item.appliesTo } : {}),
      provenance: [approved()],
    });
    out.ledger.push({
      kind: "business_rule",
      text: `${formatExpression(item.when)} => ${formatExpression(item.must)}`,
      provenance: approved(),
    });
  }
  for (const item of parsed.permissions) {
    const permission = {
      id: item.id,
      ...(item.description ? { description: item.description } : {}),
      role: item.role,
      action: item.action,
      ...(item.resource ? { resource: item.resource } : {}),
      effect: item.effect,
      ...(item.constraint ? { constraint: item.constraint } : {}),
      provenance: [approved()],
    };
    out.permissions.push(permission);
    out.ledger.push({
      kind: "permission",
      text: permissionText(permission),
      provenance: approved(),
    });
  }
  return out;
}
