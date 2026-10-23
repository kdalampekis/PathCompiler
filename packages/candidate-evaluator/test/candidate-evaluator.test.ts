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
  type EvaluationCriteria,
  evaluateCandidate,
  testRunFromPlaywrightJson,
} from "../src/index.js";

const exec = promisify(execFile);
const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo", import.meta.url),
);
let repository: string;
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
async function change(edits: [string, string, string][]) {
  for (const [file, from, to] of edits) {
    const target = path.join(repository, file);
    const content = await readFile(target, "utf8");
    if (!content.includes(from)) throw new Error(`Missing ${from} in ${file}`);
    await writeFile(target, content.replace(from, to));
  }
}
async function commit(name: string) {
  await git("commit", "--quiet", "-am", name);
  commits[name] = await git("rev-parse", "HEAD");
}
async function evaluate(
  base: string,
  head: string,
  input: Parameters<typeof evaluateCandidate>[2] = {},
) {
  return evaluateCandidate(
    await analyzeCommitRangeDetailed({
      directory: repository,
      base: commits[base] as string,
      head: commits[head] as string,
    }),
    solver,
    input,
  );
}
const COPY: [string, string, string] = [
  "components/clients.tsx",
  "            Create Client\n",
  "            Add Client\n",
];

beforeAll(async () => {
  solver = await createZ3SolverProvider();
  repository = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-candidate-"));
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
  commits.base = await git("rev-parse", "HEAD");
  await change([COPY]);
  await commit("copy");
  await change([
    ["lib/session.ts", 'session.role !== "editor"', 'session.role !== "owner"'],
  ]);
  await commit("owner");
  // The "UX improvement" that also drops a guard (reasoning spec §254).
  await git("checkout", "--quiet", "-b", "harness", commits.base as string);
  await change([
    COPY,
    ["app/api/clients/[id]/route.ts", "    requireEditor(session);\n", ""],
  ]);
  await commit("regression");
}, 120_000);
afterAll(async () => {
  await solver?.close();
  if (repository) await rm(repository, { recursive: true, force: true });
});

describe("candidate evaluation", () => {
  it("passes a human PR with no semantic effect and no criteria", async () => {
    const evaluation = await evaluate("base", "copy");
    expect(evaluation).toMatchObject({
      type: "candidate_evaluation",
      status: "pass",
      intendedChange: { declared: false, observed: [] },
      eligibleForExperiment: false,
      recommendedNextStep: "human_review",
      risks: [],
      warnings: [],
    });
    expect(evaluation.formalResults.checked).toBeGreaterThan(4);
    expect(evaluation.formalResults.violated).toBe(0);
    expect(evaluation.evidenceGaps).toContain(
      "Browser verification was not run (phase I4).",
    );
  }, 120_000);

  it("asks for review when a human PR changes reachability without declared intent", async () => {
    const evaluation = await evaluate("copy", "owner");
    expect(evaluation.status).toBe("pass_with_warnings");
    expect(evaluation.recommendedNextStep).toBe("human_review");
    expect(evaluation.warnings.map((item) => item.code)).toEqual([
      "semantic-change-review",
    ]);
    // One entry per goal and context: 9 lost for editors and 9 gained for owners.
    expect(evaluation.intendedChange.observed).toHaveLength(18);
  }, 120_000);

  it("passes and is eligible for an experiment when exactly the intended change happens", async () => {
    const goals = [
      "clients.created",
      "clients.deactivated",
      "clients.edited",
      "plans.created",
      "plans.structure_changed",
    ];
    const criteria: EvaluationCriteria = {
      recommendationId: "rec_owner_only",
      expectedChanges: goals.flatMap((goal) => [
        {
          goal,
          change: "reachability-removed" as const,
          context: { role: "editor" },
        },
        {
          goal,
          change: "reachability-added" as const,
          context: { role: "owner" },
        },
      ]),
    };
    const evaluation = await evaluate("copy", "owner", { criteria });
    expect(evaluation).toMatchObject({
      status: "pass",
      recommendationId: "rec_owner_only",
      eligibleForExperiment: true,
      recommendedNextStep: "experiment",
    });
    expect(evaluation.intendedChange.expected.every((item) => item.met)).toBe(
      true,
    );
    expect(
      evaluation.intendedChange.observed.every((item) => item.expected),
    ).toBe(true);
  }, 120_000);

  it("fails a harness candidate that claims success but silently drops a guard", async () => {
    const criteria: EvaluationCriteria = {
      recommendationId: "rec_rename_create_button",
      expectedChanges: [],
      protectedProperties: [
        {
          kind: "never",
          id: "security.viewer_never_deactivates_client",
          description: "A viewer can never deactivate a client",
          goal: "clients.deactivated",
          context: { role: "unlisted" },
        },
      ],
      mutation: { id: "mut_1", claimedOutcome: "success" },
    };
    const evaluation = await evaluate("base", "regression", { criteria });
    expect(evaluation).toMatchObject({
      status: "fail",
      eligibleForExperiment: false,
      recommendedNextStep: "reject",
      mutationId: "mut_1",
      mutationClaim: { claimedOutcome: "success", contradicted: true },
    });
    const codes = evaluation.risks.map((item) => item.code);
    expect(codes).toContain("unexpected-reachability-added");
    expect(codes).toContain("protected-property-violated");
    expect(evaluation.risks).toContainEqual({
      code: "unexpected-reachability-added",
      message: expect.stringMatching(
        /^Unexpected: clients\.deactivated became reachable for .*role=unlisted/,
      ),
    });
    const property = evaluation.formalResults.results.find(
      (item) => item.id === "security.viewer_never_deactivates_client",
    );
    expect(property).toMatchObject({
      protected: true,
      base: "holds",
      candidate: "violated",
    });
    expect(property?.counterexample?.actions.at(-1)?.actionId).toBe(
      "clients.deactivate.confirm",
    );
    expect(evaluation.warnings.map((item) => item.code)).toContain(
      "mutation-claim-contradicted",
    );
  }, 120_000);

  it("ingests test results and fails on failures in affected capabilities", async () => {
    const name =
      "Create, Edit and Deactivate Client with validation and modal cancellation";
    const evaluation = await evaluate("base", "copy", {
      tests: testRunFromPlaywrightJson({
        suites: [
          {
            title: "workflows.spec.ts",
            specs: [
              { title: name, tests: [{ status: "unexpected" }] },
              {
                title: "viewer permissions are enforced in both UI and API",
                tests: [{ status: "expected" }],
              },
            ],
          },
        ],
      }),
    });
    expect(evaluation.status).toBe("fail");
    expect(evaluation.testResults).toMatchObject({
      executed: true,
      passed: 1,
      failed: 1,
    });
    expect(evaluation.testResults.failedTests[0]?.capabilities).toContain(
      "clients.create",
    );
    expect(evaluation.recommendedNextStep).toBe("revise_candidate");
  }, 120_000);
});

describe("Playwright result import", () => {
  it("joins describe titles like the miner and maps statuses", () => {
    expect(
      testRunFromPlaywrightJson({
        suites: [
          {
            title: "a.spec.ts",
            specs: [{ title: "top", tests: [{ status: "flaky" }] }],
            suites: [
              {
                title: "Clients",
                specs: [{ title: "skip me", tests: [{ status: "skipped" }] }],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      tests: [
        { name: "top", status: "passed" },
        { name: "Clients › skip me", status: "skipped" },
      ],
    });
  });
});
