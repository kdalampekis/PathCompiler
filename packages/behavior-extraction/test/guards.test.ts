import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { e, formatExpression } from "@pathcompiler/behavior-ir";
import { describe, expect, it } from "vitest";
import { extractBehavior, extractGuards, negate } from "../src/index.js";

const root = resolve(import.meta.dirname, "../../../fixtures/refunds");
const source = (path: string) => ({
  path: `fixtures/refunds/${path}`,
  content: readFileSync(resolve(root, path), "utf8"),
});
const BINDINGS = {
  payment: "payments",
  request: "refund_requests",
  createRefund: "refund",
};
const contracts = (path: string) => {
  const { spec } = extractBehavior([source(path)], { bindings: BINDINGS });
  return Object.fromEntries(
    spec.operations.map((item) => [
      item.id,
      {
        pre: item.preconditions.map(formatExpression).sort(),
        effects: item.effects.map(
          (effect) => `${effect.variable} := ${formatExpression(effect.value)}`,
        ),
        limitations: item.limitations ?? [],
      },
    ]),
  );
};

describe("guard-clause extraction", () => {
  it("reads the contract of each refund operation from its guards", () => {
    const base = contracts("src/refunds.ts");
    expect(Object.keys(base).sort()).toEqual([
      "approve_refund",
      "process_refund",
      "refund",
    ]);
    expect(base.refund).toEqual({
      pre: [
        'actor.role == "support_agent" || actor.role == "manager"',
        "refund.amount <= 5000 || refund.manager_approval",
        "refund.amount <= payments.original_amount - payments.refunded_amount",
        "refund.amount > 0",
      ],
      effects: [
        "payments.refunded_amount := payments.refunded_amount + refund.amount",
      ],
      limitations: [],
    });
    expect(base.approve_refund?.pre).toEqual([
      "actor.id != refund_requests.requester_id",
      'actor.role == "manager"',
    ]);
    expect(base.process_refund?.pre).toEqual([
      "!refund_requests.processed",
      "refund_requests.approved",
    ]);
  });

  it("shows exactly what each candidate variant changes", () => {
    const base = contracts("src/refunds.ts");
    const pre = (name: string, operation: string) =>
      contracts(`variants/${name}.ts`)[operation]?.pre ?? [];
    const without = (list: string[], text: string) =>
      list.filter((item) => item !== text);
    // Behavior-preserving refactor: same contract.
    expect(contracts("variants/benign-refactor.ts")).toEqual(base);
    // The fast path weakens the approval guard.
    expect(pre("support-fast-path", "refund")).toContain(
      'refund.amount <= 5000 || refund.manager_approval || actor.role == "support_agent"',
    );
    // A stricter limit changes the number only.
    expect(pre("stricter-limit", "refund")).toContain(
      "refund.amount <= 1000 || refund.manager_approval",
    );
    // Dropped checks are simply absent.
    expect(pre("own-approval", "approve_refund")).toEqual(
      without(
        base.approve_refund?.pre ?? [],
        "actor.id != refund_requests.requester_id",
      ),
    );
    expect(pre("double-process", "process_refund")).toEqual(
      without(base.process_refund?.pre ?? [], "!refund_requests.processed"),
    );
  });

  it("derives permissions from explicit role checks, with provenance", () => {
    const { spec, ledger } = extractBehavior([source("src/refunds.ts")], {
      bindings: BINDINGS,
    });
    expect(
      spec.permissions.map((item) => `${item.role} ${item.action}`).sort(),
    ).toEqual([
      "manager approve_refund",
      "manager refund",
      "support_agent refund",
    ]);
    const entry = ledger.find(
      (item) => item.text === "refund: refund.amount > 0",
    );
    expect(entry?.provenance).toMatchObject({
      sourceType: "SOURCE_CODE",
      origin: "INFERRED",
      sourceFile: "fixtures/refunds/src/refunds.ts",
      sourceLines: "20",
    });
  });

  it("records what it cannot model as limitations instead of dropping it silently", () => {
    const file = {
      path: "svc.ts",
      content: `type Account = { balance: number; frozen: boolean; tier: Tier };
type Tier = "basic" | "gold";
declare function audit(message: string): void;
export function withdraw(account: Account, amount: number): void {
  if (amount <= 0) throw new Error("positive");
  if (isLocked(account)) throw new Error("locked");
  if (account.frozen) { log(); throw new Error("frozen"); }
  if (amount > 100) return;
  if (account.tier === "gold") { amount = 0; }
  audit("withdraw");
  account.balance -= amount;
  if (account.balance < 0) throw new Error("overdrawn");
  for (const x of [1]) { void x; }
}
export function helper(x: number): number { return x + 1; }
`,
    };
    const out = extractGuards(file);
    expect(out.operations).toHaveLength(1);
    const operation = out.operations[0];
    expect(operation?.id).toBe("withdraw");
    expect(operation?.preconditions.map(formatExpression)).toEqual([
      "withdraw.amount > 0",
    ]);
    expect(operation?.effects.map((item) => item.variable)).toEqual([
      "account.balance",
    ]);
    const limitations = (operation?.limitations ?? []).join("\n");
    expect(limitations).toContain("isLocked(account)");
    expect(limitations).toContain("svc.ts:7");
    expect(limitations).toContain("if (amount > 100) return;");
    expect(limitations).toContain("audit(");
    expect(limitations).toContain("updated earlier in the function");
    expect(limitations).toContain("ForOfStatement");
    expect(out.unsupported.length).toBe(operation?.limitations?.length);
  });

  it("ignores functions that have no guard or update", () => {
    const out = extractGuards({
      path: "a.ts",
      content:
        "export function add(a: number, b: number): number { return a + b; }",
    });
    expect(out.operations).toEqual([]);
    expect(out.unsupported).toEqual([]);
  });

  it("warns when one operation is defined in two source files", () => {
    const result = extractBehavior(
      [source("src/refunds.ts"), source("variants/stricter-limit.ts")],
      { bindings: BINDINGS },
    );
    expect(result.conflicts.join("\n")).toContain(
      "Operation refund is defined in more than one source file",
    );
  });
});

describe("negate", () => {
  const x = e.var("a.x");
  it("flips comparisons, applies De Morgan and removes double negation", () => {
    expect(formatExpression(negate(e.gt(x, e.lit(1))))).toBe("a.x <= 1");
    expect(
      formatExpression(negate(e.and(e.gt(x, e.lit(1)), e.not(e.var("a.b"))))),
    ).toBe("a.x <= 1 || a.b");
    expect(formatExpression(negate(e.not(e.var("a.b"))))).toBe("a.b");
    expect(formatExpression(negate(e.lit(true)))).toBe("false");
  });
});
