import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { scanNextRepository } from "@pathcompiler/adapter-nextjs";
import { ProductGraph } from "@pathcompiler/graph-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  enrichNodeHistory,
  GitEvidenceReportSchema,
  openGitRepository,
} from "../src/index.js";

const exec = promisify(execFile);
const temporary: string[] = [];
const modal = "components/AddClientModal.tsx";
const nodeId = `component:${modal}#AddClientModal`;
const initial =
  'export function AddClientModal() {\n  return <button data-pathcompiler="clients.create">Create</button>;\n}\n';
async function directory() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-git-"));
  temporary.push(dir);
  return dir;
}
async function git(dir: string, ...args: string[]) {
  return (
    await exec(
      "git",
      [
        "-C",
        dir,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      {
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: "2026-01-02T03:04:05+02:00",
          GIT_COMMITTER_DATE: "2026-01-02T03:04:05+02:00",
        },
      },
    )
  ).stdout.trim();
}
async function put(dir: string, file: string, content: string | Uint8Array) {
  await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
  await writeFile(path.join(dir, file), content);
}
async function commit(dir: string, message: string) {
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", message);
  return git(dir, "rev-parse", "HEAD");
}
async function fixture(prefix = "") {
  const dir = await directory();
  await git(dir, "init", "-b", "main");
  const scope = path.join(dir, prefix);
  await put(scope, modal, initial);
  await put(
    scope,
    "app/page.tsx",
    'import { AddClientModal } from "../components/AddClientModal";\nexport default function Page() { return <AddClientModal />; }\n',
  );
  await put(
    scope,
    "components/Unrelated.tsx",
    "export function Unrelated() { return <p>Unrelated</p>; }\n",
  );
  const base = await commit(dir, "Initial fixture");
  await put(scope, modal, initial.replace("Create</", "Add client</"));
  const head = await commit(
    dir,
    "Clarify AddClientModal action\n\nIntent only: no behavior claim.",
  );
  return { dir, scope, base, head, repository: await openGitRepository(scope) };
}
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("local Git intelligence", () => {
  it("extracts commit metadata, bounded literal-path history, text hunks and blame", async () => {
    const { repository, base, head } = await fixture();
    expect(await repository.getCurrentCommit()).toBe(head);
    expect(await repository.getCommit(head)).toEqual({
      sha: head,
      parents: [base],
      authorDate: "2026-01-02T01:04:05.000Z",
      message:
        "Clarify AddClientModal action\n\nIntent only: no behavior claim.\n",
    });
    expect(await repository.getCommitMessage(head)).toContain("Intent only");
    const history = await repository.getCommitsForPath(modal, { limit: 1 });
    expect(history).toMatchObject({ head, limited: true, shallow: false });
    expect(history.commits.map((item) => item.sha)).toEqual([head]);
    expect(
      (
        await repository.getCommitsForPath(modal, { revision: base })
      ).commits.map((item) => item.sha),
    ).toEqual([base]);
    expect(
      (
        await repository.getCommitsForPath(modal, {
          since: "2027-01-01T00:00:00Z",
        })
      ).commits,
    ).toEqual([]);
    const diff = await repository.getDiff(base, head);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toMatchObject({
      path: modal,
      status: "M",
      binary: false,
      hunks: [
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 3,
          lines: expect.arrayContaining([
            '-  return <button data-pathcompiler="clients.create">Create</button>;',
            '+  return <button data-pathcompiler="clients.create">Add client</button>;',
          ]),
        },
      ],
    });
    expect(
      await repository.getBlame(modal, { startLine: 2, limit: 1 }),
    ).toMatchObject({
      revision: head,
      startLine: 2,
      totalLines: 3,
      limited: true,
      lines: [{ sha: head, originalLine: 2, line: 2 }],
    });
    expect(
      (await repository.getBlame(modal, { revision: base })).lines.every(
        (line) => line.sha === base,
      ),
    ).toBe(true);
    expect(JSON.stringify(await repository.getBlame(modal))).not.toContain(
      "return <button",
    );
  });

  it("links the AddClientModal change to current file/component/action nodes with honest provenance", async () => {
    const { repository, scope, base, head } = await fixture();
    const source = (await scanNextRepository(scope)).graph;
    const original = source.serialize();
    const result = await enrichNodeHistory(repository, source, nodeId);
    expect(GitEvidenceReportSchema.parse(result.report)).toEqual(result.report);
    const links = result.graph
      .toJSON()
      .edges.filter(
        (edge) =>
          edge.type === "CHANGED_BY" && edge.target === `commit:${head}`,
      );
    expect(links.map((edge) => edge.source)).toEqual(
      expect.arrayContaining([`file:${modal}`, nodeId, "ui:clients.create"]),
    );
    expect(links.some((edge) => edge.source.includes("Unrelated"))).toBe(false);
    expect(links.find((edge) => edge.source === nodeId)?.data).toMatchObject({
      basis: "file-association",
      confidence: 0.5,
      heuristic: true,
      files: [modal],
      repositoryCommit: head,
      changedCommit: head,
    });
    expect(
      links.find((edge) => edge.source === `file:${modal}`)?.data,
    ).toMatchObject({ basis: "file-change", confidence: 1, heuristic: false });
    expect(result.graph.getNode(`commit:${head}`)?.data?.messageRole).toBe(
      "intent-evidence",
    );
    expect(
      result.report.commits.find((item) => item.commit.sha === base)?.diff
        ?.base,
    ).toBeNull();
    expect(
      result.report.commits.every((item) =>
        item.diff?.changes.every((change) => change.path === modal),
      ),
    ).toBe(true);
    expect(source.serialize()).toBe(original);
    expect(
      (await enrichNodeHistory(repository, source, nodeId)).graph.serialize(),
    ).toBe(result.graph.serialize());
    expect(
      (
        await enrichNodeHistory(repository, result.graph, nodeId)
      ).graph.serialize(),
    ).toBe(result.graph.serialize());
    expect(JSON.stringify(result.report)).not.toContain(scope);
    expect(
      (await enrichNodeHistory(repository, source, nodeId, { limit: 1 })).report
        .diagnostics,
    ).toContainEqual(expect.objectContaining({ code: "history-limit" }));
  });

  it("scopes paths and dirty metadata to a nested scan directory", async () => {
    const { repository, dir, scope, base, head } = await fixture("apps/demo");
    await put(dir, "outside.ts", "untracked\n");
    expect(await repository.getSnapshot()).toEqual({
      commit: head,
      dirty: false,
      shallow: false,
    });
    expect(
      (await repository.getDiff(base, head)).changes.map(
        (change) => change.path,
      ),
    ).toEqual([modal]);
    const result = await enrichNodeHistory(
      repository,
      (await scanNextRepository(scope)).graph,
      nodeId,
    );
    expect(result.report.histories[0]?.path).toBe(modal);
    expect(JSON.stringify(result.report)).not.toContain("apps/demo");
    expect((await repository.getBlame(modal)).lines[1]?.sha).toBe(head);
  });

  it("handles literal special paths, binary/empty files, deletions, renames and missing final newlines", async () => {
    const { dir, repository, head } = await fixture();
    const strange = "data/[id] café\nfile.txt";
    await put(dir, strange, "one\ntwo");
    await put(dir, "empty.txt", "");
    await put(dir, "binary.dat", new Uint8Array([0, 1, 2]));
    const added = await commit(dir, "Add files");
    expect(
      (await repository.getCommitsForPath(strange)).commits.map(
        (item) => item.sha,
      ),
    ).toEqual([added]);
    expect(
      (await repository.getDiff(head, added, { paths: [strange] })).changes[0],
    ).toMatchObject({
      path: strange,
      status: "A",
      hunks: [
        {
          oldLines: 0,
          newLines: 2,
          lines: ["+one", "+two", "\\ No newline at end of file"],
        },
      ],
    });
    expect(
      (await repository.getDiff(head, added, { paths: ["binary.dat"] }))
        .changes[0],
    ).toMatchObject({ binary: true, hunks: [] });
    expect((await repository.getBlame("empty.txt")).lines).toEqual([]);
    expect((await repository.getBlame(strange)).lines).toHaveLength(2);
    await expect(repository.getBlame("binary.dat")).rejects.toThrow(
      "text file",
    );
    await expect(
      repository.getDiff(head, added, { maxFiles: 1 }),
    ).rejects.toThrow("Select fewer paths");
    await rename(path.join(dir, strange), path.join(dir, "renamed.txt"));
    await rm(path.join(dir, "empty.txt"));
    const removed = await commit(dir, "Rename and delete");
    const changes = (await repository.getDiff(added, removed)).changes;
    expect(changes.map((change) => [change.path, change.status])).toEqual([
      [strange, "D"],
      ["empty.txt", "D"],
      ["renamed.txt", "A"],
    ]);
    expect(
      (await repository.getCommitsForPath("renamed.txt")).commits.map(
        (item) => item.sha,
      ),
    ).toEqual([removed]);
  });

  it("parses file type changes and compares merge commits against their first parent", async () => {
    const { dir, repository, head } = await fixture();
    await put(dir, "link.txt", "ordinary file\n");
    const regular = await commit(dir, "Regular file");
    await rm(path.join(dir, "link.txt"));
    await symlink(modal, path.join(dir, "link.txt"));
    const linked = await commit(dir, "Use symlink");
    const diff = await repository.getDiff(regular, linked);
    expect(diff.changes[0]).toMatchObject({ path: "link.txt", status: "T" });
    expect(diff.changes[0]?.hunks).toHaveLength(2);
    await git(dir, "checkout", "-b", "feature", head);
    await put(dir, modal, initial.replace("Create</", "Feature label</"));
    const feature = await commit(dir, "Feature label");
    await git(dir, "checkout", "main");
    await git(dir, "merge", "--no-ff", "feature", "-m", "Merge feature");
    const merge = await repository.getCommit("HEAD");
    expect(merge.parents).toEqual([linked, feature]);
    expect(
      (await repository.getDiff(merge.parents[0] ?? "", merge.sha)).changes.map(
        (change) => change.path,
      ),
    ).toEqual([modal]);
    expect(
      (await repository.getCommitsForPath(modal)).commits.map(
        (commit) => commit.sha,
      ),
    ).toContain(feature);
  });

  it("resolves cached remote/default conventions, detached HEAD and unborn repositories without fetching", async () => {
    const dir = await directory();
    await git(dir, "init", "-b", "topic");
    const repository = await openGitRepository(dir);
    expect(await repository.getCurrentCommit()).toBeNull();
    expect(await repository.getDefaultBranch()).toBeNull();
    await expect(repository.getCommitsForPath("none.ts")).rejects.toThrow(
      "revision and path",
    );
    await put(dir, "one.ts", "export const one = 1;");
    const head = await commit(dir, "First");
    await git(dir, "branch", "main");
    expect(await repository.getDefaultBranch()).toEqual({
      name: "main",
      ref: "refs/heads/main",
      source: "convention",
    });
    await git(dir, "update-ref", "refs/remotes/origin/trunk", head);
    await git(
      dir,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/trunk",
    );
    await git(dir, "checkout", "--detach", head);
    expect(await repository.getCurrentCommit()).toBe(head);
    expect(await repository.getDefaultBranch()).toEqual({
      name: "trunk",
      ref: "refs/remotes/origin/trunk",
      source: "remote-head",
    });
    await expect(openGitRepository(await directory())).rejects.toThrow(
      "local Git working tree",
    );
  });

  it("reports shallow boundaries without inventing a root diff", async () => {
    const { dir, head, base } = await fixture();
    const clone = await directory();
    await git(clone, "clone", "--depth=1", pathToFileURL(dir).href, ".");
    const repository = await openGitRepository(clone);
    expect(await repository.hasCommit(base)).toBe(false);
    expect((await repository.getCommit(head)).parents).toEqual([base]);
    const result = await enrichNodeHistory(
      repository,
      (await scanNextRepository(clone)).graph,
      nodeId,
    );
    expect(result.report.repository.shallow).toBe(true);
    expect(result.report.commits).toEqual([
      { commit: await repository.getCommit(head), diff: null },
    ]);
    expect(result.report.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["shallow-history", "missing-parent"]),
    );
    expect(
      result.graph
        .toJSON()
        .edges.filter((edge) => edge.type === "CHANGED_BY")
        .every((edge) => edge.data?.basis === "path-history"),
    ).toBe(true);
    expect((await repository.getBlame(modal)).shallow).toBe(true);
  });

  it("does not execute external diff/textconv or fsmonitor commands", async () => {
    const { dir, repository, base, head } = await fixture();
    const marker = path.join(dir, "EXECUTED");
    const command = `touch '${marker}'`;
    await put(dir, ".gitattributes", "*.tsx diff=trap\n");
    await git(dir, "config", "diff.external", command);
    await git(dir, "config", "diff.trap.textconv", command);
    await git(dir, "config", "core.fsmonitor", command);
    expect((await repository.getDiff(base, head)).changes).toHaveLength(1);
    expect((await repository.getBlame(modal)).lines).toHaveLength(3);
    expect((await repository.getSnapshot()).dirty).toBe(true);
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects invalid boundaries, stale graphs and missing nodes, and labels working-tree associations", async () => {
    const { dir, repository, base, head } = await fixture();
    for (const file of [
      "../private",
      "/absolute",
      "a/../b",
      "a\\b",
      "bad\0path",
    ])
      await expect(repository.getCommitsForPath(file)).rejects.toThrow();
    for (const limit of [0, 101, 1.5])
      await expect(
        repository.getCommitsForPath(modal, { limit }),
      ).rejects.toThrow();
    await expect(repository.getCommitMessage("--help")).rejects.toThrow(
      "Git revision",
    );
    await expect(repository.getDiff(null, head)).rejects.toThrow("root commit");
    await expect(
      repository.getBlame(modal, { startLine: 100 }),
    ).rejects.toThrow("file length");
    const source = (await scanNextRepository(dir)).graph;
    await expect(
      enrichNodeHistory(repository, source, "missing"),
    ).rejects.toThrow("Unknown graph node");
    await expect(
      enrichNodeHistory(repository, source, "repository:."),
    ).rejects.toThrow("source-file provenance");
    const snapshot = source.toJSON();
    const repo = snapshot.nodes.find((node) => node.type === "Repository");
    if (!repo?.data) throw new Error("Missing fixture repository node");
    repo.data.commit = base;
    await expect(
      enrichNodeHistory(repository, ProductGraph.fromJSON(snapshot), nodeId),
    ).rejects.toThrow("snapshot differ");
    await put(dir, modal, initial.replace("Create</", "Unsaved</"));
    await expect(enrichNodeHistory(repository, source, nodeId)).rejects.toThrow(
      "snapshot differ",
    );
    const dirty = await enrichNodeHistory(
      repository,
      (await scanNextRepository(dir)).graph,
      nodeId,
    );
    expect(dirty.report.diagnostics).toContainEqual(
      expect.objectContaining({ code: "dirty-working-tree" }),
    );
  });
});
