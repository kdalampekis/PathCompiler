import {
  ExprSchema,
  formatExpression,
  type Provenance,
  parseExpression,
} from "@pathcompiler/behavior-ir";
import { z } from "zod";
import {
  type ExtractedFragment,
  emptyFragment,
  permissionText,
  type SourceFile,
} from "./common.js";

/**
 * Candidate rules: proposed by a model or by an external harness that read the
 * code and its history, validated by PathCompiler, and **not yet approved by a
 * person**. They enter the specification as INFERRED and LLM_ASSISTED (the
 * provenance schema forbids a model-assisted rule from being EXPLICIT), so the
 * verifier, the PR guard and the agent gate report them with the "extracted
 * candidate" caveat and never fail a change on them alone. A person promotes a
 * candidate to `approved-rules.json` with `rules approve`.
 */
const text = z.string().trim().min(1);
const expression = text.transform((source, context) => {
  try {
    return ExprSchema.parse(parseExpression(source));
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: `Cannot parse "${source}": ${(error as Error).message}`,
    });
    return z.NEVER;
  }
});

export const EVIDENCE_TYPES = [
  "code",
  "test",
  "doc",
  "config",
  "commit",
] as const;
export const EvidenceSchema = z
  .strictObject({
    type: z.enum(EVIDENCE_TYPES),
    file: text.optional(),
    /** "12" or "32-47". */
    lines: z
      .string()
      .regex(/^\d+(?:-\d+)?$/, 'Use "12" or "32-47"')
      .optional(),
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/, "Use a commit SHA (7 to 40 hex digits)")
      .optional(),
    /** A short verbatim quote from the cited lines or message. */
    quote: text.max(400).optional(),
  })
  .superRefine((item, context) => {
    if (item.type === "commit") {
      if (!item.commit)
        context.addIssue({
          code: "custom",
          message: "Commit evidence needs a commit SHA.",
        });
    } else if (!item.file)
      context.addIssue({
        code: "custom",
        message: `${item.type} evidence needs a file${item.type === "code" ? " and lines" : ""}.`,
      });
    if (item.lines && !item.file)
      context.addIssue({ code: "custom", message: "lines needs file." });
  });
export type Evidence = z.infer<typeof EvidenceSchema>;

const common = {
  id: z.string().min(1),
  description: text.optional(),
  evidence: z.array(EvidenceSchema).min(1),
  rationale: text.max(2_000),
  /** PathCompiler's cap, never above MEDIUM: whatever the proposer claimed. */
  confidence: z.enum(["LOW", "MEDIUM"]),
  /** Who proposed it: `harness: <name>` or `model: <provider>`. */
  producer: text,
  taskId: text.optional(),
};
export const CandidateRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...common,
    kind: z.literal("business_rule"),
    when: expression,
    must: expression,
    appliesTo: z.array(z.string().min(1)).optional(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("invariant"),
    expression,
  }),
  z.strictObject({
    ...common,
    kind: z.literal("permission"),
    role: text,
    action: text,
    effect: z.enum(["allow", "deny"]),
    constraint: expression.optional(),
  }),
]);
export type CandidateRule = z.infer<typeof CandidateRuleSchema>;

export const CandidateRulesFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("candidate-rules"),
  rules: z.array(CandidateRuleSchema),
  /** Candidates a person rejected, kept so they are not proposed again. */
  rejected: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        text: z.string().min(1),
        by: text,
        reason: text,
      }),
    )
    .default([]),
});
export type CandidateRulesFile = z.infer<typeof CandidateRulesFileSchema>;

const SOURCE_TYPE = {
  code: "SOURCE_CODE",
  test: "TEST",
  doc: "POLICY_DOCUMENT",
  config: "CONFIG",
  commit: "INFERRED",
} as const;

/** One provenance record per piece of evidence. */
export function candidateProvenance(rule: CandidateRule): Provenance[] {
  return rule.evidence.map((item) => ({
    sourceType: SOURCE_TYPE[item.type],
    origin: "INFERRED" as const,
    extractionMethod: "LLM_ASSISTED" as const,
    extractorVersion: `rule-discovery@1 (${rule.producer})`,
    confidence: rule.confidence,
    ...(item.file ? { sourceFile: item.file } : {}),
    ...(item.lines ? { sourceLines: item.lines } : {}),
    ...(item.commit ? { sourceCommit: item.commit } : {}),
  }));
}

export const candidateRuleText = (rule: CandidateRule): string =>
  rule.kind === "business_rule"
    ? `${formatExpression(rule.when)} => ${formatExpression(rule.must)}`
    : rule.kind === "invariant"
      ? formatExpression(rule.expression)
      : permissionText({
          id: rule.id,
          role: rule.role,
          action: rule.action,
          effect: rule.effect,
          ...(rule.constraint ? { constraint: rule.constraint } : {}),
          provenance: [],
        });

export function extractCandidateRules(file: SourceFile): ExtractedFragment {
  return candidateFragment(
    CandidateRulesFileSchema.parse(JSON.parse(file.content)).rules,
  );
}

/** The specification fragment for candidate rules, with provenance. */
export function candidateFragment(
  rules: readonly CandidateRule[],
): ExtractedFragment {
  const out = emptyFragment();
  for (const rule of rules) {
    const provenance = candidateProvenance(rule);
    const description = rule.description ?? rule.rationale;
    if (rule.kind === "business_rule")
      out.businessRules.push({
        id: rule.id,
        description,
        when: rule.when,
        must: rule.must,
        ...(rule.appliesTo ? { appliesTo: rule.appliesTo } : {}),
        provenance,
      });
    else if (rule.kind === "invariant")
      out.invariants.push({
        id: rule.id,
        description,
        expression: rule.expression,
        provenance,
      });
    else
      out.permissions.push({
        id: rule.id,
        description,
        role: rule.role,
        action: rule.action,
        effect: rule.effect,
        ...(rule.constraint ? { constraint: rule.constraint } : {}),
        provenance,
      });
    const kind =
      rule.kind === "business_rule"
        ? "business_rule"
        : rule.kind === "invariant"
          ? "invariant"
          : "permission";
    for (const item of provenance)
      out.ledger.push({
        kind,
        text: candidateRuleText(rule),
        provenance: item,
      });
  }
  return out;
}
