import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SourceFile } from "@pathcompiler/behavior-extraction";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scenarios } from "../../../fixtures/refunds/tests/scenarios.js";
import {
  fixtureRepairProvider,
  type RepairProvider,
  type RepairRequest,
  runRepairLoop,
  type TestOutcome,
  unifiedDiff,
} from "../src/index.js";

let solver: SolverProvider;
beforeAll(async () => {
  solver = await createZ3SolverProvider();
});
afterAll(async () => {
  await solver?.close();
});

const root = resolve(import.meta.dirname, "../../../fixtures/refunds");
const read = (path: string): SourceFile => ({
  path,
  content: readFileSync(resolve(root, path), "utf8"),
});
const BINDINGS = {
  payment: "payments",
  request: "refund_requests",
  createRefund: "refund",
};
const FILES = [
  "db/schema.sql",
  "src/models.ts",
  "api/openapi.json",
  "spec/approved-rules.json",
  "src/refunds.ts",
].map(read);
const BASE_SERVICE = read("src/refunds.ts").content;
const withService = (content: string): SourceFile[] =>
  FILES.map((file) =>
    file.path === "src/refunds.ts" ? { ...file, content } : file,
  );
const FAST_PATH = withService(read("variants/support-fast-path.ts").content);
const NOW = "2026-10-30T10:00:00.000Z";

/** Runs the example tests against a candidate's source, as a project's test command would. */
async function exampleTests(
  files: readonly SourceFile[],
): Promise<TestOutcome> {
  const source =
    files.find((file) => file.path === "src/refunds.ts")?.content ?? "";
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const service = await import(
    `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
  );
  const failures: string[] = [];
  for (const [title, scenario] of Object.entries(scenarios))
    try {
      scenario(service);
    } catch (error) {
      failures.push(`${title}: ${(error as Error).message.split("\n")[0]}`);
    }
  return {
    passed: failures.length === 0,
    detail:
      failures.length === 0
        ? `${Object.keys(scenarios).length} scenarios pass`
        : failures.join("; "),
  };
}
const edit = (content: string, path = "src/refunds.ts") => ({
  edits: [{ path, content }],
  rationale: "prepared",
});
const run = (
  provider: RepairProvider,
  files = FAST_PATH,
  extra: { maxIterations?: number; tests?: boolean } = {},
) =>
  runRepairLoop({
    files,
    options: { bindings: BINDINGS },
    provider,
    solver,
    now: NOW,
    ...(extra.maxIterations ? { maxIterations: extra.maxIterations } : {}),
    ...(extra.tests === false ? {} : { runTests: exampleTests }),
  });

describe("repair loop on a seeded violation (RQ5)", () => {
  it("repairs the support fast path within a few attempts, rejecting bad ones with reasons", async () => {
    const fastPath = read("variants/support-fast-path.ts").content;
    const comment = `${fastPath}\n// TODO: revisit\n`;
    // Rejects every support agent: the rule holds, but the example tests fail.
    const tooStrict = BASE_SERVICE.replace(
      "  if (amount <= 0)",
      '  if (actor.role === "support_agent") throw new Error("Support cannot refund.");\n  if (amount <= 0)',
    );
    const report = await run(
      fixtureRepairProvider([
        edit(comment),
        edit(tooStrict),
        edit(BASE_SERVICE),
      ]),
    );
    expect(report.status).toBe("repaired");
    expect(report.attempts.map((item) => item.outcome)).toEqual([
      "rejected",
      "rejected",
      "repaired",
    ]);
    const failed = (index: number) =>
      report.attempts[index]?.checks
        .filter((item) => !item.passed)
        .map((item) => item.name);
    expect(failed(0)).toEqual(["target property", "regression eval"]);
    expect(failed(1)).toEqual(["tests"]);
    expect(report.attempts[2]?.checks.every((item) => item.passed)).toBe(true);
    expect(report.before.VIOLATED).toBe(1);
    expect(report.after?.VIOLATED).toBe(0);
    expect(report.target?.rule.id).toBe("refunds.manager_approval_over_limit");
    // The patch is shown, not applied, and a person still has to approve it.
    expect(report.patch?.[0]?.path).toBe("src/refunds.ts");
    expect(report.patch?.[0]?.diff).toContain(
      '-  if (amount > 5000 && !managerApproval && actor.role !== "support_agent")',
    );
    expect(report.approval).toMatchObject({
      required: true,
      status: "pending",
    });
    // Every step is logged, in order.
    expect(report.trace.map((item) => item.step)).toEqual([
      "verify",
      "target",
      "request",
      "checked",
      "rejected",
      "request",
      "checked",
      "rejected",
      "request",
      "checked",
      "accepted",
    ]);
  });

  it("is deterministic", async () => {
    const provider = () => fixtureRepairProvider([edit(BASE_SERVICE)]);
    expect(JSON.stringify(await run(provider()))).toBe(
      JSON.stringify(await run(provider())),
    );
  });

  it("gives the provider only the operation's source file and the feedback it needs", async () => {
    const seen: RepairRequest[] = [];
    const provider: RepairProvider = {
      id: "spy",
      async proposeRepair(request) {
        seen.push(request);
        return edit(BASE_SERVICE);
      },
    };
    await run(provider);
    const [request] = seen;
    expect(request?.files.map((file) => file.path)).toEqual(["src/refunds.ts"]);
    expect(request?.violation.rule.id).toBe(
      "refunds.manager_approval_over_limit",
    );
    expect(request?.violation.counterexample.replayed).toBe(true);
    expect(request?.violation.explanation).toContain(
      "violates refund.amount > 5000 => refund.manager_approval == true",
    );
    expect(request?.constraints.join(" ")).toContain(
      "Do not edit tests, the approved rules",
    );
    expect(request?.mustKeep.length).toBeGreaterThan(10);
    // Nothing else from the repository is sent.
    expect(JSON.stringify(request)).not.toContain("CREATE TABLE");
  });

  it("feeds the reasons for a rejection into the next request", async () => {
    const seen: RepairRequest[] = [];
    // The first proposal changes nothing; the second is the correct repair.
    const inner = fixtureRepairProvider([
      edit(read("variants/support-fast-path.ts").content),
      edit(BASE_SERVICE),
    ]);
    const spy: RepairProvider = {
      id: "spy",
      async proposeRepair(request) {
        seen.push(request);
        return inner.proposeRepair(request);
      },
    };
    const report = await run(spy);
    expect(report.status).toBe("repaired");
    expect(seen[1]?.previousAttempts).toHaveLength(1);
    expect(seen[1]?.previousAttempts[0]?.rejectedBecause.join(" ")).toContain(
      "the proposal does not change anything",
    );
  });
});

describe("what the loop refuses", () => {
  it("rejects a repair that introduces a new violation", async () => {
    const dropsCustomerCheck = BASE_SERVICE.replace(
      / {2}if \(actor\.role !== "support_agent" && actor\.role !== "manager"\)\n {4}throw new Error\("Only support agents and managers can refund\."\);\n/,
      "",
    );
    expect(dropsCustomerCheck).not.toBe(BASE_SERVICE);
    const report = await run(
      fixtureRepairProvider([edit(dropsCustomerCheck)]),
      FAST_PATH,
      { maxIterations: 1 },
    );
    expect(report.status).toBe("not_repaired");
    const checks = report.attempts[0]?.checks ?? [];
    expect(
      checks.find((item) => item.name === "no new violations")?.detail,
    ).toContain("refund respects refunds.customers_cannot_refund");
    expect(report.patch).toBeUndefined();
  });

  it("refuses edits outside the operation's source", async () => {
    const report = await run(
      fixtureRepairProvider([edit("{}", "spec/approved-rules.json")]),
      FAST_PATH,
      { maxIterations: 1 },
    );
    expect(report.status).toBe("not_repaired");
    expect(report.attempts[0]?.checks[0]?.detail).toContain(
      "spec/approved-rules.json may not be changed (allowed: src/refunds.ts)",
    );
  });

  it("treats an unusable or failing provider as a rejected attempt", async () => {
    const report = await run(fixtureRepairProvider([{ nope: 1 }]), FAST_PATH, {
      maxIterations: 2,
    });
    expect(report.status).toBe("not_repaired");
    expect(report.attempts.map((item) => item.checks[0]?.name)).toEqual([
      "proposal",
      "proposal",
    ]);
    expect(report.attempts[1]?.checks[0]?.detail).toContain(
      "no proposal for attempt 2",
    );
  });

  it("stops after the bounded number of attempts", async () => {
    const report = await run(
      fixtureRepairProvider([
        edit(`${read("variants/support-fast-path.ts").content}\n// 1\n`),
        edit(`${read("variants/support-fast-path.ts").content}\n// 2\n`),
      ]),
      FAST_PATH,
      { maxIterations: 2, tests: false },
    );
    expect(report.status).toBe("not_repaired");
    expect(report.attempts).toHaveLength(2);
    expect(report.reason).toBe(
      "No candidate passed every check within 2 attempt(s).",
    );
    expect(report.trace.at(-1)).toMatchObject({ step: "stop" });
  });

  it("does not call the provider when nothing is violated", async () => {
    let calls = 0;
    const provider: RepairProvider = {
      id: "never",
      async proposeRepair() {
        calls += 1;
        return edit("x");
      },
    };
    const report = await run(provider, FILES);
    expect(report.status).toBe("already_verified");
    expect(calls).toBe(0);
    expect(report.attempts).toEqual([]);
  });

  it("repairs one violation at a time and says how many remain", async () => {
    // The self-approval check is also dropped, so two rules are violated.
    const two = FAST_PATH.map((file) =>
      file.path === "src/refunds.ts"
        ? {
            ...file,
            content: file.content.replace(
              / {2}if \(actor\.id === request\.requesterId\)\n {4}throw new Error\("Nobody approves their own refund request\."\);\n/,
              "",
            ),
          }
        : file,
    );
    const report = await run(fixtureRepairProvider([edit(BASE_SERVICE)]), two, {
      maxIterations: 1,
    });
    expect(report.otherViolations).toBe(1);
  });
});

describe("unifiedDiff", () => {
  it("shows changed lines with context and nothing for identical text", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join(
      "\n",
    );
    const after = before.replace("e", "E");
    expect(unifiedDiff("x.txt", before, after)).toBe(
      "--- a/x.txt\n+++ b/x.txt\n@@ -2,7 +2,7 @@\n b\n c\n d\n-e\n+E\n f\n g\n h\n",
    );
    expect(unifiedDiff("x.txt", before, before)).toBe("");
    expect(unifiedDiff("x.txt", "a\nb", "a\nb\nc")).toContain("+c");
  });
});
