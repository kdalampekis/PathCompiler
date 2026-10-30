import { type BehaviorSpec, behaviorSpecHash } from "@pathcompiler/behavior-ir";
import type {
  VerificationProperty,
  VerificationResult,
  VerificationStatus,
  Verifier,
  VerifyOptions,
} from "./types.js";

/**
 * Picks the first verifier that supports a property. Nothing is forced
 * through a verifier that cannot handle it: the answer is UNSUPPORTED with
 * every verifier's reason, so the gap is visible rather than a silent pass.
 */
export function createVerificationRouter(verifiers: readonly Verifier[]) {
  return {
    verifiers,
    async verify(
      property: VerificationProperty,
      spec: BehaviorSpec,
      options?: VerifyOptions,
    ): Promise<VerificationResult> {
      const reasons: string[] = [];
      for (const verifier of verifiers) {
        const decision = verifier.supports(property, spec);
        if (decision.supported) return verifier.verify(property, spec, options);
        reasons.push(`${verifier.name}: ${decision.reason}`);
      }
      return {
        property,
        status: "UNSUPPORTED",
        verifier: "router",
        fragment: verifiers.map((item) => item.fragment).join(" | ") || "none",
        reason: reasons.join("; ") || "No verifier is registered.",
        caveats: [],
        elapsedMs: 0,
      };
    },
  };
}
export type VerificationRouter = ReturnType<typeof createVerificationRouter>;

/**
 * Every property the specification implies for its operations: each
 * invariant, each applicable business rule or data policy, and each deny or
 * constrained-allow permission, per operation. Sorted, so a report is stable.
 */
export function propertiesOf(
  spec: BehaviorSpec,
  only?: { operations?: readonly string[] },
): VerificationProperty[] {
  const properties: VerificationProperty[] = [];
  for (const operation of spec.operations) {
    if (only?.operations && !only.operations.includes(operation.id)) continue;
    for (const invariant of spec.invariants)
      properties.push({
        kind: "invariant_preserved",
        operation: operation.id,
        invariant: invariant.id,
      });
    for (const rule of [...spec.businessRules, ...spec.dataPolicies])
      if (!rule.appliesTo || rule.appliesTo.includes(operation.id))
        properties.push({
          kind: "rule_enforced",
          operation: operation.id,
          rule: rule.id,
        });
    for (const permission of spec.permissions)
      if (
        permission.action === operation.id &&
        (permission.effect === "deny" || permission.constraint)
      )
        properties.push({
          kind: "permission_enforced",
          operation: operation.id,
          permission: permission.id,
        });
    if (operation.effects.length > 0 && operation.postconditions.length > 0)
      properties.push({
        kind: "postconditions_guaranteed",
        operation: operation.id,
      });
  }
  return properties;
}

export type VerificationReport = {
  specId: string;
  specHash: string;
  summary: Record<VerificationStatus, number>;
  results: VerificationResult[];
};

export async function verifySpec(
  router: VerificationRouter,
  spec: BehaviorSpec,
  options: VerifyOptions & { operations?: readonly string[] } = {},
): Promise<VerificationReport> {
  const results: VerificationResult[] = [];
  const request = options.operations
    ? { operations: options.operations }
    : undefined;
  for (const property of propertiesOf(spec, request))
    results.push(await router.verify(property, spec, options));
  const summary: Record<VerificationStatus, number> = {
    VERIFIED: 0,
    VIOLATED: 0,
    UNKNOWN: 0,
    UNSUPPORTED: 0,
  };
  for (const result of results) summary[result.status] += 1;
  return {
    specId: spec.id,
    specHash: behaviorSpecHash(spec),
    summary,
    results,
  };
}
