import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { redactSecretsInText } from "@pathcompiler/harness-runner";
import { z } from "zod";

/**
 * What happened around an agent's work, recorded as it happens: the action or
 * answer that was checked, the verdict and the rules behind it, what the agent
 * did next, and what a person decided. These records are the raw material for
 * alignment and post-training datasets (datasets.ts); PathCompiler trains
 * nothing. Capture is opt-in, local, append-only, and secrets are redacted
 * before anything is written.
 */
const text = z.string().min(1);
export const FEEDBACK_KINDS = [
  "action_check",
  "output_check",
  "change_check",
  "human_decision",
  "outcome",
] as const;
export const FEEDBACK_VERDICTS = [
  "pass",
  "block",
  "review",
  "fail",
  "approved",
  "rejected",
  "accepted",
  "corrected",
  "abandoned",
] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];

export const FeedbackEventSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: text,
  at: text,
  kind: z.enum(FEEDBACK_KINDS),
  /** The agent, harness or person being checked. */
  agent: text.optional(),
  /** Calls that belong together (one task, one conversation). */
  session: text.optional(),
  verdict: z.enum(FEEDBACK_VERDICTS),
  /**
   * What was checked: an action request (`request`), an answer (`text`), a
   * change (`summary`). Secrets are redacted; datasets leave it out unless
   * asked.
   */
  subject: z
    .strictObject({
      operation: text.optional(),
      request: z.record(z.string(), z.unknown()).optional(),
      text: z.string().optional(),
      summary: z.string().optional(),
    })
    .default({}),
  /** The rules behind the verdict. */
  checks: z
    .array(
      z.strictObject({
        rule: text.optional(),
        kind: text.optional(),
        status: text,
        explanation: z.string().optional(),
        humanBacked: z.boolean().optional(),
      }),
    )
    .default([]),
  counterexample: z.record(z.string(), z.unknown()).optional(),
  specHash: text.optional(),
  /** An earlier event this one answers (a retry after a block, a human decision on a check). */
  relatesTo: text.optional(),
  decidedBy: text.optional(),
  note: z.string().optional(),
});
export type FeedbackEvent = z.infer<typeof FeedbackEventSchema>;
export type FeedbackInput = Omit<
  z.input<typeof FeedbackEventSchema>,
  "schemaVersion" | "id" | "at"
>;

/** Replaces anything secret-looking in every string of a value. */
export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redactSecretsInText(value) as T;
  if (Array.isArray(value)) return value.map(redactValue) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item)]),
    ) as T;
  return value;
}

export interface FeedbackRecorder {
  record(input: FeedbackInput): Promise<FeedbackEvent>;
}

const build = (input: FeedbackInput, at: Date, sequence: number) => {
  const body = redactValue(input);
  const id = `fb-${createHash("sha256")
    .update(JSON.stringify([body, at.toISOString(), sequence]))
    .digest("hex")
    .slice(0, 16)}`;
  return FeedbackEventSchema.parse({
    schemaVersion: 1,
    id,
    at: at.toISOString(),
    ...body,
  });
};

export const FEEDBACK_FILE = ".pathcompiler/feedback/events.jsonl";

/** Appends events to a JSONL file in the repository. */
export function fileRecorder(
  directory: string,
  options: { now?: () => Date } = {},
): FeedbackRecorder & { file: string } {
  const file = path.join(directory, FEEDBACK_FILE);
  let sequence = 0;
  return {
    file,
    async record(input) {
      const event = build(
        input,
        (options.now ?? (() => new Date()))(),
        sequence++,
      );
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify(event)}\n`);
      return event;
    },
  };
}

/** Keeps events in memory, for tests and for callers that store them elsewhere. */
export function memoryRecorder(
  options: { now?: () => Date } = {},
): FeedbackRecorder & { events: FeedbackEvent[] } {
  const events: FeedbackEvent[] = [];
  return {
    events,
    async record(input) {
      const event = build(
        input,
        (options.now ?? (() => new Date()))(),
        events.length,
      );
      events.push(event);
      return event;
    },
  };
}

/** Reads a feedback file; lines that are not valid events are counted, never dropped silently. */
export async function readFeedback(
  directory: string,
): Promise<{ events: FeedbackEvent[]; invalid: number }> {
  const raw = await readFile(path.join(directory, FEEDBACK_FILE), "utf8").catch(
    () => "",
  );
  const events: FeedbackEvent[] = [];
  let invalid = 0;
  for (const line of raw.split("\n").filter(Boolean)) {
    try {
      events.push(FeedbackEventSchema.parse(JSON.parse(line)));
    } catch {
      invalid += 1;
    }
  }
  return { events, invalid };
}
