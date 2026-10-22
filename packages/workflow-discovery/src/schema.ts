import { CapabilityIdSchema } from "@pathcompiler/capability-engine";
import { EvidenceBundleSchema } from "@pathcompiler/evidence";
import {
  DiagnosticSchema,
  SourceProjectSchema,
} from "@pathcompiler/source-model";
import { WorkflowV1Schema } from "@pathcompiler/workflow-ir";
import { parseDocument, stringify } from "yaml";
import { z } from "zod";

const status = z.enum(["not-run", "passed", "failed"]);
export const WorkflowCandidateSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    capabilityId: CapabilityIdSchema,
    workflow: WorkflowV1Schema,
    reviewRequired: z.literal(true),
    confidenceMeaning: z.literal("rule-strength-not-probability"),
    ambiguities: z.array(DiagnosticSchema),
    observations: z.array(
      z.strictObject({
        traceId: z.string().min(1),
        startOrder: z.number().int().nonnegative(),
        terminalOrder: z.number().int().nonnegative(),
      }),
    ),
    validation: z.strictObject({
      schema: status,
      repository: status,
      evidence: status,
      testComparison: status,
      browser: status,
    }),
  })
  .superRefine((candidate, context) => {
    if (candidate.workflow.status !== "candidate")
      context.addIssue({
        code: "custom",
        message: "Discovery artifacts must remain candidates",
      });
    if (
      !candidate.observations.length ||
      candidate.observations.some(
        (observation) => observation.terminalOrder <= observation.startOrder,
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "Candidate observations require an ordered entry and terminal assertion",
      });
  });
export type WorkflowCandidate = z.infer<typeof WorkflowCandidateSchema>;
export const WorkflowDiscoveryReportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    evidenceOnly: z.literal(true),
    repository: SourceProjectSchema.shape.repository,
    candidates: z.array(WorkflowCandidateSchema),
    skipped: z.array(
      z.strictObject({
        capabilityId: CapabilityIdSchema,
        reason: z.string().min(1),
      }),
    ),
    evidence: EvidenceBundleSchema,
    diagnostics: z.array(DiagnosticSchema),
  })
  .superRefine((report, context) => {
    if (
      new Set(report.candidates.map((candidate) => candidate.workflow.id))
        .size !== report.candidates.length
    )
      context.addIssue({ code: "custom", message: "Duplicate candidate IDs" });
    if (
      report.repository.commit !== report.evidence.repository.commit ||
      report.repository.dirty !== report.evidence.repository.dirty
    )
      context.addIssue({
        code: "custom",
        message: "Candidate report and evidence snapshots differ",
      });
    for (const candidate of report.candidates) {
      if (
        candidate.workflow.repository.commit !== report.repository.commit ||
        candidate.workflow.provenance.evidence.some(
          (ref) =>
            ref.type !== "commit" &&
            ref.type !== "pull_request" &&
            ref.repositoryCommit !== report.repository.commit,
        )
      )
        context.addIssue({
          code: "custom",
          message:
            "Workflow source evidence must match the repository snapshot",
        });
    }
  });
export type WorkflowDiscoveryReport = z.infer<
  typeof WorkflowDiscoveryReportSchema
>;

export function serializeCandidateYaml(input: WorkflowCandidate): string {
  return stringify(WorkflowCandidateSchema.parse(input), {
    aliasDuplicateObjects: false,
    lineWidth: 0,
  });
}
export function parseCandidateYaml(input: string): WorkflowCandidate {
  if (Buffer.byteLength(input, "utf8") > 2 * 1024 * 1024)
    throw new Error("Candidate YAML exceeds the 2 MiB limit.");
  const document = parseDocument(input, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
    version: "1.2",
  });
  if (document.errors.length || document.warnings.length)
    throw new Error(
      "Invalid candidate YAML. Use one YAML 1.2 document with unique keys and standard scalar types.",
    );
  const data: unknown = document.toJS({ maxAliasCount: 0 });
  return WorkflowCandidateSchema.parse(data);
}
