import {
  type SearchIndex,
  SearchIndexSchema,
  type SearchRecord,
} from "@pathcompiler/workflow-compiler/schema";
import { z } from "zod";

export * from "./evaluate.js";

export const ResolveContextSchema = z.strictObject({
  /** Current route; a matching entry route breaks ties but never excludes. */
  route: z.string().min(1).max(500).optional(),
  role: z.string().min(1).max(120).optional(),
  permissions: z.array(z.string().min(1).max(200)).max(500).optional(),
  featureFlags: z.record(z.string().min(1).max(200), z.boolean()).optional(),
});
export const ResolveRequestSchema = z.strictObject({
  query: z.string().max(500),
  context: ResolveContextSchema.optional(),
});
export type ResolveContext = z.infer<typeof ResolveContextSchema>;
export type ResolveRequest = z.infer<typeof ResolveRequestSchema>;

const option = z.strictObject({
  id: z.string(),
  revision: z.string(),
  title: z.string(),
});
export const WorkflowHelpResultSchema = z.strictObject({
  type: z.literal("workflow"),
  workflow: option.extend({ routes: z.array(z.string()) }),
  /** Share of the record's action/entity/qualifier signals found in the query. */
  confidence: z.number().min(0).max(1),
  matched: z.strictObject({
    alias: z.string().nullable(),
    action: z.string().nullable(),
    entity: z.string().nullable(),
    qualifiers: z.array(z.string()),
  }),
});
export const AmbiguousResultSchema = z.strictObject({
  type: z.literal("ambiguous"),
  reason: z.enum(["multiple-matches", "action-unclear"]),
  message: z.string(),
  options: z.array(option).min(1),
});
export const UnsupportedResultSchema = z.strictObject({
  type: z.literal("unsupported"),
  reason: z.enum(["empty-query", "no-match", "unavailable-in-context"]),
  message: z.string(),
  unavailable: z.array(
    option.extend({
      requires: z.array(z.string()).min(1),
    }),
  ),
});
export const ProductHelpResultSchema = z.discriminatedUnion("type", [
  WorkflowHelpResultSchema,
  AmbiguousResultSchema,
  UnsupportedResultSchema,
]);
export type WorkflowHelpResult = z.infer<typeof WorkflowHelpResultSchema>;
export type AmbiguousResult = z.infer<typeof AmbiguousResultSchema>;
export type UnsupportedResult = z.infer<typeof UnsupportedResultSchema>;
export type ProductHelpResult = z.infer<typeof ProductHelpResultSchema>;

export type ProductHelpResolver = {
  resolveProductHelp(request: ResolveRequest): ProductHelpResult;
};

/**
 * Generic English verb groups only. Product vocabulary (entity synonyms,
 * domain phrasing) belongs in approved workflow aliases, not here.
 */
const ACTION_GROUPS: Record<string, readonly string[]> = {
  create: [
    "create",
    "creation",
    "add",
    "new",
    "make",
    "register",
    "build",
    "setup",
  ],
  change: ["change", "modify", "update", "edit", "alter", "adjust", "switch"],
  delete: ["delete", "remove", "deactivate", "archive"],
};
const ACTION_OF = new Map(
  Object.entries(ACTION_GROUPS).flatMap(([group, words]) =>
    words.map((word) => [word, group] as const),
  ),
);

export function normalizeTokens(input: string): string[] {
  const words = input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/'s\b/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const tokens: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? "";
    if (word === "set" && words[index + 1] === "up") {
      tokens.push("setup");
      index += 1;
    } else tokens.push(singular(word));
  }
  return tokens;
}

function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word))
    return word.slice(0, -1);
  return word;
}

function actionGroup(word: string): string {
  return ACTION_OF.get(word) ?? word;
}

type Prepared = {
  record: SearchRecord;
  action: string;
  entity: string[];
  qualifiers: string[];
  aliases: { text: string; tokens: string[] }[];
};

export function createResolver(index: unknown): ProductHelpResolver {
  const parsed: SearchIndex = SearchIndexSchema.parse(index);
  const prepared: Prepared[] = parsed.workflows.map((record) => ({
    record,
    action: actionGroup(normalizeTokens(record.action).join(" ")),
    entity: normalizeTokens(record.entity),
    qualifiers: record.qualifiers.flatMap(normalizeTokens),
    aliases: record.aliases.map((text) => ({
      text,
      tokens: normalizeTokens(text),
    })),
  }));
  return {
    resolveProductHelp(request) {
      const { query, context = {} } = ResolveRequestSchema.parse(request);
      const tokens = normalizeTokens(query);
      if (!tokens.length)
        return unsupported(
          "empty-query",
          "Ask about a task, for example the action and the thing it applies to.",
        );
      const present = new Set(tokens);
      const actions = new Set(
        tokens.flatMap((token) => {
          const group = ACTION_OF.get(token);
          return group ? [group] : [];
        }),
      );
      const matches = prepared.flatMap((item) => {
        const alias = item.aliases.find((candidate) =>
          containsSequence(tokens, candidate.tokens),
        );
        const entity = item.entity.every((token) => present.has(token));
        const action = actions.has(item.action) || present.has(item.action);
        if (!alias && (!entity || (actions.size > 0 && !action))) return [];
        const qualifiers = item.qualifiers.filter((token) =>
          present.has(token),
        );
        const signals = 2 + item.qualifiers.length;
        const found = (entity ? 1 : 0) + (action ? 1 : 0) + qualifiers.length;
        const routeBonus =
          context.route !== undefined &&
          item.record.routes.includes(context.route)
            ? 0.5
            : 0;
        return [
          {
            item,
            alias: alias?.text ?? null,
            action,
            entity,
            qualifiers,
            score: (alias ? 10 : 0) + found * 3 + routeBonus,
            confidence: alias ? 1 : found / signals,
          },
        ];
      });
      if (!matches.length)
        return unsupported(
          "no-match",
          "No approved workflow matches that request.",
        );
      const available = matches.filter(
        (match) => requirements(match.item.record, context).length === 0,
      );
      if (!available.length)
        return {
          ...unsupported(
            "unavailable-in-context",
            "Matching workflows exist but are not available with the current role, permissions or feature flags.",
          ),
          unavailable: matches.map((match) => ({
            ...summary(match.item.record),
            requires: requirements(match.item.record, context),
          })),
        };
      available.sort(
        (a, b) =>
          b.score - a.score || (a.item.record.id < b.item.record.id ? -1 : 1),
      );
      const [best] = available;
      if (!best) throw new Error("Unreachable: available matches are empty");
      const tied = available.filter((match) => match.score === best.score);
      if (tied.length > 1)
        return {
          type: "ambiguous",
          reason: "multiple-matches",
          message: "Several approved workflows match. Ask the user to choose.",
          options: tied.map((match) => summary(match.item.record)),
        };
      if (!best.alias && !best.action && !best.qualifiers.length)
        return {
          type: "ambiguous",
          reason: "action-unclear",
          message:
            "The request names what to work on but not what to do with it. Confirm the intended task.",
          options: [summary(best.item.record)],
        };
      return {
        type: "workflow",
        workflow: {
          ...summary(best.item.record),
          routes: best.item.record.routes,
        },
        confidence: Math.round(best.confidence * 1000) / 1000,
        matched: {
          alias: best.alias,
          action: best.action ? best.item.record.action : null,
          entity: best.entity ? best.item.record.entity : null,
          qualifiers: best.qualifiers,
        },
      };
    },
  };
}

function containsSequence(tokens: string[], sequence: string[]): boolean {
  if (!sequence.length) return false;
  for (let start = 0; start + sequence.length <= tokens.length; start += 1)
    if (sequence.every((token, offset) => tokens[start + offset] === token))
      return true;
  return false;
}

/** Unmet context requirements; unknown context values never exclude. */
function requirements(record: SearchRecord, context: ResolveContext): string[] {
  const missing: string[] = [];
  if (
    context.role !== undefined &&
    record.roles.length > 0 &&
    !record.roles.includes(context.role)
  )
    missing.push(`role:${record.roles.join("|")}`);
  if (context.permissions !== undefined)
    for (const permission of record.permissions)
      if (!context.permissions.includes(permission))
        missing.push(`permission:${permission}`);
  if (context.featureFlags !== undefined)
    for (const { flag, enabled } of record.featureFlags) {
      const actual = context.featureFlags[flag];
      if (actual !== undefined && actual !== enabled)
        missing.push(`feature:${flag}=${enabled}`);
    }
  return missing;
}

function summary(record: SearchRecord) {
  return { id: record.id, revision: record.revision, title: record.title };
}

function unsupported(
  reason: UnsupportedResult["reason"],
  message: string,
): UnsupportedResult {
  return { type: "unsupported", reason, message, unavailable: [] };
}
