import type { SolverProvider, SolverTerm } from "@pathcompiler/solver-provider";
import type { InterpretationOutcome } from "./interpretation.js";

/**
 * Weighted soft constraints, P2 (reasoning spec §50). P1 interprets each
 * subject alone; here every subject's consistent candidates become weighted
 * soft constraints, the hard constraints join them (at most one meaning per
 * subject, and exclusive subjects never share a meaning), and the solver
 * maximizes the supported weight. Hard constraints always hold.
 */
export type JointAssignment = {
  subject: string;
  /** Null when no consistent candidate can be chosen. */
  value: string | null;
  /** P1's per-subject best. */
  localBest: string | null;
  /** The joint optimum chose differently from the per-subject best. */
  joint: boolean;
  weight: number;
};
export type JointSelection = {
  schemaVersion: 1;
  meaning: "hypothesis";
  status: "optimal" | "unknown" | "unsat";
  /** Set when status is `unknown`. */
  reason?: string;
  assignments: JointAssignment[];
  /** Weight of the chosen candidates, and of the best per-subject choice ignoring joint constraints. */
  satisfiedWeight: number;
  unconstrainedWeight: number;
};

/**
 * Integer weight of a candidate: its evidence tier dominates (code outranks
 * models, as in P0 fusion), then its P1 relative weight.
 */
export function candidateWeight(candidate: {
  tier: number | null;
  weight: number;
}): number {
  return (candidate.tier ?? 0) * 1000 + Math.round(candidate.weight * 999) + 1;
}

export async function selectInterpretations(input: {
  outcomes: readonly InterpretationOutcome[];
  /** Subject pairs that may not share a meaning (e.g. actions with different handlers). */
  exclusive?: readonly (readonly [string, string])[];
  solver: SolverProvider;
  timeoutMs?: number;
}): Promise<JointSelection> {
  const options = input.outcomes.map((outcome) => ({
    outcome,
    candidates: outcome.candidates
      .filter((candidate) => candidate.status === "consistent")
      .map((candidate) => ({
        value: candidate.value,
        weight: candidateWeight(candidate),
      })),
  }));
  const variable = (subject: number, candidate: number) =>
    `x${subject}_${candidate}`;
  const term = (name: string): SolverTerm => ({ op: "var", name });
  const variables = options.flatMap((option, subject) =>
    option.candidates.map((_, candidate) => ({
      name: variable(subject, candidate),
      sort: "bool" as const,
    })),
  );
  const assertions: SolverTerm[] = [];
  const both = (a: string, b: string): SolverTerm => ({
    op: "not",
    arg: { op: "and", args: [term(a), term(b)] },
  });
  // At most one meaning per subject.
  options.forEach((option, subject) => {
    for (let a = 0; a < option.candidates.length; a += 1)
      for (let b = a + 1; b < option.candidates.length; b += 1)
        assertions.push(both(variable(subject, a), variable(subject, b)));
  });
  // Exclusive subjects never share a meaning.
  const index = new Map(
    options.map((option, subject) => [option.outcome.subject, subject]),
  );
  for (const [first, second] of input.exclusive ?? []) {
    const a = index.get(first);
    const b = index.get(second);
    if (a === undefined || b === undefined) continue;
    options[a]?.candidates.forEach((left, i) => {
      options[b]?.candidates.forEach((right, j) => {
        if (left.value === right.value)
          assertions.push(both(variable(a, i), variable(b, j)));
      });
    });
  }
  const soft = options.flatMap((option, subject) =>
    option.candidates.map((candidate, index) => ({
      id: variable(subject, index),
      term: term(variable(subject, index)),
      weight: candidate.weight,
    })),
  );
  const unconstrainedWeight = options.reduce(
    (sum, option) =>
      sum + Math.max(0, ...option.candidates.map((item) => item.weight)),
    0,
  );
  const base = {
    schemaVersion: 1 as const,
    meaning: "hypothesis" as const,
    unconstrainedWeight,
  };
  const empty = (
    status: JointSelection["status"],
    reason?: string,
  ): JointSelection => ({
    ...base,
    status,
    ...(reason ? { reason } : {}),
    assignments: options.map(({ outcome }) => ({
      subject: outcome.subject,
      value: null,
      localBest: outcome.best,
      joint: outcome.best !== null,
      weight: 0,
    })),
    satisfiedWeight: 0,
  });
  // Nothing consistent to choose: the empty assignment is optimal.
  if (variables.length === 0) return empty("optimal");
  const result = await input.solver.optimize({
    variables,
    assertions,
    soft,
    timeoutMs: input.timeoutMs ?? 10_000,
  });
  if (result.status === "unknown") return empty("unknown", result.reason);
  // Unreachable while every hard constraint allows choosing nothing.
  if (result.status === "unsat") return empty("unsat");
  const chosen = new Set(result.satisfied);
  const assignments = options.map(({ outcome, candidates }, subject) => {
    const picked = candidates.findIndex((_, candidate) =>
      chosen.has(variable(subject, candidate)),
    );
    const value = picked === -1 ? null : (candidates[picked]?.value ?? null);
    return {
      subject: outcome.subject,
      value,
      localBest: outcome.best,
      joint: value !== outcome.best,
      weight: picked === -1 ? 0 : (candidates[picked]?.weight ?? 0),
    };
  });
  return {
    ...base,
    status: "optimal",
    assignments,
    satisfiedWeight: assignments.reduce((sum, item) => sum + item.weight, 0),
  };
}
