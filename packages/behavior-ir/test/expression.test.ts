import { describe, expect, it } from "vitest";
import {
  EvaluationError,
  type Expr,
  ExpressionSyntaxError,
  ExprSchema,
  e,
  evaluateExpression,
  formatExpression,
  isLinear,
  parseExpression,
  variableUses,
} from "../src/index.js";

describe("expression text syntax", () => {
  it("parses the business rules from the brief", () => {
    expect(
      parseExpression("refund > 5000 => manager_approval == true"),
    ).toEqual(
      e.implies(
        e.gt(e.var("refund"), e.lit(5000)),
        e.eq(e.var("manager_approval"), e.lit(true)),
      ),
    );
    expect(parseExpression("amount > 0 && amount <= balance")).toEqual(
      e.and(
        e.gt(e.var("amount"), e.lit(0)),
        e.le(e.var("amount"), e.var("balance")),
      ),
    );
    expect(parseExpression("new_balance == old(balance) - amount")).toEqual(
      e.eq(e.var("new_balance"), e.sub(e.old("balance"), e.var("amount"))),
    );
    expect(parseExpression('role == "support_agent" and not approved')).toEqual(
      e.and(
        e.eq(e.var("role"), e.lit("support_agent")),
        e.not(e.var("approved")),
      ),
    );
  });

  it("respects precedence and associativity", () => {
    expect(parseExpression("a || b && c")).toEqual(
      e.or(e.var("a"), e.and(e.var("b"), e.var("c"))),
    );
    expect(parseExpression("a => b => c")).toEqual(
      e.implies(e.var("a"), e.implies(e.var("b"), e.var("c"))),
    );
    expect(parseExpression("a - b - c")).toEqual(
      e.sub(e.sub(e.var("a"), e.var("b")), e.var("c")),
    );
    expect(parseExpression("2 * a + b")).toEqual(
      e.add(e.mul(e.lit(2), e.var("a")), e.var("b")),
    );
    expect(parseExpression("a - -5 > 0")).toEqual(
      e.gt(e.sub(e.var("a"), e.lit(-5)), e.lit(0)),
    );
    // A flat chain is one n-ary node; a parenthesized group stays nested.
    expect(parseExpression("a && b && c")).toEqual(
      e.and(e.var("a"), e.var("b"), e.var("c")),
    );
    expect(parseExpression("a && (b && c)")).toEqual(
      e.and(e.var("a"), e.and(e.var("b"), e.var("c"))),
    );
  });

  it("prints deterministically and reads its own output back", () => {
    const sources = [
      "refund > 5000 => manager_approval == true",
      "!(a && b) || c",
      "a && (b && c)",
      "(a + b) + c > d",
      "a - (b - c) <= 10",
      "new_balance == old(balance) - amount && new_balance >= 0",
      'role != "manager" => (a || b) && c',
      "a => (b => c)",
      "(a => b) => c",
    ];
    for (const source of sources) {
      const tree = parseExpression(source);
      expect(ExprSchema.parse(tree)).toEqual(tree);
      expect(parseExpression(formatExpression(tree))).toEqual(tree);
    }
    expect(formatExpression(parseExpression("a&&b&&c"))).toBe("a && b && c");
  });

  it("reports syntax errors with a column", () => {
    for (const [source, message] of [
      ["", "Empty expression"],
      ["a >", "Unexpected end"],
      ["a > b > c", "cannot be chained"],
      ["(a && b", 'Expected ")"'],
      ["a & b", "Unexpected character"],
      ['"open', "Unterminated string"],
      ["-x > 0", "Unary minus applies to numbers only"],
      ["a b", 'Unexpected "b"'],
    ] as const)
      expect(() => parseExpression(source), source).toThrow(message);
    expect(() => parseExpression("a >")).toThrow(ExpressionSyntaxError);
    expect(() =>
      parseExpression(`${"(".repeat(60)}a${")".repeat(60)}`),
    ).toThrow("Parentheses may be at most");
  });
});

describe("expression analysis and evaluation", () => {
  it("lists variable uses and recognizes linear arithmetic", () => {
    expect(
      variableUses(
        parseExpression("new_balance == old(balance) - amount && balance >= 0"),
      ),
    ).toEqual([
      { id: "new_balance" },
      { id: "balance", at: "pre" },
      { id: "amount" },
      { id: "balance" },
    ]);
    expect(isLinear(parseExpression("2 * a + 3 * b <= 10"))).toBe(true);
    expect(isLinear(parseExpression("a * b <= 10"))).toBe(false);
    expect(isLinear(parseExpression("a * (2 + 3) > 0"))).toBe(true);
  });

  it("evaluates against a state and a pre-state, never guessing", () => {
    const withdraw = parseExpression("new_balance == old(balance) - amount");
    const value = (
      expr: Expr,
      state: Record<string, boolean | number | string>,
      pre = state,
    ) => evaluateExpression(expr, state, pre);
    expect(
      value(withdraw, { new_balance: 70, amount: 30 }, { balance: 100 }),
    ).toBe(true);
    expect(
      value(withdraw, { new_balance: 80, amount: 30 }, { balance: 100 }),
    ).toBe(false);
    const rule = parseExpression("refund > 5000 => manager_approval == true");
    expect(value(rule, { refund: 7000, manager_approval: false })).toBe(false);
    expect(value(rule, { refund: 7000, manager_approval: true })).toBe(true);
    expect(value(rule, { refund: 100, manager_approval: false })).toBe(true);
    expect(() => value(rule, { refund: 7000 })).toThrow(EvaluationError);
    expect(() => value(parseExpression("a + 1"), { a: true })).toThrow(
      "is not a number",
    );
    expect(() => value(parseExpression("a == 1"), { a: "x" })).toThrow(
      "compares different types",
    );
  });
});
