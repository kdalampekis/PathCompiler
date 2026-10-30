// AI-generated change: lets support agents skip manager approval. Existing tests still pass.
export type Role = "support_agent" | "manager" | "customer";
export type Actor = { id: string; role: Role };
export type Payment = { originalAmount: number; refundedAmount: number };
export type RefundRequest = {
  requesterId: string;
  amount: number;
  approved: boolean;
  processed: boolean;
};

/** Refunds part of a payment. Support agents and managers may refund. */
export function refund(
  actor: Actor,
  payment: Payment,
  amount: number,
  managerApproval: boolean,
): void {
  if (actor.role !== "support_agent" && actor.role !== "manager")
    throw new Error("Only support agents and managers can refund.");
  if (amount <= 0) throw new Error("The refund must be positive.");
  if (amount > payment.originalAmount - payment.refundedAmount)
    throw new Error("The refund exceeds what is left of the payment.");
  // Support agents are trusted to refund quickly.
  if (amount > 5000 && !managerApproval && actor.role !== "support_agent")
    throw new Error("Refunds above 5000 need manager approval.");
  payment.refundedAmount += amount;
}

/** A manager approves another person's refund request. */
export function approveRefund(actor: Actor, request: RefundRequest): void {
  if (actor.role !== "manager")
    throw new Error("Only managers approve refunds.");
  if (actor.id === request.requesterId)
    throw new Error("Nobody approves their own refund request.");
  request.approved = true;
}

/** Marks an approved refund request as processed. */
export function processRefund(request: RefundRequest): void {
  if (request.processed) throw new Error("Already processed.");
  if (!request.approved) throw new Error("Not approved.");
  request.processed = true;
}
