import { z } from "zod";

/** The C8 browser verification report, without Playwright, for consumers such as diagnosis. */
const status = z.enum(["not-run", "passed", "failed"]);
const stage = z.enum([
  "preflight",
  "prepare",
  "open",
  "resolve",
  "action",
  "expected",
  "terminal",
]);
export const BrowserVerificationReportV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    kind: z.literal("browser-verification"),
    /** A distinct evidence class (`browser`) for evidence fusion. */
    evidenceClass: z.literal("browser"),
    workflowId: z.string().nullable(),
    workflowVersion: z.number().int().positive().nullable(),
    candidateCommit: z.string().nullable(),
    origin: z.string().nullable(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    valid: z.boolean(),
    steps: z.array(
      z.strictObject({
        stepId: z.string(),
        target: z.string().nullable(),
        action: z.enum([
          "click",
          "input",
          "select",
          "navigate",
          "explain",
          "wait",
        ]),
        status,
        expected: status,
      }),
    ),
    terminal: status,
    /** Destructive-looking targets the policy allowed for this run. */
    destructiveAllowed: z.array(z.string()),
    failure: z
      .strictObject({
        code: z.string(),
        stage,
        message: z.string(),
        stepId: z.string().optional(),
        target: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((report, context) => {
    const valid =
      !report.failure &&
      report.terminal === "passed" &&
      report.steps.length > 0 &&
      report.steps.every(
        (step) => step.status === "passed" && step.expected !== "failed",
      );
    if (report.valid !== valid)
      context.addIssue({
        code: "custom",
        message: "Browser result must agree with observed steps and terminal",
      });
  });
export type BrowserVerificationReportV2 = z.infer<
  typeof BrowserVerificationReportV2Schema
>;
export type BrowserVerificationStage = z.infer<typeof stage>;
