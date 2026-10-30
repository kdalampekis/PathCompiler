import {
  type Expr,
  e,
  formatExpression,
  type Provenance,
} from "@pathcompiler/behavior-ir";
import { isMap, isScalar, LineCounter, type Node, parseDocument } from "yaml";
import {
  type ExtractedFragment,
  type ExtractionOptions,
  emptyFragment,
  lineRange,
  provenanceOf,
  type SourceFile,
  snake,
} from "./common.js";

/**
 * OpenAPI extractor (JSON or YAML, 3.x). Per operation it reads the request
 * body and parameters: integer bounds and enums become preconditions of an
 * input contract, required fields and security requirements become data
 * constraints. Response status contracts have no BehaviorIR form yet and are
 * listed as unsupported rather than ignored. Everything read verbatim is
 * EXPLICIT.
 */
const METHODS = ["get", "put", "post", "delete", "patch"] as const;
type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function extractOpenApi(
  file: SourceFile,
  options: ExtractionOptions = {},
): ExtractedFragment {
  const out = emptyFragment();
  const counter = new LineCounter();
  const document = parseDocument(file.content, { lineCounter: counter });
  const root: unknown = document.toJS();
  if (!isObject(root) || typeof root.openapi !== "string") return out;
  const bindings = new Map(
    Object.entries(options.bindings ?? {}).map(([key, value]) => [
      snake(key),
      value,
    ]),
  );

  const lines = (path: (string | number)[]): string | undefined => {
    const node = document.getIn(path, true) as Node | null | undefined;
    const range =
      isScalar(node) || isMap(node) || (node && "range" in node)
        ? (node as Node).range
        : undefined;
    if (!range) return undefined;
    return lineRange(
      counter.linePos(range[0]).line,
      counter.linePos(Math.max(range[0], range[1] - 1)).line,
    );
  };
  const provenance = (path: (string | number)[]) =>
    provenanceOf({
      sourceType: "OPENAPI",
      origin: "EXPLICIT",
      extractionMethod: "SCHEMA_PARSE",
      confidence: "HIGH",
      file: file.path,
      lines: lines(path),
    });
  const resolve = (schema: unknown): unknown => {
    if (isObject(schema) && typeof schema.$ref === "string") {
      const parts = schema.$ref.replace(/^#\//, "").split("/");
      let current: unknown = root;
      for (const part of parts)
        current = isObject(current) ? current[part] : undefined;
      return current;
    }
    return schema;
  };
  const skip = (path: (string | number)[], construct: string, reason: string) =>
    out.unsupported.push({
      file: file.path,
      ...(lines(path) ? { lines: lines(path) as string } : {}),
      construct,
      reason,
    });

  const paths = isObject(root.paths) ? root.paths : {};
  const globalSecurity =
    Array.isArray(root.security) && root.security.length > 0;
  for (const [route, item] of Object.entries(paths)) {
    if (!isObject(item)) continue;
    for (const method of METHODS) {
      const operation = item[method];
      if (!isObject(operation)) continue;
      const at: (string | number)[] = ["paths", route, method];
      const operationId =
        typeof operation.operationId === "string"
          ? operation.operationId
          : `${method}_${route}`;
      const name = snake(operationId);
      const prefix = bindings.get(name) ?? name;
      const parameters: string[] = [];
      const preconditions: Expr[] = [];

      type Field = {
        name: string;
        schema: unknown;
        required: boolean;
        path: (string | number)[];
      };
      const fields: Field[] = [];
      const body = resolve(operation.requestBody);
      if (isObject(body) && isObject(body.content)) {
        for (const [media, content] of Object.entries(body.content)) {
          if (!media.includes("json") || !isObject(content)) continue;
          const schema = resolve(content.schema);
          if (!isObject(schema) || !isObject(schema.properties)) continue;
          const required = Array.isArray(schema.required)
            ? schema.required.filter((x): x is string => typeof x === "string")
            : [];
          // Locate the schema node for line numbers: inline, or the referenced component.
          const ref =
            isObject(content.schema) && typeof content.schema.$ref === "string"
              ? content.schema.$ref.replace(/^#\//, "").split("/")
              : [...at, "requestBody", "content", media, "schema"];
          for (const [field, definition] of Object.entries(schema.properties))
            fields.push({
              name: field,
              schema: resolve(definition),
              required: required.includes(field),
              path: [...ref, "properties", field],
            });
        }
      }
      if (Array.isArray(operation.parameters))
        for (const [index, raw] of operation.parameters.entries()) {
          const parameter = resolve(raw);
          if (!isObject(parameter) || typeof parameter.name !== "string")
            continue;
          fields.push({
            name: parameter.name,
            schema: resolve(parameter.schema),
            required: parameter.required === true,
            path: [...at, "parameters", index],
          });
        }

      for (const field of fields) {
        const id = `${prefix}.${snake(field.name)}`;
        const variable = e.var(id);
        const schema = isObject(field.schema) ? field.schema : {};
        const where = `${operationId}.${field.name}`;
        const description = `${where} (${file.path})`;
        const bounds: Expr[] = [];
        if (schema.type === "integer") {
          out.variables.push({
            id,
            type: "integer",
            scope: "input",
            description,
          });
          if (typeof schema.minimum === "number")
            bounds.push(
              schema.exclusiveMinimum === true
                ? e.gt(variable, e.lit(schema.minimum))
                : e.ge(variable, e.lit(schema.minimum)),
            );
          if (typeof schema.maximum === "number")
            bounds.push(
              schema.exclusiveMaximum === true
                ? e.lt(variable, e.lit(schema.maximum))
                : e.le(variable, e.lit(schema.maximum)),
            );
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
            skip(
              field.path,
              where,
              "enum values must be identifier-like strings",
            );
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
          out.variables.push({
            id,
            type: "string",
            scope: "input",
            description,
          });
        else {
          skip(
            field.path,
            where,
            `type ${String(schema.type)} has no exact BehaviorIR type (integers only, no decimals)`,
          );
          continue;
        }
        parameters.push(id);
        if (field.required) {
          const entry = {
            id: `${id}_required`,
            kind: "required" as const,
            subject: id,
            provenance: [provenance(field.path)],
          };
          out.dataConstraints.push(entry);
          out.ledger.push({
            kind: "data_constraint",
            text: `required ${id}`,
            provenance: entry.provenance[0] as Provenance,
          });
        }
        if (bounds.length > 0 && !field.required)
          skip(
            field.path,
            where,
            "bounds on an optional field apply only when it is present, so they are not applied",
          );
        else
          for (const bound of bounds) {
            preconditions.push(bound);
            out.ledger.push({
              kind: "precondition",
              text: `${prefix}: ${formatExpression(bound)}`,
              provenance: provenance(field.path),
            });
          }
      }

      const secured =
        (Array.isArray(operation.security) && operation.security.length > 0) ||
        (operation.security === undefined && globalSecurity);
      if (secured) {
        const entry = {
          id: `${prefix}.authentication_required`,
          kind: "authentication_required" as const,
          subject: prefix,
          provenance: [
            provenance(
              Array.isArray(operation.security)
                ? [...at, "security"]
                : ["security"],
            ),
          ],
        };
        out.dataConstraints.push(entry);
        out.ledger.push({
          kind: "data_constraint",
          text: `authentication_required ${prefix}`,
          provenance: entry.provenance[0] as Provenance,
        });
      }
      if (isObject(operation.responses)) {
        const statuses = Object.keys(operation.responses).join(", ");
        skip(
          [...at, "responses"],
          `${operationId} responses (${statuses})`,
          "response status contracts have no BehaviorIR form yet",
        );
      }
      out.operations.push({
        id: prefix,
        description: `Contract of ${method.toUpperCase()} ${route}`,
        parameters,
        preconditions,
        postconditions: [],
        effects: [],
        provenance: [provenance(at)],
      });
    }
  }
  return out;
}
