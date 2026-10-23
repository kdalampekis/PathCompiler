import {
  WorkflowConditionSchema,
  WorkflowStepSchema,
  WorkflowTerminalConditionSchema,
  WorkflowV1Schema,
} from "@pathcompiler/workflow-ir";
import { z } from "zod";

// Browser-safe: compiled artifact contracts only, no Node.js imports.
/** Bump whenever compiled output changes for the same approved input. */
export const COMPILER_VERSION = "1.0.0";

const text = z.string().min(1);
const revision = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const header = {
  schemaVersion: z.literal(1),
  compilerVersion: z.literal(COMPILER_VERSION),
};

export const SearchRecordSchema = z.strictObject({
  id: text,
  revision,
  title: text,
  description: text.optional(),
  domain: text,
  aliases: z.array(text),
  action: text,
  entity: text,
  qualifiers: z.array(text),
  roles: z.array(text),
  routes: z.array(text),
  permissions: z.array(text),
  featureFlags: z.array(z.strictObject({ flag: text, enabled: z.boolean() })),
});
export const SearchIndexSchema = z.strictObject({
  ...header,
  kind: z.literal("search-index"),
  workflows: z.array(SearchRecordSchema),
});

/** Browser-safe: no evidence, provenance, confidence, commits or reviewer data. */
export const RuntimeWorkflowSchema = z.strictObject({
  id: text,
  revision,
  title: text,
  entrypoints: WorkflowV1Schema.shape.entrypoints,
  preconditions: z.array(WorkflowConditionSchema),
  steps: z.array(WorkflowStepSchema.omit({ evidence: true })).min(1),
  terminal: WorkflowTerminalConditionSchema,
});
export const RuntimeManifestSchema = z.strictObject({
  ...header,
  kind: z.literal("runtime-manifest"),
  workflows: z.array(RuntimeWorkflowSchema),
});

export const DocumentationRecordSchema = z.strictObject({
  id: text,
  revision,
  title: text,
  description: text.optional(),
  domain: text,
  intent: WorkflowV1Schema.shape.intent,
  roles: z.array(text),
  entrypoints: z.array(text),
  prerequisites: z.array(text),
  steps: z.array(
    z.strictObject({
      id: text,
      text,
      optional: z.boolean(),
      expected: text.optional(),
      next: text.optional(),
      branches: z.array(z.strictObject({ when: text, next: text })),
    }),
  ),
  completion: text,
  commit: text,
});
export const DocumentationSchema = z.strictObject({
  ...header,
  kind: z.literal("documentation"),
  workflows: z.array(DocumentationRecordSchema),
});

export type SearchRecord = z.infer<typeof SearchRecordSchema>;
export type SearchIndex = z.infer<typeof SearchIndexSchema>;
export type RuntimeWorkflow = z.infer<typeof RuntimeWorkflowSchema>;
export type RuntimeManifest = z.infer<typeof RuntimeManifestSchema>;
export type DocumentationRecord = z.infer<typeof DocumentationRecordSchema>;
export type Documentation = z.infer<typeof DocumentationSchema>;
export type CompiledWorkflows = {
  searchIndex: SearchIndex;
  runtimeManifest: RuntimeManifest;
  documentation: Documentation;
};
