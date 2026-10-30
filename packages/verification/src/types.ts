import type {
  BehaviorSpec,
  ConfidenceBand,
  Literal,
} from "@pathcompiler/behavior-ir";

/**
 * What can be asked of a specification. Every property is about **one
 * execution of one operation**, starting from any state that satisfies the
 * invariants (an inductive check): "VERIFIED" therefore means the property
 * holds for every such step in the encoded model, not that the system is
 * correct.
 */
export type VerificationProperty =
  /** After `operation` runs, `invariant` still holds. */
  | { kind: "invariant_preserved"; operation: string; invariant: string }
  /** Whenever `operation` runs, the business rule or data policy holds. */
  | { kind: "rule_enforced"; operation: string; rule: string }
  /** The operation's preconditions respect a deny or constrained-allow permission. */
  | { kind: "permission_enforced"; operation: string; permission: string }
  /** The operation's stated postconditions follow from its preconditions and effects. */
  | { kind: "postconditions_guaranteed"; operation: string };

export type VerificationStatus =
  | "VERIFIED"
  | "VIOLATED"
  | "UNKNOWN"
  | "UNSUPPORTED";

export type Counterexample = {
  operation: string;
  /** State before the operation. */
  state: Record<string, Literal>;
  inputs: Record<string, Literal>;
  context: Record<string, Literal>;
  /** State after the operation, when the property is about the step's result. */
  after?: Record<string, Literal>;
  /** What is violated, in expression text. */
  violated: string;
  /** True when re-evaluating the specification on these values confirms it. */
  replayed: boolean;
  /**
   * The variables that matter to this violation (those the violated rule and
   * the operation's contract mention), so a report can show them and leave out
   * the rest of the valuation.
   */
  relevant?: string[];
};

/** How far a rule can be trusted, from its provenance. */
export type RuleBasis = {
  id: string;
  kind: string;
  text: string;
  confidence: ConfidenceBand;
  humanBacked: boolean;
  sources: string[];
};

export type VerificationResult = {
  property: VerificationProperty;
  status: VerificationStatus;
  verifier: string;
  /** The fragment the verifier supports, stated so a result is read in context. */
  fragment: string;
  rule?: RuleBasis;
  reason?: string;
  /** Things that weaken the claim (unmodeled constructs, unreachable pre-states). */
  caveats: string[];
  counterexample?: Counterexample;
  elapsedMs: number;
};

export type VerifyOptions = {
  timeoutMs?: number;
};

export type SupportDecision =
  | { supported: true }
  | { supported: false; reason: string };

/** A backend. The router asks `supports` first, so UNSUPPORTED is explicit. */
export interface Verifier {
  readonly name: string;
  readonly fragment: string;
  supports(property: VerificationProperty, spec: BehaviorSpec): SupportDecision;
  verify(
    property: VerificationProperty,
    spec: BehaviorSpec,
    options?: VerifyOptions,
  ): Promise<VerificationResult>;
}

export const propertyLabel = (property: VerificationProperty): string => {
  switch (property.kind) {
    case "invariant_preserved":
      return `${property.operation} preserves ${property.invariant}`;
    case "rule_enforced":
      return `${property.operation} enforces ${property.rule}`;
    case "permission_enforced":
      return `${property.operation} respects ${property.permission}`;
    case "postconditions_guaranteed":
      return `${property.operation} guarantees its postconditions`;
  }
};
