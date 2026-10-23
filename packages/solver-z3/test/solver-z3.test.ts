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
