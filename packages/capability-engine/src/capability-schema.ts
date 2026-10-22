import { SourceProvenanceSchema } from "@pathcompiler/evidence";
import { compareText } from "@pathcompiler/source-model";
import { z } from "zod";
import { ProductSurfaceReportSchema } from "./schema.js";

const token = z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
export const CapabilityIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
export const CapabilityVerbSchema = z.enum([
  "create",
  "edit",
  "change",
  "deactivate",
  "activate",
  "delete",
  "archive",
  "restore",
  "invite",
  "duplicate",
  "export",
  "import",
  "assign",
  "unassign",
]);
const ids = z.array(z.string().min(1));
export const CapabilitySchema = z
  .strictObject({
    id: CapabilityIdSchema,
    domain: token,
    verb: CapabilityVerbSchema,
    entity: token,
    qualifier: token.nullable(),
    title: z.string().min(1),
    status: z.literal("candidate"),
    heuristic: z.literal(true),
    roles: ids,
    rolesAreAuthoritative: z.literal(false),
    roleEvidenceNodeIds: ids,
    surfaceIds: ids.min(1),
    sourceNodeIds: ids.min(1),
    evidenceNodeIds: ids.min(1),
    routeIds: ids.min(1),
    evidence: z.array(SourceProvenanceSchema).min(1),
    inferences: z
      .array(
        z.strictObject({
          surfaceId: z.string().min(1),
          rule: z.enum([
            "semantic-target",
            "accessible-name",
            "component-name",
          ]),
          nodeId: z.string().min(1),
        }),
      )
      .min(1),
    apiEvidence: z.array(
      z.strictObject({
        nodeId: z.string().min(1),
        association: z.enum(["handler", "component-context"]),
      }),
    ),
    confidence: z.number().min(0).max(1),
    confidenceMeaning: z.literal("rule-strength-not-probability"),
    confidenceBand: z.enum(["low", "medium", "high"]),
    reviewRequired: z.literal(true),
    reviewReasons: ids.min(1),
  })
  .superRefine((capability, context) => {
    if (
      capability.id !==
      `${capability.domain}.${capability.verb}${capability.qualifier ? `_${capability.qualifier}` : ""}`
    )
      context.addIssue({
        code: "custom",
        message: "Capability ID must match its canonical semantic key",
      });
    const band =
      capability.confidence < 0.7
        ? "low"
        : capability.confidence < 0.85
          ? "medium"
          : "high";
    if (
      capability.confidenceBand !== band ||
      (band === "low" && !capability.reviewReasons.includes("low-confidence"))
    )
      context.addIssue({
        code: "custom",
        message:
          "Confidence band and review requirements do not match the score",
      });
    for (const values of [
      capability.roles,
      capability.roleEvidenceNodeIds,
      capability.surfaceIds,
      capability.sourceNodeIds,
      capability.evidenceNodeIds,
      capability.routeIds,
      capability.reviewReasons,
    ])
      if (new Set(values).size !== values.length)
        context.addIssue({
          code: "custom",
          message: "Capability references must be unique",
        });
  });
export type Capability = z.infer<typeof CapabilitySchema>;
export const CapabilityExpectationsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    capabilityIds: z.array(CapabilityIdSchema),
  })
  .refine(
    (value) => new Set(value.capabilityIds).size === value.capabilityIds.length,
    "Expected capability IDs must be unique",
  );
export const CapabilityEvaluationSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("not-evaluated"),
    falsePositiveCount: z.null(),
    falseNegativeCount: z.null(),
  }),
  z.strictObject({
    status: z.literal("evaluated"),
    expectedIds: z.array(CapabilityIdSchema),
    matchedIds: z.array(CapabilityIdSchema),
    falsePositiveIds: z.array(CapabilityIdSchema),
    falseNegativeIds: z.array(CapabilityIdSchema),
    falsePositiveCount: z.number().int().nonnegative(),
    falseNegativeCount: z.number().int().nonnegative(),
  }),
]);
export type CapabilityEvaluation = z.infer<typeof CapabilityEvaluationSchema>;

/** Evaluation never participates in inference. Absence of ground truth is not a zero-error result. */
export function evaluateCapabilities(
  actualIds: string[],
  expectedIds?: string[],
): CapabilityEvaluation {
  if (expectedIds === undefined)
    return {
      status: "not-evaluated",
      falsePositiveCount: null,
      falseNegativeCount: null,
    };
  const expected = CapabilityExpectationsSchema.parse({
    schemaVersion: 1,
    capabilityIds: expectedIds,
  }).capabilityIds.sort(compareText);
  const actual = [
    ...new Set(z.array(CapabilityIdSchema).parse(actualIds)),
  ].sort(compareText);
  const falsePositiveIds = actual.filter((id) => !expected.includes(id));
  const falseNegativeIds = expected.filter((id) => !actual.includes(id));
  return {
    status: "evaluated",
    expectedIds: expected,
    matchedIds: actual.filter((id) => expected.includes(id)),
    falsePositiveIds,
    falseNegativeIds,
    falsePositiveCount: falsePositiveIds.length,
    falseNegativeCount: falseNegativeIds.length,
  };
}

export const CapabilityDiscoveryReportSchema =
  ProductSurfaceReportSchema.safeExtend({
    capabilities: z.array(CapabilitySchema),
    evaluation: CapabilityEvaluationSchema,
  }).superRefine((report, context) => {
    const nodes = new Map(
      report.evidence.graph.nodes.map((node) => [node.id, node]),
    );
    const surfaces = new Map(
      report.surfaces.map((surface) => [surface.id, surface]),
    );
    if (
      new Set(report.capabilities.map((capability) => capability.id)).size !==
      report.capabilities.length
    )
      context.addIssue({ code: "custom", message: "Duplicate capability IDs" });
    for (const capability of report.capabilities) {
      const sources = new Set(capability.sourceNodeIds);
      const evidence = new Set(capability.evidenceNodeIds);
      for (const id of [...sources, ...evidence])
        if (!nodes.has(id))
          context.addIssue({
            code: "custom",
            message: `Unknown capability evidence: ${id}`,
          });
      if ([...sources].some((id) => !evidence.has(id)))
        context.addIssue({
          code: "custom",
          message: "Capability sources must be included in evidence",
        });
      for (const id of capability.surfaceIds) {
        const surface = surfaces.get(id);
        if (!surface || !sources.has(surface.anchorNodeId))
          context.addIssue({
            code: "custom",
            message: `Unknown or unsupported capability surface: ${id}`,
          });
      }
      for (const inference of capability.inferences)
        if (
          !capability.surfaceIds.includes(inference.surfaceId) ||
          !sources.has(inference.nodeId)
        )
          context.addIssue({
            code: "custom",
            message: "Inference must cite a contributing surface and source",
          });
      for (const id of capability.routeIds)
        if (nodes.get(id)?.type !== "Route" || !sources.has(id))
          context.addIssue({
            code: "custom",
            message: `Unknown capability route: ${id}`,
          });
      for (const api of capability.apiEvidence)
        if (
          nodes.get(api.nodeId)?.type !== "APIEndpoint" ||
          !sources.has(api.nodeId)
        )
          context.addIssue({
            code: "custom",
            message: "API association must cite API source evidence",
          });
      const roles = capability.roleEvidenceNodeIds.map((id) => nodes.get(id));
      if (
        roles.some(
          (node) =>
            node?.type !== "Permission" ||
            !sources.has(node.id) ||
            typeof node.data?.role !== "string",
        ) ||
        capability.roles.some(
          (role) => !roles.some((node) => node?.data?.role === role),
        )
      )
        context.addIssue({
          code: "custom",
          message: "Roles must retain source observation evidence",
        });
      const locations = new Set(
        [...sources].flatMap((id) => {
          const data = nodes.get(id)?.data?.evidence;
          return Array.isArray(data)
            ? data.flatMap((ref) => {
                const parsed = SourceProvenanceSchema.safeParse(ref);
                return parsed.success ? [JSON.stringify(parsed.data)] : [];
              })
            : [];
        }),
      );
      if (
        capability.evidence.some(
          (ref) =>
            ref.repositoryCommit !== report.repository.commit ||
            !locations.has(JSON.stringify(ref)),
        )
      )
        context.addIssue({
          code: "custom",
          message:
            "Capability provenance must match its supporting source snapshot",
        });
    }
    if (report.evaluation.status === "evaluated") {
      // Child string refinements may have failed without aborting this refinement.
      if (
        !z
          .array(CapabilityIdSchema)
          .safeParse([
            ...report.evaluation.expectedIds,
            ...report.capabilities.map((capability) => capability.id),
          ]).success
      )
        return;
      if (
        new Set(report.evaluation.expectedIds).size !==
        report.evaluation.expectedIds.length
      ) {
        context.addIssue({
          code: "custom",
          message: "Expected capability IDs must be unique",
        });
        return;
      }
      const evaluation = evaluateCapabilities(
        report.capabilities.map((capability) => capability.id),
        report.evaluation.expectedIds,
      );
      if (
        JSON.stringify(report.evaluation) !==
        JSON.stringify(CapabilityEvaluationSchema.parse(evaluation))
      )
        context.addIssue({
          code: "custom",
          message:
            "Evaluation must match the discovered and expected capability IDs",
        });
    }
  });
export type CapabilityDiscoveryReport = z.infer<
  typeof CapabilityDiscoveryReportSchema
>;
