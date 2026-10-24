import { z } from "zod";
import type { ProductHelpResolver, ProductHelpResult } from "./index.js";

const expected = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("workflow"), id: z.string().min(1) }),
  z.strictObject({
    type: z.literal("ambiguous"),
    ids: z.array(z.string().min(1)).min(1),
  }),
  z.strictObject({ type: z.literal("unsupported") }),
]);
const evaluationCase = z.strictObject({
  query: z.string().max(500),
  expected,
});
export const EvaluationDatasetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  description: z.string(),
  targetAccuracy: z.number().min(0).max(1),
  cases: z.array(evaluationCase).min(1),
  controls: z.array(evaluationCase),
});
export type EvaluationDataset = z.infer<typeof EvaluationDatasetSchema>;

export type EvaluationOutcome = {
  query: string;
  expected: z.infer<typeof expected>;
  actual: ProductHelpResult;
  correct: boolean;
};
export type EvaluationReport = {
  accuracy: number;
  targetAccuracy: number;
  passed: boolean;
  cases: EvaluationOutcome[];
  controls: EvaluationOutcome[];
};

/** Accuracy counts `cases`; every control must also be correct to pass. */
export function evaluateResolver(
  resolver: ProductHelpResolver,
  dataset: unknown,
): EvaluationReport {
  const parsed = EvaluationDatasetSchema.parse(dataset);
  const run = (item: z.infer<typeof evaluationCase>): EvaluationOutcome => {
    const actual = resolver.resolveProductHelp({ query: item.query });
    return {
      query: item.query,
      expected: item.expected,
      actual,
      correct: matches(item.expected, actual),
    };
  };
  const cases = parsed.cases.map(run);
  const controls = parsed.controls.map(run);
  const accuracy =
    cases.filter((outcome) => outcome.correct).length / cases.length;
  return {
    accuracy,
    targetAccuracy: parsed.targetAccuracy,
    passed:
      accuracy >= parsed.targetAccuracy &&
      controls.every((outcome) => outcome.correct),
    cases,
    controls,
  };
}

function matches(
  wanted: z.infer<typeof expected>,
  actual: ProductHelpResult,
): boolean {
  if (wanted.type === "workflow")
    return actual.type === "workflow_help" && actual.workflowId === wanted.id;
  if (wanted.type === "ambiguous")
    return (
      actual.type === "ambiguous" &&
      actual.candidates.map((item) => item.workflowId).join() ===
        [...wanted.ids].sort().join()
    );
  return actual.type === "unsupported";
}
