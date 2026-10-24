import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import {
  analyzeCommitRangeDetailed,
  type CommitAnalysis,
} from "@pathcompiler/graph-delta";
import { analyzeWorkflowImpact } from "@pathcompiler/impact-analysis";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import type { WorkflowV1 } from "@pathcompiler/workflow-ir";
import {
  type ApprovedWorkflow,
  approveCandidate,
} from "@pathcompiler/workflow-review";
import { validateWorkflow } from "@pathcompiler/workflow-validator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptDeprecation,
  acceptProposal,
  decideProposal,
  generateProposals,
  type Proposal,
  ProposalError,
  parseProposalYaml,
  proposalFileName,
  serializeProposalYaml,
  type WorkflowUpdateProposal,
} from "../src/index.js";

const exec = promisify(execFile);
const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo", import.meta.url),
);
let repository: string;
let approved: ApprovedWorkflow[];
let head: CommitAnalysis;
let proposals: Proposal[];
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
async function replaceAll(file: string, from: string, to: string) {
  const target = path.join(repository, file);
  const content = await readFile(target, "utf8");
  if (!content.includes(from)) throw new Error(`Missing ${from} in ${file}`);
  await writeFile(target, content.replaceAll(from, to));
}
function analyze(project: Awaited<ReturnType<typeof readSourceProject>>) {
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  return {
    mined,
    candidates: discoverWorkflows(
      capabilities.graph,
      capabilities.report,
      mined.report,
    ).report.candidates,
  };
}
const validator = (analysis: CommitAnalysis) => (workflow: WorkflowV1) =>
  validateWorkflow(workflow, {
    graph: analysis.mined.graph,
    traces: analysis.mined.report,
  });

beforeAll(async () => {
  repository = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-proposal-"));
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
  const baseline = analyze(project);
  approved = baseline.candidates.map((candidate) =>
    approveCandidate(candidate, {
      approvedBy: "Test Reviewer",
      approvedAt: "2026-10-22T10:00:00.000Z",
      validation: validateWorkflow(candidate.workflow, {
        graph: baseline.mined.graph,
        traces: baseline.mined.report,
      }),
      repository: project.repository,
    }),
  );
  for (const file of ["components/plans.tsx", "tests/workflows.spec.ts"])
    await replaceAll(file, '"plans.change_structure"', '"plans.restructure"');
  await git(
    "commit",
    "--quiet",
    "-am",
    "Rename plan structure action\n\nDetails.",
  );
  const range = await analyzeCommitRangeDetailed({
    directory: repository,
    base,
    head: "HEAD",
  });
  head = range.head;
  const capabilities = discoverCapabilities(head.mined.graph);
  proposals = generateProposals({
    impact: analyzeWorkflowImpact(range.delta, approved),
    approved,
    candidates: discoverWorkflows(
      capabilities.graph,
      capabilities.report,
      head.mined.report,
    ).report.candidates,
    validate: validator(head),
    changedFiles: range.delta.summary.files,
    commits: [
      {
        sha: head.commit,
        authorDate: "2026-10-22T11:00:00.000Z",
        message: "Rename plan structure action\n\nDetails.",
      },
    ],
  });
}, 90_000);
afterAll(async () => {
  await rm(repository, { recursive: true, force: true });
});
function proposal(): WorkflowUpdateProposal {
  const found = proposals.find(
    (item) => item.workflowId === "plans.change_structure",
  );
  if (found?.kind !== "workflow-update-proposal")
    throw new Error("Missing update proposal");
  return structuredClone(found);
}
function proposalError(run: () => unknown): ProposalError {
  try {
    run();
  } catch (error) {
    if (error instanceof ProposalError) return error;
    throw error;
  }
  throw new Error("Expected a ProposalError");
}
const decision = (overrides: Record<string, unknown> = {}) => ({
  decidedBy: "Ana",
  decidedAt: "2026-10-22T12:00:00.000Z",
  validation: validator(head)(proposal().proposed as WorkflowV1),
  repository: { commit: head.commit, dirty: false },
  current: approved.find(
    (item) => item.workflow.id === "plans.change_structure",
  ),
  ...overrides,
});

describe("workflow update proposals", () => {
  it("proposes a validated head-commit update only for medium/high impact", () => {
    expect(proposals.map((item) => item.workflowId)).toEqual([
      "plans.change_structure",
    ]);
    const item = proposal();
    expect(item).toMatchObject({
      impact: { severity: "high", affectedSteps: ["step.1"] },
      head: { commit: head.commit },
      validation: { valid: true, errors: 0 },
      review: { status: "pending" },
      evidence: {
        commits: [{ subject: "Rename plan structure action" }],
      },
    });
    expect(["same-id", "same-intent", "step-overlap"]).toContain(
      item.match.method,
    );
    expect(item.proposed?.id).toBe("plans.change_structure");
    expect(item.proposed?.status).toBe("candidate");
    expect(item.proposed?.steps[0]?.target).toBe("plans.restructure");
    expect(item.evidence.changedFiles.map((file) => file.path)).toEqual([
      "components/plans.tsx",
      "tests/workflows.spec.ts",
    ]);
    expect(proposalFileName(item.workflowId, item.head.commit)).toBe(
      `plans.change_structure.${head.commit}.yaml`,
    );
  });

  it("includes a human-readable semantic diff", () => {
    const { diff } = proposal();
    expect(diff).toMatch(
      /^--- approved plans\.change_structure @ [a-f0-9]{12}\n\+\+\+ proposed/,
    );
    expect(diff).toContain(
      "-     target: plans.change_structure\n+     target: plans.restructure",
    );
    expect(diff).toContain("  …");
    expect(diff).not.toContain("repositoryCommit");
  });

  it("accepts into a new approved record bound to the head commit", () => {
    const { approved: record, proposal: decided } = acceptProposal(
      proposal(),
      decision(),
    );
    expect(record.approval).toEqual({
      approvedBy: "Ana",
      approvedAt: "2026-10-22T12:00:00.000Z",
      approvedCommit: head.commit,
      version: 2,
    });
    const current = decision().current as (typeof approved)[number];
    const second = acceptProposal(proposal(), {
      ...decision(),
      current: { ...current, approval: { ...current.approval, version: 6 } },
    });
    expect(second.approved.approval.version).toBe(7);
    const stale = structuredClone(current);
    stale.workflow.title = "Changed meanwhile";
    expect(
      proposalError(() =>
        acceptProposal(proposal(), decision({ current: stale })),
      ).code,
    ).toBe("approved-changed");
    expect(record.workflow).toMatchObject({
      id: "plans.change_structure",
      status: "approved",
    });
    expect(decided.review).toMatchObject({
      status: "accepted",
      mode: "accept",
    });
    expect(proposalError(() => acceptProposal(decided, decision())).code).toBe(
      "not-pending",
    );
  });

  it("records hand edits as edit mode and refuses unsafe acceptance", () => {
    const edited = proposal();
    const first = edited.proposed?.steps[0];
    if (!first) throw new Error("Missing step");
    first.instruction = { text: "Open the structure editor" };
    expect(
      acceptProposal(edited, {
        ...decision(),
        validation: validator(head)(edited.proposed as WorkflowV1),
      }).proposal.review,
    ).toMatchObject({ mode: "edit" });
    expect(
      proposalError(() =>
        acceptProposal(
          proposal(),
          decision({ repository: { commit: "a".repeat(40), dirty: false } }),
        ),
      ).code,
    ).toBe("stale-repository");
    expect(
      proposalError(() =>
        acceptProposal(
          proposal(),
          decision({ repository: { commit: head.commit, dirty: true } }),
        ),
      ).code,
    ).toBe("dirty-repository");
    const invalid = structuredClone(decision().validation);
    invalid.valid = false;
    invalid.errors.push({ code: "x", message: "broken" });
    const structure = invalid.checks.find(
      (check) => check.name === "structure",
    );
    if (structure) structure.status = "failed";
    expect(
      proposalError(() =>
        acceptProposal(proposal(), decision({ validation: invalid })),
      ).code,
    ).toBe("validation-failed");
    const empty = { ...proposal(), proposed: null, generatedRevision: null };
    expect(proposalError(() => acceptProposal(empty, decision())).code).toBe(
      "no-proposed-workflow",
    );
    const renamed = proposal();
    if (renamed.proposed) renamed.proposed.id = "plans.other";
    expect(() => acceptProposal(renamed, decision())).toThrow(
      "approved workflow ID",
    );
  });

  it("rejects or ignores without producing an approved record and round-trips YAML", () => {
    const rejected = decideProposal(proposal(), "rejected", {
      decidedBy: "Ana",
      decidedAt: "2026-10-22T12:00:00.000Z",
      note: "Rename is temporary",
    });
    expect(rejected.review).toMatchObject({
      status: "rejected",
      note: "Rename is temporary",
    });
    expect(
      decideProposal(proposal(), "ignored", {
        decidedBy: "Ana",
        decidedAt: "2026-10-22T12:00:00.000Z",
      }).review.status,
    ).toBe("ignored");
    expect(
      proposalError(() =>
        decideProposal(rejected, "ignored", {
          decidedBy: "Ana",
          decidedAt: "2026-10-22T12:00:00.000Z",
        }),
      ).code,
    ).toBe("not-pending");
    const yaml = serializeProposalYaml(proposal());
    expect(parseProposalYaml(yaml)).toEqual(proposal());
    expect(() => parseProposalYaml(`${yaml}\nkind: other\n`)).toThrow();
  });
});

describe("workflow deprecation proposals", () => {
  const headSha = "c".repeat(40);
  const record = () => {
    const found = approved.find(
      (item) => item.workflow.id === "clients.create",
    );
    if (!found) throw new Error("Missing approved clients.create");
    return structuredClone(found);
  };
  const impact = (
    code: "target-removed" | "api-changed",
    severity: "high" | "medium",
  ) => ({
    schemaVersion: 1 as const,
    base: { commit: record().approval.approvedCommit },
    head: { commit: headSha },
    method: "deterministic-rules" as const,
    impacts: [
      {
        workflowId: "clients.create",
        severity,
        reasons: [
          {
            code,
            severity,
            message: `Semantic target clients.create was removed.`,
            nodeId: "ui:clients.create",
            stepIds: ["step.1"],
          },
        ],
        affectedSteps: ["step.1"],
      },
    ],
  });
  const generate = (
    code: "target-removed" | "api-changed",
    severity: "high" | "medium",
  ) =>
    generateProposals({
      impact: impact(code, severity),
      approved: [record()],
      candidates: [],
      validate: () => {
        throw new Error("No candidate should be validated");
      },
      newCapabilities: [
        {
          id: "plans.duplicate",
          domain: "plans",
          entity: "plan",
          title: "Duplicate Plan",
        },
        {
          id: "clients.invite",
          domain: "clients",
          entity: "client",
          title: "Invite Client",
        },
      ],
    });
  const decided = { decidedBy: "Ana", decidedAt: "2026-10-22T12:00:00.000Z" };

  it("proposes deprecation when critical support is lost and nothing matches", () => {
    const [item] = generate("target-removed", "high");
    expect(item).toMatchObject({
      kind: "workflow-deprecation-proposal",
      workflowId: "clients.create",
      lostSupport: ["target-removed"],
      replacement: { capabilityId: "clients.invite", title: "Invite Client" },
      review: { status: "pending" },
    });
    if (item?.kind !== "workflow-deprecation-proposal")
      throw new Error("Expected deprecation");
    expect(item.summary).toContain("lost implementation support");
    expect(item.summary).toContain(
      "Possible replacement: Invite Client (clients.invite).",
    );
    expect(item.summary).toContain("never deleted automatically");
    expect(parseProposalYaml(serializeProposalYaml(item))).toEqual(item);
  });

  it("keeps medium-only losses as manual update proposals", () => {
    const [item] = generate("api-changed", "medium");
    expect(item).toMatchObject({
      kind: "workflow-update-proposal",
      proposed: null,
      match: { method: "none" },
    });
  });

  it("accepts into a deprecated record and guards against drift and wrong kinds", () => {
    const [item] = generate("target-removed", "high");
    const result = acceptDeprecation(item, record(), {
      ...decided,
      note: "Replaced by invites",
    });
    expect(result.deprecated).toMatchObject({
      kind: "deprecated-workflow",
      deprecation: {
        deprecatedBy: "Ana",
        deprecatedCommit: headSha,
        reasons: ["target-removed"],
        replacement: "clients.invite",
        note: "Replaced by invites",
      },
      workflow: { id: "clients.create", status: "deprecated" },
    });
    expect(result.proposal.review).toMatchObject({ status: "accepted" });
    const changed = record();
    changed.workflow.title = "Edited later";
    expect(
      proposalError(() => acceptDeprecation(item, changed, decided)).code,
    ).toBe("approved-changed");
    expect(
      proposalError(() => acceptDeprecation(proposal(), record(), decided))
        .code,
    ).toBe("wrong-kind");
    expect(proposalError(() => acceptProposal(item, decision())).code).toBe(
      "wrong-kind",
    );
    expect(decideProposal(item, "rejected", decided).review.status).toBe(
      "rejected",
    );
  });
});
