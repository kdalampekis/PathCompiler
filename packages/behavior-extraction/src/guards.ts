import {
  type Effect,
  type Expr,
  e,
  formatExpression,
  type Variable,
  variableUses,
} from "@pathcompiler/behavior-ir";
import ts from "typescript";
import {
  type ExtractedFragment,
  type ExtractionOptions,
  emptyFragment,
  permissionText,
  provenanceOf,
  type SourceFile,
  snake,
} from "./common.js";
import {
  integerLiteral,
  nodeLines,
  parseTs,
  stringLiteral,
} from "./ts-util.js";
import { DEFAULT_CONTEXT } from "./zod.js";

/**
 * Source-code extractor for guard clauses. For an exported function it reads
 * the top-level statements:
 *  - `if (cond) throw …` is a guard: the operation requires `!cond`;
 *  - `x.y += e`, `x.y = e`, `x.y++` on a state entity is an effect;
 *  - an explicit role check also yields a permission.
 * Everything else (calls, loops, conditionals, `return` guards, a condition
 * that reads a value updated earlier) is **not modeled and is said so**: it is
 * recorded as a limitation of the operation and as an unsupported construct,
 * so a verifier knows the extracted preconditions may be weaker than the code.
 * Results are SOURCE_CODE / INFERRED: the code says what it does, not what the
 * business wants.
 *
 * Naming: an operation is the function name in snake case; a primitive
 * parameter is an input `operation.param`; a parameter named like an actor or
 * session is context (`actor.role`); any other object parameter is a state
 * entity, named by `options.bindings` or else by the parameter name
 * (`payment` → `payments` with `--bind payment=payments`). A TypeScript
 * `number` is modeled as an integer.
 */
type Shape =
  | { kind: "integer" | "boolean" | "string" }
  | { kind: "enum"; values: string[] }
  | { kind: "object"; members: Map<string, Shape> };

/** Named types across the analyzed files, so `Actor` in one file resolves in another. */
export type TypeIndex = Map<string, ts.TypeNode | ts.InterfaceDeclaration>;
export function collectTypes(files: readonly SourceFile[]): TypeIndex {
  const index: TypeIndex = new Map();
  for (const file of files) {
    if (!/\.tsx?$/.test(file.path)) continue;
    const source = parseTs(file.path, file.content);
    for (const statement of source.statements) {
      if (ts.isTypeAliasDeclaration(statement))
        index.set(statement.name.text, statement.type);
      else if (ts.isInterfaceDeclaration(statement))
        index.set(statement.name.text, statement);
    }
  }
  return index;
}

function shapeOf(
  node: ts.TypeNode | ts.InterfaceDeclaration,
  index: TypeIndex,
  seen: ReadonlySet<string> = new Set(),
): Shape | undefined {
  const members = (list: readonly ts.TypeElement[]): Shape => {
    const result = new Map<string, Shape>();
    for (const member of list)
      if (
        ts.isPropertySignature(member) &&
        member.type &&
        (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
      ) {
        const shape = shapeOf(member.type, index, seen);
        if (shape) result.set(member.name.text, shape);
      }
    return { kind: "object", members: result };
  };
  if (ts.isInterfaceDeclaration(node)) return members(node.members);
  if (ts.isTypeLiteralNode(node)) return members(node.members);
  if (ts.isParenthesizedTypeNode(node)) return shapeOf(node.type, index, seen);
  switch (node.kind) {
    case ts.SyntaxKind.NumberKeyword:
      return { kind: "integer" };
    case ts.SyntaxKind.BooleanKeyword:
      return { kind: "boolean" };
    case ts.SyntaxKind.StringKeyword:
      return { kind: "string" };
  }
  if (ts.isLiteralTypeNode(node)) {
    const value = stringLiteral(node.literal);
    return value === undefined ? undefined : { kind: "enum", values: [value] };
  }
  if (ts.isUnionTypeNode(node)) {
    const values: string[] = [];
    for (const part of node.types) {
      const shape = shapeOf(part, index, seen);
      if (shape?.kind !== "enum") return undefined;
      values.push(...shape.values);
    }
    return { kind: "enum", values };
  }
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;
    const target = index.get(name);
    if (!target || seen.has(name)) return undefined;
    return shapeOf(target, index, new Set([...seen, name]));
  }
  return undefined;
}

class Unmodeled extends Error {}

const NEGATED: Partial<
  Record<Expr["op"], "eq" | "ne" | "lt" | "le" | "gt" | "ge">
> = {
  eq: "ne",
  ne: "eq",
  lt: "ge",
  le: "gt",
  gt: "le",
  ge: "lt",
};
/** Logical negation with comparisons flipped and De Morgan applied. */
export function negate(expr: Expr): Expr {
  switch (expr.op) {
    case "not":
      return expr.arg;
    case "and":
      return e.or(...expr.args.map(negate));
    case "or":
      return e.and(...expr.args.map(negate));
    case "lit":
      return typeof expr.value === "boolean" ? e.lit(!expr.value) : e.not(expr);
    case "eq":
    case "ne":
    case "lt":
    case "le":
    case "gt":
    case "ge":
      return {
        op: NEGATED[expr.op] as "eq",
        left: expr.left,
        right: expr.right,
      };
    case "implies":
      return e.and(expr.left, negate(expr.right));
    default:
      return e.not(expr);
  }
}

/** `a && b && c` as one n-ary node, not a nested pair. */
function join(op: "and" | "or" | "add" | "mul", left: Expr, right: Expr): Expr {
  const parts = (item: Expr) =>
    item.op === op ? (item as { args: Expr[] }).args : [item];
  return { op, args: [...parts(left), ...parts(right)] };
}

const COMPARE = {
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: "eq",
  [ts.SyntaxKind.EqualsEqualsToken]: "eq",
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "ne",
  [ts.SyntaxKind.ExclamationEqualsToken]: "ne",
  [ts.SyntaxKind.LessThanToken]: "lt",
  [ts.SyntaxKind.LessThanEqualsToken]: "le",
  [ts.SyntaxKind.GreaterThanToken]: "gt",
  [ts.SyntaxKind.GreaterThanEqualsToken]: "ge",
} as const;

export function extractGuards(
  file: SourceFile,
  options: ExtractionOptions = {},
  types: TypeIndex = collectTypes([file]),
): ExtractedFragment {
  const out = emptyFragment();
  if (!/\.tsx?$/.test(file.path) || /\.d\.ts$/.test(file.path)) return out;
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
  const roleProperties = new Set(
    (options.roleProperties ?? ["role"]).map(snake),
  );
  const provenance = (node: ts.Node) =>
    provenanceOf({
      sourceType: "SOURCE_CODE",
      origin: "INFERRED",
      extractionMethod: "STATIC_ANALYSIS",
      confidence: "MEDIUM",
      file: file.path,
      lines: nodeLines(source, node),
    });

  // Module-level constants with literal values are inlined (`APPROVAL_LIMIT = 5000`).
  const constants = new Map<string, number | string | boolean>();
  for (const statement of source.statements)
    if (
      ts.isVariableStatement(statement) &&
      statement.declarationList.flags & ts.NodeFlags.Const
    )
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
          continue;
        let initializer = declaration.initializer;
        if (ts.isAsExpression(initializer))
          initializer = initializer.expression;
        const value =
          integerLiteral(initializer) ??
          stringLiteral(initializer) ??
          (initializer.kind === ts.SyntaxKind.TrueKeyword
            ? true
            : initializer.kind === ts.SyntaxKind.FalseKeyword
              ? false
              : undefined);
        if (value !== undefined) constants.set(declaration.name.text, value);
      }

  const functions: {
    name: string;
    node: ts.FunctionLikeDeclaration;
    body: ts.Block;
    owner: ts.Node;
  }[] = [];
  for (const statement of source.statements) {
    const exported = ts
      .getModifiers(statement as ts.HasModifiers)
      ?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body)
      functions.push({
        name: statement.name.text,
        node: statement,
        body: statement.body,
        owner: statement,
      });
    else if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
          ts.isBlock(init.body)
        )
          functions.push({
            name: declaration.name.text,
            node: init,
            body: init.body,
            owner: statement,
          });
      }
  }

  for (const fn of functions) {
    const operation = bindings.get(snake(fn.name)) ?? snake(fn.name);
    const limitations: string[] = [];
    const preconditions: Expr[] = [];
    const effects: Effect[] = [];
    const parameters: string[] = [];
    const variables = new Map<string, Variable>();
    const assigned = new Set<string>();
    const ledgerStart = out.ledger.length;
    const permissionStart = out.permissions.length;
    const unsupportedStart = out.unsupported.length;

    type Binding =
      | { kind: "context"; prefix: string; members: Map<string, Shape> }
      | { kind: "entity"; prefix: string; members: Map<string, Shape> }
      | { kind: "input"; id: string; shape: Shape };
    const scope = new Map<string, Binding>();
    for (const parameter of fn.node.parameters) {
      if (!ts.isIdentifier(parameter.name) || !parameter.type) continue;
      const name = parameter.name.text;
      const shape = shapeOf(parameter.type, types);
      if (!shape) continue;
      if (shape.kind === "object")
        scope.set(
          name,
          contextNames.has(snake(name))
            ? { kind: "context", prefix: snake(name), members: shape.members }
            : {
                kind: "entity",
                prefix: bindings.get(snake(name)) ?? snake(name),
                members: shape.members,
              },
        );
      else
        scope.set(name, {
          kind: "input",
          id: `${operation}.${snake(name)}`,
          shape,
        });
    }

    const declare = (
      id: string,
      scopeName: Variable["scope"],
      shape: Shape,
    ) => {
      if (variables.has(id)) return;
      const description =
        "from source code (a TypeScript number is modeled as an integer)";
      variables.set(
        id,
        shape.kind === "enum"
          ? {
              id,
              type: "enum",
              scope: scopeName,
              values: [...new Set(shape.values)].sort(),
              description,
            }
          : shape.kind === "object"
            ? { id, type: "string", scope: scopeName }
            : { id, type: shape.kind, scope: scopeName, description },
      );
    };
    const reference = (node: ts.Expression): Expr => {
      if (ts.isParenthesizedExpression(node)) return reference(node.expression);
      if (ts.isIdentifier(node)) {
        const bound = scope.get(node.text);
        if (bound?.kind === "input") {
          declare(bound.id, "input", bound.shape);
          if (!parameters.includes(bound.id)) parameters.push(bound.id);
          return e.var(bound.id);
        }
        throw new Unmodeled(
          `${node.text} is not a parameter this extractor can model`,
        );
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression)
      ) {
        const bound = scope.get(node.expression.text);
        if (bound && bound.kind !== "input") {
          const shape = bound.members.get(node.name.text);
          if (!shape)
            throw new Unmodeled(
              `the type of ${node.expression.text}.${node.name.text} is unknown`,
            );
          const id = `${bound.prefix}.${snake(node.name.text)}`;
          declare(id, bound.kind === "context" ? "context" : "state", shape);
          return e.var(id);
        }
      }
      throw new Unmodeled(`${node.getText(source)} is not a modeled value`);
    };
    const translate = (node: ts.Expression): Expr => {
      if (ts.isParenthesizedExpression(node)) return translate(node.expression);
      const integer = integerLiteral(node);
      if (integer !== undefined) return e.lit(integer);
      const text = stringLiteral(node);
      if (text !== undefined) return e.lit(text);
      if (node.kind === ts.SyntaxKind.TrueKeyword) return e.lit(true);
      if (node.kind === ts.SyntaxKind.FalseKeyword) return e.lit(false);
      if (
        ts.isIdentifier(node) &&
        constants.has(node.text) &&
        !scope.has(node.text)
      )
        return e.lit(constants.get(node.text) as number);
      if (ts.isPrefixUnaryExpression(node)) {
        if (node.operator === ts.SyntaxKind.ExclamationToken)
          return e.not(translate(node.operand));
        throw new Unmodeled(`operator ${node.getText(source).slice(0, 1)}`);
      }
      if (ts.isBinaryExpression(node)) {
        const kind = node.operatorToken.kind;
        const left = () => translate(node.left);
        const right = () => translate(node.right);
        if (kind in COMPARE)
          return {
            op: COMPARE[kind as keyof typeof COMPARE],
            left: left(),
            right: right(),
          };
        switch (kind) {
          case ts.SyntaxKind.AmpersandAmpersandToken:
            return join("and", left(), right());
          case ts.SyntaxKind.BarBarToken:
            return join("or", left(), right());
          case ts.SyntaxKind.PlusToken:
            return join("add", left(), right());
          case ts.SyntaxKind.MinusToken:
            return e.sub(left(), right());
          case ts.SyntaxKind.AsteriskToken:
            return join("mul", left(), right());
        }
        throw new Unmodeled(`operator ${node.operatorToken.getText(source)}`);
      }
      return reference(node);
    };
    const readsAssigned = (expr: Expr) => {
      const stale = variableUses(expr).find((use) => assigned.has(use.id));
      if (stale)
        throw new Unmodeled(
          `it reads ${stale.id}, which is updated earlier in the function (effects are evaluated in the pre-state)`,
        );
    };
    const note = (statement: ts.Node, construct: string, reason: string) => {
      const line = nodeLines(source, statement);
      limitations.push(`${file.path}:${line} ${construct}: ${reason}`);
      out.unsupported.push({
        file: file.path,
        lines: line,
        construct: `${fn.name}: ${construct}`,
        reason,
      });
    };

    const throwsOnly = (statement: ts.Statement) =>
      ts.isThrowStatement(statement) ||
      (ts.isBlock(statement) &&
        statement.statements.length === 1 &&
        statement.statements[0] !== undefined &&
        ts.isThrowStatement(statement.statements[0]));

    for (const statement of fn.body.statements) {
      const construct =
        statement.getText(source).split("\n")[0]?.slice(0, 70) ?? "";
      if (ts.isIfStatement(statement)) {
        if (throwsOnly(statement.thenStatement) && !statement.elseStatement) {
          try {
            const condition = translate(statement.expression);
            readsAssigned(condition);
            const precondition = negate(condition);
            preconditions.push(precondition);
            out.ledger.push({
              kind: "precondition",
              text: `${operation}: ${formatExpression(precondition)}`,
              provenance: provenance(statement),
            });
            // An explicit role check also states who may run the operation.
            const alternatives =
              precondition.op === "or" ? precondition.args : [precondition];
            const roles = alternatives.map((item) => {
              if (
                item.op !== "eq" ||
                item.left.op !== "var" ||
                item.right.op !== "lit"
              )
                return undefined;
              const id = item.left.id;
              const variable = variables.get(id);
              return variable?.scope === "context" &&
                roleProperties.has(id.split(".").pop() as string) &&
                typeof item.right.value === "string"
                ? item.right.value
                : undefined;
            });
            if (roles.length > 0 && roles.every((role) => role !== undefined))
              for (const role of roles as string[]) {
                const permission = {
                  id: `${operation}.${snake(role)}_allowed`,
                  description: `Role check in ${fn.name}`,
                  role,
                  action: operation,
                  effect: "allow" as const,
                  provenance: [provenance(statement)],
                };
                out.permissions.push(permission);
                out.ledger.push({
                  kind: "permission",
                  text: permissionText(permission),
                  provenance: provenance(statement),
                });
              }
          } catch (error) {
            if (!(error instanceof Unmodeled)) throw error;
            note(
              statement,
              `guard \`${construct}\``,
              `not modeled: ${error.message}`,
            );
          }
        } else
          note(
            statement,
            `conditional \`${construct}\``,
            "a conditional that does not simply throw is not modeled",
          );
        continue;
      }
      if (ts.isExpressionStatement(statement)) {
        const expression = statement.expression;
        const target = ts.isBinaryExpression(expression)
          ? expression.left
          : ts.isPostfixUnaryExpression(expression) ||
              ts.isPrefixUnaryExpression(expression)
            ? expression.operand
            : undefined;
        const kind = ts.isBinaryExpression(expression)
          ? expression.operatorToken.kind
          : undefined;
        const updating =
          kind === ts.SyntaxKind.EqualsToken ||
          kind === ts.SyntaxKind.PlusEqualsToken ||
          kind === ts.SyntaxKind.MinusEqualsToken ||
          ((ts.isPostfixUnaryExpression(expression) ||
            ts.isPrefixUnaryExpression(expression)) &&
            (expression.operator === ts.SyntaxKind.PlusPlusToken ||
              expression.operator === ts.SyntaxKind.MinusMinusToken));
        if (target && updating) {
          try {
            const variable = reference(target as ts.Expression);
            if (variable.op !== "var") throw new Unmodeled("not a variable");
            const known = variables.get(variable.id);
            if (known?.scope !== "state")
              throw new Unmodeled(`${variable.id} is not stored state`);
            let value: Expr;
            if (ts.isBinaryExpression(expression)) {
              const right = translate(expression.right);
              value =
                kind === ts.SyntaxKind.EqualsToken
                  ? right
                  : kind === ts.SyntaxKind.PlusEqualsToken
                    ? e.add(variable, right)
                    : e.sub(variable, right);
            } else if (
              ts.isPostfixUnaryExpression(expression) ||
              ts.isPrefixUnaryExpression(expression)
            )
              value =
                expression.operator === ts.SyntaxKind.PlusPlusToken
                  ? e.add(variable, e.lit(1))
                  : e.sub(variable, e.lit(1));
            else throw new Unmodeled("not an update");
            readsAssigned(value);
            effects.push({ variable: variable.id, value });
            assigned.add(variable.id);
          } catch (error) {
            if (!(error instanceof Unmodeled)) throw error;
            note(
              statement,
              `update \`${construct}\``,
              `not modeled: ${error.message}`,
            );
          }
          continue;
        }
      }
      if (ts.isReturnStatement(statement) && !statement.expression) continue;
      note(
        statement,
        `statement \`${construct}\``,
        `${ts.SyntaxKind[statement.kind]} is not modeled, so its effects are not part of the contract`,
      );
    }

    if (preconditions.length === 0 && effects.length === 0) {
      // Not an operation this extractor understands: leave no trace of it.
      out.ledger.length = ledgerStart;
      out.permissions.length = permissionStart;
      out.unsupported.length = unsupportedStart;
      continue;
    }
    out.variables.push(...variables.values());
    const jsDoc = (fn.owner as { jsDoc?: ts.JSDoc[] }).jsDoc?.[0]?.comment;
    out.operations.push({
      id: operation,
      ...(typeof jsDoc === "string" && jsDoc.trim()
        ? { description: jsDoc.trim() }
        : {
            description: `Behavior of ${fn.name}() read from its guard clauses`,
          }),
      parameters,
      preconditions,
      postconditions: [],
      effects,
      ...(limitations.length > 0 ? { limitations } : {}),
      provenance: [provenance(fn.owner)],
    });
  }
  return out;
}
