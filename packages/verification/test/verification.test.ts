import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractBehavior } from "@pathcompiler/behavior-extraction";
import {
  type BehaviorSpec,
  e,
  type Provenance,
  parseBehaviorSpec,
} from "@pathcompiler/behavior-ir";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSmtVerifier,
  createVerificationRouter,
  propertiesOf,
  type VerificationResult,
  type Verifier,
  verifySpec,
} from "../src/index.js";

let solver: SolverProvider;
beforeAll(async () => {
  solver = await createZ3SolverProvider();
});
afterAll(async () => {
  await solver?.close();
});

const root = resolve(import.meta.dirname, "../../../fixtures/refunds");
const BINDINGS = {
  payment: "payments",
  request: "refund_requests",
  createRefund: "refund",
};
function refundSpec(service = "src/refunds.ts"): BehaviorSpec {
  const files = [
    "db/schema.sql",
    "src/models.ts",
    "api/openapi.json",
    "spec/approved-rules.json",
    service,
  ].map((path) => ({
    path: `fixtures/refunds/${path}`,
    content: readFileSync(resolve(root, path), "utf8"),
  }));
  return extractBehavior(files, { bindings: BINDINGS }).spec;
}
const verifier = () => createSmtVerifier(solver);
const router = () => createVerificationRouter([verifier()]);
const statusOf = (
  results: VerificationResult[],
  operation: string,
  id: string,
) =>
  results.find(
    (item) =>
      item.property.operation === operation &&
      JSON.stringify(item.property).includes(`"${id}"`),
  );

describe("refund specification (RQ2, RQ3)", () => {
  it("verifies every extracted and approved rule of the base service", async () => {
    const report = await verifySpec(router(), refundSpec());
    expect(report.summary.VIOLATED).toBe(0);
    expect(report.summary.UNKNOWN).toBe(0);
    expect(report.summary.UNSUPPORTED).toBe(0);
    expect(report.summary.VERIFIED).toBe(report.results.length);
    expect(report.results.length).toBe(23);
    const approval = statusOf(
      report.results,
      "refund",
      "refunds.manager_approval_over_limit",
    );
    expect(approval?.status).toBe("VERIFIED");
    expect(approval?.rule).toMatchObject({
      humanBacked: true,
      confidence: "HIGH",
    });
  });

  it("finds the support fast path with a counterexample that replays", async () => {
    const spec = refundSpec("variants/support-fast-path.ts");
    const report = await verifySpec(router(), spec);
    const violated = report.results.filter(
      (item) => item.status === "VIOLATED",
    );
    expect(violated.map((item) => JSON.stringify(item.property))).toEqual([
      JSON.stringify({
        kind: "rule_enforced",
        operation: "refund",
        rule: "refunds.manager_approval_over_limit",
      }),
    ]);
    const cex = violated[0]?.counterexample;
    expect(cex?.replayed).toBe(true);
    // The counterexample says which variables matter; the rest of the valuation is noise.
    expect(cex?.relevant).toEqual(
      expect.arrayContaining([
        "actor.role",
        "refund.amount",
        "refund.manager_approval",
        "payments.original_amount",
      ]),
    );
    expect(cex?.relevant).not.toContain("refund_requests.requester_id");
    expect(cex?.context["actor.role"]).toBe("support_agent");
    expect(cex?.inputs["refund.manager_approval"]).toBe(false);
    expect(Number(cex?.inputs["refund.amount"])).toBeGreaterThan(5000);
    expect(violated[0]?.rule?.humanBacked).toBe(true);
    // Tests pass on this variant; the rule does not hold: the point of RQ3.
    expect(report.summary.VERIFIED).toBe(report.results.length - 1);
  });

  it("flags each dropped guard and nothing else", async () => {
    const violations = async (variant: string) =>
      (await verifySpec(router(), refundSpec(`variants/${variant}.ts`))).results
        .filter((item) => item.status === "VIOLATED")
        .map((item) => (item.property as { rule?: string }).rule)
        .sort();
    expect(await violations("own-approval")).toEqual([
      "refunds.no_self_approval",
    ]);
    expect(await violations("double-process")).toEqual([
      "refunds.process_once",
    ]);
  });

  it("does not flag a benign refactor or a stricter limit", async () => {
    for (const variant of ["benign-refactor", "stricter-limit"]) {
      const report = await verifySpec(
        router(),
        refundSpec(`variants/${variant}.ts`),
      );
      expect(report.summary.VIOLATED, variant).toBe(0);
    }
  });

  it("is deterministic apart from timing", async () => {
    const strip = (report: Awaited<ReturnType<typeof verifySpec>>) =>
      JSON.stringify(report.results.map(({ elapsedMs: _, ...rest }) => rest));
    const spec = refundSpec("variants/support-fast-path.ts");
    expect(strip(await verifySpec(router(), spec))).toBe(
      strip(await verifySpec(router(), spec)),
    );
  });
});

const declared: Provenance = {
  sourceType: "HUMAN_DECLARATION",
  origin: "HUMAN_APPROVED",
  extractionMethod: "HUMAN",
  extractorVersion: "t",
  confidence: "HIGH",
  declaredBy: "tester",
};
const x = (text: string) => parseExpressionLazy(text);

import { parseExpression as parseExpressionLazy } from "@pathcompiler/behavior-ir";

/** The brief's account example: withdraw without the balance guard. */
function account(overrides: Partial<BehaviorSpec> = {}): BehaviorSpec {
  return parseBehaviorSpec({
    schemaVersion: 1,
    kind: "behavior-spec",
    id: "account",
    metadata: { repositoryCommit: null, producer: "t", producerVersion: "1" },
    variables: [
      { id: "balance", type: "integer", scope: "state" },
      { id: "amount", type: "integer", scope: "input" },
      {
        id: "role",
        type: "enum",
        scope: "context",
        values: ["teller", "guest"],
      },
    ],
    workflows: [],
    transitions: [],
    operations: [
      {
        id: "withdraw",
        parameters: ["amount"],
        preconditions: [x("amount > 0")],
        postconditions: [],
        effects: [{ variable: "balance", value: x("balance - amount") }],
        provenance: [declared],
      },
    ],
    invariants: [
      {
        id: "balance_non_negative",
        expression: x("balance >= 0"),
        provenance: [declared],
      },
    ],
    permissions: [],
    temporalRules: [],
    dataPolicies: [],
    businessRules: [],
    ...overrides,
  });
}

describe("verification results", () => {
  it("returns VIOLATED with a replayed counterexample for a missing guard", async () => {
    const result = await verifier().verify(
      {
        kind: "invariant_preserved",
        operation: "withdraw",
        invariant: "balance_non_negative",
      },
      account(),
    );
    expect(result.status).toBe("VIOLATED");
    const cex = result.counterexample;
    expect(cex?.replayed).toBe(true);
    const before = Number(cex?.state.balance);
    const amount = Number(cex?.inputs.amount);
    expect(before).toBeGreaterThanOrEqual(0);
    expect(amount).toBeGreaterThan(before);
    expect(cex?.after?.balance).toBe(before - amount);
    expect(result.caveats.join(" ")).toContain("may not be reachable");
  });

  it("returns VERIFIED once the guard is added", async () => {
    const spec = account();
    const first = spec.operations[0];
    if (!first) throw new Error("fixture");
    const guarded = parseBehaviorSpec({
      ...spec,
      operations: [
        { ...first, preconditions: [x("amount > 0"), x("amount <= balance")] },
      ],
    });
    const result = await verifier().verify(
      {
        kind: "invariant_preserved",
        operation: "withdraw",
        invariant: "balance_non_negative",
      },
      guarded,
    );
    expect(result.status).toBe("VERIFIED");
    expect(result.fragment).toContain("linear integer arithmetic");
  });

  it("checks permissions through the role variable", async () => {
    const withRole = (precondition: string) =>
      account({
        operations: [
          {
            id: "withdraw",
            parameters: ["amount"],
            preconditions: [x(precondition)],
            postconditions: [],
            effects: [],
            provenance: [declared],
          },
        ],
        permissions: [
          {
            id: "no_guest",
            role: "guest",
            action: "withdraw",
            effect: "deny",
            provenance: [declared],
          },
        ],
      });
    const property = {
      kind: "permission_enforced" as const,
      operation: "withdraw",
      permission: "no_guest",
    };
    const open = await verifier().verify(property, withRole("amount > 0"));
    expect(open.status).toBe("VIOLATED");
    expect(open.counterexample?.context.role).toBe("guest");
    expect(
      (await verifier().verify(property, withRole('role == "teller"'))).status,
    ).toBe("VERIFIED");
  });

  it("checks business rules with enums, booleans and implication", async () => {
    const spec = account({
      variables: [
        { id: "balance", type: "integer", scope: "state" },
        { id: "amount", type: "integer", scope: "input" },
        { id: "approved", type: "boolean", scope: "context" },
      ],
      businessRules: [
        {
          id: "big_needs_approval",
          when: x("amount > 100"),
          must: x("approved"),
          provenance: [declared],
        },
      ],
    });
    const result = await verifier().verify(
      {
        kind: "rule_enforced",
        operation: "withdraw",
        rule: "big_needs_approval",
      },
      spec,
    );
    expect(result.status).toBe("VIOLATED");
    expect(result.counterexample?.context.approved).toBe(false);
    expect(Number(result.counterexample?.inputs.amount)).toBeGreaterThan(100);
  });

  it("checks that stated postconditions follow from the effects", async () => {
    const withPost = (post: string) =>
      account({
        operations: [
          {
            id: "withdraw",
            parameters: ["amount"],
            preconditions: [x("amount > 0")],
            postconditions: [x(post)],
            effects: [{ variable: "balance", value: x("balance - amount") }],
            provenance: [declared],
          },
        ],
      });
    const property = {
      kind: "postconditions_guaranteed" as const,
      operation: "withdraw",
    };
    expect(
      (
        await verifier().verify(
          property,
          withPost("balance == old(balance) - amount"),
        )
      ).status,
    ).toBe("VERIFIED");
    expect(
      (
        await verifier().verify(
          property,
          withPost("balance == old(balance) + amount"),
        )
      ).status,
    ).toBe("VIOLATED");
  });

  it("flags a proof that holds only because the operation can never run", async () => {
    const spec = account();
    const first = spec.operations[0];
    if (!first) throw new Error("fixture");
    const contradictory = parseBehaviorSpec({
      ...spec,
      operations: [
        { ...first, preconditions: [x("amount > 0"), x("amount < 0")] },
      ],
    });
    const result = await verifier().verify(
      {
        kind: "invariant_preserved",
        operation: "withdraw",
        invariant: "balance_non_negative",
      },
      contradictory,
    );
    expect(result.status).toBe("VERIFIED");
    expect(result.caveats.join(" ")).toContain("Vacuous");
  });

  it("carries operation limitations into the caveats", async () => {
    const spec = account();
    const first = spec.operations[0];
    if (!first) throw new Error("fixture");
    const limited = parseBehaviorSpec({
      ...spec,
      operations: [{ ...first, limitations: ["svc.ts:5 guard not modeled"] }],
    });
    const result = await verifier().verify(
      {
        kind: "invariant_preserved",
        operation: "withdraw",
        invariant: "balance_non_negative",
      },
      limited,
    );
    expect(result.status).toBe("VIOLATED");
    expect(result.caveats.join(" ")).toContain(
      "may not be possible in the real system",
    );
  });
});

describe("honest non-answers", () => {
  it("reports UNSUPPORTED with the reason, never a pass", async () => {
    const nonlinear = account({
      invariants: [
        {
          id: "weird",
          expression: x("balance * amount >= 0"),
          provenance: [declared],
        },
      ],
    });
    const cases = [
      [
        {
          kind: "invariant_preserved" as const,
          operation: "withdraw",
          invariant: "weird",
        },
        nonlinear,
        "nonlinear",
      ],
      [
        {
          kind: "invariant_preserved" as const,
          operation: "nope",
          invariant: "weird",
        },
        nonlinear,
        "no operation nope",
      ],
      [
        {
          kind: "rule_enforced" as const,
          operation: "withdraw",
          rule: "missing",
        },
        account(),
        "no business rule",
      ],
      [
        { kind: "postconditions_guaranteed" as const, operation: "withdraw" },
        account(),
        "both effects and postconditions",
      ],
    ] as const;
    for (const [property, spec, reason] of cases) {
      const result = await router().verify(property, spec);
      expect(result.status).toBe("UNSUPPORTED");
      expect(result.reason).toContain(reason);
    }
  });

  it("reports UNKNOWN when the solver gives up, and when a model does not replay", async () => {
    const spec = account();
    const property = {
      kind: "invariant_preserved" as const,
      operation: "withdraw",
      invariant: "balance_non_negative",
    };
    const stub = (check: SolverProvider["check"]): SolverProvider => ({
      name: "stub",
      check,
      optimize: async () => ({ status: "unsat" }),
      close: async () => undefined,
    });
    const timedOut = await createSmtVerifier(
      stub(async () => ({ status: "unknown", reason: "timeout" })),
    ).verify(property, spec);
    expect(timedOut).toMatchObject({ status: "UNKNOWN", reason: "timeout" });
    const bogus = await createSmtVerifier(
      stub(async () => ({
        status: "sat",
        model: { balance: 10, "balance'": 10, amount: 1, role: 1 },
      })),
    ).verify(property, spec);
    expect(bogus.status).toBe("UNKNOWN");
    expect(bogus.reason).toContain("disagreed");
    expect(bogus.counterexample).toBeUndefined();
  });

  it("routes to the first supporting verifier and lists every reason otherwise", async () => {
    const never = (name: string): Verifier => ({
      name,
      fragment: "nothing",
      supports: () => ({ supported: false, reason: `${name} cannot` }),
      verify: async () => {
        throw new Error("must not be called");
      },
    });
    const property = {
      kind: "invariant_preserved" as const,
      operation: "withdraw",
      invariant: "balance_non_negative",
    };
    const routed = await createVerificationRouter([
      never("a"),
      verifier(),
    ]).verify(property, account());
    expect(routed.status).toBe("VIOLATED");
    const none = await createVerificationRouter([
      never("a"),
      never("b"),
    ]).verify(property, account());
    expect(none).toMatchObject({ status: "UNSUPPORTED", verifier: "router" });
    expect(none.reason).toBe("a: a cannot; b: b cannot");
    expect(
      (await createVerificationRouter([]).verify(property, account())).reason,
    ).toBe("No verifier is registered.");
  });
});

describe("property enumeration", () => {
  it("lists invariants, applicable rules and enforceable permissions per operation", () => {
    const spec = account({
      permissions: [
        {
          id: "no_guest",
          role: "guest",
          action: "withdraw",
          effect: "deny",
          provenance: [declared],
        },
        {
          id: "teller_ok",
          role: "teller",
          action: "withdraw",
          effect: "allow",
          provenance: [declared],
        },
      ],
      businessRules: [
        {
          id: "elsewhere",
          when: e.lit(true),
          must: e.lit(true),
          appliesTo: [],
          provenance: [declared],
        },
      ],
    });
    expect(propertiesOf(spec).map((item) => item.kind)).toEqual([
      "invariant_preserved",
      "permission_enforced",
    ]);
  });
});
