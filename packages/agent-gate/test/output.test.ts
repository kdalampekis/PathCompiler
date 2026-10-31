import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  extractBehavior,
  readSourceFiles,
} from "@pathcompiler/behavior-extraction";
import { describe, expect, it } from "vitest";
import {
  checkOutput,
  createActionGate,
  guardOutput,
  type OutputClaim,
  parseOutputPolicies,
} from "../src/index.js";

const root = resolve(import.meta.dirname, "../../../fixtures/support-agent");
const files = await readSourceFiles(root);
const gate = createActionGate(extractBehavior(files).spec);
const policies = parseOutputPolicies(
  readFileSync(resolve(root, "spec/output-policies.json"), "utf8"),
);
const refund = (amount: number, approved: boolean): OutputClaim => ({
  operation: "refund",
  inputs: { amount, manager_approval: approved },
});

describe("agent tool definitions in the gate", () => {
  it("applies the tool's own bounds and the approved business rule to a tool call", () => {
    expect(gate.check(refund(100, false)).decision).toBe("PASS");
    const tooBig = gate.check(refund(25000, true));
    expect(tooBig.decision).toBe("BLOCK");
    const unapproved = gate.check(refund(6000, false));
    expect(unapproved.violations[0]?.id).toBe(
      "support.manager_approval_over_limit",
    );
  });
});

describe("answer check", () => {
  it("blocks an answer that commits to an action the rules forbid, and says how to fix it", () => {
    const decision = checkOutput(gate, policies, {
      text: "I have refunded 6000 to your card. It is subject to our refund policy.",
      claims: [refund(6000, false)],
    });
    expect(decision.decision).toBe("BLOCK");
    expect(decision.violations[0]).toMatchObject({
      source: "claim",
      id: "support.manager_approval_over_limit",
    });
    expect(decision.correction).toContain("Rewrite it");
  });

  it("applies declared policies: forbidden phrases and required disclaimers", () => {
    const guaranteed = checkOutput(gate, policies, {
      text: "We guarantee your money back.",
    });
    expect(guaranteed.violations.map((item) => item.id)).toEqual([
      "support.no_guarantees",
    ]);
    const missing = checkOutput(gate, policies, {
      text: "I refunded 100.",
      claims: [refund(100, false)],
    });
    expect(missing.violations.map((item) => item.id)).toEqual([
      "support.refund_disclaimer",
    ]);
    // The disclaimer is only required when the answer commits to a refund.
    expect(
      checkOutput(gate, policies, { text: "How can I help?" }).decision,
    ).toBe("PASS");
    expect(
      checkOutput(gate, policies, {
        text: "Refunded 100, subject to our refund policy.",
        claims: [refund(100, false)],
      }).decision,
    ).toBe("PASS");
  });

  it("respects channels and rejects bad patterns", () => {
    const scoped = parseOutputPolicies(
      JSON.stringify({
        declaredBy: "x",
        policies: [
          {
            id: "p.email",
            description: "No casual tone in email.",
            kind: "forbid",
            pattern: "hey",
            channels: ["email"],
          },
        ],
      }),
    );
    expect(
      checkOutput(gate, scoped, { text: "Hey!", channel: "chat" }).decision,
    ).toBe("PASS");
    expect(
      checkOutput(gate, scoped, { text: "Hey!", channel: "email" }).decision,
    ).toBe("BLOCK");
    expect(() =>
      parseOutputPolicies(
        JSON.stringify({
          declaredBy: "x",
          policies: [
            { id: "p.bad", description: "d", kind: "forbid", pattern: "(" },
          ],
        }),
      ),
    ).toThrow("invalid pattern");
  });

  it("guards whatever produces an answer", async () => {
    const seen: string[] = [];
    const answer = guardOutput(
      gate,
      policies,
      async (amount: number) => `Refunded ${amount}.`,
      {
        claimsOf: (amount) => [refund(amount, false)],
        onDecision: (decision) => seen.push(decision.decision),
      },
    );
    const blocked = await answer(100);
    expect(blocked.ok).toBe(false);
    expect(seen).toEqual(["BLOCK"]);
  });
});
