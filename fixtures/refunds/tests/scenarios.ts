// The example-based tests of the refund service as plain functions, so they
// can run against the base service and every candidate variant. They pass on
// all variants: none of them covers the rules the variants break, which is the
// point of the fixture (tests pass, a business rule does not hold).
import assert from "node:assert/strict";
import type { Actor, Payment, RefundRequest } from "../src/refunds.js";

export type RefundService = {
  refund(
    actor: Actor,
    payment: Payment,
    amount: number,
    managerApproval: boolean,
  ): void;
  approveRefund(actor: Actor, request: RefundRequest): void;
  processRefund(request: RefundRequest): void;
};

const manager: Actor = { id: "m1", role: "manager" };
const agent: Actor = { id: "a1", role: "support_agent" };
const customer: Actor = { id: "c1", role: "customer" };
const payment = (): Payment => ({ originalAmount: 10000, refundedAmount: 0 });
const request = (): RefundRequest => ({
  requesterId: "a1",
  amount: 200,
  approved: false,
  processed: false,
});

export const scenarios: Record<string, (service: RefundService) => void> = {
  "a manager refunds part of a payment"(service) {
    const p = payment();
    service.refund(manager, p, 400, false);
    assert.equal(p.refundedAmount, 400);
  },
  "a support agent refunds a small amount"(service) {
    const p = payment();
    service.refund(agent, p, 200, false);
    assert.equal(p.refundedAmount, 200);
  },
  "a refund above the limit succeeds with manager approval"(service) {
    const p = payment();
    service.refund(manager, p, 6000, true);
    assert.equal(p.refundedAmount, 6000);
  },
  "a customer cannot refund"(service) {
    assert.throws(() => service.refund(customer, payment(), 100, false));
  },
  "a refund beyond what is left is rejected"(service) {
    const p = { originalAmount: 1000, refundedAmount: 900 };
    assert.throws(() => service.refund(manager, p, 200, false));
    assert.equal(p.refundedAmount, 900);
  },
  "a manager approves someone else's request"(service) {
    const r = request();
    service.approveRefund(manager, r);
    assert.equal(r.approved, true);
  },
  "a support agent cannot approve"(service) {
    assert.throws(() => service.approveRefund(agent, request()));
  },
  "an approved request is processed"(service) {
    const r = { ...request(), approved: true };
    service.processRefund(r);
    assert.equal(r.processed, true);
  },
  "an unapproved request is not processed"(service) {
    assert.throws(() => service.processRefund(request()));
  },
};
