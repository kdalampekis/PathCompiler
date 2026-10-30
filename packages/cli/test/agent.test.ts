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
