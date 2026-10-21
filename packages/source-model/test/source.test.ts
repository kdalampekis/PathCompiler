import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  RelativePathSchema,
  readSourceProject,
  SourceProjectSchema,
} from "../src/index.js";

const exec = promisify(execFile);
const directories: string[] = [];
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-source-"));
  directories.push(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("source ingestion", () => {
  it("validates normalized paths and rejects duplicate source identities", () => {
    for (const file of [
      "../outside.ts",
      "/absolute.ts",
      "a/../b.ts",
      "a\\b.ts",
      "C:/a.ts",
      "./a.ts",
    ])
      expect(RelativePathSchema.safeParse(file).success).toBe(false);
    expect(
      SourceProjectSchema.safeParse({
        files: [
          { path: "a.ts", content: "" },
          { path: "a.ts", content: "" },
        ],
        repository: { commit: null, dirty: null },
      }).success,
    ).toBe(false);
  });

  it("excludes generated, private, binary and symlinked inputs without executing configs", async () => {
    const root = await fixture({
      "app/page.tsx": "export default function Page() { return <main /> }",
      "next.config.ts": "throw new Error('must never execute');",
      "package.json": '{"name":"test"}',
      "node_modules/lib/index.js": "secret",
      ".env": "SECRET=value",
      ".hidden/private.ts": "secret",
      "dist/generated.js": "secret",
      "types.d.ts": "declare const ignored: string",
      "secret/private.ts": "secret",
      "binary.ts": "a\0b",
    });
    await symlink(path.join(root, "secret"), path.join(root, "linked"));
    const result = await readSourceProject(root, { exclude: ["secret"] });
    expect(result.files.map((file) => file.path)).toEqual([
      "app/page.tsx",
      "next.config.ts",
    ]);
    expect(result.repository).toEqual({ commit: null, dirty: null });
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "binary-source",
    );
    expect(result.configs["package.json"]).toBe('{"name":"test"}');
  });

  it("honors Git ignores and binds a subdirectory scan to HEAD and working-tree state", async () => {
    const root = await fixture({
      ".gitignore": "ignored/\n",
      "product/app/page.tsx": "export default () => <main />;",
      "product/ignored/private.ts": "secret",
      "outside.ts": "export const outside = true",
    });
    const git = (args: string[]) => exec("git", ["-C", root, ...args]);
    await git(["init", "-q"]);
    await git(["add", "."]);
    await git([
      "-c",
      "user.name=PathCompiler Test",
      "-c",
      "user.email=test@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "fixture",
    ]);
    const commit = (await git(["rev-parse", "HEAD"])).stdout.trim();
    const first = await readSourceProject(path.join(root, "product"));
    expect(first.files.map((file) => file.path)).toEqual(["app/page.tsx"]);
    expect(first.repository).toEqual({ commit, dirty: false });
    await writeFile(
      path.join(root, "product/new.ts"),
      "export const added = true",
    );
    expect(
      (await readSourceProject(path.join(root, "product"))).repository,
    ).toEqual({ commit, dirty: true });
  });
});
