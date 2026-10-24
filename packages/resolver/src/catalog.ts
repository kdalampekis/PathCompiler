import {
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

// Capabilities are computed at compile time; re-exported for existing callers.
export {
  type SupportedActions,
  SupportedActionsSchema,
  supportedActions,
} from "@pathcompiler/workflow-compiler/schema";
