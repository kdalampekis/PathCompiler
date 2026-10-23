import {
  createResolver,
  type ProductHelpResult,
  ProductHelpResultSchema,
  type RelatedWorkflow,
  RelatedWorkflowSchema,
  type ResolveContext,
  type ResolveRequest,
  ResolveRequestSchema,
  relatedWorkflows,
  type SupportedActions,
  supportedActions,
} from "@pathcompiler/resolver";
import {
  DocumentationRecordSchema,
  DocumentationSchema,
  RuntimeManifestSchema,
  type RuntimeWorkflow,
  RuntimeWorkflowSchema,
  SearchIndexSchema,
} from "@pathcompiler/workflow-compiler/schema";
import { z } from "zod";

export type {
  ProductHelpResult,
  RelatedWorkflow,
  ResolveContext,
  ResolveRequest,
  SupportedActions,
} from "@pathcompiler/resolver";
export type { RuntimeWorkflow } from "@pathcompiler/workflow-compiler/schema";
export { createHttpTransport, type HttpTransportOptions } from "./http.js";

/** Readable workflow description. Omits the repository commit kept in documentation.json. */
export const WorkflowDetailsSchema = DocumentationRecordSchema.omit({
  commit: true,
});
export type WorkflowDetails = z.infer<typeof WorkflowDetailsSchema>;
export type WorkflowSummary = { id: string; revision: string; title: string };

export interface RuntimeTransport {
  resolve(request: ResolveRequest): Promise<ProductHelpResult>;
  getWorkflow(id: string): Promise<WorkflowDetails>;
  getRuntimeManifest(id: string): Promise<RuntimeWorkflow>;
  getRelatedWorkflows(id: string): Promise<RelatedWorkflow[]>;
}

export class PathCompilerError extends Error {
  constructor(
    readonly code:
      | "invalid-request"
      | "workflow-not-found"
      | "invalid-response"
      | "unauthorized"
      | "transport-failed",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PathCompilerError";
  }
}

const WorkflowIdSchema = z.string().min(1).max(200);
const OptionsSchema = z.strictObject({
  project: z.string().min(1).max(200),
  transport: z.custom<RuntimeTransport>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      [
        "resolve",
        "getWorkflow",
        "getRuntimeManifest",
        "getRelatedWorkflows",
      ].every(
        (name) =>
          typeof (value as Record<string, unknown>)[name] === "function",
      ),
    "Transport must implement resolve, getWorkflow, getRuntimeManifest and getRelatedWorkflows",
  ),
});
export type PathCompilerOptions = z.infer<typeof OptionsSchema>;

/** Headless client. Every transport response is validated before it is returned. */
export class PathCompiler {
  readonly project: string;
  readonly workflows: {
    get(id: string): Promise<WorkflowDetails>;
    getRuntimeManifest(id: string): Promise<RuntimeWorkflow>;
    /** Workflows sharing the entity or domain, entity matches first. */
    related(id: string): Promise<RelatedWorkflow[]>;
    /** Explain/checklist/navigate/guide availability; never execute. */
    getSupportedActions(id: string): Promise<SupportedActions>;
    /** Workflows the resolver considers relevant: one match, all ambiguous options, or none. */
    search(query: string, context?: ResolveContext): Promise<WorkflowSummary[]>;
  };
  readonly #transport: RuntimeTransport;

  constructor(options: PathCompilerOptions) {
    const parsed = OptionsSchema.safeParse(options);
    if (!parsed.success)
      throw new PathCompilerError(
        "invalid-request",
        "Provide a project name and a transport implementing resolve, getWorkflow, getRuntimeManifest and getRelatedWorkflows.",
        { cause: parsed.error },
      );
    this.project = parsed.data.project;
    this.#transport = parsed.data.transport;
    this.workflows = {
      get: async (id) =>
        checked(
          WorkflowDetailsSchema,
          await this.#transport.getWorkflow(workflowId(id)),
          "workflow details",
        ),
      getRuntimeManifest: async (id) =>
        checked(
          RuntimeWorkflowSchema,
          await this.#transport.getRuntimeManifest(workflowId(id)),
          "runtime manifest",
        ),
      related: async (id) =>
        checked(
          z.array(RelatedWorkflowSchema),
          await this.#transport.getRelatedWorkflows(workflowId(id)),
          "related workflow list",
        ),
      getSupportedActions: async (id) =>
        supportedActions(await this.workflows.getRuntimeManifest(id)),
      search: async (query, context) => {
        const result = await this.resolve(
          context === undefined ? { query } : { query, context },
        );
        if (result.type === "workflow")
          return [
            {
              id: result.workflow.id,
              revision: result.workflow.revision,
              title: result.workflow.title,
            },
          ];
        if (result.type === "ambiguous") return result.options;
        return [];
      },
    };
  }

  async resolve(request: ResolveRequest): Promise<ProductHelpResult> {
    const parsed = ResolveRequestSchema.safeParse(request);
    if (!parsed.success)
      throw new PathCompilerError(
        "invalid-request",
        "Resolve requests need a query of at most 500 characters and an optional route/role/permissions/featureFlags context.",
        { cause: parsed.error },
      );
    return checked(
      ProductHelpResultSchema,
      await this.#transport.resolve(parsed.data),
      "help result",
    );
  }
}

function workflowId(id: string): string {
  const parsed = WorkflowIdSchema.safeParse(id);
  if (!parsed.success)
    throw new PathCompilerError(
      "invalid-request",
      "Workflow ID must be a non-empty string of at most 200 characters.",
    );
  return parsed.data;
}

function checked<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new PathCompilerError(
      "invalid-response",
      `The transport returned an invalid ${label}. Check that the runtime and SDK versions match.`,
      { cause: parsed.error },
    );
  return parsed.data;
}

export type StaticArtifacts = {
  searchIndex: unknown;
  runtimeManifest: unknown;
  documentation: unknown;
};

/**
 * Offline transport over the three files written by `pathcompiler build`.
 * No network access; suitable for bundling with an application.
 */
export function createStaticTransport(
  artifacts: StaticArtifacts,
): RuntimeTransport {
  const parsed = z
    .strictObject({
      searchIndex: SearchIndexSchema,
      runtimeManifest: RuntimeManifestSchema,
      documentation: DocumentationSchema,
    })
    .safeParse(artifacts);
  if (!parsed.success)
    throw new PathCompilerError(
      "invalid-request",
      "Static artifacts must be the search index, runtime manifest and documentation from pathcompiler build.",
      { cause: parsed.error },
    );
  const { searchIndex, runtimeManifest, documentation } = parsed.data;
  const builds = [searchIndex, runtimeManifest, documentation];
  const fingerprint = (items: { id: string; revision: string }[]) =>
    items.map((item) => `${item.id}@${item.revision}`).join();
  if (
    new Set(builds.map((build) => build.compilerVersion)).size !== 1 ||
    new Set(builds.map((build) => fingerprint(build.workflows))).size !== 1
  )
    throw new PathCompilerError(
      "invalid-request",
      "Static artifacts come from different builds. Run pathcompiler build and use all three files together.",
    );
  const resolver = createResolver(searchIndex);
  const runtime = new Map(
    runtimeManifest.workflows.map((item) => [item.id, item]),
  );
  const details = new Map(
    documentation.workflows.map(({ commit: _commit, ...item }) => [
      item.id,
      item,
    ]),
  );
  const notFound = (id: string) =>
    new PathCompilerError(
      "workflow-not-found",
      `No approved workflow ${id} in these artifacts. Approve it and rebuild.`,
    );
  const find = <T>(items: Map<string, T>, id: string): T => {
    const item = items.get(id);
    if (item === undefined) throw notFound(id);
    return structuredClone(item);
  };
  return {
    resolve: async (request) => resolver.resolveProductHelp(request),
    getWorkflow: async (id) => find(details, id),
    getRuntimeManifest: async (id) => find(runtime, id),
    getRelatedWorkflows: async (id) => {
      const related = relatedWorkflows(searchIndex, id);
      if (related === null) throw notFound(id);
      return related;
    },
  };
}
