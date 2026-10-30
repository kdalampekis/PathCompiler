import ts from "typescript";
import { lineRange } from "./common.js";

export const parseTs = (path: string, content: string) =>
  ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

/** "12" or "32-47", 1-based and inclusive. */
export function nodeLines(source: ts.SourceFile, node: ts.Node): string {
  const first =
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const last = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  return lineRange(first, last);
}

/** An integer literal, including a negated one; undefined for anything else. */
export function integerLiteral(node: ts.Node | undefined): number | undefined {
  if (!node) return undefined;
  if (ts.isNumericLiteral(node)) {
    const value = Number(node.text);
    return Number.isSafeInteger(value) ? value : undefined;
  }
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken
  ) {
    const inner = integerLiteral(node.operand);
    return inner === undefined ? undefined : -inner;
  }
  return undefined;
}
export const stringLiteral = (node: ts.Node | undefined) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

/** `a.b.c` as ["a", "b", "c"]; undefined when the expression is anything else. */
export function propertyPath(node: ts.Node): string[] | undefined {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const head = propertyPath(node.expression);
    return head ? [...head, node.name.text] : undefined;
  }
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node))
    return propertyPath(node.expression);
  return undefined;
}

export type CallLink = { name: string; args: readonly ts.Expression[] };
/**
 * Unrolls `z.number().int().min(1)` into its base (`z.number`) and the
 * modifier calls in source order.
 */
export function callChain(
  node: ts.Expression,
): { root: string; base: CallLink; modifiers: CallLink[] } | undefined {
  const modifiers: CallLink[] = [];
  let current: ts.Expression = node;
  while (ts.isCallExpression(current)) {
    const callee: ts.LeftHandSideExpression = current.expression;
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    const link = { name: callee.name.text, args: current.arguments };
    if (ts.isIdentifier(callee.expression)) {
      return {
        root: callee.expression.text,
        base: link,
        modifiers: modifiers.reverse(),
      };
    }
    modifiers.push(link);
    current = callee.expression;
  }
  return undefined;
}
