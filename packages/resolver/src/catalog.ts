import {
  type RuntimeWorkflow,
  RuntimeWorkflowSchema,
  type SearchIndex,
  SearchIndexSchema,
} from "@pathcompiler/workflow-compiler/schema";
import { z } from "zod";

export const RelatedWorkflowSchema = z.strictObject({
  id: z.string(),
  revision: z.string(),
  title: z.string(),
  relation: z.enum(["same-entity", "same-domain"]),
});
export type RelatedWorkflow = z.infer<typeof RelatedWorkflowSchema>;

/**
 * Approved workflows sharing the entity (first) or domain of `id`, in stable ID
 * order. Returns `null` when `id` is not in the index.
 */
export function relatedWorkflows(
  index: SearchIndex,
  id: string,
  limit = 10,
): RelatedWorkflow[] | null {
  const workflows = SearchIndexSchema.parse(index).workflows;
  const source = workflows.find((item) => item.id === id);
  if (!source) return null;
  return workflows
    .filter(
      (item) =>
        item.id !== id &&
        (item.entity === source.entity || item.domain === source.domain),
    )
    .map((item) => ({
      id: item.id,
      revision: item.revision,
      title: item.title,
      relation:
        item.entity === source.entity
          ? ("same-entity" as const)
          : ("same-domain" as const),
    }))
    .sort(
      (a, b) =>
        (a.relation === b.relation
          ? 0
          : a.relation === "same-entity"
            ? -1
            : 1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, Math.max(0, limit));
}

export const SupportedActionsSchema = z.strictObject({
  explain: z.boolean(),
  checklist: z.boolean(),
  /** A static entry route exists; templated routes need concrete parameters. */
  navigate: z.boolean(),
  /** Every step can be followed by the observing guide runtime. */
  guide: z.boolean(),
  /** PathCompiler never executes workflows on the user's behalf. */
  execute: z.literal(false),
});
export type SupportedActions = z.infer<typeof SupportedActionsSchema>;

/** What an assistant or UI can offer for a compiled workflow. */
export function supportedActions(workflow: RuntimeWorkflow): SupportedActions {
  const parsed = RuntimeWorkflowSchema.parse(workflow);
  return {
    explain: true,
    checklist: true,
    navigate: parsed.entrypoints.some(
      (entry) => entry.route !== undefined && !entry.route.includes("["),
    ),
    guide: parsed.steps.every(
      (step) =>
        step.target !== undefined ||
        ["navigate", "explain", "wait"].includes(step.action.type),
    ),
    execute: false,
  };
}
