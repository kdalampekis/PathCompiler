import type {
  PathCompiler,
  ProductHelpResult,
  ResolveRequest,
} from "@pathcompiler/sdk-js";
import { z } from "zod";

/**
 * Provider-neutral tool definitions for PathCompiler. Adapters only reshape the
 * same JSON Schema; no model-provider SDK is imported here.
 */
export const TOOL_NAME = "resolve_product_help";
export const TOOL_DESCRIPTION =
  "Find the approved product workflow that answers a user's how-to question about this application. Returns a workflow (with ID, title and routes), several options to choose from, or unsupported. Use it before explaining how to do something in the product; do not invent steps.";

type JsonSchema = Record<string, unknown>;
const contextProperties = {
  route: {
    type: "string",
    description: "The user's current route, e.g. /clients",
    maxLength: 500,
  },
  role: { type: "string", description: "The user's role", maxLength: 120 },
  permissions: {
    type: "array",
    items: { type: "string", maxLength: 200 },
    maxItems: 500,
    description: "Permissions the user holds",
  },
  featureFlags: {
    type: "object",
    additionalProperties: { type: "boolean" },
    description: "Feature flags enabled or disabled for the user",
  },
} as const;

const querySchema = {
  type: "string",
  description: "The user's question in their own words",
  maxLength: 500,
} as const;

/** Generic JSON Schema (draft 2020-12 compatible) for the tool input. */
export const INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    query: querySchema,
    context: {
      type: "object",
      properties: contextProperties,
      additionalProperties: false,
    },
  },
  required: ["query"],
  additionalProperties: false,
};

/**
 * OpenAI strict mode requires every property to be required and optional values
 * to be nullable; nulls are mapped back to "absent" by the handler.
 */
const nullable = (schema: Record<string, unknown>) => {
  const { type, ...rest } = schema;
  return { ...rest, type: [type as string, "null"] };
};
export const STRICT_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    query: querySchema,
    context: {
      type: ["object", "null"],
      properties: {
        route: nullable(contextProperties.route),
        role: nullable(contextProperties.role),
        permissions: nullable(contextProperties.permissions),
        // Strict mode cannot express open maps; flags are name/value pairs.
        featureFlags: {
          type: ["array", "null"],
          description: contextProperties.featureFlags.description,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              enabled: { type: "boolean" },
            },
            required: ["name", "enabled"],
            additionalProperties: false,
          },
        },
      },
      required: ["route", "role", "permissions", "featureFlags"],
      additionalProperties: false,
    },
  },
  required: ["query", "context"],
  additionalProperties: false,
};

/** Generic description consumable by any JSON Schema tool runtime. */
export function jsonSchemaTool() {
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    inputSchema: INPUT_SCHEMA,
  };
}
/** Anthropic Messages API `tools[]` entry. */
export function anthropicTool() {
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    input_schema: INPUT_SCHEMA,
  };
}
/** OpenAI function tool: Chat Completions (nested) or Responses (flat) shape. */
export function openAITool(options: { api?: "chat" | "responses" } = {}) {
  const definition = {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: STRICT_INPUT_SCHEMA,
    strict: true,
  };
  return options.api === "responses"
    ? { type: "function" as const, ...definition }
    : { type: "function" as const, function: definition };
}

const InputSchema = z.strictObject({
  query: z.string().max(500),
  context: z
    .strictObject({
      route: z.string().max(500).nullable().optional(),
      role: z.string().max(120).nullable().optional(),
      permissions: z.array(z.string().max(200)).max(500).nullable().optional(),
      featureFlags: z
        .union([
          z.record(z.string(), z.boolean()),
          z.array(z.strictObject({ name: z.string(), enabled: z.boolean() })),
        ])
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

export class ToolInputError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ToolInputError";
  }
}

/**
 * Normalizes tool arguments from any provider: a JSON string (OpenAI) or an
 * object (Anthropic, LangChain), strict-mode nulls and flag pair arrays.
 */
export function parseToolInput(raw: unknown): ResolveRequest {
  let value = raw;
  if (typeof raw === "string")
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new ToolInputError("Tool arguments are not valid JSON.", {
        cause: error,
      });
    }
  const parsed = InputSchema.safeParse(value);
  if (!parsed.success)
    throw new ToolInputError(
      "Provide {query} (at most 500 characters) and an optional context with route, role, permissions and featureFlags.",
      { cause: parsed.error },
    );
  const { query, context } = parsed.data;
  if (!context) return { query };
  const flags = context.featureFlags;
  const featureFlags = Array.isArray(flags)
    ? Object.fromEntries(flags.map((flag) => [flag.name, flag.enabled]))
    : flags;
  return {
    query,
    context: {
      ...(context.route ? { route: context.route } : {}),
      ...(context.role ? { role: context.role } : {}),
      ...(context.permissions ? { permissions: context.permissions } : {}),
      ...(featureFlags ? { featureFlags } : {}),
    },
  };
}

/** The provider-neutral core call every adapter uses. */
export async function resolveProductHelp(
  client: PathCompiler,
  input: unknown,
): Promise<ProductHelpResult> {
  return client.resolve(parseToolInput(input));
}

/** Serializes a result for a tool-result message. */
export function toolResultText(result: ProductHelpResult): string {
  return JSON.stringify(result);
}

/** LangChain-style structured tool shape (name, description, schema, invoke). */
export function langChainTool(client: PathCompiler) {
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    schema: INPUT_SCHEMA,
    async invoke(input: unknown): Promise<string> {
      return toolResultText(await resolveProductHelp(client, input));
    },
  };
}
