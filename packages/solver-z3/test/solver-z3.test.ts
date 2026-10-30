import type { SolverProvider, SolverTerm } from "@pathcompiler/solver-provider";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createZ3SolverProvider } from "../src/index.js";

let solver: SolverProvider;
beforeAll(async () => {
  solver = await createZ3SolverProvider();
});
afterAll(async () => {
  await solver?.close();
});
const x: SolverTerm = { op: "var", name: "x" };
const b: SolverTerm = { op: "var", name: "b" };
const int = (value: number): SolverTerm => ({ op: "int", value });
const variables = [
  { name: "x", sort: "int" as const },
  { name: "b", sort: "bool" as const },
];

describe("z3 solver provider", () => {
  it("returns plain values for satisfiable problems", async () => {
    const result = await solver.check({
      variables,
      assertions: [
        { op: "lt", left: int(2), right: x },
        { op: "le", left: x, right: int(3) },
        {
          op: "eq",
          left: b,
          right: { op: "not", arg: { op: "bool", value: true } },
        },
      ],
      timeoutMs: 5000,
    });
    expect(result).toEqual({ status: "sat", model: { x: 3, b: false } });
    expect(solver.name).toMatch(/^z3 \d/);
  });

  it("reports unsatisfiable problems and assigns unconstrained variables", async () => {
    expect(
      await solver.check({
        variables,
        assertions: [{ op: "and", args: [b, { op: "not", arg: b }] }],
        timeoutMs: 5000,
      }),
    ).toEqual({ status: "unsat" });
    const free = await solver.check({
      variables,
      assertions: [],
      timeoutMs: 5000,
    });
    expect(free.status).toBe("sat");
    if (free.status === "sat")
      expect(Object.keys(free.model).sort()).toEqual(["b", "x"]);
  });

  it("validates problems at the boundary", async () => {
    await expect(
      solver.check({ variables, assertions: [x], timeoutMs: 5000 }),
    ).rejects.toThrow(/Expected a bool term/);
  });
});

describe("z3 assumptions", () => {
  it("returns an unsat core over the assumptions", async () => {
    const vars = [
      { name: "p", sort: "bool" as const },
      { name: "q", sort: "bool" as const },
      { name: "r", sort: "bool" as const },
      { name: "x", sort: "int" as const },
    ];
    const v = (name: string): SolverTerm => ({ op: "var", name });
    const implies = (a: SolverTerm, b: SolverTerm): SolverTerm => ({
      op: "or",
      args: [{ op: "not", arg: a }, b],
    });
    const problem = {
      variables: vars,
      assertions: [
        implies(v("p"), { op: "lt", left: x, right: int(0) }),
        implies(v("q"), { op: "lt", left: int(5), right: x }),
        implies(v("r"), { op: "eq", left: x, right: int(10) }),
      ],
      timeoutMs: 5000,
    };
    const result = await solver.check({
      ...problem,
      assumptions: ["p", "q", "r"],
    });
    expect(result.status).toBe("unsat");
    if (result.status === "unsat") {
      expect(result.core).toContain("p");
      expect(result.core?.every((item) => ["p", "q", "r"].includes(item))).toBe(
        true,
      );
    }
    expect(
      (await solver.check({ ...problem, assumptions: ["q", "r"] })).status,
    ).toBe("sat");
    await expect(
      solver.check({ ...problem, assumptions: ["x"] }),
    ).rejects.toThrow(/not a declared boolean variable/);
  });

  it("maximizes the weight of satisfied soft constraints under hard ones", async () => {
    const p: SolverTerm = { op: "var", name: "p" };
    const q: SolverTerm = { op: "var", name: "q" };
    const problem = {
      variables: [
        { name: "p", sort: "bool" as const },
        { name: "q", sort: "bool" as const },
      ],
      // Hard: not both.
      assertions: [
        { op: "not" as const, arg: { op: "and" as const, args: [p, q] } },
      ],
      soft: [
        { id: "want-p", term: p, weight: 2 },
        { id: "want-q", term: q, weight: 3 },
      ],
      timeoutMs: 5000,
    };
    expect(await solver.optimize(problem)).toEqual({
      status: "optimal",
      model: { p: false, q: true },
      satisfied: ["want-q"],
      cost: 2,
    });
    expect(
      await solver.optimize({
        ...problem,
        assertions: [...problem.assertions, p, q],
      }),
    ).toEqual({ status: "unsat" });
    await expect(
      solver.optimize({
        ...problem,
        soft: [...problem.soft, { id: "want-p", term: q, weight: 1 }],
      }),
    ).rejects.toThrow("Soft constraint IDs must be unique");
    await expect(
      solver.optimize({
        ...problem,
        soft: [{ id: "bad", term: { op: "var", name: "missing" }, weight: 1 }],
      }),
    ).rejects.toThrow();
  });

  it("solves linear integer arithmetic (BX3)", async () => {
    // x + 2 * 3 - 1 == 10 → x == 5; a satisfiable system and its negation.
    const arithmetic: SolverTerm = {
      op: "sub",
      left: { op: "add", args: [x, { op: "mul", args: [int(2), int(3)] }] },
      right: int(1),
    };
    const result = await solver.check({
      variables,
      assertions: [{ op: "eq", left: arithmetic, right: int(10) }],
      timeoutMs: 5000,
    });
    expect(result).toMatchObject({ status: "sat", model: { x: 5 } });
    expect(
      await solver.check({
        variables,
        assertions: [
          { op: "eq", left: arithmetic, right: int(10) },
          { op: "lt", left: x, right: int(5) },
        ],
        timeoutMs: 5000,
      }),
    ).toEqual({ status: "unsat" });
  });
});
