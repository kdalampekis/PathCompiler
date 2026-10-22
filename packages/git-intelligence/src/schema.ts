import {
  DiagnosticSchema,
  RelativePathSchema,
} from "@pathcompiler/source-model";
import { z } from "zod";

export const CommitShaSchema = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
export const CommitSchema = z.strictObject({
  sha: CommitShaSchema,
  parents: z.array(CommitShaSchema),
  authorDate: z.iso.datetime(),
  message: z.string(),
});
export const DefaultBranchSchema = z.strictObject({
  name: z.string().min(1),
  ref: z.string().min(1),
  source: z.enum(["remote-head", "convention"]),
});
export const DiffHunkSchema = z.strictObject({
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  header: z.string(),
  lines: z.array(z.string()),
});
export const GitDiffSchema = z.strictObject({
  base: CommitShaSchema.nullable(),
  head: CommitShaSchema,
  changes: z.array(
    z.strictObject({
      path: RelativePathSchema,
      status: z.enum(["A", "M", "D", "T"]),
      binary: z.boolean(),
      hunks: z.array(DiffHunkSchema),
    }),
  ),
});
export const PathHistorySchema = z.strictObject({
  path: RelativePathSchema,
  head: CommitShaSchema,
  commits: z.array(CommitSchema),
  limited: z.boolean(),
  shallow: z.boolean(),
});
export const BlameSchema = z.strictObject({
  path: RelativePathSchema,
  revision: CommitShaSchema,
  startLine: z.number().int().positive(),
  totalLines: z.number().int().nonnegative(),
  limited: z.boolean(),
  shallow: z.boolean(),
  lines: z.array(
    z.strictObject({
      sha: CommitShaSchema,
      originalLine: z.number().int().positive(),
      line: z.number().int().positive(),
    }),
  ),
});
export const GitEvidenceReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evidenceOnly: z.literal(true),
  nodeId: z.string().min(1),
  repository: z.strictObject({
    commit: CommitShaSchema,
    dirty: z.boolean(),
    shallow: z.boolean(),
  }),
  defaultBranch: DefaultBranchSchema.nullable(),
  histories: z.array(PathHistorySchema),
  commits: z.array(
    z.strictObject({
      commit: CommitSchema,
      diff: GitDiffSchema.nullable(),
    }),
  ),
  diagnostics: z.array(DiagnosticSchema),
});
export type Commit = z.infer<typeof CommitSchema>;
export type DefaultBranch = z.infer<typeof DefaultBranchSchema>;
export type DiffHunk = z.infer<typeof DiffHunkSchema>;
export type GitDiff = z.infer<typeof GitDiffSchema>;
export type PathHistory = z.infer<typeof PathHistorySchema>;
export type Blame = z.infer<typeof BlameSchema>;
export type GitEvidenceReport = z.infer<typeof GitEvidenceReportSchema>;

export const HistoryOptionsSchema = z.strictObject({
  revision: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  since: z.iso.datetime({ offset: true }).optional(),
});
export type HistoryOptions = z.input<typeof HistoryOptionsSchema>;
