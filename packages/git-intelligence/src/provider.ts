import {
  createEdgeId,
  createNodeId,
  ProductGraph,
} from "@pathcompiler/graph-core";
import {
  compareText,
  DiagnosticSchema,
  RelativePathSchema,
} from "@pathcompiler/source-model";
import { z } from "zod";
import { filesForNode } from "./provenance.js";
import { CommitShaSchema } from "./schema.js";

export const PullRequestFileSchema = z
  .strictObject({
    path: RelativePathSchema,
    previousPath: RelativePathSchema.optional(),
    status: z.enum([
      "added",
      "removed",
      "modified",
      "renamed",
      "copied",
      "changed",
      "unchanged",
    ]),
  })
  .refine(
    (file) => file.status !== "renamed" || file.previousPath !== undefined,
    "Renamed files need their previous path",
  );
export const PullRequestRecordSchema = z
  .strictObject({
    provider: z.string().regex(/^[a-z][a-z0-9-]*$/),
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    number: z.number().int().positive().safe(),
    url: z.url({ protocol: /^https$/ }),
    title: z.string(),
    body: z.string().nullable(),
    state: z.enum(["open", "closed"]),
    merged: z.boolean(),
    baseSha: CommitShaSchema,
    headSha: CommitShaSchema,
    mergeCommitSha: CommitShaSchema.nullable(),
    lookupCommitSha: CommitShaSchema.optional(),
    updatedAt: z.iso.datetime(),
    files: z.array(PullRequestFileSchema).max(3000),
    commits: z.array(CommitShaSchema).max(250),
  })
  .superRefine((pr, context) => {
    if (
      (pr.merged && pr.state !== "closed") ||
      (!pr.merged && pr.mergeCommitSha !== null)
    )
      context.addIssue({
        code: "custom",
        message:
          "Only merged pull requests can identify an actual merge commit",
      });
    if (
      new Set(pr.files.map((file) => file.path)).size !== pr.files.length ||
      new Set(pr.commits).size !== pr.commits.length
    )
      context.addIssue({
        code: "custom",
        message: "Pull request files and commits must be unique",
      });
  });
export type PullRequestRecord = z.infer<typeof PullRequestRecordSchema>;

/** Providers are configured for one repository; IDs are its positive decimal PR numbers. */
export interface GitProvider {
  getPullRequest(id: string): Promise<PullRequestRecord>;
  /** Null means no association. Ambiguous associations must fail instead of picking arbitrarily. */
  findPullRequestForCommit(sha: string): Promise<PullRequestRecord | null>;
}

export const PullRequestEvidenceReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evidenceOnly: z.literal(true),
  sourceRepository: z.strictObject({
    commit: CommitShaSchema.nullable(),
    dirty: z.boolean().nullable(),
  }),
  repositoryPath: z.union([z.literal(""), RelativePathSchema]),
  pullRequest: PullRequestRecordSchema,
  associatedNodeIds: z.array(z.string()),
  diagnostics: z.array(DiagnosticSchema),
});
export type PullRequestEvidenceReport = z.infer<
  typeof PullRequestEvidenceReportSchema
>;

/** Attach separate PR evidence; never replace source nodes, commit facts or workflow data. */
export function associatePullRequest(
  sourceGraph: ProductGraph,
  input: unknown,
  options: { repositoryPath?: string } = {},
): { graph: ProductGraph; report: PullRequestEvidenceReport } {
  const pr = PullRequestRecordSchema.parse(input);
  pr.files.sort((a, b) => compareText(a.path, b.path));
  pr.commits.sort(compareText);
  const { repositoryPath } = z
    .strictObject({
      repositoryPath: z.union([z.literal(""), RelativePathSchema]).default(""),
    })
    .parse(options);
  const sourceRepository =
    PullRequestEvidenceReportSchema.shape.sourceRepository.parse({
      commit: sourceGraph.getNode("repository:.")?.data?.commit,
      dirty: sourceGraph.getNode("repository:.")?.data?.dirty,
    });
  const graph = ProductGraph.fromJSON(sourceGraph.toJSON());
  const id = createNodeId(
    "PullRequest",
    `${pr.provider}:${pr.repository.toLowerCase()}#${pr.number}`,
  );
  if (graph.getNode(id))
    throw new Error(
      "This graph already contains that PR. Start from the source/history graph to refresh its evidence.",
    );
  graph.addNode({
    id,
    type: "PullRequest",
    data: {
      provider: pr.provider,
      repository: pr.repository,
      number: pr.number,
      url: pr.url,
      title: pr.title,
      headSha: pr.headSha,
      baseSha: pr.baseSha,
      mergeCommitSha: pr.mergeCommitSha,
      updatedAt: pr.updatedAt,
      evidenceOnly: true,
    },
  });
  const changed = new Set(
    pr.files
      .filter((file) => file.status !== "unchanged")
      .flatMap((file) =>
        file.status === "renamed" && file.previousPath
          ? [file.path, file.previousPath]
          : [file.path],
      ),
  );
  const report: PullRequestEvidenceReport = {
    schemaVersion: 1,
    evidenceOnly: true,
    sourceRepository,
    repositoryPath,
    pullRequest: pr,
    associatedNodeIds: [],
    diagnostics: [],
  };
  if (!pr.merged)
    report.diagnostics.push({
      code: "unmerged-pull-request",
      message:
        "This PR is not merged. Its evidence describes proposed changes.",
    });
  if (sourceRepository.dirty)
    report.diagnostics.push({
      code: "dirty-working-tree",
      message:
        "PR paths are associated with current uncommitted declarations; review these associations.",
    });
  for (const node of sourceGraph.toJSON().nodes) {
    const files = filesForNode(node).filter((file) =>
      changed.has(repositoryPath ? `${repositoryPath}/${file}` : file),
    );
    const sha =
      node.type === "Commit" ? CommitShaSchema.safeParse(node.data?.sha) : null;
    const commit =
      sha?.success &&
      (pr.commits.includes(sha.data) ||
        pr.mergeCommitSha === sha.data ||
        pr.lookupCommitSha === sha.data)
        ? sha.data
        : null;
    if (!files.length && !commit) continue;
    graph.addEdge({
      id: createEdgeId("SUPPORTED_BY", node.id, id),
      type: "SUPPORTED_BY",
      source: node.id,
      target: id,
      data: {
        evidenceOnly: true,
        basis: commit
          ? pr.commits.includes(commit) || pr.mergeCommitSha === commit
            ? "pull-request-commit"
            : "provider-commit-association"
          : "pull-request-file-association",
        confidence: commit ? 1 : 0.5,
        heuristic: !commit,
        files,
        commit,
        repositoryCommit: sourceRepository.commit,
        repositoryPath,
        pullRequestHead: pr.headSha,
        pullRequestBase: pr.baseSha,
        merged: pr.merged,
      },
    });
    report.associatedNodeIds.push(node.id);
  }
  return { graph, report: PullRequestEvidenceReportSchema.parse(report) };
}
