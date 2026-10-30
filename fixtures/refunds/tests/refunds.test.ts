// Documentation fixture for the assertion extractor; not run by the
// repository's test runner.
import { describe, expect, it } from "vitest";
import { refund } from "../src/refunds";

describe("refunds", () => {
  it("keeps the refunded total within the payment", () => {
    const payment = { originalAmount: 1000, refundedAmount: 0 };
    refund({ id: "a", role: "manager" }, payment, 400, false);
    expect(payment.refundedAmount).toBeGreaterThanOrEqual(0);
    expect(payment.refundedAmount).toBeLessThanOrEqual(payment.originalAmount);
    expect(payment.originalAmount).toBeLessThanOrEqual(1000);
  });

  it("refunds the requested amount", () => {
    const payment = { originalAmount: 1000, refundedAmount: 0 };
    refund({ id: "a", role: "support_agent" }, payment, 200, false);
    expect(payment.refundedAmount).toBe(200);
  });
});
