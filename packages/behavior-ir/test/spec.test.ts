import { describe, expect, it } from "vitest";
import {
  type BehaviorSpec,
  behaviorSpecHash,
  isHumanBacked,
  type Provenance,
  ProvenanceSchema,
  parseBehaviorSpec,
  parseExpression,
  serializeBehaviorSpec,
  weakestConfidence,
} from "../src/index.js";

const x = parseExpression;
const declared: Provenance = {
  sourceType: "HUMAN_DECLARATION",
  origin: "HUMAN_APPROVED",
  extractionMethod: "HUMAN",
  extractorVersion: "test",
  confidence: "HIGH",
  declaredBy: "payments team",
};
const fromTest: Provenance = {
  sourceType: "TEST",
  origin: "INFERRED",
  extractionMethod: "STATIC_ANALYSIS",
  extractorVersion: "assertions@1",
  confidence: "MEDIUM",
  sourceFile: "tests/test_refunds.py",
  sourceLines: "32-47",
};
/** The examples from the expansion brief, as one specification. */
function refundSpec(): BehaviorSpec {
  return {
    schemaVersion: 1,
    kind: "behavior-spec",
    id: "refunds",
    metadata: {
      repositoryCommit: null,
      producer: "test",
      producerVersion: "1",
    },
    variables: [
      { id: "balance", type: "integer", scope: "state", min: 0 },
      { id: "inventory", type: "integer", scope: "state" },
      { id: "payment_verified", type: "boolean", scope: "state" },
      { id: "manager_approval", type: "boolean", scope: "context" },
      {
        id: "role",
        type: "enum",
        scope: "context",
        values: ["support_agent", "manager"],
      },
      { id: "amount", type: "integer", scope: "input" },
      { id: "refund", type: "integer", scope: "input" },
      { id: "new_balance", type: "integer", scope: "state" },
      { id: "source_tenant", type: "string", scope: "context" },
      { id: "destination_tenant", type: "string", scope: "context" },
    ],
    workflows: [
      {
        id: "checkout",
        states: ["cart", "payment_pending", "order_confirmed"],
        entry: { state: "cart" },
        terminal: { states: ["order_confirmed"] },
        provenance: [declared],
      },
    ],
    transitions: [
      {
        id: "confirm_order",
        workflow: "checkout",
        from: "payment_pending",
        to: "order_confirmed",
        preconditions: [x("payment_verified == true")],
        effects: [],
        provenance: [fromTest],
      },
    ],
    operations: [
      {
        id: "withdraw",
        parameters: ["amount"],
        preconditions: [x("amount > 0"), x("amount <= balance")],
        postconditions: [
          x("new_balance == old(balance) - amount"),
          x("new_balance >= 0"),
        ],
        effects: [],
        provenance: [declared],
      },
    ],
    invariants: [
      {
        id: "inventory_non_negative",
        expression: x("inventory >= 0"),
        provenance: [fromTest],
      },
    ],
    permissions: [
      {
        id: "support_refund_limit",
        role: "support_agent",
        action: "refund",
        effect: "allow",
        constraint: x("refund <= 500"),
        provenance: [declared],
      },
    ],
    temporalRules: [
      {
        id: "payment_before_confirmation",
        kind: "must_precede",
        before: "payment_pending",
        after: "confirm_order",
        provenance: [declared],
      },
    ],
    dataPolicies: [
      {
        id: "tenant_isolation",
        rule: x("source_tenant == destination_tenant"),
        provenance: [declared],
      },
    ],
    businessRules: [
      {
        id: "manager_approval_required_above_5000",
        when: x("refund > 5000"),
        must: x("manager_approval == true"),
        provenance: [declared, fromTest],
      },
    ],
  };
}
const issues = (input: unknown) => {
  const result = (() => {
    try {
      parseBehaviorSpec(input);
      return [];
    } catch (error) {
      return (
        (error as { issues?: { message: string }[] }).issues?.map(
          (item) => item.message,
        ) ?? [String(error)]
      );
    }
  })();
  return result;
};

describe("BehaviorIR", () => {
  it("accepts the workflow, transition, invariant, permission, temporal, data and operation examples", () => {
    const spec = parseBehaviorSpec(refundSpec());
    expect(spec.workflows[0]?.terminal.states).toEqual(["order_confirmed"]);
    expect(spec.temporalRules[0]?.kind).toBe("must_precede");
    expect(weakestConfidence(spec.businessRules[0]?.provenance ?? [])).toBe(
      "MEDIUM",
    );
    expect(isHumanBacked(spec.invariants[0]?.provenance ?? [])).toBe(false);
    expect(isHumanBacked(spec.businessRules[0]?.provenance ?? [])).toBe(true);
  });

  it("serializes and hashes identically for any authoring order", () => {
    const spec = refundSpec();
    const shuffled: BehaviorSpec = {
      ...spec,
      variables: [...spec.variables].reverse(),
      businessRules: spec.businessRules.map((rule) => ({
        ...rule,
        provenance: [...rule.provenance].reverse(),
      })),
      invariants: [...spec.invariants].reverse(),
    };
    expect(serializeBehaviorSpec(shuffled)).toBe(serializeBehaviorSpec(spec));
    expect(behaviorSpecHash(shuffled)).toBe(behaviorSpecHash(spec));
    expect(serializeBehaviorSpec(spec)).toMatch(/\n$/);
    expect(behaviorSpecHash(spec)).toMatch(/^sha256:[a-f0-9]{64}$/);
    const changed = refundSpec();
    changed.invariants[0] = {
      ...(changed.invariants[0] as BehaviorSpec["invariants"][number]),
      expression: x("inventory >= 1"),
    };
    expect(behaviorSpecHash(changed)).not.toBe(behaviorSpecHash(spec));
  });

  it("refuses rules without provenance, and provenance a reviewer cannot follow", () => {
    const missing = refundSpec();
    missing.invariants[0] = {
      ...(missing.invariants[0] as BehaviorSpec["invariants"][number]),
      provenance: [],
    };
    expect(issues(missing)).toContain("Every rule needs provenance.");
    const bad = (provenance: Record<string, unknown>) =>
      ProvenanceSchema.safeParse({
        ...fromTest,
        ...provenance,
      }).error?.issues.map((item) => item.message) ?? [];
    expect(bad({ sourceFile: undefined, sourceLines: undefined })[0]).toContain(
      "needs sourceFile",
    );
    expect(bad({ sourceLines: "9-3" })[0]).toContain("not a valid range");
    expect(bad({ origin: "HUMAN_APPROVED" })[0]).toContain("need declaredBy");
    expect(
      bad({ extractionMethod: "LLM_ASSISTED", origin: "EXPLICIT" })[0],
    ).toContain("INFERRED until a human approves");
    expect(
      bad({
        sourceType: "INFERRED",
        origin: "EXPLICIT",
        sourceFile: undefined,
        sourceLines: undefined,
      }),
    ).toContain("An INFERRED source cannot be EXPLICIT.");
    expect(ProvenanceSchema.safeParse(declared).success).toBe(true);
  });

  it("checks references, scopes and types with actionable messages", () => {
    const base = refundSpec();
    const first = <T>(items: T[]): T => items[0] as T;
    const messages = (patch: Partial<BehaviorSpec>) =>
      issues({ ...base, ...patch });
    const invariant = (expression: string) => ({
      invariants: [{ ...first(base.invariants), expression: x(expression) }],
    });
    expect(messages(invariant("stock >= 0"))).toContain(
      "Unknown variable stock",
    );
    expect(messages(invariant("inventory >= true"))).toContain(
      "true is a boolean, but a number is needed here.",
    );
    expect(messages(invariant("old(inventory) >= 0"))).toContain(
      "old(inventory) is only allowed in postconditions.",
    );
    expect(
      messages({
        businessRules: [
          { ...first(base.businessRules), must: x('role == "intern"') },
        ],
      }),
    ).toContain('"intern" is not a value of role (support_agent, manager).');
    expect(
      messages({
        operations: [{ ...first(base.operations), parameters: ["balance"] }],
      }),
    ).toContain(
      "balance is a state variable; parameters must be input variables.",
    );
    expect(
      messages({
        temporalRules: [
          { ...first(base.temporalRules), before: "payment_done" },
        ],
      }),
    ).toContain(
      "payment_done is not a transition, operation or workflow state.",
    );
    expect(
      messages({
        transitions: [{ ...first(base.transitions), to: "shipped" }],
      }),
    ).toContain("State shipped is not in the states of checkout.");
    expect(
      messages({
        businessRules: [first(base.businessRules), first(base.businessRules)],
      }),
    ).toContain(
      "Rule ID manager_approval_required_above_5000 is used by more than one rule",
    );
    expect(
      messages({
        operations: [
          {
            ...first(base.operations),
            effects: [{ variable: "amount", value: x("1") }],
          },
        ],
      }),
    ).toContain(
      "amount is a input variable; only state variables can be updated.",
    );
    expect(
      messages({
        permissions: [{ ...first(base.permissions), effect: "deny" }],
      }),
    ).toContain(
      "A deny permission is unconditional; remove the constraint or use allow.",
    );
  });
});
