import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { analyzeCommitRangeDetailed } from "@pathcompiler/graph-delta";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzeSemanticChange,
  collapseContexts,
  type SemanticChangeReport,
  summarizeSemanticChange,
} from "../src/index.js";

const exec = promisify(execFile);
const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo", import.meta.url),
);
let repository: string;
let app: string;
let solver: SolverProvider;
const commits: Record<string, string> = {};
const git = async (...args: string[]) =>
  (
    await exec("git", ["-C", repository, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.test",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.test",
      },
    })
  ).stdout.trim();
async function commit(name: string, file: string, from: string, to: string) {
  const target = path.join(app, file);
  const content = await readFile(target, "utf8");
  if (!content.includes(from)) throw new Error(`Missing ${from} in ${file}`);
  await writeFile(target, content.replace(from, to));
  await git("commit", "--quiet", "-am", name);
  commits[name] = await git("rev-parse", "HEAD");
}
async function semantic(base: string, head: string) {
  return analyzeSemanticChange(
    await analyzeCommitRangeDetailed({
      directory: app,
      base: commits[base] as string,
      head: commits[head] as string,
    }),
    solver,
  );
}

beforeAll(async () => {
  solver = await createZ3SolverProvider();
  repository = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-semantic-"));
  app = path.join(repository, "apps/demo");
  await mkdir(app, { recursive: true });
  const tracked = (
    await exec("git", ["-C", fixture, "ls-files", "-z", "--", "."])
  ).stdout
    .split("\0")
    .filter(Boolean);
  for (const file of tracked) {
    await mkdir(path.dirname(path.join(app, file)), { recursive: true });
    await cp(path.join(fixture, file), path.join(app, file));
  }
  await git("init", "--quiet", "--initial-branch=main");
  await git("add", ".");
  await git("commit", "--quiet", "-m", "base");
  commits.base = await git("rev-parse", "HEAD");
  await commit(
    "copy",
    "components/clients.tsx",
    "            Create Client\n",
    "            Add Client\n",
  );
  await commit(
    "owner",
    "lib/session.ts",
    'session.role !== "editor"',
    'session.role !== "owner"',
  );
}, 120_000);
afterAll(async () => {
  await solver?.close();
  if (repository) await rm(repository, { recursive: true, force: true });
});

describe("semantic change between commits", () => {
  let report: SemanticChangeReport;
  beforeAll(async () => {
    report = await semantic("copy", "owner");
  }, 300_000);

  it("reports lost reachability for editors, traced to the permission rule and commit", () => {
    expect(report.commitRange).toEqual({
      base: commits.copy,
      head: commits.owner,
    });
    const lost = report.removedReachability.filter(
      (item) => item.goal === "clients.created",
    );
    expect(lost.map((item) => item.context.role)).toEqual(["editor", "editor"]);
    for (const change of lost) {
      expect(change.after).toBe("unreachable");
      expect(change.rootCause?.map((item) => item.description)).toEqual([
        // Admins keep access; only the editor half of the guard was renamed.
        "clients.create.submit requires role = admin or role = owner",
      ]);
      expect(change.rootCause?.[0]?.evidence.map((ref) => ref.id)).toContain(
        "symbol:lib/session.ts#requireEditor",
      );
      expect(change.changedAt).toEqual(["lib/session.ts"]);
    }
    expect(report.affectedWorkflows).toContainEqual({
      capabilityId: "clients.create",
      goal: "clients.created",
      code: "reachability-removed",
      message:
        "clients.created is no longer reachable for role=editor: clients.create.submit requires role = admin or role = owner (changed in lib/session.ts).",
    });
  });

  it("reports the reachability owners gained and covers every guarded capability", () => {
    expect(report.affectedWorkflows).toContainEqual(
      expect.objectContaining({
        capabilityId: "plans.change_structure",
        code: "reachability-added",
        message:
          "plans.structure_changed is newly reachable for plan_structure_enabled=true, role=owner.",
      }),
    );
    const removed = new Set(
      report.affectedWorkflows
        .filter((item) => item.code === "reachability-removed")
        .map((item) => item.capabilityId),
    );
    // True-change recall: every capability whose API calls requireEditor.
    expect([...removed].sort()).toEqual([
      "clients.create",
      "clients.deactivate",
      "clients.edit",
      "plans.change_structure",
      "plans.create",
    ]);
    expect(report.modelDiff.variables.changed).toContain("role");
    expect(report.uncertainty).toEqual([]);
    expect(summarizeSemanticChange(report)).toEqual(
      expect.arrayContaining([
        "REMOVED REACHABILITY",
        "NEW REACHABILITY",
        "WORKFLOW IMPACT",
        "5 capabilities require review: clients.create, clients.deactivate, clients.edit, plans.change_structure, plans.create",
      ]),
    );
  });

  it("reports nothing for a copy-only change (no false positives)", async () => {
    const copy = await semantic("base", "copy");
    expect(copy.removedReachability).toEqual([]);
    expect(copy.newReachability).toEqual([]);
    expect(copy.changedApplicability).toEqual([]);
    expect(copy.affectedWorkflows).toEqual([]);
    expect(summarizeSemanticChange(copy)).toContain(
      "No capability changed reachability.",
    );
  }, 300_000);
});

describe("context collapsing", () => {
  it("drops variables the change covers completely", () => {
    const universe = ["a", "b"].flatMap((role) =>
      [false, true].map((flag) => ({ role, flag })),
    );
    expect(
      collapseContexts(
        [
          { role: "a", flag: false },
          { role: "a", flag: true },
        ],
        universe,
      ),
    ).toEqual([{ role: "a" }]);
    expect(collapseContexts([{ role: "a", flag: true }], universe)).toEqual([
      { role: "a", flag: true },
    ]);
    expect(collapseContexts(universe, universe)).toEqual([{}]);
  });
});
