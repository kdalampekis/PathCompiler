import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { describe, expect, it } from "vitest";
import {
  associatePullRequest,
  type GitProvider,
  type PullRequestRecord,
  PullRequestRecordSchema,
} from "../src/index.js";

const base = "a".repeat(40);
const head = "b".repeat(40);
const merge = "c".repeat(40);
const modal = "components/AddClientModal.tsx";
const component = `component:${modal}#AddClientModal`;
function source() {
  const graph = analyzeNextProject({
    repository: { commit: merge, dirty: false },
    files: [
      {
        path: "app/page.tsx",
        content:
          'import { AddClientModal } from "../components/AddClientModal"; export default function Page() { return <AddClientModal />; }',
      },
      {
        path: modal,
        content:
          'export function AddClientModal() { return <button data-pathcompiler="clients.create">Add client</button>; }',
      },
      {
        path: "components/Unrelated.tsx",
        content: "export function Unrelated() { return <p>Unrelated</p>; }",
      },
    ],
  }).graph;
  graph.addNode({ id: `commit:${head}`, type: "Commit", data: { sha: head } });
  graph.addNode({
    id: `commit:${merge}`,
    type: "Commit",
    data: { sha: merge },
  });
  graph.addNode({ id: `commit:${base}`, type: "Commit", data: { sha: base } });
  return graph;
}
function record(): PullRequestRecord {
  return {
    provider: "github",
    repository: "example/product",
    number: 12,
    url: "https://github.com/example/product/pull/12",
    title: "Explain AddClientModal",
    body: "This mentions Unrelated, but it does not change that file.",
    state: "closed",
    merged: true,
    baseSha: base,
    headSha: head,
    mergeCommitSha: merge,
    updatedAt: "2026-01-02T03:04:05Z",
    files: [{ path: modal, status: "modified" }],
    commits: [head],
  };
}
describe("pull request evidence", () => {
  it("associates a mock provider PR with changed file/component/action and linked commit nodes", async () => {
    const provider: GitProvider = {
      getPullRequest: async () => record(),
      findPullRequestForCommit: async () => record(),
    };
    const graph = source();
    const before = graph.serialize();
    const result = associatePullRequest(
      graph,
      await provider.getPullRequest("12"),
    );
    const prId = "pr:github:example/product#12";
    expect(result.report.associatedNodeIds).toEqual(
      expect.arrayContaining([
        `file:${modal}`,
        component,
        "ui:clients.create",
        `commit:${head}`,
        `commit:${merge}`,
      ]),
    );
    expect(result.report.associatedNodeIds).not.toContain(`commit:${base}`);
    expect(
      result.report.associatedNodeIds.some((id) => id.includes("Unrelated")),
    ).toBe(false);
    expect(
      result.graph
        .toJSON()
        .edges.find((edge) => edge.source === component && edge.target === prId)
        ?.data,
    ).toMatchObject({
      evidenceOnly: true,
      basis: "pull-request-file-association",
      heuristic: true,
      confidence: 0.5,
      repositoryCommit: merge,
    });
    expect(
      result.graph
        .toJSON()
        .edges.find(
          (edge) => edge.source === `commit:${head}` && edge.target === prId,
        )?.data,
    ).toMatchObject({
      basis: "pull-request-commit",
      confidence: 1,
      heuristic: false,
    });
    expect(result.report.pullRequest.body).toContain("Unrelated");
    expect(result.graph.getNode(prId)?.data?.body).toBeUndefined();
    expect(graph.serialize()).toBe(before);
    expect(associatePullRequest(graph, record()).graph.serialize()).toBe(
      result.graph.serialize(),
    );
    expect(result.graph.getNode(component)).toEqual(graph.getNode(component));
    const lookup = associatePullRequest(graph, {
      ...record(),
      lookupCommitSha: base,
    });
    expect(
      lookup.graph
        .toJSON()
        .edges.find(
          (edge) => edge.source === `commit:${base}` && edge.target === prId,
        )?.data?.basis,
    ).toBe("provider-commit-association");
  });

  it("maps root-relative PR paths to nested graphs, including prior rename paths", () => {
    const pr = record();
    pr.files = [
      {
        path: "apps/demo/components/ClientDialog.tsx",
        previousPath: `apps/demo/${modal}`,
        status: "renamed",
      },
      { path: `other/${modal}`, status: "modified" },
    ];
    const result = associatePullRequest(source(), pr, {
      repositoryPath: "apps/demo",
    });
    expect(result.report.associatedNodeIds).toContain(component);
    expect(result.report.repositoryPath).toBe("apps/demo");
    expect(
      associatePullRequest(source(), pr).report.associatedNodeIds,
    ).not.toContain(component);
    pr.files.reverse();
    expect(
      associatePullRequest(source(), pr, {
        repositoryPath: "apps/demo",
      }).graph.serialize(),
    ).toBe(result.graph.serialize());
  });

  it("keeps unmerged proposals explicit, skips unchanged files and rejects invalid/conflicting records", () => {
    const pr = {
      ...record(),
      state: "open",
      merged: false,
      mergeCommitSha: null,
    } as const;
    const result = associatePullRequest(source(), pr);
    expect(result.report.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unmerged-pull-request" }),
    );
    expect(result.report.associatedNodeIds).not.toContain(`commit:${merge}`);
    expect(() => associatePullRequest(result.graph, pr)).toThrow(
      "already contains",
    );
    const unchanged = record();
    unchanged.files = [{ path: modal, status: "unchanged" }];
    expect(
      associatePullRequest(source(), unchanged).report.associatedNodeIds,
    ).not.toContain(component);
    expect(() =>
      PullRequestRecordSchema.parse({ ...pr, mergeCommitSha: merge }),
    ).toThrow("actual merge");
    expect(() =>
      associatePullRequest(source(), { ...record(), commits: [head, head] }),
    ).toThrow("unique");
    expect(() =>
      associatePullRequest(source(), record(), {
        repositoryPath: "../private",
      }),
    ).toThrow();
  });
});
