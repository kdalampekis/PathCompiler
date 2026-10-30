import { EvidenceRefSchema } from "@pathcompiler/workflow-ir";
import { z } from "zod";

/**
 * Where a rule came from and how far to trust it. An automatically extracted
 * rule is a candidate with provenance, never ground truth: a verifier that
 * proves a property of a wrongly extracted rule proves nothing about the
 * business (docs/EXPANDED_PATHCOMPILER_ARCHITECTURE.md §14).
 */
export const SOURCE_TYPES = [
  "TEST",
  "DATABASE_SCHEMA",
  "ORM_MODEL",
  "VALIDATION_MODEL",
  "OPENAPI",
  "SOURCE_CODE",
  "CONFIG",
  "POLICY_DOCUMENT",
  "HUMAN_DECLARATION",
  "RUNTIME_TRACE",
  "INFERRED",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export const ORIGINS = ["EXPLICIT", "INFERRED", "HUMAN_APPROVED"] as const;
export type Origin = (typeof ORIGINS)[number];
export const EXTRACTION_METHODS = [
  "STATIC_ANALYSIS",
  "SCHEMA_PARSE",
  "LLM_ASSISTED",
  "HUMAN",
  "OBSERVATION",
  "FORMAL_MODEL",
] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];
export const CONFIDENCE_BANDS = ["HIGH", "MEDIUM", "LOW"] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

/** Source types read from a file; they must say which (or cite evidence). */
const FILE_BASED = new Set<SourceType>([
  "TEST",
  "DATABASE_SCHEMA",
  "ORM_MODEL",
  "VALIDATION_MODEL",
  "OPENAPI",
  "SOURCE_CODE",
  "CONFIG",
  "POLICY_DOCUMENT",
]);
const text = z.string().trim().min(1);

export const ProvenanceSchema = z
  .strictObject({
    sourceType: z.enum(SOURCE_TYPES),
    origin: z.enum(ORIGINS),
    extractionMethod: z.enum(EXTRACTION_METHODS),
    extractorVersion: text,
    confidence: z.enum(CONFIDENCE_BANDS),
    /** The extractor's own 0–1 score, when it has one (kept so scores round-trip). */
    score: z.number().min(0).max(1).optional(),
    sourceFile: text.optional(),
    /** The commit the rule was found in (a commit message or a change), when that is its evidence. */
    sourceCommit: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/, "Use a commit SHA (7 to 40 hex digits)")
      .optional(),
    /** Inclusive line range, e.g. "32-47" or "12". */
    sourceLines: z
      .string()
      .regex(/^\d+(?:-\d+)?$/, 'Use "12" or "32-47"')
      .optional(),
    /** Who declared or approved the rule; required for human origins. */
    declaredBy: text.optional(),
    evidence: z.array(EvidenceRefSchema).optional(),
  })
  .superRefine((provenance, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (
      FILE_BASED.has(provenance.sourceType) &&
      !provenance.sourceFile &&
      !(provenance.evidence && provenance.evidence.length > 0)
    )
      issue(
        `${provenance.sourceType} provenance needs sourceFile (or graph evidence) so a reviewer can find the source.`,
      );
    if (provenance.sourceLines && !provenance.sourceFile)
      issue("sourceLines needs sourceFile.");
    if (provenance.sourceLines) {
      const [first, last] = provenance.sourceLines.split("-").map(Number) as [
        number,
        number | undefined,
      ];
      if (first < 1 || (last !== undefined && last < first))
        issue(`sourceLines ${provenance.sourceLines} is not a valid range.`);
    }
    if (
      (provenance.sourceType === "HUMAN_DECLARATION" ||
        provenance.origin === "HUMAN_APPROVED") &&
      !provenance.declaredBy
    )
      issue("Human declarations and approvals need declaredBy.");
    if (
      provenance.sourceType === "INFERRED" &&
      provenance.origin === "EXPLICIT"
    )
      issue("An INFERRED source cannot be EXPLICIT.");
    if (
      provenance.extractionMethod === "LLM_ASSISTED" &&
      provenance.origin === "EXPLICIT"
    )
      issue(
        "A rule found with model assistance is INFERRED until a human approves it.",
      );
  });
export type Provenance = z.infer<typeof ProvenanceSchema>;
/** At least one provenance record: a rule without a source is not accepted. */
export const ProvenanceListSchema = z
  .array(ProvenanceSchema)
  .min(1, "Every rule needs provenance.");

/** Same banding as capability confidence. */
export function confidenceBand(score: number): ConfidenceBand {
  return score >= 0.85 ? "HIGH" : score >= 0.7 ? "MEDIUM" : "LOW";
}
const RANK: Record<ConfidenceBand, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
/** The weakest confidence among records: a rule is only as sure as its weakest source. */
export function weakestConfidence(
  records: readonly Provenance[],
): ConfidenceBand {
  return records.reduce<ConfidenceBand>(
    (weakest, record) =>
      RANK[record.confidence] < RANK[weakest] ? record.confidence : weakest,
    "HIGH",
  );
}
/** True when a human approved the rule or declared it. */
export function isHumanBacked(records: readonly Provenance[]): boolean {
  return records.some(
    (record) =>
      record.origin === "HUMAN_APPROVED" ||
      record.sourceType === "HUMAN_DECLARATION",
  );
}
