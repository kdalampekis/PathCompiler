import { GitProviderError } from "@pathcompiler/diagnostics";
import {
  CommitShaSchema,
  type GitProvider,
  type PullRequestRecord,
  PullRequestRecordSchema,
} from "@pathcompiler/git-intelligence";
import { RelativePathSchema } from "@pathcompiler/source-model";
import { z } from "zod";

export const GITHUB_API_VERSION = "2026-03-10";
const MAX_BYTES = 4 * 1024 * 1024;
const prNumber = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine(
    (value) => Number.isSafeInteger(Number(value)),
    "Expected a positive PR number",
  );
const metadataSchema = z.object({
  number: z.number().int().positive().safe(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed"]),
  merged: z.boolean(),
  merge_commit_sha: CommitShaSchema.nullable(),
  updated_at: z.iso.datetime(),
  commits: z.number().int().nonnegative(),
  changed_files: z.number().int().nonnegative(),
  head: z.object({ sha: CommitShaSchema }),
  base: z.object({
    sha: CommitShaSchema,
    repo: z.object({ full_name: z.string() }),
  }),
});
const fileSchema = z.object({
  filename: RelativePathSchema,
  previous_filename: RelativePathSchema.optional(),
  status: z.enum([
    "added",
    "removed",
    "modified",
    "renamed",
    "copied",
    "changed",
    "unchanged",
  ]),
});
const commitSchema = z.object({ sha: CommitShaSchema });
const associationSchema = z.object({
  number: z.number().int().positive().safe(),
  base: z.object({ repo: z.object({ full_name: z.string() }) }),
});

export type GitHubProviderOptions = {
  owner: string;
  repo: string;
  token: string;
  /** Inject a transport for tests; production uses native fetch against api.github.com only. */
  fetch?: typeof globalThis.fetch;
};

/** Token-authenticated, read-only GitHub.com adapter for one repository. No credentials enter records. */
export function createGitHubProvider(
  options: GitHubProviderOptions,
): GitProvider {
  const { owner, repo } = z
    .strictObject({
      owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/),
      repo: z
        .string()
        .regex(/^[A-Za-z0-9_.-]{1,100}$/)
        .refine((value) => value !== "." && value !== ".."),
    })
    .parse({ owner: options.owner, repo: options.repo });
  const token = options.token;
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 4096 ||
    !/^[\x21-\x7e]+$/.test(token)
  )
    throw new GitProviderError(
      "Provide a nonempty GitHub token without whitespace; it needs Pull requests read permission.",
    );
  const transport = options.fetch ?? globalThis.fetch;
  const repository = `${owner}/${repo}`;
  const prefix = `https://api.github.com/repos/${owner}/${repo}`;

  async function request<T>(
    route: string,
    schema: z.ZodType<T>,
  ): Promise<{ value: T; next: boolean }> {
    let response: Response;
    try {
      response = await transport(`${prefix}${route}`, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          "User-Agent": "PathCompiler",
        },
      });
    } catch {
      throw new GitProviderError(
        "GitHub request failed or timed out. Check network access and retry.",
      );
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      if (
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get("x-ratelimit-remaining") === "0" ||
            response.headers.has("retry-after")))
      )
        throw new GitProviderError(
          "GitHub rate limit reached. Wait for the limit to reset, then retry; no automatic retry was made.",
        );
      if (response.status === 401 || response.status === 403)
        throw new GitProviderError(
          "GitHub denied access. Check the token and Pull requests read permission for this repository.",
        );
      if (response.status === 404)
        throw new GitProviderError(
          "GitHub repository, PR or commit was not found or is not accessible with this token.",
        );
      throw new GitProviderError(
        `GitHub returned HTTP ${response.status}. Retry later or check the repository and request.`,
      );
    }
    if (!response.body)
      throw new GitProviderError("GitHub returned an empty response.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let body = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) {
          await reader.cancel();
          throw new GitProviderError("Response limit");
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } catch {
      throw new GitProviderError(
        "GitHub response was interrupted, invalid UTF-8 or exceeded 4 MiB. Retry or inspect a smaller PR.",
      );
    } finally {
      reader.releaseLock();
    }
    try {
      return {
        value: schema.parse(JSON.parse(body)),
        next: /\brel=(?:"[^"]*\bnext\b[^"]*"|next)/.test(
          response.headers.get("link") ?? "",
        ),
      };
    } catch {
      throw new GitProviderError(
        "GitHub returned an invalid response. No incomplete evidence was saved.",
      );
    }
  }

  async function list<T>(
    route: string,
    schema: z.ZodType<T>,
    expected: number,
  ): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; result.length < expected; page++) {
      const response = await request(
        `${route}?per_page=100&page=${page}`,
        z.array(schema).max(100),
      );
      const remaining = expected - result.length;
      if (
        response.value.length !== Math.min(100, remaining) ||
        (remaining <= 100 && response.next)
      )
        throw new GitProviderError(
          "GitHub pagination disagrees with PR counts. The PR may have changed; retry.",
        );
      result.push(...response.value);
    }
    return result;
  }

  async function getPullRequest(id: string): Promise<PullRequestRecord> {
    const number = Number(prNumber.parse(id));
    const route = `/pulls/${number}`;
    const before = (await request(route, metadataSchema)).value;
    if (
      before.number !== number ||
      before.base.repo.full_name.toLowerCase() !== repository.toLowerCase()
    )
      throw new GitProviderError(
        "GitHub returned a PR for a different repository or number.",
      );
    // ponytail: fail beyond documented REST list limits; add another retrieval strategy when larger PRs are needed.
    if (before.commits > 250 || before.changed_files > 3000)
      throw new GitProviderError(
        "PR exceeds the supported GitHub limits of 250 commits or 3,000 files. No partial evidence was returned.",
      );
    const files = await list(
      `${route}/files`,
      fileSchema,
      before.changed_files,
    );
    const commits = await list(
      `${route}/commits`,
      commitSchema,
      before.commits,
    );
    const after = (await request(route, metadataSchema)).value;
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new GitProviderError(
        "PR changed while its evidence was being read. Retry to capture a consistent snapshot.",
      );
    try {
      return PullRequestRecordSchema.parse({
        provider: "github",
        repository: repository.toLowerCase(),
        number,
        url: `https://github.com/${repository}/pull/${number}`,
        title: before.title,
        body: before.body,
        state: before.state,
        merged: before.merged,
        baseSha: before.base.sha,
        headSha: before.head.sha,
        // GitHub's merge_commit_sha on an open PR is a temporary test merge, not a real merged change.
        mergeCommitSha: before.merged ? before.merge_commit_sha : null,
        updatedAt: before.updated_at,
        files: files
          .map((file) => ({
            path: file.filename,
            status: file.status,
            ...(file.previous_filename === undefined
              ? {}
              : { previousPath: file.previous_filename }),
          }))
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
        commits: commits.map((commit) => commit.sha).sort(),
      });
    } catch {
      throw new GitProviderError(
        "GitHub returned inconsistent PR evidence, such as duplicate files/commits or an incomplete rename. Retry.",
      );
    }
  }

  return {
    getPullRequest,
    async findPullRequestForCommit(
      sha: string,
    ): Promise<PullRequestRecord | null> {
      const commit = CommitShaSchema.parse(sha);
      const result = await request(
        `/commits/${commit}/pulls?per_page=100&page=1`,
        z.array(associationSchema).max(100),
      );
      if (result.next || result.value.length > 1)
        throw new GitProviderError(
          "Multiple pull requests are associated with this commit. Inspect an explicit PR number.",
        );
      const match = result.value[0];
      if (!match) return null;
      if (match.base.repo.full_name.toLowerCase() !== repository.toLowerCase())
        throw new GitProviderError(
          "GitHub returned a commit association for a different repository.",
        );
      const pr = await getPullRequest(String(match.number));
      // Rebased commits can have new SHAs. Preserve the provider's association separately from the PR commit list.
      return { ...pr, lookupCommitSha: commit };
    },
  };
}
