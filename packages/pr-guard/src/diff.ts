import {
  type BehaviorSpec,
  formatExpression,
  type Operation,
} from "@pathcompiler/behavior-ir";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { relateConditions } from "@pathcompiler/verification";

/**
 * What changed in the extracted behavior between two versions, independent of
 * which rules it breaks. Preconditions that changed are classified with the
 * solver: a refactoring that names a constant or reorders guards is
 * `equivalent` and produces no change at all.
 */
export type PreconditionChange =
  | "strengthened"
  | "weakened"
  | "changed"
  | "unknown";
export type OperationChange = {
  operation: string;
  status: "added" | "removed" | "changed";
  preconditions: {
    added: string[];
    removed: string[];
    /** Present when the set of preconditions differs semantically. */
    relation?: PreconditionChange;
  };
  effects: { added: string[]; removed: string[] };
  limitationsAdded: string[];
};
export type SetChange = { added: string[]; removed: string[] };
export type BehaviorDiff = {
  operations: OperationChange[];
  invariants: SetChange;
  businessRules: SetChange;
  permissions: SetChange;
  dataConstraints: SetChange;
  /** True when anything above is non-empty. */
  changed: boolean;
};

const sorted = (items: Iterable<string>) => [...new Set(items)].sort();
function change(base: Iterable<string>, head: Iterable<string>): SetChange {
  const before = new Set(base);
  const after = new Set(head);
  return {
    added: sorted([...after].filter((item) => !before.has(item))),
    removed: sorted([...before].filter((item) => !after.has(item))),
  };
}
const empty = (item: SetChange) =>
  item.added.length === 0 && item.removed.length === 0;

const preconditionTexts = (operation: Operation) =>
  operation.preconditions.map(formatExpression);
const effectTexts = (operation: Operation) =>
  operation.effects.map(
    (item) => `${item.variable} := ${formatExpression(item.value)}`,
  );
/** A limitation without its `file:line` prefix, so moving code is not a change. */
const limitationText = (text: string) => text.replace(/^\S+:\d+(?:-\d+)? /, "");

const rules = {
  invariants: (spec: BehaviorSpec) =>
    spec.invariants.map((item) => formatExpression(item.expression)),
  businessRules: (spec: BehaviorSpec) => [
    ...spec.businessRules.map(
      (item) =>
        `${item.id}: ${formatExpression(item.when)} => ${formatExpression(item.must)}`,
    ),
    ...spec.dataPolicies.map(
      (item) => `${item.id}: ${formatExpression(item.rule)}`,
    ),
  ],
  permissions: (spec: BehaviorSpec) =>
    spec.permissions.map(
      (item) =>
        `${item.role} ${item.effect} ${item.action}${item.constraint ? ` if ${formatExpression(item.constraint)}` : ""}`,
    ),
  dataConstraints: (spec: BehaviorSpec) =>
    (spec.dataConstraints ?? []).map(
      (item) =>
        `${item.kind} ${item.subject}${item.references ? ` -> ${item.references}` : ""}`,
    ),
};

export async function diffBehavior(
  base: BehaviorSpec,
  head: BehaviorSpec,
  solver: SolverProvider,
): Promise<BehaviorDiff> {
  // Conditions of both versions are compared over one variable universe.
  const known = new Set(head.variables.map((item) => item.id));
  const universe: BehaviorSpec = {
    ...head,
    variables: [
      ...head.variables,
      ...base.variables.filter((item) => !known.has(item.id)),
    ],
  };
  const before = new Map(base.operations.map((item) => [item.id, item]));
  const after = new Map(head.operations.map((item) => [item.id, item]));
  const operations: OperationChange[] = [];
  for (const id of sorted([...before.keys(), ...after.keys()])) {
    const old = before.get(id);
    const next = after.get(id);
    if (!old || !next) {
      const only = (old ?? next) as Operation;
      operations.push({
        operation: id,
        status: old ? "removed" : "added",
        preconditions: {
          added: old ? [] : sorted(preconditionTexts(only)),
          removed: old ? sorted(preconditionTexts(only)) : [],
        },
        effects: {
          added: old ? [] : sorted(effectTexts(only)),
          removed: old ? sorted(effectTexts(only)) : [],
        },
        limitationsAdded: old
          ? []
          : (only.limitations ?? []).map(limitationText),
      });
      continue;
    }
    const preconditions = change(
      preconditionTexts(old),
      preconditionTexts(next),
    );
    const effects = change(effectTexts(old), effectTexts(next));
    const limitationsAdded = change(
      (old.limitations ?? []).map(limitationText),
      (next.limitations ?? []).map(limitationText),
    ).added;
    if (empty(preconditions) && empty(effects) && limitationsAdded.length === 0)
      continue;
    let relation: PreconditionChange | undefined;
    if (!empty(preconditions)) {
      const result = await relateConditions(
        solver,
        universe,
        next.preconditions,
        old.preconditions,
      );
      relation =
        result.relation === "equivalent"
          ? undefined
          : result.relation === "left_stronger"
            ? "strengthened"
            : result.relation === "left_weaker"
              ? "weakened"
              : result.relation === "incomparable"
                ? "changed"
                : "unknown";
    }
    // Different text, same meaning (reordering, a named constant): not a change.
    if (
      !empty(preconditions) &&
      relation === undefined &&
      empty(effects) &&
      limitationsAdded.length === 0
    )
      continue;
    operations.push({
      operation: id,
      status: "changed",
      preconditions: { ...preconditions, ...(relation ? { relation } : {}) },
      effects,
      limitationsAdded,
    });
  }
  const sets = {
    invariants: change(rules.invariants(base), rules.invariants(head)),
    businessRules: change(rules.businessRules(base), rules.businessRules(head)),
    permissions: change(rules.permissions(base), rules.permissions(head)),
    dataConstraints: change(
      rules.dataConstraints(base),
      rules.dataConstraints(head),
    ),
  };
  return {
    operations,
    ...sets,
    changed:
      operations.length > 0 || Object.values(sets).some((item) => !empty(item)),
  };
}
