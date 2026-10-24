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
const RoleSchema = z.enum(["admin", "editor", "viewer"]);
export const SessionSettingsSchema = z.strictObject({
  role: RoleSchema,
  planStructure: z.boolean(),
  // Optional so older callers that only toggle plan structure keep working.
  planArchive: z.boolean().optional(),
});
export const DemoSessionSchema = z.strictObject({
  role: RoleSchema,
  featureFlags: z.strictObject({
    planStructure: z.boolean(),
    planArchive: z.boolean().default(false),
  }),
  clients: z
    .array(ClientInputSchema.extend({ id: z.uuid(), active: z.boolean() }))
    .max(20),
  plans: z
    .array(
      PlanInputSchema.extend({
        id: z.uuid(),
        structure: z.enum(["simple", "weekly"]),
        archived: z.boolean().default(false),
      }),
    )
    .max(20),
});
export type DemoSession = z.infer<typeof DemoSessionSchema>;
export type Client = DemoSession["clients"][number];
export type Plan = DemoSession["plans"][number];
