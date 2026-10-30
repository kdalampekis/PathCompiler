import type { BehaviorSpec } from "@pathcompiler/behavior-ir";

const ROLE_PROPERTIES = ["role"];

/**
 * The context variable that holds the actor's role: an enum named `role` (or
 * `<x>.role`) that lists `role` among its values. `named` overrides the search.
 */
export function findRoleVariable(
  spec: BehaviorSpec,
  role: string,
  named?: string,
): { id: string; reason?: undefined } | { id?: undefined; reason: string } {
  const candidates = spec.variables.filter(
    (variable) =>
      variable.scope === "context" &&
      variable.type === "enum" &&
      variable.values.includes(role) &&
      (named
        ? variable.id === named
        : ROLE_PROPERTIES.includes(variable.id.split(".").pop() as string)),
  );
  if (candidates.length === 1)
    return { id: (candidates[0] as { id: string }).id };
  return {
    reason:
      candidates.length === 0
        ? `No context enum variable holds the role ${role} (name one with roleVariable).`
        : `Several context variables could hold the role ${role}: ${candidates.map((item) => item.id).join(", ")}.`,
  };
}
