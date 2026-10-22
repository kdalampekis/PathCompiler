import {
  DiagnosticSchema,
  RelativePathSchema,
  SourceProjectSchema,
} from "@pathcompiler/source-model";
import { z } from "zod";

export const TestValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: z.json() }),
  z.strictObject({
    kind: z.literal("regex"),
    pattern: z.string(),
    flags: z.string(),
  }),
  z.strictObject({ kind: z.literal("dynamic") }),
]);
export type TestValue = z.infer<typeof TestValueSchema>;
export const TargetHintSchema = z.strictObject({
  method: z.string(),
  argument: TestValueSchema,
  options: TestValueSchema,
});
export type TargetHint = z.infer<typeof TargetHintSchema>;
export const TestTargetSchema = z.strictObject({
  page: z.string(),
  hints: z.array(TargetHintSchema),
  resolution: z.enum(["matched", "ambiguous", "unresolved"]),
  graphNodeIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type TestTarget = z.infer<typeof TestTargetSchema>;
const LocationSchema = z.strictObject({
  file: RelativePathSchema,
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});
export const TestEvidenceSchema = LocationSchema.extend({
  repositoryCommit: z.string().nullable(),
  callSites: z.array(LocationSchema),
});
const event = {
  order: z.number().int().nonnegative(),
  phase: z.enum(["setup", "test", "teardown"]),
  conditional: z.boolean(),
  evidence: TestEvidenceSchema,
};
export const TestActionSchema = z.strictObject({
  ...event,
  kind: z.enum(["navigate", "ui", "page", "request", "unsupported"]),
  operation: z.string(),
  value: TestValueSchema,
  target: TestTargetSchema.nullable(),
});
export type TestAction = z.infer<typeof TestActionSchema>;
export const TestAssertionSchema = z.strictObject({
  ...event,
  matcher: z.string(),
  expected: TestValueSchema,
  negated: z.boolean(),
  soft: z.boolean(),
  subject: z.enum(["locator", "page", "value"]),
  target: TestTargetSchema.nullable(),
});
export type TestAssertion = z.infer<typeof TestAssertionSchema>;
export const TestTraceSchema = z.strictObject({
  id: z.string(),
  testName: z.string(),
  sourceFile: RelativePathSchema,
  mode: z.enum(["normal", "only", "skip", "fixme"]),
  startRoute: z.string().nullable(),
  actions: z.array(TestActionSchema),
  assertions: z.array(TestAssertionSchema),
  terminalAssertion: TestAssertionSchema.nullable(),
  partial: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
});
export type TestTrace = z.infer<typeof TestTraceSchema>;
export const TestTraceReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evidenceOnly: z.literal(true),
  execution: z.literal("not-run"),
  repository: SourceProjectSchema.shape.repository,
  diagnostics: z.array(DiagnosticSchema),
  traces: z.array(TestTraceSchema),
});
export type TestTraceReport = z.infer<typeof TestTraceReportSchema>;
