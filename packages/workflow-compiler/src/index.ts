import { createHash } from "node:crypto";
import type {
  WorkflowCondition,
  WorkflowStep,
  WorkflowTerminalCondition,
  WorkflowV1,
} from "@pathcompiler/workflow-ir";
import { ApprovedWorkflowSchema } from "@pathcompiler/workflow-review";
import {
  COMPILER_VERSION,
  type CompiledWorkflows,
  type DocumentationRecord,
  DocumentationSchema,
  RuntimeManifestSchema,
  type RuntimeWorkflow,
  SearchIndexSchema,
  type SearchRecord,
} from "./schema.js";

export * from "./schema.js";

/**
 * Pure and deterministic: the same approved records and compiler version always
 * produce identical output, regardless of input order.
 */
export function compileWorkflows(
  approved: readonly unknown[],
): CompiledWorkflows {
  const workflows = approved
    .map((record) => ApprovedWorkflowSchema.parse(record).workflow)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const [index, workflow] of workflows.entries())
    if (workflows[index + 1]?.id === workflow.id)
      throw new Error(
        `Duplicate approved workflow ${workflow.id}. Keep one approved record per ID.`,
      );
  const compiled = workflows.map((workflow) => ({
    workflow,
    revision: workflowRevision(workflow),
  }));
  const base = { schemaVersion: 1, compilerVersion: COMPILER_VERSION } as const;
  return {
    searchIndex: SearchIndexSchema.parse({
      ...base,
      kind: "search-index",
      workflows: compiled.map(({ workflow, revision }) =>
        searchRecord(workflow, revision),
      ),
    }),
    runtimeManifest: RuntimeManifestSchema.parse({
      ...base,
      kind: "runtime-manifest",
      workflows: compiled.map(({ workflow, revision }) =>
        runtimeWorkflow(workflow, revision),
      ),
    }),
    documentation: DocumentationSchema.parse({
      ...base,
      kind: "documentation",
      workflows: compiled.map(({ workflow, revision }) =>
        documentationRecord(workflow, revision),
      ),
    }),
  };
}

/** Content hash of the approved workflow; independent of key order and reviewer. */
export function workflowRevision(workflow: WorkflowV1): string {
  return `sha256:${createHash("sha256").update(canonicalJson(workflow)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function searchRecord(workflow: WorkflowV1, revision: string): SearchRecord {
  const preconditions = workflow.preconditions ?? [];
  const flags = new Map<string, { flag: string; enabled: boolean }>();
  for (const condition of preconditions)
    if (condition.type === "feature_flag")
      flags.set(`${condition.flag}:${condition.enabled}`, {
        flag: condition.flag,
        enabled: condition.enabled,
      });
  return {
    id: workflow.id,
    revision,
    title: workflow.title,
    ...(workflow.description === undefined
      ? {}
      : { description: workflow.description }),
    domain: workflow.domain,
    aliases: [],
    action: workflow.intent.action,
    entity: workflow.intent.entity,
    qualifiers: workflow.intent.qualifiers ?? [],
    roles: unique(workflow.roles ?? []),
    routes: unique(
      workflow.entrypoints.flatMap((entry) =>
        entry.route === undefined ? [] : [entry.route],
      ),
    ),
    permissions: unique(
      preconditions.flatMap((condition) =>
        condition.type === "permission" ? [condition.permission] : [],
      ),
    ),
    featureFlags: [...flags.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, value]) => value),
  };
}

function runtimeWorkflow(
  workflow: WorkflowV1,
  revision: string,
): RuntimeWorkflow {
  return {
    id: workflow.id,
    revision,
    title: workflow.title,
    entrypoints: workflow.entrypoints,
    preconditions: workflow.preconditions ?? [],
    steps: workflow.steps.map(({ evidence: _evidence, ...step }) => step),
    terminal: workflow.terminal,
  };
}

function documentationRecord(
  workflow: WorkflowV1,
  revision: string,
): DocumentationRecord {
  return {
    id: workflow.id,
    revision,
    title: workflow.title,
    ...(workflow.description === undefined
      ? {}
      : { description: workflow.description }),
    domain: workflow.domain,
    intent: workflow.intent,
    roles: unique(workflow.roles ?? []),
    entrypoints: workflow.entrypoints.map((entry) =>
      entry.route !== undefined && entry.state !== undefined
        ? `${entry.route} (${entry.state})`
        : (entry.route ?? `State ${entry.state}`),
    ),
    prerequisites: (workflow.preconditions ?? []).map(describeCondition),
    steps: workflow.steps.map((step) => ({
      id: step.id,
      text: step.instruction?.text ?? describeAction(step),
      optional: step.optional ?? false,
      ...(step.expected === undefined
        ? {}
        : { expected: describeCondition(step.expected) }),
      ...(step.next === undefined ? {} : { next: step.next }),
      branches: (step.branches ?? []).map((branch) => ({
        when: describeCondition(branch.when),
        next: branch.next,
      })),
    })),
    completion: describeTerminal(workflow.terminal),
    commit: workflow.repository.commit,
  };
}

function describeAction(step: WorkflowStep): string {
  const target = step.target ?? "the current page";
  switch (step.action.type) {
    case "click":
      return `Select ${target}`;
    case "input":
      return `Enter ${target}`;
    case "select":
      return `Choose ${target}`;
    case "navigate":
      return `Go to ${step.action.route}`;
    case "explain":
      return `Review ${target}`;
    case "wait":
      return `Wait for ${target}`;
  }
}

export function describeCondition(condition: WorkflowCondition): string {
  switch (condition.type) {
    case "route_matches":
      return `The route matches ${condition.pattern}`;
    case "target_appears":
      return `${condition.target} appears`;
    case "element_text":
      return condition.match === "exact"
        ? `${condition.target} shows "${condition.text}"`
        : `${condition.target} contains "${condition.text}"`;
    case "element_count":
      return condition.count === 0
        ? `${condition.target} is no longer shown`
        : `${condition.target} is shown ${condition.count} time${condition.count === 1 ? "" : "s"}`;
    case "event_emitted":
      return `The ${condition.event} event occurs`;
    case "url_changed":
      return condition.url === undefined
        ? "The URL changes"
        : `The URL changes to ${condition.url}`;
    case "element_state":
      return `${condition.target} is ${condition.state}`;
    case "explicit_next":
      return "Continue to the next step";
    case "permission":
      return `You have the ${condition.permission} permission`;
    case "feature_flag":
      return `The ${condition.flag} feature is ${condition.enabled ? "enabled" : "disabled"}`;
  }
}

function describeTerminal(terminal: WorkflowTerminalCondition): string {
  if ("any" in terminal)
    return terminal.any.map(describeCondition).join(" or ");
  if ("all" in terminal)
    return terminal.all.map(describeCondition).join(" and ");
  return describeCondition(terminal);
}
