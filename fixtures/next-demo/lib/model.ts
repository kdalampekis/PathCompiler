import { z } from "zod";

export const ClientInputSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(2, "Name must contain at least 2 characters")
    .max(80),
  email: z.email().max(160),
});
export const PlanInputSchema = z.strictObject({
  title: z.string().trim().min(2).max(80),
  clientId: z.uuid(),
});
export const StructureInputSchema = z.strictObject({
  structure: z.enum(["simple", "weekly"]),
  confirmed: z.boolean().optional(),
});
export const SessionSettingsSchema = z.strictObject({
  role: z.enum(["editor", "viewer"]),
  planStructure: z.boolean(),
});
export const DemoSessionSchema = z.strictObject({
  role: z.enum(["editor", "viewer"]),
  featureFlags: z.strictObject({ planStructure: z.boolean() }),
  clients: z
    .array(ClientInputSchema.extend({ id: z.uuid(), active: z.boolean() }))
    .max(20),
  plans: z
    .array(
      PlanInputSchema.extend({
        id: z.uuid(),
        structure: z.enum(["simple", "weekly"]),
      }),
    )
    .max(20),
});
export type DemoSession = z.infer<typeof DemoSessionSchema>;
export type Client = DemoSession["clients"][number];
export type Plan = DemoSession["plans"][number];
