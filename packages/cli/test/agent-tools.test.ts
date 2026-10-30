import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const refunds = fileURLToPath(
  new URL("../../../fixtures/refunds/", import.meta.url),
);
const BIND = [
  "--bind",
  "payment=payments",
  "--bind",
  "createRefund=refund",
  "--bind",
  "request=refund_requests",
  "--exclude",
  "variants",
];

describe("tools for harnesses", () => {
  it("lists the tools and prints function-calling schemas", async () => {
    expect(await runCli(["tools", "list"])).toContain(
      "pathcompiler_check_change",
    );
    const openai = JSON.parse(
      await runCli(["tools", "list", "--format", "openai"]),
    );
    expect(openai[0]).toMatchObject({ type: "function" });
    const anthropic = JSON.parse(
      await runCli(["tools", "list", "--format", "anthropic"]),
    );
    expect(anthropic[0].input_schema.type).toBe("object");
  });

  it("calls one tool against a repository", async () => {
    const out = await runCli([
      "tools",
      "call",
      "pathcompiler_check_action",
      refunds,
      "--input",
      JSON.stringify({
        operation: "refund",
        inputs: { payment_id: 1, amount: 6000, manager_approval: false },
        context: { "actor.role": "support_agent", "actor.id": "a1" },
        state: {
          "payments.original_amount": 10000,
          "payments.refunded_amount": 0,
        },
      }),
      ...BIND,
    ]);
    expect(out).toMatch(/^BLOCK refund: /);
  }, 60_000);

  it("rejects bad arguments with an actionable message", async () => {
    await expect(runCli(["tools"])).rejects.toThrow(
      "Expected: pathcompiler tools list",
    );
    await expect(
      runCli([
        "tools",
        "call",
        "pathcompiler_describe",
        refunds,
        "--input",
        "{nope",
      ]),
    ).rejects.toThrow("must be a JSON object");
    await expect(
      runCli(["tools", "call", "pathcompiler_nope", refunds]),
    ).rejects.toThrow("Unknown tool");
    await expect(runCli(["scan", ".", "--allow-write"])).rejects.toThrow(
      "only supported by tools call and mcp-agent",
    );
  });
});
