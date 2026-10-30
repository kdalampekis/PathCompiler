import { type Expr, e, formatExpression } from "@pathcompiler/behavior-ir";
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
import { integerLiteral, nodeLines, parseTs, propertyPath } from "./ts-util.js";

/**
 * Test-assertion extractor. Only assertions that read as general rules are
 * lifted, and always as INFERRED with MEDIUM confidence, since a test asserts
 * a rule on some data, not for all data:
 *  - `expect(a.b).toBeGreaterThanOrEqual(0)` (a sign check against zero);
 *  - `expect(a.b).toBeLessThanOrEqual(a.c)` (a relation between two fields).
 * A comparison with any other literal is test data, an equality with a
 * literal is an example; both are listed as unsupported, not guessed.
 * The names in the assertion are mapped to variables through
 * `options.bindings` (`payment` → `payments`).
 */
const COMPARISONS = {
  toBeGreaterThan: e.gt,
  toBeGreaterThanOrEqual: e.ge,
  toBeLessThan: e.lt,
  toBeLessThanOrEqual: e.le,
} as const;

export function extractAssertions(
  file: SourceFile,
  options: ExtractionOptions = {},
): ExtractedFragment {
  const out = emptyFragment();
  const source = parseTs(file.path, file.content);
  const bindings = new Map(
    Object.entries(options.bindings ?? {}).map(([key, value]) => [
      snake(key),
      value,
    ]),
  );
  const provenance = (node: ts.Node) =>
    provenanceOf({
      sourceType: "TEST",
      origin: "INFERRED",
      extractionMethod: "STATIC_ANALYSIS",
      confidence: "MEDIUM",
      file: file.path,
      lines: nodeLines(source, node),
    });
  const variableOf = (node: ts.Node): Expr | undefined => {
    const path = propertyPath(node);
    if (!path || path.length < 2) return undefined;
    const entity = bindings.get(snake(path[0] as string));
    if (!entity || path.length !== 2) return undefined;
    return e.var(`${entity}.${snake(path[1] as string)}`);
  };

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isCallExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression) &&
      node.expression.expression.expression.text === "expect"
    ) {
      const matcher = node.expression.name.text;
      const subject = node.expression.expression.arguments[0];
      const argument = node.arguments[0];
      const where = `expect(${subject?.getText(source) ?? ""}).${matcher}(${argument?.getText(source) ?? ""})`;
      const skip = (reason: string) =>
        out.unsupported.push({
          file: file.path,
          lines: nodeLines(source, node),
          construct: where,
          reason,
        });
      if (matcher in COMPARISONS && subject && argument) {
        const left = variableOf(subject);
        const literal = integerLiteral(argument);
        const right =
          literal === undefined ? variableOf(argument) : e.lit(literal);
        const make = COMPARISONS[matcher as keyof typeof COMPARISONS];
        if (!left)
          skip(
            "the subject is not a field of a bound entity (set bindings, e.g. payment=payments)",
          );
        else if (!right)
          skip(
            "the expected value is neither an integer literal nor a bound field",
          );
        else if (literal !== undefined && literal !== 0)
          skip(
            "a comparison with a non-zero literal is test data, not a general rule",
          );
        else {
          const expression = make(left, right);
          const prefix = left.op === "var" ? left.id.split(".")[0] : undefined;
          out.invariants.push({
            id: `${prefix}.check_${expressionSlug(expression, prefix)}`,
            description: `Asserted in ${file.path}: ${formatExpression(expression)}`,
            expression,
            provenance: [provenance(node)],
          });
          out.ledger.push({
            kind: "invariant",
            text: formatExpression(expression),
            provenance: provenance(node),
          });
          if (left.op === "var")
            out.variables.push({
              id: left.id,
              type: "integer",
              scope: "state",
            });
          if (right.op === "var")
            out.variables.push({
              id: right.id,
              type: "integer",
              scope: "state",
            });
        }
      } else if (["toBe", "toEqual", "toStrictEqual"].includes(matcher))
        skip("an equality in a test is an example, not a rule");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}
