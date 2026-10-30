import { EvidenceSchema } from "@pathcompiler/behavior-extraction";
import { z } from "zod";

/**
 * What a model or harness hands back. Expressions are text, in the BehaviorIR
 * syntax; evidence is mandatory. The proposer's own confidence is a claim,
 * not an input: PathCompiler computes the confidence it records.
 */
const text = z.string().trim().min(1);
const common = {
  /** Optional; PathCompiler assigns a stable ID when absent. */
  id: z.string().trim().min(1).optional(),
  description: text.max(300).optional(),
  evidence: z.array(EvidenceSchema).min(1).max(8),
  rationale: text.max(2_000),
  confidence: z.enum(["low", "medium", "high"]).optional(),
};
export const ProposalSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...common,
    kind: z.literal("business_rule"),
    when: text,
    must: text,
    appliesTo: z.array(text).optional(),
  }),
  z.strictObject({ ...common, kind: z.literal("invariant"), expression: text }),
  z.strictObject({
    ...common,
    kind: z.literal("permission"),
    role: text,
    action: text,
    effect: z.enum(["allow", "deny"]),
    constraint: text.optional(),
  }),
]);
export type Proposal = z.infer<typeof ProposalSchema>;

/** What a model returns (the producer is known to PathCompiler). */
export const ProposalListSchema = z.strictObject({
  proposals: z.array(ProposalSchema).max(100),
});
/** What a harness writes to a file. */
export const RuleProposalsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  taskId: text,
  producer: z.strictObject({
    kind: z.enum(["harness", "model"]),
    name: text,
    version: text.optional(),
  }),
  proposals: z.array(ProposalSchema).max(100),
});
export type RuleProposals = z.infer<typeof RuleProposalsSchema>;

export const proposalListJsonSchema = (): Record<string, unknown> =>
  z.toJSONSchema(ProposalListSchema, {
    io: "output",
    unrepresentable: "any",
  }) as Record<string, unknown>;
export const ruleProposalsJsonSchema = (): Record<string, unknown> =>
  z.toJSONSchema(RuleProposalsSchema, {
    io: "output",
    unrepresentable: "any",
  }) as Record<string, unknown>;
