import {
  EvidenceBundleSchema,
  SourceProvenanceSchema,
} from "@pathcompiler/evidence";
import {
  DiagnosticSchema,
  SourceProjectSchema,
} from "@pathcompiler/source-model";
import { z } from "zod";

export const ProductSurfaceSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["page", "panel", "modal", "form", "action"]),
  title: z.string().min(1),
  anchorNodeId: z.string().min(1),
  sourceNodeIds: z.array(z.string().min(1)).min(1),
  evidenceNodeIds: z.array(z.string().min(1)).min(1),
  parentIds: z.array(z.string().min(1)),
  routeIds: z.array(z.string().min(1)).min(1),
  rule: z.enum(["route", "component-name", "element", "interaction"]),
  titleSource: z.enum([
    "route",
    "component-name",
    "accessible-name",
    "semantic-id",
    "fallback",
  ]),
  confidence: z.number().min(0).max(1),
  heuristic: z.literal(true),
  status: z.literal("candidate"),
  evidence: z.array(SourceProvenanceSchema).min(1),
});
export type ProductSurface = z.infer<typeof ProductSurfaceSchema>;
export const ProductSurfaceReportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    evidenceOnly: z.literal(true),
    repository: SourceProjectSchema.shape.repository,
    surfaces: z.array(ProductSurfaceSchema),
    evidence: EvidenceBundleSchema,
    diagnostics: z.array(DiagnosticSchema),
  })
  .superRefine((report, context) => {
    const surfaces = new Map(
      report.surfaces.map((surface) => [surface.id, surface]),
    );
    const nodes = new Map(
      report.evidence.graph.nodes.map((node) => [node.id, node]),
    );
    if (surfaces.size !== report.surfaces.length)
      context.addIssue({ code: "custom", message: "Duplicate surface IDs" });
    if (
      JSON.stringify(report.repository) !==
      JSON.stringify(report.evidence.repository)
    )
      context.addIssue({
        code: "custom",
        message: "Surface and evidence snapshots differ",
      });
    for (const surface of report.surfaces) {
      for (const ids of [
        surface.sourceNodeIds,
        surface.evidenceNodeIds,
        surface.parentIds,
        surface.routeIds,
      ])
        if (new Set(ids).size !== ids.length)
          context.addIssue({
            code: "custom",
            message: `Duplicate references in ${surface.id}`,
          });
      const provenance = new Set(
        surface.sourceNodeIds.flatMap((id) => {
          const node = nodes.get(id);
          return Array.isArray(node?.data?.evidence)
            ? node.data.evidence.flatMap((location) => {
                const parsed = SourceProvenanceSchema.safeParse(location);
                return parsed.success ? [JSON.stringify(parsed.data)] : [];
              })
            : [];
        }),
      );
      if (
        surface.evidence.some(
          (location) =>
            location.repositoryCommit !== report.repository.commit ||
            !provenance.has(JSON.stringify(location)),
        )
      )
        context.addIssue({
          code: "custom",
          message: `Surface ${surface.id} has stale or unsupported provenance`,
        });
      if (
        !surface.sourceNodeIds.includes(surface.anchorNodeId) ||
        !surface.sourceNodeIds.every((id) =>
          surface.evidenceNodeIds.includes(id),
        )
      )
        context.addIssue({
          code: "custom",
          message: `Surface ${surface.id} is missing anchor/source evidence`,
        });
      for (const id of [...surface.sourceNodeIds, ...surface.evidenceNodeIds])
        if (!nodes.has(id))
          context.addIssue({
            code: "custom",
            message: `Unknown surface evidence: ${id}`,
          });
      for (const id of surface.routeIds)
        if (
          nodes.get(id)?.type !== "Route" ||
          !surface.sourceNodeIds.includes(id)
        )
          context.addIssue({
            code: "custom",
            message: `Unknown surface route: ${id}`,
          });
      const seen = new Set<string>();
      const pending = [...surface.parentIds];
      while (pending.length) {
        const id = pending.pop();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (id === surface.id || !surfaces.has(id)) {
          context.addIssue({
            code: "custom",
            message:
              "Surface parents must form an acyclic graph of existing surfaces",
          });
          break;
        }
        pending.push(...(surfaces.get(id)?.parentIds ?? []));
      }
    }
  });
export type ProductSurfaceReport = z.infer<typeof ProductSurfaceReportSchema>;
