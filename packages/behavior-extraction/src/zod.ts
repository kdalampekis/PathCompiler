import {
  type Expr,
  e,
  formatExpression,
  type Provenance,
} from "@pathcompiler/behavior-ir";
import ts from "typescript";
import {
  type ExtractedFragment,
  type ExtractionOptions,
  emptyFragment,
  provenanceOf,
  type SourceFile,
  snake,
} from "./common.js";
import { expressionSlug } from "./sql.js";
import {
  callChain,
  integerLiteral,
  nodeLines,
  parseTs,
  stringLiteral,
} from "./ts-util.js";

/**
 * Zod extractor. `const RefundInput = z.object({...})` declares what a valid
 * value looks like; verbatim bounds and enums are EXPLICIT. How a schema is
 * used is the one thing the file cannot say, so it is classified by name
 * (`…Input`/`…Request`/`…Body` are operation inputs, an actor or session is
 * context, anything else is stored state) and `options.bindings` overrides
 * the entity or operation it maps to.
 */
const INPUT_SUFFIX = /(Input|Request|Body|Command|Params|Args|Payload)$/;
export const DEFAULT_CONTEXT = ["actor", "ctx", "context", "session", "user"];

export function extractZod(
  file: SourceFile,
  options: ExtractionOptions = {},
): ExtractedFragment {
  const out = emptyFragment();
  if (!/from\s+["']zod["']/.test(file.content)) return out;
  const source = parseTs(file.path, file.content);
  const bindings = new Map(
    Object.entries(options.bindings ?? {}).map(([key, value]) => [
      snake(key),
      value,
    ]),
  );
  const contextNames = new Set(
    (options.contextParameters ?? DEFAULT_CONTEXT).map(snake),
  );
  const provenance = (node: ts.Node) =>
    provenanceOf({
      sourceType: "VALIDATION_MODEL",
      origin: "EXPLICIT",
      extractionMethod: "STATIC_ANALYSIS",
      confidence: "HIGH",
      file: file.path,
      lines: nodeLines(source, node),
    });
  const skip = (node: ts.Node, construct: string, reason: string) =>
    out.unsupported.push({
      file: file.path,
      lines: nodeLines(source, node),
      construct,
      reason,
    });

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
        continue;
      const chain = callChain(declaration.initializer);
      const object = chain?.base.args[0];
      if (
        !chain ||
        !["z", "zod"].includes(chain.root) ||
        chain.base.name !== "object" ||
        !object ||
        !ts.isObjectLiteralExpression(object)
      )
        continue;

      const schemaName = declaration.name.text;
      const base = snake(schemaName.replace(/Schema$/, ""));
      const isInput = INPUT_SUFFIX.test(schemaName.replace(/Schema$/, ""));
      const role: "input" | "context" | "state" = isInput
        ? "input"
        : contextNames.has(base)
          ? "context"
          : "state";
      const prefix =
        bindings.get(base) ??
        (role === "input"
          ? snake(schemaName.replace(/Schema$/, "").replace(INPUT_SUFFIX, ""))
          : base);
      const rules: { expr: Expr; node: ts.Node }[] = [];
      const parameters: string[] = [];

      for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property)) {
          skip(property, `${schemaName} member`, "not a plain property");
          continue;
        }
        const fieldName = ts.isIdentifier(property.name)
          ? property.name.text
          : stringLiteral(property.name);
        const fieldChain = callChain(property.initializer);
        if (
          !fieldName ||
          !fieldChain ||
          !["z", "zod"].includes(fieldChain.root)
        ) {
          skip(
            property,
            `${schemaName}.${fieldName ?? "?"}`,
            "not a z.* field",
          );
          continue;
        }
        const id = `${prefix}.${snake(fieldName)}`;
        const where = `${schemaName}.${fieldName}`;
        const names = new Set(fieldChain.modifiers.map((item) => item.name));
        const optional = names.has("optional") || names.has("nullish");
        const scope = role === "state" ? "state" : role;
        const description = `${where} (${file.path})`;
        const variable = e.var(id);
        const bounds: Expr[] = [];
        const bound = (
          modifier: { name: string; args: readonly ts.Expression[] },
          value: number | undefined,
          make: (left: Expr, right: Expr) => Expr,
        ) => {
          if (value === undefined)
            skip(
              property,
              where,
              `.${modifier.name}() needs an integer literal`,
            );
          else bounds.push(make(variable, e.lit(value)));
        };

        switch (fieldChain.base.name) {
          case "boolean":
            out.variables.push({ id, type: "boolean", scope, description });
            break;
          case "string":
            out.variables.push({ id, type: "string", scope, description });
            for (const modifier of fieldChain.modifiers)
              if (["min", "max", "length", "regex"].includes(modifier.name))
                skip(
                  property,
                  where,
                  `string .${modifier.name}() is not modeled`,
                );
            break;
          case "enum": {
            const list = fieldChain.base.args[0];
            const values =
              list && ts.isArrayLiteralExpression(list)
                ? list.elements.map((item) => stringLiteral(item))
                : [];
            if (
              values.length === 0 ||
              values.some(
                (item) =>
                  item === undefined || !/^[A-Za-z][A-Za-z0-9_]*$/.test(item),
              )
            ) {
              skip(
                property,
                where,
                "enum values must be identifier-like string literals",
              );
              continue;
            }
            out.variables.push({
              id,
              type: "enum",
              scope,
              values: values as string[],
              description,
            });
            break;
          }
          case "number": {
            if (!names.has("int")) {
              skip(
                property,
                where,
                "z.number() without .int() has no exact BehaviorIR type (integers only)",
              );
              continue;
            }
            out.variables.push({ id, type: "integer", scope, description });
            for (const modifier of fieldChain.modifiers) {
              const value = integerLiteral(modifier.args[0]);
              switch (modifier.name) {
                case "positive":
                  bounds.push(e.gt(variable, e.lit(0)));
                  break;
                case "nonnegative":
                  bounds.push(e.ge(variable, e.lit(0)));
                  break;
                case "negative":
                  bounds.push(e.lt(variable, e.lit(0)));
                  break;
                case "nonpositive":
                  bounds.push(e.le(variable, e.lit(0)));
                  break;
                case "min":
                case "gte":
                  bound(modifier, value, e.ge);
                  break;
                case "max":
                case "lte":
                  bound(modifier, value, e.le);
                  break;
                case "gt":
                  bound(modifier, value, e.gt);
                  break;
                case "lt":
                  bound(modifier, value, e.lt);
                  break;
                case "int":
                case "safe":
                case "finite":
                case "optional":
                case "nullable":
                case "nullish":
                case "default":
                  break;
                default:
                  skip(property, where, `.${modifier.name}() is not modeled`);
              }
            }
            break;
          }
          default:
            skip(
              property,
              where,
              `z.${fieldChain.base.name}() has no BehaviorIR type`,
            );
            continue;
        }

        if (role === "input") {
          parameters.push(id);
          if (!optional) {
            const entry = {
              id: `${id}_required`,
              kind: "required" as const,
              subject: id,
              provenance: [provenance(property)],
            };
            out.dataConstraints.push(entry);
            out.ledger.push({
              kind: "data_constraint",
              text: `required ${id}`,
              provenance: entry.provenance[0] as Provenance,
            });
          }
        }
        if (bounds.length > 0 && optional)
          skip(
            property,
            where,
            "bounds on an optional field apply only when it is present, so they are not applied",
          );
        else if (bounds.length > 0 && role === "context")
          skip(property, where, "bounds on context values are not modeled");
        else
          for (const bound of bounds)
            rules.push({ expr: bound, node: property });
      }

      if (role === "input") {
        const preconditions = rules.map((item) => item.expr);
        out.operations.push({
          id: prefix,
          description: `Input contract from ${schemaName}`,
          parameters,
          preconditions,
          postconditions: [],
          effects: [],
          provenance: [provenance(declaration)],
        });
        for (const rule of rules)
          out.ledger.push({
            kind: "precondition",
            text: `${prefix}: ${formatExpression(rule.expr)}`,
            provenance: provenance(rule.node),
          });
      } else if (role === "state")
        for (const rule of rules) {
          out.invariants.push({
            id: `${prefix}.check_${expressionSlug(rule.expr, prefix)}`,
            description: `${schemaName} requires ${formatExpression(rule.expr)}`,
            expression: rule.expr,
            provenance: [provenance(rule.node)],
          });
          out.ledger.push({
            kind: "invariant",
            text: formatExpression(rule.expr),
            provenance: provenance(rule.node),
          });
        }
    }
  }
  return out;
}
