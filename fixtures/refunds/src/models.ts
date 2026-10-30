import { z } from "zod";

export const RefundInput = z.object({
  paymentId: z.number().int().positive(),
  amount: z.number().int().positive().max(100000),
  managerApproval: z.boolean(),
  reason: z.string().min(3),
});

export const ActorSchema = z.object({
  id: z.string(),
  role: z.enum(["support_agent", "manager", "customer"]),
});

export const PaymentSchema = z.object({
  originalAmount: z.number().int().positive(),
  refundedAmount: z.number().int().min(0),
});
