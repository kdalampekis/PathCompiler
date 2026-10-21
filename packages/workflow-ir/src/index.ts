import { z } from "zod";

const text = z.string().trim().min(1);
const confidence = z.number().min(0).max(1);

export const EvidenceRefSchema = z.strictObject({
  id: text,
  type: z.enum([
    "source_file",
    "symbol",
    "route",
    "api",
    "test",
    "commit",
    "pull_request",
    "documentation",
    "runtime",
  ]),
  locator: text,
  repositoryCommit: text,
  summary: text.optional(),
  confidence: confidence.optional(),
});

export const WorkflowConditionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("route_matches"),
    pattern: text.refine((value) => {
      try {
        new RegExp(value);
        return true;
      } catch {
        return false;
      }
    }, "Route pattern must be a valid regular expression"),
  }),
  z.strictObject({ type: z.literal("target_appears"), target: text }),
  z.strictObject({ type: z.literal("event_emitted"), event: text }),
  z.strictObject({ type: z.literal("url_changed"), url: text.optional() }),
  z.strictObject({
    type: z.literal("element_state"),
    target: text,
    state: z.enum([
      "visible",
      "hidden",
      "enabled",
      "disabled",
      "checked",
      "unchecked",
    ]),
  }),
  z.strictObject({ type: z.literal("explicit_next") }),
  z.strictObject({ type: z.literal("permission"), permission: text }),
  z.strictObject({
    type: z.literal("feature_flag"),
    flag: text,
    enabled: z.boolean(),
  }),
]);

export const WorkflowTerminalConditionSchema = z.union([
  WorkflowConditionSchema,
  z.strictObject({ any: z.array(WorkflowConditionSchema).min(1) }),
  z.strictObject({ all: z.array(WorkflowConditionSchema).min(1) }),
]);

export const WorkflowStepSchema = z.strictObject({
  id: text,
  target: text.optional(),
  action: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("click") }),
    z.strictObject({ type: z.literal("input"), inputKind: text.optional() }),
    z.strictObject({ type: z.literal("select") }),
    z.strictObject({ type: z.literal("navigate"), route: text }),
    z.strictObject({ type: z.literal("explain") }),
    z.strictObject({ type: z.literal("wait") }),
  ]),
  instruction: z
    .strictObject({ text: text.optional(), key: text.optional() })
    .refine(
      (value) => value.text !== undefined || value.key !== undefined,
      "Instruction requires text or a translation key",
    )
    .optional(),
  expected: WorkflowConditionSchema.optional(),
  optional: z.boolean().optional(),
  branches: z
    .array(z.strictObject({ when: WorkflowConditionSchema, next: text }))
    .optional(),
  next: text.optional(),
  evidence: z.array(EvidenceRefSchema).min(1),
});

export const WorkflowProvenanceSchema = z.strictObject({
  evidence: z.array(EvidenceRefSchema).min(1),
});

export const WorkflowV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: text,
    title: text,
    description: text.optional(),
    domain: text,
    intent: z.strictObject({
      action: text,
      entity: text,
      qualifiers: z.array(text).optional(),
    }),
    roles: z.array(text).optional(),
    entrypoints: z
      .array(
        z
          .strictObject({ route: text.optional(), state: text.optional() })
          .refine(
            (entry) => entry.route !== undefined || entry.state !== undefined,
            "Entrypoint requires a route or state",
          ),
      )
      .min(1),
    preconditions: z.array(WorkflowConditionSchema).optional(),
    steps: z.array(WorkflowStepSchema).min(1),
    terminal: WorkflowTerminalConditionSchema,
    provenance: WorkflowProvenanceSchema,
    repository: z.strictObject({ commit: text, branch: text.optional() }),
    confidence: z.strictObject({
      overall: confidence,
      dimensions: z.record(text, confidence).optional(),
    }),
    status: z.enum(["candidate", "approved", "deprecated", "rejected"]),
  })
  .superRefine((workflow, context) => {
    const ids = new Set<string>();
    workflow.steps.forEach((step, index) => {
      if (ids.has(step.id)) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "id"],
          message: `Duplicate step ID: ${step.id}`,
        });
      }
      ids.add(step.id);
    });
    workflow.steps.forEach((step, index) => {
      const checkReference = (next: string, path: (string | number)[]) => {
        if (!ids.has(next))
          context.addIssue({
            code: "custom",
            path,
            message: `Unknown next step: ${next}`,
          });
      };
      if (step.next !== undefined)
        checkReference(step.next, ["steps", index, "next"]);
      step.branches?.forEach((branch, branchIndex) => {
        checkReference(branch.next, [
          "steps",
          index,
          "branches",
          branchIndex,
          "next",
        ]);
      });
    });
  });

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type WorkflowCondition = z.infer<typeof WorkflowConditionSchema>;
export type WorkflowTerminalCondition = z.infer<
  typeof WorkflowTerminalConditionSchema
>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowProvenance = z.infer<typeof WorkflowProvenanceSchema>;
export type WorkflowV1 = z.infer<typeof WorkflowV1Schema>;

export function parseWorkflow(input: unknown): WorkflowV1 {
  return WorkflowV1Schema.parse(input);
}
