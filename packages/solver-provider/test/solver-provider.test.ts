import { describe, expect, it } from "vitest";
import { parseSolverProblem } from "../src/index.js";

const x = { op: "var", name: "x" } as const;
const b = { op: "var", name: "b" } as const;
const problem = (assertions: unknown[]) => ({
  variables: [
    { name: "x", sort: "int" },
    { name: "b", sort: "bool" },
  ],
  assertions,
  timeoutMs: 100,
});

describe("solver problem boundary", () => {
  it("accepts well-sorted problems", () => {
    expect(
      parseSolverProblem(
        problem([
          {
            op: "and",
            args: [b, { op: "lt", left: x, right: { op: "int", value: 3 } }],
          },
          { op: "eq", left: b, right: { op: "bool", value: true } },
        ]),
      ).assertions,
    ).toHaveLength(2);
  });

  it("rejects sort errors, undeclared variables and bad budgets", () => {
    const issue = (input: unknown) => {
      try {
        parseSolverProblem(input);
        return "";
      } catch (error) {
        return String(error);
      }
    };
    expect(issue(problem([x]))).toContain("Expected a bool term, got int");
    expect(issue(problem([{ op: "var", name: "y" }]))).toContain(
      "Undeclared solver variable: y",
    );
    expect(issue(problem([{ op: "eq", left: x, right: b }]))).toContain(
      "Expected a int term, got bool",
    );
    expect(issue(problem([{ op: "lt", left: b, right: b }]))).toContain(
      "Expected a int term",
    );
    expect(
      issue({
        ...problem([]),
        variables: [
          { name: "x", sort: "int" },
          { name: "x", sort: "int" },
        ],
      }),
    ).toContain("Duplicate solver variable: x");
    expect(issue({ ...problem([]), timeoutMs: 0 })).not.toBe("");
    expect(issue(problem([{ op: "int", value: 1.5 }]))).not.toBe("");
  });

  it("accepts integer arithmetic and rejects it on booleans", () => {
    const sum = { op: "add", args: [x, { op: "int", value: 1 }] } as const;
    expect(
      parseSolverProblem(
        problem([
          { op: "le", left: { op: "sub", left: sum, right: x }, right: x },
        ]),
      ).assertions,
    ).toHaveLength(1);
    expect(() =>
      parseSolverProblem(
        problem([{ op: "eq", left: { op: "add", args: [b, x] }, right: x }]),
      ),
    ).toThrow(/Expected a int term/);
  });
});
