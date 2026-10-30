import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const refunds = fileURLToPath(
  new URL("../../../fixtures/refunds/", import.meta.url),
);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => rm(item, { recursive: true, force: true })),
  );
});

const request = (amount: number, role: string) => ({
  operation: "refund",
  inputs: { payment_id: 1, amount, manager_approval: false },
  context: { "actor.role": role, "actor.id": "a1" },
  state: { "payments.original_amount": 10000, "payments.refunded_amount": 0 },
});

describe("agent", () => {
  it("checks one action against the extracted specification and explains a block", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-agent-"));
    temporary.push(cwd);
    const repo = path.join(cwd, "repo");
    await cp(refunds, repo, { recursive: true });
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    await run([
      "behavior",
      "extract",
      repo,
      "--bind",
      "payment=payments",
      "--bind",
      "createRefund=refund",
      "--bind",
      "request=refund_requests",
      "--exclude",
      "variants",
    ]);
    const spec = path.join("out", "reports", "behavior-spec.json");

    await writeFile(
      path.join(cwd, "safe.json"),
      JSON.stringify(request(200, "support_agent")),
    );
    expect(
      await run(["agent", "check", spec, "--request", "safe.json"]),
    ).toContain("PASS refund");

    await writeFile(
      path.join(cwd, "unsafe.json"),
      JSON.stringify(request(6000, "support_agent")),
    );
    const blocked = await run([
      "agent",
      "check",
      spec,
      "--request",
      "unsafe.json",
    ]).catch((error: Error) => error.message);
    expect(blocked).toContain("BLOCK refund:");
    expect(blocked).toContain("refunds.manager_approval_over_limit");
    expect(blocked).toContain("rule trust: human-approved");
    expect(blocked).toContain("refund.amount=6000");

    // With the state left out the gate says what it needs and blocks.
    await writeFile(
      path.join(cwd, "partial.json"),
      JSON.stringify({ ...request(200, "support_agent"), state: {} }),
    );
    const partial = await run([
      "agent",
      "check",
      spec,
      "--request",
      "partial.json",
    ]).catch((error: Error) => error.message);
    expect(partial).toContain("cannot be checked, missing");
    expect(
      await run([
        "agent",
        "check",
        spec,
        "--request",
        "partial.json",
        "--on-unknown",
        "allow",
      ]),
    ).toContain("PASS refund");

    // A log of actions that already happened: which would the rules have blocked?
    const trace = [
      { id: "t1", at: "2026-10-01", ...request(200, "support_agent") },
      { id: "t2", at: "2026-10-02", ...request(9000, "support_agent") },
      { id: "t3", at: "2026-10-03", ...request(300, "customer") },
      { id: "t4", at: "2026-10-04", ...request(100, "manager"), state: {} },
    ];
    await writeFile(
      path.join(cwd, "log.jsonl"),
      trace.map((item) => JSON.stringify(item)).join("\n"),
    );
    const audit = await run(["agent", "audit", spec, "--trace", "log.jsonl"]);
    expect(audit).toContain(
      "Replayed 4 logged action(s): 1 clean, 2 would have been blocked, 1 could not be judged.",
    );
    expect(audit).toContain("#2 t2 (2026-10-02) refund:");
    expect(audit).toContain("1 action(s) lack payments.original_amount");
    await writeFile(path.join(cwd, "log.json"), JSON.stringify(trace));
    expect(
      JSON.parse(
        await run(["agent", "audit", spec, "--trace", "log.json", "--json"]),
      ),
    ).toMatchObject({ total: 4, violating: 2, unresolved: 1 });
    await writeFile(path.join(cwd, "bad.jsonl"), "not json");
    await expect(
      run(["agent", "audit", spec, "--trace", "bad.jsonl"]),
    ).rejects.toThrow("neither JSON Lines nor a JSON array");
    await expect(run(["agent", "audit", spec])).rejects.toThrow(
      "needs --trace",
    );

    const evaluated = await run([
      "agent",
      "eval",
      spec,
      "--cases",
      path.join(repo, "spec", "action-cases.json"),
    ]);
    expect(evaluated).toContain("28 labeled actions (18 unsafe, 10 safe)");
    expect(evaluated).toContain("unsafe block rate 88.9%");
    expect(evaluated).toContain("safe allow rate 100.0%");
    expect(evaluated).toContain(
      "missed unsafe action: duplicate-identical-refund",
    );
    expect(evaluated).toContain(
      "an unsafe action no rule describes is not blocked",
    );
  }, 120_000);

  it("rejects bad arguments", async () => {
    await expect(runCli(["agent", "check"])).rejects.toThrow(
      "Expected: pathcompiler agent check",
    );
    await expect(runCli(["scan", ".", "--request", "x.json"])).rejects.toThrow(
      "only supported by agent",
    );
    await expect(
      runCli(["agent", "check", "spec.json", "--enforce", "some"]),
    ).rejects.toThrow("--enforce must be all or approved_only.");
  });
});
