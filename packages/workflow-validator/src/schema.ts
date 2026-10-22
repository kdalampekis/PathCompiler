import { z } from "zod";

export const ValidationIssueSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  stepId: z.string().min(1).optional(),
  evidenceId: z.string().min(1).optional(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export const ValidationCheckSchema = z.strictObject({
  name: z.enum([
    "schema",
    "structure",
    "repository",
    "evidence",
    "testComparison",
    "browser",
  ]),
  status: z.enum(["passed", "failed", "not-run"]),
  details: z.string().min(1),
});
export type ValidationCheck = z.infer<typeof ValidationCheckSchema>;
export const ValidationReportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    workflowId: z.string().nullable(),
    repositoryCommit: z.string().nullable(),
    valid: z.boolean(),
    errors: z.array(ValidationIssueSchema),
    warnings: z.array(ValidationIssueSchema),
    checks: z.array(ValidationCheckSchema),
  })
  .superRefine((report, context) => {
    const required = [
      "schema",
      "structure",
      "repository",
      "evidence",
      "testComparison",
      "browser",
    ];
    if (
      report.checks.length !== required.length ||
      !required.every((name) =>
        report.checks.some((check) => check.name === name),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Every validation check must appear exactly once",
      });
    const valid =
      report.errors.length === 0 &&
      !report.checks.some((check) => check.status === "failed") &&
      required
        .slice(0, 4)
        .every(
          (name) =>
            report.checks.find((check) => check.name === name)?.status ===
            "passed",
        );
    if (report.valid !== valid)
      context.addIssue({
        code: "custom",
        message: "Validation outcome must agree with checks and errors",
      });
  });
export type ValidationReport = z.infer<typeof ValidationReportSchema>;
