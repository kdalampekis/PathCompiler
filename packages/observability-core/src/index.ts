import { z } from "zod";

/**
 * Semantic runtime events (reasoning spec §134–§139, §152, §156). Events name
 * product states and semantic targets, never raw input, DOM or pointer data.
 * Browser-safe: no Node.js imports and no transport.
 */
export const EVENT_SCHEMA_VERSION = 1;

const id = z.string().min(1).max(200);
const semanticId = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)*$/,
    "Use a semantic ID such as clients.create",
  )
  .max(200);
/** Paths only: a query string or fragment can carry user content. */
const route = z
  .string()
  .min(1)
  .max(500)
  .regex(
    /^\/[^?#\s]*$/,
    "Routes must be paths without query strings or fragments",
  );
const hashedId = z
  .string()
  .regex(
    /^sha256:[a-f0-9]{64}$/,
    "User IDs must be salted SHA-256 hashes (hashUserId)",
  );

export const PrivacyMetadataSchema = z.strictObject({
  /** True only when the policy allows PII and this event carries some. */
  pii: z.boolean(),
  /** Whether `anonymousUserId` is a salted hash. */
  userIdHashed: z.boolean(),
});
export type PrivacyMetadata = z.infer<typeof PrivacyMetadataSchema>;

export const RuntimeEventBaseSchema = z.strictObject({
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  eventId: id,
  timestamp: z.iso.datetime(),
  projectId: id,
  /** Application release (spec §156); required for before/after analysis. */
  release: id.optional(),
  workflowId: id.optional(),
  workflowVersion: z.number().int().positive().optional(),
  semanticTarget: semanticId.optional(),
  sessionId: id,
  anonymousUserId: id.optional(),
  route: route.optional(),
  role: z.string().min(1).max(120).optional(),
  locale: z.string().min(1).max(35).optional(),
  /** Low-cardinality product context only; keys must be allowed by the policy. */
  context: z
    .record(
      z.string().min(1).max(64),
      z.union([z.string().max(200), z.number(), z.boolean()]),
    )
    .refine(
      (value) => Object.keys(value).length <= 32,
      "At most 32 context keys",
    )
    .optional(),
  privacy: PrivacyMetadataSchema,
});
export type RuntimeEventBase = z.infer<typeof RuntimeEventBaseSchema>;

const workflowFields = {
  workflowId: id,
  workflowVersion: z.number().int().positive(),
};
// `extend` keeps the schema strict and lets a type make a base field required.
const event = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  RuntimeEventBaseSchema.extend({ type: z.literal(type), ...shape });

export const WorkflowStartedEventSchema = event("workflow.started", {
  ...workflowFields,
  /** What started it: a guide, an assistant answer, or the user on their own. */
  trigger: z.enum(["guide", "assistant", "organic"]),
});
export const WorkflowStepReachedEventSchema = event("workflow.step_reached", {
  ...workflowFields,
  stepId: id,
  stepIndex: z.number().int().nonnegative().optional(),
});
export const WorkflowCompletedEventSchema = event("workflow.completed", {
  ...workflowFields,
  durationMs: z.number().int().nonnegative().optional(),
});
export const WorkflowAbandonedEventSchema = event("workflow.abandoned", {
  ...workflowFields,
  lastStepId: id.optional(),
  reason: z.enum([
    "stopped",
    "timed-out",
    "failed",
    "navigated-away",
    "unknown",
  ]),
});
export const SemanticTargetActivatedEventSchema = event(
  "semantic_target.activated",
  {
    semanticTarget: semanticId,
    interaction: z.enum(["click", "input", "select", "submit"]),
  },
);
export const GoalReachedEventSchema = event("goal.reached", {
  /** A Formal Product Model goal ID, e.g. clients.created. */
  goalId: semanticId,
  capabilityId: semanticId.optional(),
});
export const RouteChangedEventSchema = event("route.changed", {
  route,
  previousRoute: route.optional(),
});
/** Attempted-but-blocked (spec §152): demand for an unavailable capability. */
export const ActionBlockedEventSchema = event("action.blocked", {
  semanticTarget: semanticId,
  reason: z.enum(["permission", "feature_flag", "precondition", "unknown"]),
});

/**
 * An explicit business event the application emits (spec §138), e.g.
 * `client.created`. Only a semantic name: no payload, so no user content.
 */
export const DomainEventSchema = event("domain.event", {
  name: semanticId,
});

export const ProductRuntimeEventSchema = z.discriminatedUnion("type", [
  WorkflowStartedEventSchema,
  WorkflowStepReachedEventSchema,
  WorkflowCompletedEventSchema,
  WorkflowAbandonedEventSchema,
  SemanticTargetActivatedEventSchema,
  GoalReachedEventSchema,
  RouteChangedEventSchema,
  ActionBlockedEventSchema,
  DomainEventSchema,
]);
export type ProductRuntimeEvent = z.infer<typeof ProductRuntimeEventSchema>;
export type ProductRuntimeEventType = ProductRuntimeEvent["type"];

/** Spec §139 defaults: analytics off, no PII, hashed user IDs, no context keys. */
export const PrivacyPolicySchema = z.strictObject({
  enabled: z.boolean().default(false),
  collectPii: z.boolean().default(false),
  hashUserIds: z.boolean().default(true),
  /** Context keys an application has declared safe (e.g. plan_tier). */
  allowedContextKeys: z.array(z.string().min(1).max(64)).default([]),
});
export type PrivacyPolicy = z.infer<typeof PrivacyPolicySchema>;
export const DEFAULT_PRIVACY_POLICY: PrivacyPolicy = Object.freeze(
  PrivacyPolicySchema.parse({}),
) as PrivacyPolicy;

/** Words that suggest user content or credentials; such keys are refused even if allowed. */
const SENSITIVE_WORDS = new Set([
  "pass",
  "password",
  "secret",
  "token",
  "email",
  "phone",
  "address",
  "card",
  "iban",
  "ssn",
  "birth",
  "birthday",
  "dob",
  "health",
  "diagnosis",
  "name",
  "content",
  "text",
  "value",
  "input",
  "keystroke",
  "keystrokes",
  "dom",
  "html",
  "mouse",
  "coord",
  "coords",
]);
const sensitiveKey = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => SENSITIVE_WORDS.has(word));

export class EventPolicyError extends Error {
  constructor(
    readonly issues: string[],
    options?: { cause?: unknown },
  ) {
    super(`Event rejected: ${issues.join("; ")}`, options);
    this.name = "EventPolicyError";
  }
}

/**
 * Validates an event against the schema and a privacy policy. Unknown fields
 * (raw values, DOM, coordinates) are rejected by the strict schema; the policy
 * adds context allowlisting, PII and user-ID hashing rules.
 */
export function validateEvent(
  input: unknown,
  policy: Partial<PrivacyPolicy> = {},
): ProductRuntimeEvent {
  const rules = PrivacyPolicySchema.parse(policy);
  const parsed = ProductRuntimeEventSchema.safeParse(input);
  if (!parsed.success)
    throw new EventPolicyError(
      parsed.error.issues.map(
        (item) => `${item.path.join(".") || "event"}: ${item.message}`,
      ),
      { cause: parsed.error },
    );
  const value = parsed.data;
  const issues: string[] = [];
  for (const key of Object.keys(value.context ?? {})) {
    if (sensitiveKey(key))
      issues.push(`context.${key} looks like user content or a credential`);
    else if (!rules.allowedContextKeys.includes(key))
      issues.push(`context.${key} is not in the policy's allowedContextKeys`);
  }
  if (value.privacy.pii && !rules.collectPii)
    issues.push("privacy.pii is true but the policy does not allow PII");
  if (value.anonymousUserId !== undefined) {
    const hashed = hashedId.safeParse(value.anonymousUserId).success;
    if (rules.hashUserIds && !hashed)
      issues.push("anonymousUserId must be hashed with hashUserId");
    if (value.privacy.userIdHashed !== hashed)
      issues.push("privacy.userIdHashed does not match anonymousUserId");
  }
  if (issues.length) throw new EventPolicyError(issues);
  return value;
}

/** Salted SHA-256 pseudonym for a user ID (Web Crypto; browsers and Node 20+). */
export async function hashUserId(
  userId: string,
  salt: string,
): Promise<string> {
  if (!salt) throw new Error("hashUserId needs a non-empty, per-project salt.");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${salt}\u0000${userId}`),
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** Canonical JSON: equal events serialize identically regardless of key order. */
export function serializeEvent(input: ProductRuntimeEvent): string {
  return canonical(ProductRuntimeEventSchema.parse(input));
}
/** Parses newline-delimited canonical events (the storage format for later phases). */
export function parseEvents(text: string): ProductRuntimeEvent[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      const parsed = ProductRuntimeEventSchema.safeParse(JSON.parse(line));
      if (!parsed.success)
        throw new EventPolicyError([`line ${index + 1}: invalid event`], {
          cause: parsed.error,
        });
      return parsed.data;
    });
}

type Distribute<T> = T extends unknown ? T : never;
/** Caller-supplied fields of an event; the factory adds the bound ones. */
export type EventInput<T extends ProductRuntimeEventType> = Distribute<
  Omit<
    Extract<ProductRuntimeEvent, { type: T }>,
    | "type"
    | "schemaVersion"
    | "eventId"
    | "timestamp"
    | "projectId"
    | "release"
    | "sessionId"
    | "privacy"
  >
>;
export type EventFactoryOptions = {
  projectId: string;
  sessionId: string;
  /** Bound to every event (spec §156). */
  release?: string;
  policy?: Partial<PrivacyPolicy>;
  now?: () => Date;
  nextId?: () => string;
};
export type EventFactory = <T extends ProductRuntimeEventType>(
  type: T,
  fields: EventInput<T>,
) => Extract<ProductRuntimeEvent, { type: T }>;

/** Builds validated events with project, session and release bound in. */
export function createEventFactory(options: EventFactoryOptions): EventFactory {
  let counter = 0;
  const now = options.now ?? (() => new Date());
  const nextId =
    options.nextId ??
    (() =>
      globalThis.crypto?.randomUUID?.() ?? `evt-${Date.now()}-${++counter}`);
  return (type, fields) => {
    const anonymous = (fields as { anonymousUserId?: string }).anonymousUserId;
    return validateEvent(
      {
        ...fields,
        type,
        schemaVersion: EVENT_SCHEMA_VERSION,
        eventId: nextId(),
        timestamp: now().toISOString(),
        projectId: options.projectId,
        sessionId: options.sessionId,
        ...(options.release === undefined ? {} : { release: options.release }),
        privacy: {
          pii: false,
          userIdHashed:
            anonymous !== undefined && hashedId.safeParse(anonymous).success,
        },
      },
      options.policy,
    ) as Extract<ProductRuntimeEvent, { type: typeof type }>;
  };
}
