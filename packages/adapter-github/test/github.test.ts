import { describe, expect, it } from "vitest";
import { createGitHubProvider, GITHUB_API_VERSION } from "../src/index.js";

const base = "a".repeat(40);
const head = "b".repeat(40);
const merge = "c".repeat(40);
const token = "fixture_secret_token";
const metadata = {
  number: 12,
  title: "Explain client creation",
  body: "AddClientModal opens a create form.",
  state: "closed",
  merged: true,
  merge_commit_sha: merge,
  updated_at: "2026-01-02T03:04:05Z",
  commits: 1,
  changed_files: 1,
  head: { sha: head },
  base: { sha: base, repo: { full_name: "example/product" } },
};
const files = [
  {
    filename: "components/AddClientModal.tsx",
    status: "modified",
    patch: "private patch omitted",
  },
];
const commits = [{ sha: head, author: { login: "not-retained" } }];
const association = {
  number: 12,
  base: { repo: { full_name: "example/product" } },
};
type RequestHandler = (url: URL, count: number) => Response | Promise<Response>;
function setup(handler?: RequestHandler) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const provider = createGitHubProvider({
    owner: "example",
    repo: "product",
    token,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      if (handler) return handler(url, calls.length);
      const payload = url.pathname.endsWith("/files")
        ? files
        : url.pathname.endsWith("/commits")
          ? commits
          : url.pathname.includes("/commits/")
            ? [association]
            : metadata;
      return Response.json(payload);
    },
  });
  return { provider, calls };
}

describe("GitHub PR adapter", () => {
  it("fetches token-authenticated PR metadata/files/commits and returns only evidence fields", async () => {
    const { provider, calls } = setup();
    const record = await provider.getPullRequest("12");
    expect(record).toEqual({
      provider: "github",
      repository: "example/product",
      number: 12,
      url: "https://github.com/example/product/pull/12",
      title: metadata.title,
      body: metadata.body,
      state: "closed",
      merged: true,
      baseSha: base,
      headSha: head,
      mergeCommitSha: merge,
      updatedAt: metadata.updated_at,
      files: [{ path: files[0]?.filename, status: "modified" }],
      commits: [head],
    });
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.url.origin).toBe("https://api.github.com");
      expect(call.init).toMatchObject({
        method: "GET",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          Accept: "application/vnd.github+json",
        },
      });
      expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(JSON.stringify(record)).not.toMatch(
      /fixture_secret|private patch|not-retained/,
    );
    expect(await provider.getPullRequest("12")).toEqual(record);
  });

  it("paginates all files and commits, handles rename paths and sorts output deterministically", async () => {
    const pages = Array.from({ length: 101 }, (_, i) => ({
      filename: `file-${String(i).padStart(3, "0")}.ts`,
      status: "modified",
    }));
    const shaPages = Array.from({ length: 101 }, (_, i) => ({
      sha: (i + 1).toString(16).padStart(40, "0"),
    }));
    pages.reverse();
    shaPages.reverse();
    const { provider, calls } = setup((url) => {
      if (
        url.pathname.endsWith("/files") ||
        url.pathname.endsWith("/commits")
      ) {
        const start = (Number(url.searchParams.get("page")) - 1) * 100;
        const items = url.pathname.endsWith("/files") ? pages : shaPages;
        return Response.json(items.slice(start, start + 100), {
          headers:
            start === 0
              ? { link: '<https://untrusted.invalid/next>; rel="next"' }
              : {},
        });
      }
      return Response.json({ ...metadata, changed_files: 101, commits: 101 });
    });
    const record = await provider.getPullRequest("12");
    expect(calls).toHaveLength(6);
    expect(record.files).toHaveLength(101);
    expect(record.files[0]?.path).toBe("file-000.ts");
    expect(record.commits[0]).toBe("1".padStart(40, "0"));
    expect(calls.every((call) => call.url.hostname === "api.github.com")).toBe(
      true,
    );
    const renamed = setup((url) =>
      Response.json(
        url.pathname.endsWith("/files")
          ? [
              {
                filename: "new.ts",
                previous_filename: "old.ts",
                status: "renamed",
              },
            ]
          : url.pathname.endsWith("/commits")
            ? commits
            : metadata,
      ),
    );
    expect((await renamed.provider.getPullRequest("12")).files).toEqual([
      { path: "new.ts", previousPath: "old.ts", status: "renamed" },
    ]);
  });

  it("finds commit and merge associations, returns null for none and rejects ambiguity", async () => {
    expect(
      (await setup().provider.findPullRequestForCommit(head))?.number,
    ).toBe(12);
    expect(
      (await setup().provider.findPullRequestForCommit(merge))?.number,
    ).toBe(12);
    const none = setup(() => Response.json([]));
    expect(await none.provider.findPullRequestForCommit(head)).toBeNull();
    expect(none.calls).toHaveLength(1);
    for (const response of [
      Response.json([association, { ...association, number: 13 }]),
      Response.json([association], {
        headers: { link: '<https://api.github.com/next>; rel="next"' },
      }),
    ])
      await expect(
        setup(() => response).provider.findPullRequestForCommit(head),
      ).rejects.toThrow("explicit PR number");
    expect(
      await setup().provider.findPullRequestForCommit("d".repeat(40)),
    ).toMatchObject({
      lookupCommitSha: "d".repeat(40),
      commits: [head],
      mergeCommitSha: merge,
    });
  });

  it("keeps open-PR test merges out of actual merge evidence and preserves nullable bodies", async () => {
    const { provider } = setup((url) =>
      Response.json(
        url.pathname.endsWith("/files")
          ? files
          : url.pathname.endsWith("/commits")
            ? commits
            : { ...metadata, body: null, merged: false, state: "open" },
      ),
    );
    expect(await provider.getPullRequest("12")).toMatchObject({
      body: null,
      merged: false,
      mergeCommitSha: null,
    });
  });

  it("fails explicitly on list limits, count mismatches, duplicate pages and PR snapshot changes", async () => {
    for (const limits of [{ commits: 251 }, { changed_files: 3001 }]) {
      const test = setup(() => Response.json({ ...metadata, ...limits }));
      await expect(test.provider.getPullRequest("12")).rejects.toThrow(
        "No partial evidence",
      );
      expect(test.calls).toHaveLength(1);
    }
    await expect(
      setup((url) =>
        Response.json(url.pathname.endsWith("/files") ? [] : metadata),
      ).provider.getPullRequest("12"),
    ).rejects.toThrow("pagination");
    const duplicate = setup((url) =>
      Response.json(
        url.pathname.endsWith("/files")
          ? [files[0], files[0]]
          : url.pathname.endsWith("/commits")
            ? commits
            : { ...metadata, changed_files: 2 },
      ),
    );
    await expect(duplicate.provider.getPullRequest("12")).rejects.toThrow(
      "duplicate files/commits",
    );
    const drifting = setup((url, count) =>
      Response.json(
        url.pathname.endsWith("/files")
          ? files
          : url.pathname.endsWith("/commits")
            ? commits
            : { ...metadata, title: count === 4 ? "Changed" : metadata.title },
      ),
    );
    await expect(drifting.provider.getPullRequest("12")).rejects.toThrow(
      "PR changed",
    );
    const truncated = setup((url) =>
      Response.json(url.pathname.endsWith("/files") ? files : metadata, {
        headers: url.pathname.endsWith("/files")
          ? { link: '<https://example.invalid/>; rel="next"' }
          : {},
      }),
    );
    await expect(truncated.provider.getPullRequest("12")).rejects.toThrow(
      "pagination",
    );
  });

  it("rejects wrong repositories, unsafe paths, malformed JSON and incomplete rename evidence", async () => {
    await expect(
      setup(() =>
        Response.json({
          ...metadata,
          base: { sha: base, repo: { full_name: "other/product" } },
        }),
      ).provider.getPullRequest("12"),
    ).rejects.toThrow("different repository");
    await expect(
      setup(() => new Response("not json")).provider.getPullRequest("12"),
    ).rejects.toThrow("invalid response");
    await expect(
      setup(() =>
        Response.json({ ...metadata, head: { sha: "bad" } }),
      ).provider.getPullRequest("12"),
    ).rejects.toThrow("invalid response");
    await expect(
      setup((url) =>
        Response.json(
          url.pathname.endsWith("/files")
            ? [{ ...files[0], filename: "../private" }]
            : metadata,
        ),
      ).provider.getPullRequest("12"),
    ).rejects.toThrow("invalid response");
    await expect(
      setup((url) =>
        Response.json(
          url.pathname.endsWith("/files")
            ? [{ ...files[0], status: "renamed" }]
            : url.pathname.endsWith("/commits")
              ? commits
              : metadata,
        ),
      ).provider.getPullRequest("12"),
    ).rejects.toThrow("incomplete rename");
  });

  it.each([
    [401, {}, "denied access"],
    [403, {}, "denied access"],
    [404, {}, "not found"],
    [403, { "x-ratelimit-remaining": "0" }, "rate limit"],
    [429, {}, "rate limit"],
    [302, { location: "https://untrusted.invalid" }, "HTTP 302"],
    [503, {}, "HTTP 503"],
  ])(
    "handles HTTP %s without exposing response content or retrying",
    async (status, headers, message) => {
      const { provider, calls } = setup(
        () => new Response(`secret ${token}`, { status, headers }),
      );
      await expect(provider.getPullRequest("12")).rejects.toThrow(message);
      expect(calls).toHaveLength(1);
    },
  );

  it("bounds responses and sanitizes transport failures", async () => {
    await expect(
      setup(
        () => new Response("x".repeat(4 * 1024 * 1024 + 1)),
      ).provider.getPullRequest("12"),
    ).rejects.toThrow("exceeded 4 MiB");
    const throwing = setup(() => {
      throw new Error(`transport leaked ${token}`);
    });
    try {
      await throwing.provider.getPullRequest("12");
      throw new Error("Expected failure");
    } catch (error) {
      expect(String(error)).toContain("request failed");
      expect(String(error)).not.toContain(token);
    }
    const broken = setup(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error(token));
            },
          }),
        ),
    );
    await expect(broken.provider.getPullRequest("12")).rejects.toThrow(
      "interrupted",
    );
  });

  it("validates configuration, PR IDs and commit SHAs before issuing requests", async () => {
    for (const value of ["", "has whitespace", "bad\r\nheader"])
      expect(() =>
        createGitHubProvider({
          owner: "example",
          repo: "product",
          token: value,
        }),
      ).toThrow("token");
    for (const repo of ["..", ".", "name/escape", "name?secret"])
      expect(() =>
        createGitHubProvider({ owner: "example", repo, token }),
      ).toThrow();
    const { provider, calls } = setup();
    for (const id of ["0", "-1", "1/../2", "1?secret", "1.5"])
      await expect(provider.getPullRequest(id)).rejects.toThrow();
    await expect(provider.findPullRequestForCommit("HEAD")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
