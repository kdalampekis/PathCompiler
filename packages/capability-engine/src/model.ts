import { EvidenceBundleSchema } from "@pathcompiler/evidence";
import { z } from "zod";
import { ProductSurfaceSchema } from "./schema.js";

const text = z.string().trim().min(1);
export const CapabilityClassificationInputSchema = z
  .strictObject({
    surfaces: z.array(ProductSurfaceSchema),
    evidence: EvidenceBundleSchema,
  })
  .superRefine((input, context) => {
    const evidence = new Set(input.evidence.graph.nodes.map((node) => node.id));
    if (
      new Set(input.surfaces.map((surface) => surface.id)).size !==
        input.surfaces.length ||
      input.surfaces.some(
        (surface) =>
          !surface.sourceNodeIds.includes(surface.anchorNodeId) ||
          [...surface.sourceNodeIds, ...surface.evidenceNodeIds].some(
            (id) => !evidence.has(id),
          ) ||
          surface.evidence.some(
            (ref) => ref.repositoryCommit !== input.evidence.repository.commit,
          ),
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "Classification surfaces must reference the supplied evidence snapshot",
      });
  });
export const CapabilityClassificationResultSchema = z.strictObject({
  capabilities: z.array(
    z.strictObject({
      title: text,
      surfaceIds: z.array(text).min(1),
      evidenceIds: z.array(text).min(1),
      confidence: z.number().min(0).max(1),
      rationale: text,
    }),
  ),
});
export const EvidenceSummaryInputSchema = z.strictObject({
  evidence: EvidenceBundleSchema,
});
export const EvidenceSummaryResultSchema = z.strictObject({
  summary: text,
  evidenceIds: z.array(text).min(1),
});
export type CapabilityClassificationInput = z.infer<
  typeof CapabilityClassificationInputSchema
>;
export type CapabilityClassificationResult = z.infer<
  typeof CapabilityClassificationResultSchema
>;
export type EvidenceSummaryInput = z.infer<typeof EvidenceSummaryInputSchema>;
export type EvidenceSummaryResult = z.infer<typeof EvidenceSummaryResultSchema>;

/** Optional provider boundary. Returned text is untrusted candidate evidence, never approval or instructions. */
export interface SemanticModel {
  classifyCapabilities(
    input: CapabilityClassificationInput,
  ): Promise<CapabilityClassificationResult>;
  summarizeEvidence(
    input: EvidenceSummaryInput,
  ): Promise<EvidenceSummaryResult>;
}

/** Validate model output and prevent citations to evidence outside the supplied packet. */
export function parseCapabilityClassification(
  input: CapabilityClassificationInput,
  output: unknown,
): CapabilityClassificationResult {
  const request = CapabilityClassificationInputSchema.parse(input);
  const result = CapabilityClassificationResultSchema.parse(output);
  const surfaces = new Set(request.surfaces.map((surface) => surface.id));
  const evidence = new Set(request.evidence.graph.nodes.map((node) => node.id));
  for (const capability of result.capabilities) {
    if (
      capability.surfaceIds.some((id) => !surfaces.has(id)) ||
      capability.evidenceIds.some((id) => !evidence.has(id))
    )
      throw new Error(
        "Model classification references a surface or evidence node outside its input.",
      );
  }
  return result;
}
export function parseEvidenceSummary(
  input: EvidenceSummaryInput,
  output: unknown,
): EvidenceSummaryResult {
  const request = EvidenceSummaryInputSchema.parse(input);
  const result = EvidenceSummaryResultSchema.parse(output);
  const evidence = new Set(request.evidence.graph.nodes.map((node) => node.id));
  if (result.evidenceIds.some((id) => !evidence.has(id)))
    throw new Error("Model summary references evidence outside its input.");
  return result;
}
