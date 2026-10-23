import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { analyzeCommitRange, type GraphDelta } from "@pathcompiler/graph-delta";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import {
  type ApprovedWorkflow,
  approveCandidate,
} from "@pathcompiler/workflow-review";
import { validateWorkflow } from "@pathcompiler/workflow-validator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzeWorkflowImpact,
  WorkflowImpactReportSchema,
} from "../src/index.js";

const exec = promisify(execFile);
const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo", import.meta.url),
);
let repository: string;
let approved: ApprovedWorkflow[];
let delta: GraphDelta;
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
async function edit(file: string, from: string, to: string) {
  const target = path.join(repository, file);
  const content = await readFile(target, "utf8");
  if (!content.includes(from)) throw new Error(`Missing ${from} in ${file}`);
  await writeFile(target, content.replace(from, to));
}

beforeAll(async () => {
  repository = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-impact-"));
  const tracked = (
    await exec("git", ["-C", fixture, "ls-files", "-z", "--", "."])
  ).stdout
    .split("\0")
    .filter(Boolean);
  for (const file of tracked) {
    await mkdir(path.dirname(path.join(repository, file)), { recursive: true });
    await cp(path.join(fixture, file), path.join(repository, file));
  }
  await git("init", "--quiet");
  await git("add", ".");
  await git("commit", "--quiet", "-m", "base");
  const base = await git("rev-parse", "HEAD");
  const project = await readSourceProject(repository);
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  approved = discoverWorkflows(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).report.candidates.map((candidate) =>
    approveCandidate(candidate, {
      approvedBy: "Test Reviewer",
      approvedAt: "2026-10-22T10:00:00.000Z",
      validation: validateWorkflow(candidate.workflow, {
        graph: mined.graph,
        traces: mined.report,
      }),
      repository: project.repository,
    }),
  );
  await edit(
    "components/clients.tsx",
    "            Create Client\n",
    "            Add Client\n",
  );
  await edit(
    "components/plans.tsx",
    'data-pathcompiler="plans.change_structure"',
    'data-pathcompiler="plans.restructure"',
  );
  await git("commit", "--quiet", "-am", "head");
  delta = await analyzeCommitRange({
    directory: repository,
    base,
    head: "HEAD",
  });
}, 60_000);
afterAll(async () => {
  await rm(repository, { recursive: true, force: true });
});
const impactOf = (
  id: string,
  input: GraphDelta = delta,
  records = approved,
) => {
  const found = analyzeWorkflowImpact(input, records).impacts.find(
    (item) => item.workflowId === id,
  );
  if (!found) throw new Error(`No impact for ${id}`);
  return found;
};
function client(): ApprovedWorkflow {
  const found = approved.find((item) => item.workflow.id === "clients.create");
  if (!found) throw new Error("Missing clients.create");
  return found;
}
function synthetic(patch: Partial<GraphDelta>): GraphDelta {
  const empty = { added: [], removed: [], changed: [] };
  return {
    schemaVersion: 1,
    base: { commit: client().workflow.repository.commit },
    head: { commit: "e".repeat(40) },
    addedNodes: [],
    removedNodes: [],
    changedNodes: [],
    addedEdges: [],
    removedEdges: [],
    changedEdges: [],
    summary: {
      files: [],
      symbols: empty,
      routes: empty,
      targets: empty,
      apis: empty,
    },
    ...patch,
  };
}

describe("workflow impact analysis", () => {
  it("rates a removed semantic target high and a copy-only edit low on real commits", () => {
    const report = analyzeWorkflowImpact(delta, approved);
    expect(WorkflowImpactReportSchema.parse(report)).toEqual(report);
    expect(report.method).toBe("deterministic-rules");
    expect(report.impacts[0]).toMatchObject({
      workflowId: "plans.change_structure",
      severity: "high",
      affectedSteps: ["step.1"],
    });
    expect(report.impacts[0]?.reasons[0]).toMatchObject({
      code: "target-removed",
      nodeId: "ui:plans.change_structure",
    });
    const create = impactOf("clients.create");
    expect(create.severity).toBe("low");
    expect(create.reasons.map((item) => item.code)).toContain("copy-changed");
    expect(create.affectedSteps).toContain("step.1");
    expect(create.reasons.map((item) => item.code)).not.toContain(
      "source-file-changed",
    );
    // plans.tsx changed, but none of this workflow's elements did.
    expect(impactOf("plans.create")).toMatchObject({
      severity: "low",
      reasons: [{ code: "source-file-changed", stepIds: [] }],
      affectedSteps: [],
    });
    expect(analyzeWorkflowImpact(delta, [...approved].reverse())).toEqual(
      report,
    );
  });

  it("rates removed APIs, removed or changed routes and access changes high", () => {
    const api = { id: "api:POST:/api/clients", type: "APIEndpoint" as const };
    const route = { id: "route:/clients", type: "Route" as const };
    expect(
      impactOf("clients.create", synthetic({ removedNodes: [api] })),
    ).toMatchObject({
      severity: "high",
      reasons: [{ code: "api-removed" }],
    });
    expect(
      impactOf("clients.create", synthetic({ removedNodes: [route] }))
        .reasons[0]?.code,
    ).toBe("route-removed");
    const routeChange = {
      id: route.id,
      type: route.type,
      kind: "content" as const,
      fields: ["path"],
      before: { ...route, data: { path: "/clients" } },
      after: { ...route, data: { path: "/customers" } },
    };
    expect(
      impactOf("clients.create", synthetic({ changedNodes: [routeChange] }))
        .reasons[0]?.code,
    ).toBe("route-changed");
    const guard = {
      id: "edge:guard",
      type: "REQUIRES_PERMISSION" as const,
      source: "component:components/clients.tsx#Clients",
      target: "permission:role:admin",
    };
    expect(
      impactOf("clients.create", synthetic({ addedEdges: [guard] })),
    ).toMatchObject({
      severity: "high",
      reasons: [{ code: "permission-changed" }],
    });
  });

  it("rates moved targets low, behavior changes medium and history gaps medium", () => {
    const node = (
      data: NonNullable<GraphDelta["removedNodes"][number]["data"]>,
    ) => ({
      id: "ui:clients.create",
      type: "UIAction" as const,
      data,
    });
    const target = {
      semanticId: "clients.create",
      name: "Create Client",
      source: "annotation",
    };
    const moved = {
      id: "ui:clients.create",
      type: "UIAction" as const,
      kind: "location" as const,
      fields: ["evidence"],
      before: node({ target }),
      after: node({ target }),
    };
    expect(
      impactOf("clients.create", synthetic({ changedNodes: [moved] })),
    ).toMatchObject({
      severity: "low",
      reasons: [{ code: "target-moved" }],
      affectedSteps: ["step.1"],
    });
    const behavior = {
      ...moved,
      kind: "content" as const,
      fields: ["kind"],
      before: node({ target, kind: "click" }),
      after: node({ target, kind: "observe" }),
    };
    expect(
      impactOf("clients.create", synthetic({ changedNodes: [behavior] }))
        .reasons[0]?.code,
    ).toBe("target-changed");
    const stale = synthetic({ base: { commit: "d".repeat(40) } });
    expect(impactOf("clients.create", stale)).toMatchObject({
      severity: "medium",
      reasons: [{ code: "baseline-mismatch" }],
    });
    expect(impactOf("clients.create", synthetic({}))).toEqual({
      workflowId: "clients.create",
      severity: "none",
      reasons: [],
      affectedSteps: [],
    });
  });

  it("adds semantic reasoning findings to the matching workflow", () => {
    const record = client();
    const variant = {
      ...record,
      workflow: { ...record.workflow, id: "clients.create--0123456789ab" },
    };
    const report = analyzeWorkflowImpact(synthetic({}), [record, variant], {
      semantic: [
        {
          capabilityId: "clients.create",
          code: "reachability-removed",
          message: "clients.created is no longer reachable for role=editor.",
        },
        {
          capabilityId: "plans.create",
          code: "reachability-added",
          message: "plans.created is newly reachable for role=owner.",
        },
      ],
    });
    expect(report.method).toBe("deterministic-rules+bounded-smt");
    for (const impact of report.impacts) {
      expect(impact.severity).toBe("high");
      expect(impact.reasons).toContainEqual({
        code: "reachability-removed",
        severity: "high",
        message: "clients.created is no longer reachable for role=editor.",
        stepIds: [],
      });
      expect(impact.reasons.map((item) => item.code)).not.toContain(
        "reachability-added",
      );
    }
    expect(analyzeWorkflowImpact(synthetic({}), [record]).method).toBe(
      "deterministic-rules",
    );
  });

  it("validates its inputs", () => {
    expect(() => analyzeWorkflowImpact({}, approved)).toThrow();
    expect(() =>
      analyzeWorkflowImpact(delta, [
        {
          ...client(),
          workflow: { ...client().workflow, status: "candidate" },
        },
      ]),
    ).toThrow();
  });
});
