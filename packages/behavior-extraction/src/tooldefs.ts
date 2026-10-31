import { type Expr, e, formatExpression } from "@pathcompiler/behavior-ir";
import {
  type ExtractedFragment,
  emptyFragment,
  provenanceOf,
  type SourceFile,
  snake,
} from "./common.js";

/**
 * Tool definitions of agentic software, read as operations. An agent's tools
 * are declared in JSON Schema in every major format (OpenAI function calling,
 * Anthropic tools, MCP `tools/list`, plain `{name, parameters}`), whatever the
 * language the agent is written in. Each tool becomes an operation whose
 * parameters are variables and whose declared bounds are preconditions, so the
 * action gate can refuse a call that breaks its own schema and business rules
 * can apply to the same operation. Declarations read verbatim are EXPLICIT.
 */
type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type Tool = { name: string; description?: string; schema: Json };

/** The tools declared in a parsed JSON document, in any of the known shapes. */
export function toolsIn(root: unknown): Tool[] {
  const candidates: unknown[] = Array.isArray(root)
    ? root
    : isObject(root) && Array.isArray(root.tools)
      ? root.tools
      : isObject(root) &&
          isObject(root.result) &&
          Array.isArray(root.result.tools)
        ? root.result.tools
        : [];
  const tools: Tool[] = [];
  for (const raw of candidates) {
    if (!isObject(raw)) continue;
    const body = isObject(raw.function) ? raw.function : raw;
    const schema = [body.parameters, body.input_schema, body.inputSchema].find(
      isObject,
    );
    if (typeof body.name !== "string" || !schema) continue;
    tools.push({
      name: body.name,
      ...(typeof body.description === "string"
        ? { description: body.description }
        : {}),
      schema,
    });
  }
  return tools;
}

/** True when the file declares at least one tool. */
export function looksLikeToolDefinitions(content: string): boolean {
  if (!/"(?:parameters|input_schema|inputSchema)"\s*:/.test(content))
    return false;
  try {
    return toolsIn(JSON.parse(content)).length > 0;
  } catch {
    return false;
  }
}

export function extractToolDefinitions(file: SourceFile): ExtractedFragment {
  const out = emptyFragment();
  let root: unknown;
  try {
    root = JSON.parse(file.content);
  } catch {
    return out;
  }
  const provenance = () =>
    provenanceOf({
      sourceType: "CONFIG",
      origin: "EXPLICIT",
      extractionMethod: "SCHEMA_PARSE",
      confidence: "HIGH",
      file: file.path,
    });
  for (const tool of toolsIn(root)) {
    const prefix = snake(tool.name);
    const properties = isObject(tool.schema.properties)
      ? tool.schema.properties
      : {};
    const required = Array.isArray(tool.schema.required)
      ? tool.schema.required.filter((x): x is string => typeof x === "string")
      : [];
    const parameters: string[] = [];
    const preconditions: Expr[] = [];
    const skip = (construct: string, reason: string) =>
      out.unsupported.push({ file: file.path, construct, reason });
    for (const [field, definition] of Object.entries(properties)) {
      const schema = isObject(definition) ? definition : {};
      const id = `${prefix}.${snake(field)}`;
      const where = `${tool.name}.${field}`;
      const description = `${where} (${file.path})`;
      const variable = e.var(id);
      const bounds: Expr[] = [];
      if (schema.type === "integer") {
        out.variables.push({
          id,
          type: "integer",
          scope: "input",
          description,
        });
        if (typeof schema.minimum === "number")
          bounds.push(e.ge(variable, e.lit(schema.minimum)));
        if (typeof schema.maximum === "number")
          bounds.push(e.le(variable, e.lit(schema.maximum)));
        if (typeof schema.exclusiveMinimum === "number")
          bounds.push(e.gt(variable, e.lit(schema.exclusiveMinimum)));
        if (typeof schema.exclusiveMaximum === "number")
          bounds.push(e.lt(variable, e.lit(schema.exclusiveMaximum)));
      } else if (schema.type === "boolean")
        out.variables.push({
          id,
          type: "boolean",
          scope: "input",
          description,
        });
      else if (schema.type === "string" && Array.isArray(schema.enum)) {
        const values = schema.enum.filter(
          (x): x is string => typeof x === "string",
        );
        if (
          values.length === 0 ||
          values.some((x) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(x))
        ) {
          skip(where, "enum values must be identifier-like strings");
          continue;
        }
        out.variables.push({
          id,
          type: "enum",
          scope: "input",
          values,
          description,
        });
      } else if (schema.type === "string")
        out.variables.push({ id, type: "string", scope: "input", description });
      else {
        skip(
          where,
          `type ${String(schema.type)} has no exact BehaviorIR type (integers only, no decimals or structures)`,
        );
        continue;
      }
      parameters.push(id);
      if (required.includes(field)) {
        const evidence = provenance();
        const entry = {
          id: `${id}_required`,
          kind: "required" as const,
          subject: id,
          provenance: [evidence],
        };
        out.dataConstraints.push(entry);
        out.ledger.push({
          kind: "data_constraint",
          text: `required ${id}`,
          provenance: evidence,
        });
      }
      // Bounds on an optional field apply only when it is present.
      if (bounds.length > 0 && !required.includes(field))
        skip(
          where,
          "bounds on an optional field apply only when it is present, so they are not applied",
        );
      else
        for (const bound of bounds) {
          preconditions.push(bound);
          out.ledger.push({
            kind: "precondition",
            text: `${prefix}: ${formatExpression(bound)}`,
            provenance: provenance(),
          });
        }
    }
    out.operations.push({
      id: prefix,
      description: tool.description ?? `Tool ${tool.name}`,
      parameters,
      preconditions,
      postconditions: [],
      effects: [],
      provenance: [provenance()],
    });
  }
  return out;
}
