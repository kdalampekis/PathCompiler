import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { FormalProductModel } from "@pathcompiler/formal-model";
import {
  type CapabilityEvidence,
  detectDeadFeatures,
  findMinimalEnablement,
  ProductPropertySchema,
  type ProductReasoner,
  ReasoningQueryError,
} from "@pathcompiler/reasoner-core";
import { clusterTraces } from "@pathcompiler/trace-clustering";
import { z } from "zod";

/**
 * Developer reasoning surfaces (reasoning spec §73–§75): one service behind
 * the `/v1/reason/*` endpoints and the developer reasoning MCP. Results are
 * product-semantic: goals, actions, constraints and evidence, never solver
 * statistics. These surfaces are for developers and agents working on the
 * product, never for end users.
 */
export const REASONING_OPERATIONS = [
  "reachability",
  "why-unreachable",
  "plan",
  "alternatives",
  "verify-property",
  "minimal-enablement",
  "dead-features",
] as const;
export type ReasoningOperation = (typeof REASONING_OPERATIONS)[number];

const goal = z.string().min(1).max(200);
const context = z
  .record(
    z.string().min(1).max(200),
    z.union([z.string(), z.boolean(), z.number()]),
  )
  .optional();
const inputs = {
  reachability: z.strictObject({ goal, context }),
  "why-unreachable": z.strictObject({ goal, context }),
  plan: z.strictObject({ goal, context }),
  alternatives: z.strictObject({
    goal,
    context,
    slack: z.number().int().min(0).max(3).optional(),
  }),
  "verify-property": z.strictObject({ property: z.unknown() }),
  "minimal-enablement": z.strictObject({ goal, context }),
  "dead-features": z.strictObject({}),
} as const;

export class ReasoningRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReasoningRequestError";
  }
}

/** Drops solver statistics anywhere in a result. */
function productSemantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(productSemantic);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "stats")
        .map(([key, item]) => [key, productSemantic(item)]),
    );
  return value;
}

export type ReasoningService = {
  operations: readonly ReasoningOperation[];
  handle(operation: string, input: unknown): Promise<unknown>;
};

export function createReasoningService(options: {
  reasoner: ProductReasoner;
  model: FormalProductModel;
  /** Static-analysis capabilities, for missing-transition checks. */
  capabilities?: CapabilityEvidence[];
}): ReasoningService {
  const { reasoner, model } = options;
  return {
    operations: REASONING_OPERATIONS,
    async handle(operation, input) {
      if (!REASONING_OPERATIONS.includes(operation as ReasoningOperation))
        throw new ReasoningRequestError(
          `Unknown reasoning operation ${operation}. Operations: ${REASONING_OPERATIONS.join(", ")}.`,
        );
      const schema = inputs[operation as ReasoningOperation];
      const parsed = schema.safeParse(input ?? {});
      if (!parsed.success)
        throw new ReasoningRequestError(
          `Invalid ${operation} request: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ")}`,
        );
      const body = parsed.data as {
        goal: string;
        context?: Record<string, string | boolean | number>;
        slack?: number;
        property?: unknown;
      };
      const query = {
        goal: body.goal,
        ...(body.context ? { context: body.context } : {}),
      };
      try {
        switch (operation as ReasoningOperation) {
          case "reachability":
            return productSemantic(
              await reasoner.checkReachability(model, query),
            );
          case "why-unreachable":
            return productSemantic(
              await reasoner.explainUnreachable(model, query),
            );
          case "plan":
            return productSemantic(await reasoner.findPlan(model, query));
          case "alternatives": {
            const result = await reasoner.enumeratePlans(model, {
              ...query,
              ...(body.slack === undefined ? {} : { slack: body.slack }),
            });
            return productSemantic(
              result.status === "found"
                ? { ...result, variants: clusterTraces(result.plans) }
                : result,
            );
          }
          case "verify-property": {
            const property = ProductPropertySchema.safeParse(body.property);
            if (!property.success)
              throw new ReasoningRequestError(
                `Invalid property: ${property.error.issues.map((issue) => issue.message).join("; ")}`,
              );
            return productSemantic(
              await reasoner.verifyProperty(model, property.data),
            );
          }
          case "minimal-enablement":
            return productSemantic(
              await findMinimalEnablement(reasoner, model, query),
            );
          case "dead-features":
            return productSemantic(
              await detectDeadFeatures(reasoner, model, {
                ...(options.capabilities
                  ? { capabilities: options.capabilities }
                  : {}),
              }),
            );
        }
      } catch (error) {
        // Unknown goals, bad contexts: actionable request errors.
        if (error instanceof ReasoningQueryError)
          throw new ReasoningRequestError(error.message);
        throw error;
      }
    },
  };
}

const TOOLS: {
  name: string;
  operation: ReasoningOperation;
  title: string;
  description: string;
  input: z.ZodRawShape;
}[] = [
  {
    name: "pathcompiler.check_reachability",
    operation: "reachability",
    title: "Check reachability",
    description:
      "Whether a business goal can be reached under a context (role, flags), with a witness trace or a proof.",
    input: { goal, context },
  },
  {
    name: "pathcompiler.explain_unreachable",
    operation: "why-unreachable",
    title: "Explain unreachable",
    description:
      "The minimal product constraints (permissions, flags, preconditions) that make a goal unreachable, with source evidence.",
    input: { goal, context },
  },
  {
    name: "pathcompiler.find_plan",
    operation: "plan",
    title: "Find plan",
    description:
      "The shortest sequence of product actions that reaches a goal.",
    input: { goal, context },
  },
  {
    name: "pathcompiler.list_alternative_paths",
    operation: "alternatives",
    title: "List alternative paths",
    description:
      "Semantically distinct ways to reach a goal (business variants), from bounded plan enumeration.",
    input: { goal, context, slack: z.number().int().min(0).max(3).optional() },
  },
  {
    name: "pathcompiler.verify_product_property",
    operation: "verify-property",
    title: "Verify product property",
    description:
      "Bounded check of a product property (never, always, invariant, via); a violation returns a counterexample trace.",
    input: { property: z.unknown() },
  },
  {
    name: "pathcompiler.minimal_enablement",
    operation: "minimal-enablement",
    title: "Minimal enablement",
    description:
      "The smallest context or guard changes that would make an unreachable goal reachable. Diagnostic only.",
    input: { goal, context },
  },
  {
    name: "pathcompiler.dead_features",
    operation: "dead-features",
    title: "Dead features",
    description:
      "Unreachable capabilities, actions that can never fire, and capabilities with UI and API but no formal transitions.",
    input: {},
  },
];
export const REASONING_MCP_TOOL_NAMES = TOOLS.map((tool) => tool.name);

/** The developer reasoning MCP: separate from the product-help MCP and its users. */
export function createReasoningMcpServer(
  service: ReasoningService,
  info: { name?: string; version?: string } = {},
): McpServer {
  const server = new McpServer({
    name: info.name ?? "pathcompiler-reasoning",
    version: info.version ?? "0.0.0",
  });
  for (const tool of TOOLS)
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (input: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          const result = await service.handle(tool.operation, input);
          const structuredContent = { result } as Record<string, unknown>;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(structuredContent, null, 2),
              },
            ],
            structuredContent,
          };
        } catch (error) {
          if (!(error instanceof ReasoningRequestError)) throw error;
          return {
            isError: true,
            content: [{ type: "text", text: error.message }],
          };
        }
      },
    );
  return server;
}

export async function serveReasoningStdio(
  service: ReasoningService,
  info?: { name?: string; version?: string },
): Promise<McpServer> {
  const server = createReasoningMcpServer(service, info);
  await server.connect(new StdioServerTransport());
  return server;
}
