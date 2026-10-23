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
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import {
  type ApprovedWorkflow,
  approveCandidate,
  rejectCandidate,
} from "@pathcompiler/workflow-review";
import { validateWorkflow } from "@pathcompiler/workflow-validator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectNewWorkflows, NewWorkflowReportSchema } from "../src/index.js";

const exec = promisify(execFile);
const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo", import.meta.url),
);
let repository: string;
let approved: ApprovedWorkflow[];
let base: string;
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
const capabilitiesOf = (analysis: CommitAnalysis) =>
  discoverCapabilities(analysis.mined.graph);
async function detect(
  head: string,
  subjects: string[],
  rejected: unknown[] = [],
) {
  const range = await analyzeCommitRangeDetailed({
    directory: repository,
    base,
    head,
  });
  const headCapabilities = capabilitiesOf(range.head);
  return detectNewWorkflows({
    delta: range.delta,
    baseCapabilities: capabilitiesOf(range.base).report.capabilities,
    headCapabilities: headCapabilities.report.capabilities,
    candidates: discoverWorkflows(
      headCapabilities.graph,
      headCapabilities.report,
      range.head.mined.report,
    ).report.candidates,
    approved,
    rejected,
    commitSubjects: subjects,
  });
}

beforeAll(async () => {
  repository = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-detect-"));
  const tracked = (
    await exec("git", ["-C", fixture, "ls-files", "-z", "--", "."])
  ).stdout
    .split("\0")
    .filter(Boolean);
  for (const file of tracked) {
    await mkdir(path.dirname(path.join(repository, file)), { recursive: true });
    await cp(path.join(fixture, file), path.join(repository, file));
  }
  await git("init", "--quiet", "--initial-branch=main");
  await git("add", ".");
  await git("commit", "--quiet", "-m", "base");
  base = await git("rev-parse", "HEAD");
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

  // Branch "weak": only a new button, no API, test or route.
  await git("checkout", "--quiet", "-b", "weak");
  await edit(
    "components/clients.tsx",
    "            Create Client\n          </button>\n        )}",
    '            Create Client\n          </button>\n        )}\n        {canEdit && (\n          <button data-pathcompiler="clients.archive" type="button">\n            Archive Clients\n          </button>\n        )}',
  );
  await git("commit", "--quiet", "-am", "Tweak toolbar");

  // Branch "feature": a complete Duplicate Plan feature.
  await git("checkout", "--quiet", "main");
  await git("checkout", "--quiet", "-b", "feature");
  await edit(
    "components/plans.tsx",
    '  return (\n    <>\n      <div className="page-heading">',
    '  async function duplicate(plan: Plan) {\n    setBusy(true);\n    setError("");\n    try {\n      await save(`/api/plans/$' +
      '{plan.id}/duplicate`, "POST", {});\n      setNotice("Plan duplicated");\n      router.refresh();\n    } catch (cause) {\n      setError(errorMessage(cause));\n    } finally {\n      setBusy(false);\n    }\n  }\n\n  return (\n    <>\n      <div className="page-heading">',
  );
  await edit(
    "components/plans.tsx",
    "                  Change Plan Structure\n                </button>\n              )}",
    '                  Change Plan Structure\n                </button>\n              )}\n              {canEdit && (\n                <button\n                  data-pathcompiler="plans.duplicate"\n                  type="button"\n                  onClick={() => duplicate(plan)}\n                >\n                  Duplicate Plan\n                </button>\n              )}',
  );
  await mkdir(path.join(repository, "app/api/plans/[id]/duplicate"), {
    recursive: true,
  });
  await writeFile(
    path.join(repository, "app/api/plans/[id]/duplicate/route.ts"),
    'import { handleRequest, readSession, requireEditor, writeSession } from "../../../../../lib/session";\n\nexport async function POST() {\n  return handleRequest(async () => {\n    const session = await readSession();\n    requireEditor(session);\n    return writeSession(session, session.plans[0] ?? null, 201);\n  });\n}\n',
  );
  await writeFile(
    path.join(repository, "tests/workflows.spec.ts"),
    `${await readFile(path.join(repository, "tests/workflows.spec.ts"), "utf8")}
test("Duplicate Plan", async ({ page }) => {
  await page.goto("/plans");
  await page.locator('[data-pathcompiler="plans.duplicate"]').click();
  await expect(page.locator('[data-pathcompiler="plans.feedback"]')).toHaveText(
    "Plan duplicated",
  );
});
`,
  );
  await git("add", ".");
  await git("commit", "--quiet", "-m", "Duplicate a plan from its row");
}, 60_000);
afterAll(async () => {
  await rm(repository, { recursive: true, force: true });
});

describe("new workflow detection", () => {
  it("proposes a test-backed candidate for a new multi-signal capability", async () => {
    const report = await detect("feature", ["Duplicate a plan from its row"]);
    expect(NewWorkflowReportSchema.parse(report)).toEqual(report);
    expect(report.detections.map((item) => item.capabilityId)).toEqual([
      "plans.duplicate",
    ]);
    const [found] = report.detections;
    expect(found).toMatchObject({
      status: "new-candidate",
      confidenceMeaning: "rule-strength-not-probability",
      candidate: { workflow: { id: "plans.duplicate", status: "candidate" } },
    });
    expect(found?.signals.map((item) => item.signal).sort()).toEqual([
      "commit-title",
      "new-playwright-flow",
      "new-user-action",
      "new-write-api",
    ]);
    expect(found?.confidence).toBe(0.85);
  }, 60_000);

  it("never proposes from a single signal and skips existing or reviewed capabilities", async () => {
    const weak = await detect("weak", ["Tweak toolbar"]);
    expect(weak.detections).toEqual([
      expect.objectContaining({
        capabilityId: "clients.archive",
        status: "insufficient-evidence",
        candidate: null,
        signals: [expect.objectContaining({ signal: "new-user-action" })],
      }),
    ]);
    const candidate = (await detect("feature", [])).detections[0]?.candidate;
    if (!candidate) throw new Error("Expected candidate");
    const rejected = rejectCandidate(candidate, {
      rejectedBy: "Ana",
      rejectedAt: "2026-10-22T12:00:00.000Z",
    });
    expect((await detect("feature", [], [rejected])).detections).toEqual([]);
  }, 60_000);
});
