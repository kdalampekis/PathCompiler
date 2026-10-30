import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractBehavior } from "@pathcompiler/behavior-extraction";
import { describe, expect, it } from "vitest";
import {
  ActionBlockedError,
  type ActionRequest,
  auditActions,
  createActionGate,
  evaluateGate,
  guardTool,
  type LabeledAction,
  type RecordedAction,
} from "../src/index.js";

const root = resolve(import.meta.dirname, "../../../fixtures/refunds");
const read = (path: string) => ({
  path,
  content: readFileSync(resolve(root, path), "utf8"),
});
const spec = extractBehavior(
  [
    "db/schema.sql",
    "src/models.ts",
    "api/openapi.json",
    "spec/approved-rules.json",
    "src/refunds.ts",
  ].map(read),
  {
    bindings: {
      payment: "payments",
      request: "refund_requests",
      createRefund: "refund",
    },
  },
).spec;
const cases = (
  JSON.parse(readFileSync(resolve(root, "spec/action-cases.json"), "utf8")) as {
    cases: LabeledAction[];
  }
).cases;
const gate = createActionGate(spec);
const refund = (overrides: Partial<ActionRequest> = {}): ActionRequest => ({
  operation: "refund",
  inputs: { payment_id: 1, amount: 6000, manager_approval: false },
  context: { "actor.role": "support_agent", "actor.id": "a1" },
  state: { "payments.original_amount": 10000, "payments.refunded_amount": 0 },
  ...overrides,
});

describe("action gate on the refund specification (RQ4)", () => {
  it("blocks what the specification covers, passes safe actions, and shows what it cannot see", () => {
    const result = evaluateGate(gate, cases);
    expect(result.falseBlocks).toEqual([]);
    expect(result.wrongReason).toEqual([]);
    expect(result.safe).toBe(10);
    expect(result.unsafe).toBe(18);
    expect(result.safeAllowRate).toBe(1);
    expect(result.falseBlockRate).toBe(0);
    // Two unsafe actions are not described by any rule: the gate is only as
    // good as the specification, and the evaluation says so.
    expect(result.missedUnsafe.sort()).toEqual([
      "duplicate-identical-refund",
      "refund-for-another-customers-payment",
    ]);
    expect(result.unsafeBlockRate).toBeCloseTo(16 / 18);
    expect(result.rightReason).toBe(15);
    // The checks are evaluation, not search: well under a millisecond each.
    expect(result.meanLatencyMs).toBeLessThan(5);
  });

  it("explains the violated rule, with the values, and carries a counterexample", () => {
    const decision = gate.check(refund());
    expect(decision.decision).toBe("BLOCK");
    expect(decision.status).toBe("VIOLATED");
    const [violation] = decision.violations;
    expect(violation).toMatchObject({
      kind: "business_rule",
      id: "refunds.manager_approval_over_limit",
      enforced: true,
      basis: { humanBacked: true, confidence: "HIGH" },
    });
    expect(violation?.explanation).toContain(
      "A refund above 5000 needs manager approval.",
    );
    expect(violation?.because).toEqual({
      "refund.amount": 6000,
      "refund.manager_approval": false,
    });
    expect(decision.summary).toMatch(/^BLOCK refund: /);
    expect(decision.counterexample).toMatchObject({
      operation: "refund",
      replayed: true,
      context: { "actor.role": "support_agent" },
    });
  });

  it("names the missing precondition", () => {
    const decision = gate.check(
      refund({ inputs: { payment_id: 1, amount: 0, manager_approval: false } }),
    );
    const precondition = decision.violations.find(
      (item) => item.kind === "precondition",
    );
    expect(precondition?.rule).toBe("refund.amount >= 1");
    expect(precondition?.explanation).toBe(
      "refund requires refund.amount >= 1, which is false (refund.amount=0).",
    );
    expect(precondition?.basis?.humanBacked).toBe(false);
  });

  it("accepts short parameter names and full IDs, and ignores what it does not know", () => {
    const full = gate.check(
      refund({
        inputs: {
          "refund.payment_id": 1,
          "refund.amount": 100,
          "refund.manager_approval": false,
          surprise: 1,
        },
      }),
    );
    expect(full.decision).toBe("PASS");
    expect(full.warnings).toContain(
      "Ignored surprise: it is not a variable of the specification.",
    );
  });

  it("says what is missing when it cannot decide, and blocks by default", () => {
    const request = refund({
      state: {},
      inputs: { payment_id: 1, amount: 100, manager_approval: false },
    });
    const decision = gate.check(request);
    expect(decision).toMatchObject({ decision: "BLOCK", status: "UNKNOWN" });
    expect(
      decision.unresolved.flatMap((item) => item.missing).sort(),
    ).toContain("payments.original_amount");
    expect(decision.summary).toContain("cannot be checked, missing");
    // A caller can choose to let unknowns through.
    const lenient = createActionGate(spec, { onUnknown: "allow" }).check(
      refund({
        state: {},
        inputs: { payment_id: 1, amount: 100, manager_approval: false },
      }),
    );
    expect(lenient.decision).toBe("PASS");
    expect(lenient.status).toBe("UNKNOWN");
  });

  it("blocks an operation the specification does not describe unless told otherwise", () => {
    const request = { operation: "delete_payment" };
    expect(gate.check(request).decision).toBe("BLOCK");
    expect(
      createActionGate(spec, { onUnmodeledOperation: "allow" }).check(request)
        .decision,
    ).toBe("PASS");
  });

  it("predicts the invariant a valid-looking action would break", () => {
    // Without the code's own guards the stored invariant still stops it.
    const unguarded = {
      ...spec,
      operations: spec.operations.map((item) =>
        item.id === "refund" ? { ...item, preconditions: [] } : item,
      ),
      businessRules: [],
    };
    const decision = createActionGate(unguarded).check(
      refund({
        inputs: { payment_id: 1, amount: 900, manager_approval: true },
        state: {
          "payments.original_amount": 1000,
          "payments.refunded_amount": 500,
        },
      }),
    );
    expect(decision.violations.map((item) => [item.kind, item.id])).toEqual([
      ["invariant_after", "payments.check_refunded_amount_le_original_amount"],
    ]);
    expect(decision.violations[0]?.explanation).toContain("After refund");
    expect(decision.counterexample?.after).toMatchObject({
      "payments.refunded_amount": 1400,
    });
  });

  it("only enforces approved rules in approved_only mode and warns about the rest", () => {
    const strict = createActionGate(spec, { enforce: "approved_only" });
    // Violates only the code's own precondition (amount > 0) and the OpenAPI bound.
    const decision = strict.check(
      refund({
        inputs: { payment_id: 1, amount: 0, manager_approval: false },
        context: { "actor.role": "manager", "actor.id": "m1" },
      }),
    );
    expect(decision.violations.length).toBeGreaterThan(0);
    expect(decision.decision).toBe("PASS");
    expect(decision.warnings.join("\n")).toContain(
      "Not enforced (the rule is not human-approved)",
    );
    // An approved rule still blocks.
    expect(strict.check(refund()).decision).toBe("BLOCK");
  });
});

describe("guarded tools", () => {
  const calls: string[] = [];
  const issue = async (args: { amount: number; approved: boolean }) => {
    calls.push(`refund ${args.amount}`);
    return { refunded: args.amount };
  };
  const toRequest = (args: { amount: number; approved: boolean }) =>
    refund({
      inputs: {
        payment_id: 1,
        amount: args.amount,
        manager_approval: args.approved,
      },
    });

  it("runs the tool when the gate passes and returns the explanation when it blocks", async () => {
    calls.length = 0;
    const decisions: string[] = [];
    const tool = guardTool(gate, issue, {
      toRequest,
      onDecision: (decision) => decisions.push(decision.decision),
    });
    const ok = await tool({ amount: 200, approved: false });
    expect(ok).toMatchObject({ ok: true, result: { refunded: 200 } });
    const blocked = await tool({ amount: 6000, approved: false });
    expect(blocked).toMatchObject({ ok: false, blocked: true });
    expect(blocked.ok === false && blocked.message).toContain(
      "The action was not executed.",
    );
    expect(calls).toEqual(["refund 200"]);
    expect(decisions).toEqual(["PASS", "BLOCK"]);
  });

  it("can throw instead, and supports an async state lookup", async () => {
    calls.length = 0;
    const tool = guardTool(gate, issue, {
      onBlock: "throw",
      toRequest: async (args) => ({
        ...toRequest(args),
        state: {
          "payments.original_amount": 10000,
          "payments.refunded_amount": 0,
        },
      }),
    });
    await expect(
      tool({ amount: 6000, approved: false }),
    ).rejects.toBeInstanceOf(ActionBlockedError);
    expect(calls).toEqual([]);
  });
});

describe("gate evaluation", () => {
  it("reports misses, false blocks and wrong reasons instead of hiding them", () => {
    const labeled: LabeledAction[] = [
      {
        id: "a",
        label: "unsafe",
        request: refund({
          inputs: { payment_id: 1, amount: 100, manager_approval: false },
          context: { "actor.role": "manager", "actor.id": "m1" },
        }),
      },
      { id: "b", label: "safe", request: refund() },
      {
        id: "c",
        label: "unsafe",
        request: refund(),
        expectedRule: "refunds.process_once",
      },
    ];
    const result = evaluateGate(gate, labeled);
    expect(result.missedUnsafe).toEqual(["a"]);
    expect(result.falseBlocks.map((item) => item.id)).toEqual(["b"]);
    expect(result.wrongReason).toEqual([
      {
        id: "c",
        expected: "refunds.process_once",
        got: [
          "refunds.manager_approval_over_limit",
          "refund.amount <= 5000 || refund.manager_approval",
        ],
      },
    ]);
    expect(result.unsafeBlockRate).toBe(0.5);
    expect(result.safeAllowRate).toBe(0);
    expect(evaluateGate(gate, []).unsafeBlockRate).toBe(1);
  });
});

describe("audit of recorded actions (observed but not allowed)", () => {
  const logged = (
    id: string,
    request: ActionRequest,
    at = "2026-10-01",
  ): RecordedAction => ({
    id,
    at,
    ...request,
  });
  it("finds the actions that already broke a rule, per rule, and the ones it cannot judge", () => {
    const log: RecordedAction[] = [
      logged(
        "a",
        refund({
          inputs: { payment_id: 1, amount: 200, manager_approval: false },
        }),
      ),
      logged("b", refund()),
      logged(
        "c",
        refund({
          inputs: { payment_id: 1, amount: 9000, manager_approval: false },
        }),
      ),
      logged(
        "d",
        refund({
          context: { "actor.role": "customer", "actor.id": "c1" },
          inputs: { payment_id: 1, amount: 100, manager_approval: false },
        }),
      ),
      logged(
        "e",
        refund({
          state: {},
          inputs: { payment_id: 1, amount: 100, manager_approval: false },
        }),
      ),
    ];
    const report = auditActions(gate, log);
    expect(report).toMatchObject({
      total: 5,
      clean: 1,
      violating: 3,
      unresolved: 1,
    });
    expect(
      report.findings.map((item) => [item.index, item.id, item.at]),
    ).toEqual([
      [2, "b", "2026-10-01"],
      [3, "c", "2026-10-01"],
      [4, "d", "2026-10-01"],
    ]);
    expect(
      report.byRule.find(
        (item) => item.rule === "refunds.manager_approval_over_limit",
      ),
    ).toEqual({ rule: "refunds.manager_approval_over_limit", actions: 2 });
    expect(report.byRule.map((item) => item.rule)).toContain(
      "refunds.customers_cannot_refund",
    );
    expect(report.missingValues.map((item) => item.id)).toContain(
      "payments.original_amount",
    );
  });
  it("is empty and clean for an empty log", () => {
    expect(auditActions(gate, [])).toEqual({
      total: 0,
      clean: 0,
      violating: 0,
      unresolved: 0,
      missingValues: [],
      byRule: [],
      findings: [],
    });
  });
});
