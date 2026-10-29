import { z } from "zod";

/**
 * BehaviorIR expressions: a small typed tree with linear arithmetic, no
 * solver types. `at` selects the pre-state value of a variable inside a
 * postcondition (written `old(x)` in text); a plain variable there means the
 * post-state. Everywhere else `at` is not allowed.
 */
export const IDENTIFIER = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
export type Literal = boolean | number | string;
export type Expr =
  | { op: "lit"; value: Literal }
  | { op: "var"; id: string; at?: "pre" | undefined }
  | { op: "add" | "mul" | "and" | "or"; args: Expr[] }
  | { op: "not"; arg: Expr }
  | {
      op: "sub" | "eq" | "ne" | "lt" | "le" | "gt" | "ge" | "implies";
      left: Expr;
      right: Expr;
    };

const MAX_DEPTH = 40;
export const ExprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z.strictObject({
      op: z.literal("lit"),
      value: z.union([z.boolean(), z.number().int().safe(), z.string()]),
    }),
    z.strictObject({
      op: z.literal("var"),
      id: z.string().regex(IDENTIFIER, "Variable IDs are lowercase words"),
      at: z.literal("pre").optional(),
    }),
    z.strictObject({
      op: z.enum(["add", "mul", "and", "or"]),
      args: z.array(ExprSchema).min(2),
    }),
    z.strictObject({ op: z.literal("not"), arg: ExprSchema }),
    z.strictObject({
      op: z.enum(["sub", "eq", "ne", "lt", "le", "gt", "ge", "implies"]),
      left: ExprSchema,
      right: ExprSchema,
    }),
  ]),
);

/** Small constructors for readable hand-written specifications. */
export const e = {
  lit: (value: Literal): Expr => ({ op: "lit", value }),
  var: (id: string): Expr => ({ op: "var", id }),
  old: (id: string): Expr => ({ op: "var", id, at: "pre" }),
  add: (...args: Expr[]): Expr => ({ op: "add", args }),
  mul: (...args: Expr[]): Expr => ({ op: "mul", args }),
  and: (...args: Expr[]): Expr => ({ op: "and", args }),
  or: (...args: Expr[]): Expr => ({ op: "or", args }),
  not: (arg: Expr): Expr => ({ op: "not", arg }),
  sub: (left: Expr, right: Expr): Expr => ({ op: "sub", left, right }),
  eq: (left: Expr, right: Expr): Expr => ({ op: "eq", left, right }),
  ne: (left: Expr, right: Expr): Expr => ({ op: "ne", left, right }),
  lt: (left: Expr, right: Expr): Expr => ({ op: "lt", left, right }),
  le: (left: Expr, right: Expr): Expr => ({ op: "le", left, right }),
  gt: (left: Expr, right: Expr): Expr => ({ op: "gt", left, right }),
  ge: (left: Expr, right: Expr): Expr => ({ op: "ge", left, right }),
  implies: (left: Expr, right: Expr): Expr => ({
    op: "implies",
    left,
    right,
  }),
};

export function expressionDepth(expr: Expr): number {
  if (expr.op === "lit" || expr.op === "var") return 1;
  if (expr.op === "not") return 1 + expressionDepth(expr.arg);
  if ("args" in expr)
    return 1 + Math.max(...expr.args.map((item) => expressionDepth(item)));
  return 1 + Math.max(expressionDepth(expr.left), expressionDepth(expr.right));
}
export function assertShallow(expr: Expr): void {
  if (expressionDepth(expr) > MAX_DEPTH)
    throw new Error(`Expressions may be at most ${MAX_DEPTH} levels deep.`);
}

export type VariableUse = { id: string; at?: "pre" | undefined };
/** Every variable reference, in first-occurrence order. */
export function variableUses(expr: Expr): VariableUse[] {
  const seen = new Map<string, VariableUse>();
  const walk = (item: Expr) => {
    if (item.op === "var") {
      const key = `${item.at ?? "post"}:${item.id}`;
      if (!seen.has(key))
        seen.set(key, item.at ? { id: item.id, at: item.at } : { id: item.id });
    } else if (item.op === "not") walk(item.arg);
    else if ("args" in item) item.args.forEach(walk);
    else if ("left" in item) {
      walk(item.left);
      walk(item.right);
    }
  };
  walk(expr);
  return [...seen.values()];
}

/** True when multiplication never combines two variable terms (linear arithmetic). */
export function isLinear(expr: Expr): boolean {
  const constant = (item: Expr): boolean =>
    item.op === "lit" ||
    (item.op === "mul" && item.args.every(constant)) ||
    (item.op === "add" && item.args.every(constant)) ||
    (item.op === "sub" && constant(item.left) && constant(item.right));
  const walk = (item: Expr): boolean => {
    if (item.op === "lit" || item.op === "var") return true;
    if (item.op === "not") return walk(item.arg);
    if (item.op === "mul")
      return (
        item.args.every(walk) &&
        item.args.filter((arg) => !constant(arg)).length <= 1
      );
    if ("args" in item) return item.args.every(walk);
    return walk(item.left) && walk(item.right);
  };
  return walk(expr);
}

// --- Text syntax --------------------------------------------------------------

export class ExpressionSyntaxError extends Error {
  override name = "ExpressionSyntaxError";
  constructor(
    message: string,
    readonly column: number,
  ) {
    super(`${message} (column ${column + 1})`);
  }
}
type Token =
  | { kind: "number" | "string" | "word" | "symbol"; text: string; at: number }
  | { kind: "end"; text: ""; at: number };
const SYMBOLS = [
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "<",
  ">",
  "+",
  "-",
  "*",
  "!",
  "(",
  ")",
];
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index] as string;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const number = /^\d+/.exec(input.slice(index));
    if (number) {
      tokens.push({ kind: "number", text: number[0], at: index });
      index += number[0].length;
      continue;
    }
    if (char === '"' || char === "'") {
      const close = input.indexOf(char, index + 1);
      if (close === -1)
        throw new ExpressionSyntaxError("Unterminated string", index);
      tokens.push({
        kind: "string",
        text: input.slice(index + 1, close),
        at: index,
      });
      index = close + 1;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(input.slice(index));
    if (word) {
      tokens.push({ kind: "word", text: word[0], at: index });
      index += word[0].length;
      continue;
    }
    const symbol = SYMBOLS.find((item) => input.startsWith(item, index));
    if (!symbol)
      throw new ExpressionSyntaxError(`Unexpected character "${char}"`, index);
    tokens.push({ kind: "symbol", text: symbol, at: index });
    index += symbol.length;
  }
  tokens.push({ kind: "end", text: "", at: input.length });
  return tokens;
}

const COMPARISONS = {
  "==": "eq",
  "!=": "ne",
  "<": "lt",
  "<=": "le",
  ">": "gt",
  ">=": "ge",
} as const;
const COMPARISON_SYMBOL = {
  eq: "==",
  ne: "!=",
  lt: "<",
  le: "<=",
  gt: ">",
  ge: ">=",
} as const;

/**
 * Parses `refund > 5000 => manager_approval == true`. Precedence, loosest to
 * tightest: `=>` (right associative), `or`/`||`, `and`/`&&`, `not`/`!`,
 * comparison, `+ -`, `*`, unary `-`. Same-operator chains flatten into one
 * n-ary node; parenthesized groups stay nested, so printing and parsing
 * round-trip.
 */
export function parseExpression(input: string): Expr {
  const tokens = tokenize(input);
  let position = 0;
  const peek = () => tokens[position] as Token;
  const take = () => tokens[position++] as Token;
  const isSymbol = (text: string) =>
    peek().kind === "symbol" && peek().text === text;
  const isWord = (text: string) =>
    peek().kind === "word" && peek().text === text;
  const fail = (message: string, token = peek()): never => {
    throw new ExpressionSyntaxError(message, token.at);
  };

  function implies(): Expr {
    const left = or();
    if (isSymbol("=>") || isWord("implies")) {
      take();
      return { op: "implies", left, right: implies() };
    }
    return left;
  }
  function chain(
    op: "and" | "or",
    next: () => Expr,
    matches: () => boolean,
  ): Expr {
    const args = [next()];
    while (matches()) {
      take();
      args.push(next());
    }
    return args.length === 1 ? (args[0] as Expr) : { op, args };
  }
  function or(): Expr {
    return chain("or", and, () => isSymbol("||") || isWord("or"));
  }
  function and(): Expr {
    return chain("and", not, () => isSymbol("&&") || isWord("and"));
  }
  function not(): Expr {
    if (isSymbol("!") || isWord("not")) {
      take();
      return { op: "not", arg: not() };
    }
    return comparison();
  }
  function comparison(): Expr {
    const left = additive();
    const token = peek();
    if (token.kind === "symbol" && token.text in COMPARISONS) {
      take();
      const op = COMPARISONS[token.text as keyof typeof COMPARISONS];
      const right = additive();
      const next = peek();
      if (next.kind === "symbol" && next.text in COMPARISONS)
        fail("Comparisons cannot be chained; use and", next);
      return { op, left, right };
    }
    return left;
  }
  function additive(): Expr {
    let left = multiplicative();
    for (;;) {
      if (isSymbol("+")) {
        take();
        const right = multiplicative();
        left =
          left.op === "add" && !parenthesized.has(left)
            ? { op: "add", args: [...left.args, right] }
            : { op: "add", args: [left, right] };
      } else if (isSymbol("-")) {
        take();
        left = { op: "sub", left, right: multiplicative() };
      } else return left;
    }
  }
  function multiplicative(): Expr {
    let left = unary();
    while (isSymbol("*")) {
      take();
      const right = unary();
      left =
        left.op === "mul" && !parenthesized.has(left)
          ? { op: "mul", args: [...left.args, right] }
          : { op: "mul", args: [left, right] };
    }
    return left;
  }
  function unary(): Expr {
    if (isSymbol("-")) {
      const token = take();
      const operand = unary();
      return operand.op === "lit" && typeof operand.value === "number"
        ? { op: "lit", value: -operand.value }
        : (fail("Unary minus applies to numbers only", token) as never);
    }
    return primary();
  }
  const parenthesized = new WeakSet<Expr>();
  let nesting = 0;
  function primary(): Expr {
    const token = take();
    if (token.kind === "number")
      return { op: "lit", value: Number(token.text) };
    if (token.kind === "string") return { op: "lit", value: token.text };
    if (token.kind === "symbol" && token.text === "(") {
      nesting += 1;
      if (nesting > MAX_DEPTH)
        fail(`Parentheses may be at most ${MAX_DEPTH} levels deep`, token);
      const inner = implies();
      nesting -= 1;
      if (!isSymbol(")")) fail('Expected ")"');
      take();
      parenthesized.add(inner);
      return inner;
    }
    if (token.kind === "word") {
      if (token.text === "true" || token.text === "false")
        return { op: "lit", value: token.text === "true" };
      if (token.text === "old" && isSymbol("(")) {
        take();
        const name = take();
        if (name.kind !== "word") fail("Expected a variable in old()", name);
        if (!isSymbol(")")) fail('Expected ")" after old(...)');
        take();
        return { op: "var", id: name.text, at: "pre" };
      }
      return { op: "var", id: token.text };
    }
    return fail(
      token.kind === "end"
        ? "Unexpected end of expression"
        : `Unexpected "${token.text}"`,
      token,
    );
  }
  if (peek().kind === "end") fail("Empty expression");
  const result = implies();
  if (peek().kind !== "end") fail(`Unexpected "${peek().text}"`);
  assertShallow(result);
  return result;
}

const PRECEDENCE: Record<Expr["op"], number> = {
  implies: 1,
  or: 2,
  and: 3,
  not: 4,
  eq: 5,
  ne: 5,
  lt: 5,
  le: 5,
  gt: 5,
  ge: 5,
  add: 6,
  sub: 6,
  mul: 7,
  lit: 9,
  var: 9,
};
/** Deterministic text for an expression; `parseExpression` reads it back. */
export function formatExpression(expr: Expr): string {
  const wrap = (child: Expr, parent: number, force = false) => {
    const text = formatExpression(child);
    return force || PRECEDENCE[child.op] < parent ? `(${text})` : text;
  };
  switch (expr.op) {
    case "lit":
      return typeof expr.value === "string"
        ? JSON.stringify(expr.value)
        : String(expr.value);
    case "var":
      return expr.at ? `old(${expr.id})` : expr.id;
    case "not":
      return `!${wrap(expr.arg, PRECEDENCE.not + 1)}`;
    case "and":
    case "or":
    case "add":
    case "mul": {
      const separator = { and: " && ", or: " || ", add: " + ", mul: " * " }[
        expr.op
      ];
      const level = PRECEDENCE[expr.op];
      // Same-operator children are parenthesized so nesting round-trips.
      return expr.args
        .map((arg) => wrap(arg, level + 1, arg.op === expr.op))
        .join(separator);
    }
    case "sub":
      return `${wrap(expr.left, PRECEDENCE.sub)} - ${wrap(expr.right, PRECEDENCE.sub + 1)}`;
    case "implies":
      return `${wrap(expr.left, PRECEDENCE.implies + 1)} => ${wrap(expr.right, PRECEDENCE.implies)}`;
    default:
      return `${wrap(expr.left, 6)} ${COMPARISON_SYMBOL[expr.op]} ${wrap(expr.right, 6)}`;
  }
}

// --- Evaluation ---------------------------------------------------------------

export type Valuation = Readonly<Record<string, Literal>>;
export class EvaluationError extends Error {
  override name = "EvaluationError";
}
/**
 * Evaluates an expression. `state` supplies variables (the post-state inside
 * postconditions); `pre` supplies `old(x)` values and defaults to `state`.
 * Used to replay counterexamples, so it never guesses: a missing variable or
 * a type mismatch is an error.
 */
export function evaluateExpression(
  expr: Expr,
  state: Valuation,
  pre: Valuation = state,
): Literal {
  const number = (item: Expr): number => {
    const value = evaluateExpression(item, state, pre);
    if (typeof value !== "number")
      throw new EvaluationError(`${formatExpression(item)} is not a number.`);
    return value;
  };
  const boolean = (item: Expr): boolean => {
    const value = evaluateExpression(item, state, pre);
    if (typeof value !== "boolean")
      throw new EvaluationError(`${formatExpression(item)} is not a boolean.`);
    return value;
  };
  switch (expr.op) {
    case "lit":
      return expr.value;
    case "var": {
      const source = expr.at ? pre : state;
      const value = source[expr.id];
      if (value === undefined)
        throw new EvaluationError(
          `No value for ${expr.at ? `old(${expr.id})` : expr.id}.`,
        );
      return value;
    }
    case "add":
      return expr.args.reduce((sum, item) => sum + number(item), 0);
    case "mul":
      return expr.args.reduce((product, item) => product * number(item), 1);
    case "sub":
      return number(expr.left) - number(expr.right);
    case "and":
      return expr.args.every((item) => boolean(item));
    case "or":
      return expr.args.some((item) => boolean(item));
    case "not":
      return !boolean(expr.arg);
    case "implies":
      return !boolean(expr.left) || boolean(expr.right);
    case "eq":
    case "ne": {
      const left = evaluateExpression(expr.left, state, pre);
      const right = evaluateExpression(expr.right, state, pre);
      if (typeof left !== typeof right)
        throw new EvaluationError(
          `${formatExpression(expr)} compares different types.`,
        );
      return expr.op === "eq" ? left === right : left !== right;
    }
    case "lt":
      return number(expr.left) < number(expr.right);
    case "le":
      return number(expr.left) <= number(expr.right);
    case "gt":
      return number(expr.left) > number(expr.right);
    case "ge":
      return number(expr.left) >= number(expr.right);
  }
}
