import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path, { resolve } from "node:path";
import { extractBehavior } from "@pathcompiler/behavior-extraction";
import type { BehaviorSpec } from "@pathcompiler/behavior-ir";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import {
  createSmtVerifier,
  createVerificationRouter,
  type VerificationResult,
} from "@pathcompiler/verification";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as base from "../../../fixtures/refunds/src/refunds.js";
import * as benignRefactor from "../../../fixtures/refunds/variants/benign-refactor.js";
import * as stricterLimit from "../../../fixtures/refunds/variants/stricter-limit.js";
import * as supportFastPath from "../../../fixtures/refunds/variants/support-fast-path.js";
import {
  contractExecutor,
  counterexampleId,
  createRecord,
  type Executor,
  generateEval,
  listCounterexamples,
  readCounterexample,
  recordCounterexample,
  resolveCounterexample,
  runEval,
  runSpecEval,
} from "../src/index.js";

let solver: SolverProvider;
beforeAll(async () => {
  solver = await createZ3SolverProvider();
});
afterAll(async () => {
  await solver?.close();
});
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => rm(item, { recursive: true, force: true })),
  );
});

const root = resolve(import.meta.dirname, "../../../fixtures/refunds");
const read = (file: string) => ({
  path: file,
  content: readFileSync(resolve(root, file), "utf8"),
});
const specFor = (service: string): BehaviorSpec =>
  extractBehavior(
    [
      "db/schema.sql",
      "src/models.ts",
      "api/openapi.json",
      "spec/approved-rules.json",
      service,
    ].map(read),
    {
      bindings: {
        payment: "payments",
        request: "refund_requests",
        createRefund: "refund",
      },
    },
  ).spec;
const baseSpec = specFor("src/refunds.ts");
const candidateSpec = specFor("variants/support-fast-path.ts");
const router = () => createVerificationRouter([createSmtVerifier(solver)]);
const NOW = "2026-10-29T12:00:00.000Z";

/** The counterexample the verifier finds for the support-agent fast path. */
async function foundViolation(): Promise<VerificationResult> {
  return router().verify(
    {
      kind: "rule_enforced",
      operation: "refund",
      rule: "refunds.manager_approval_over_limit",
    },
    candidateSpec,
  );
}
async function record() {
  const result = await foundViolation();
  if (!result.counterexample || !result.rule)
    throw new Error("expected a violation");
  return createRecord({
    rule: result.rule,
    counterexample: result.counterexample,
    trigger: "verification",
    commit: "abc123",
    specHash: "sha256:x",
    now: NOW,
  });
}

/** Runs a candidate service the way a caller would: build the arguments, catch the refusal. */
const serviceExecutor =
  (service: typeof base): Executor =>
  (request) => {
    const inputs = request.inputs ?? {};
    const context = request.context ?? {};
    const state = request.state ?? {};
    const payment = {
      originalAmount: state["payments.original_amount"] as number,
      refundedAmount: state["payments.refunded_amount"] as number,
    };
    try {
      service.refund(
        {
          id: String(context["actor.id"]),
          role: context["actor.role"] as base.Role,
        },
        payment,
        inputs["refund.amount"] as number,
        inputs["refund.manager_approval"] as boolean,
      );
      return "accepted";
    } catch {
      return "rejected";
    }
  };

describe("counterexample records", () => {
  it("describes the violation and has a stable content ID", async () => {
    const first = await record();
    expect(first).toMatchObject({
      schemaVersion: 1,
      rule: { id: "refunds.manager_approval_over_limit", humanBacked: true },
      trigger: "verification",
      operation: "refund",
      commit: "abc123",
      status: "open",
      observedAt: NOW,
    });
    expect(first.action.context["actor.role"]).toBe("support_agent");
    expect(first.id).toMatch(/^cx-[0-9a-f]{12}$/);
    expect((await record()).id).toBe(first.id);
    expect(
      counterexampleId({
        rule: "r",
        operation: "o",
        inputs: { a: 1 },
        context: {},
        state: {},
      }),
    ).toBe(
      counterexampleId({
        rule: "r",
        operation: "o",
        inputs: { a: 1 },
        context: {},
        state: {},
      }),
    );
  });

  it("stores each finding once, lists them, and marks one fixed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-cx-"));
    temporary.push(directory);
    expect(await listCounterexamples(path.join(directory, "none"))).toEqual([]);
    const item = await record();
    expect((await recordCounterexample(directory, item)).created).toBe(true);
    const again = await recordCounterexample(directory, {
      ...item,
      observedAt: "later",
    });
    expect(again.created).toBe(false);
    expect(again.record.observedAt).toBe(NOW);
    expect(
      (await listCounterexamples(directory)).map((entry) => entry.id),
    ).toEqual([item.id]);
    const fixed = await resolveCounterexample(directory, item.id, {
      by: "def456",
      at: NOW,
    });
    expect(fixed).toMatchObject({ status: "fixed", fixedBy: "def456" });
    expect((await readCounterexample(directory, item.id)).status).toBe("fixed");
    await expect(
      readCounterexample(directory, "cx-000000000000"),
    ).rejects.toThrow("No counterexample");
    await expect(
      readCounterexample(directory, "../etc/passwd"),
    ).rejects.toThrow("not a counterexample ID");
  });
});

describe("regression eval (RQ5)", () => {
  it("has the reproduction, variants that break the same rule, and neighbors that do not", async () => {
    const evaluation = generateEval(await record(), baseSpec);
    expect(evaluation).toMatchObject({
      counterexample: (await record()).id,
      operation: "refund",
      property: {
        kind: "rule_enforced",
        rule: "refunds.manager_approval_over_limit",
      },
    });
    const byKind = (kind: string) =>
      evaluation.cases.filter((item) => item.kind === kind);
    expect(byKind("reproduction")).toHaveLength(1);
    expect(byKind("variant").length).toBeGreaterThanOrEqual(3);
    expect(byKind("neighbor").length).toBeGreaterThanOrEqual(2);
    for (const item of byKind("variant"))
      expect(item.expect, item.id).toBe("rejected");
    for (const item of byKind("neighbor"))
      expect(item.expect, item.id).toBe("accepted");
    // Variants cover other roles and amounts, not only the exact counterexample.
    const changes = byKind("variant")
      .map((item) => item.change)
      .join(" | ");
    expect(changes).toContain('actor.role = "manager"');
    expect(changes).toContain("refund.amount");
    // Neighbors include the legitimate way to do the same refund.
    expect(byKind("neighbor").map((item) => item.change)).toContain(
      "refund.manager_approval = true",
    );
    // Deterministic.
    expect(JSON.stringify(generateEval(await record(), baseSpec))).toBe(
      JSON.stringify(evaluation),
    );
  });

  it("fails on the violating candidate and passes after a verified repair", async () => {
    const evaluation = generateEval(await record(), baseSpec);
    // The real code, before and after the repair.
    const broken = await runEval(evaluation, serviceExecutor(supportFastPath));
    expect(broken.passed).toBe(false);
    expect(broken.failed).toContain("reproduction");
    const repaired = await runEval(evaluation, serviceExecutor(base));
    expect(repaired).toMatchObject({
      passed: true,
      failed: [],
      overRestrictive: [],
    });
    // The contract extracted from each version says the same.
    expect(
      (await runEval(evaluation, contractExecutor(candidateSpec))).passed,
    ).toBe(false);
    expect((await runEval(evaluation, contractExecutor(baseSpec))).passed).toBe(
      true,
    );
    // And so does the verifier, on the specification.
    expect(
      (await runSpecEval(evaluation, candidateSpec, router())).status,
    ).toBe("VIOLATED");
    expect((await runSpecEval(evaluation, baseSpec, router())).status).toBe(
      "VERIFIED",
    );
  });

  it("accepts a harmless refactor and a stricter limit, and flags the stricter one as over-restrictive", async () => {
    const evaluation = generateEval(await record(), baseSpec);
    expect(
      (await runEval(evaluation, serviceExecutor(benignRefactor))).passed,
    ).toBe(true);
    const stricter = await runEval(evaluation, serviceExecutor(stricterLimit));
    expect(stricter.passed).toBe(true);
    expect(stricter.overRestrictive.length).toBeGreaterThan(0);
    expect(
      (
        await runEval(evaluation, serviceExecutor(stricterLimit), {
          strictNeighbors: true,
        })
      ).passed,
    ).toBe(false);
  });

  it("does not let a fix that rejects everything look like a success", async () => {
    const evaluation = generateEval(await record(), baseSpec);
    const rejectAll: Executor = () => "rejected";
    const run = await runEval(evaluation, rejectAll);
    expect(run.passed).toBe(true);
    expect(run.overRestrictive).toHaveLength(
      evaluation.cases.filter((item) => item.kind === "neighbor").length,
    );
    expect(
      (await runEval(evaluation, rejectAll, { strictNeighbors: true })).passed,
    ).toBe(false);
  });

  it("refuses to build an eval from a spec in which the rule does not apply", async () => {
    const without = {
      ...baseSpec,
      businessRules: baseSpec.businessRules.filter(
        (item) => item.id !== "refunds.manager_approval_over_limit",
      ),
    };
    expect(() => generateEval(awaitedRecord, without)).toThrow(
      "does not violate refunds.manager_approval_over_limit",
    );
  });
});

let awaitedRecord: Awaited<ReturnType<typeof record>>;
beforeAll(async () => {
  awaitedRecord = await record();
});
