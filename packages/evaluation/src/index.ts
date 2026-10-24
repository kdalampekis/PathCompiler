import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import {
  CapabilityExpectationsSchema,
  discoverCapabilities,
  evaluateCapabilities,
} from "@pathcompiler/capability-engine";
import { analyzeCommitRange } from "@pathcompiler/graph-delta";
import { analyzeWorkflowImpact } from "@pathcompiler/impact-analysis";
import {
  discoverWorkflowsByReasoning,
  type ReasoningDiscoveryOptions,
} from "@pathcompiler/reasoning-discovery";
import {
  createResolver,
  EvaluationDatasetSchema,
  evaluateResolver as runResolverEvaluation,
} from "@pathcompiler/resolver";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { compileWorkflows } from "@pathcompiler/workflow-compiler";
import {
  discoverWorkflows,
  type WorkflowCandidate,
} from "@pathcompiler/workflow-discovery";
import type { WorkflowV1 } from "@pathcompiler/workflow-ir";
import { approveCandidate } from "@pathcompiler/workflow-review";
import { validateWorkflow } from "@pathcompiler/workflow-validator";
import { parse } from "yaml";
import { z } from "zod";

/**
 * Evaluation harness (CODEX spec §54): reviewed ground truth per fixture and
 * one deterministic report per metric family. Never tune against these cases;
 * add cases instead.
 */
const step = z.strictObject({
  target: z.string().min(1),
  action: z.enum(["click", "input", "select", "navigate", "explain", "wait"]),
});
export const ExpectedWorkflowSchema = z.strictObject({
  id: z.string().min(1),
  entrypoint: z.string().min(1),
  steps: z.array(step).min(1),
  terminal: z.strictObject({
    type: z.string().min(1),
    target: z.string().min(1).optional(),
    text: z.string().optional(),
  }),
  /** Applicability: roles that can complete it and feature flags it needs on. */
  roles: z.array(z.string().min(1)).optional(),
  flags: z.array(z.string().min(1)).optional(),
});
export type ExpectedWorkflow = z.infer<typeof ExpectedWorkflowSchema>;
const severity = z.enum(["none", "low", "medium", "high"]);
export const ImpactCaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  description: z.string(),
  edits: z
    .array(
      z.strictObject({
        file: z.string().min(1),
        from: z.string().min(1),
        to: z.string(),
        all: z.boolean().optional(),
      }),
    )
    .min(1),
  expected: z.record(z.string(), severity),
});
export type ImpactCase = z.infer<typeof ImpactCaseSchema>;

export type GroundTruth = {
  directory: string;
  capabilities: string[];
  workflows: ExpectedWorkflow[];
  impactCases: ImpactCase[];
  queries: z.infer<typeof EvaluationDatasetSchema> | null;
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
async function optional(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function list(directory: string, extension: string) {
  try {
    return (await readdir(directory))
      .filter((name) => name.endsWith(extension))
      .sort(compare);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Loads `<directory>`: capabilities.json, workflows/*.yaml, impact-cases/*.json, queries.json. */
export async function loadGroundTruth(directory: string): Promise<GroundTruth> {
  const read = async <T>(file: string, schema: z.ZodType<T>, yaml = false) => {
    const text = await readFile(file, "utf8");
    const parsed = schema.safeParse(yaml ? parse(text) : JSON.parse(text));
    if (!parsed.success)
      throw new Error(
        `Invalid ground truth ${file}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      );
    return parsed.data;
  };
  const capabilities = await optional(
    path.join(directory, "capabilities.json"),
  );
  const queries = await optional(path.join(directory, "queries.json"));
  return {
    directory,
    capabilities: capabilities
      ? CapabilityExpectationsSchema.parse(JSON.parse(capabilities))
          .capabilityIds
      : [],
    workflows: await Promise.all(
      (await list(path.join(directory, "workflows"), ".yaml")).map((name) =>
        read(
          path.join(directory, "workflows", name),
          ExpectedWorkflowSchema,
          true,
        ),
      ),
    ),
    impactCases: await Promise.all(
      (await list(path.join(directory, "impact-cases"), ".json")).map((name) =>
        read(path.join(directory, "impact-cases", name), ImpactCaseSchema),
      ),
    ),
    queries: queries
      ? EvaluationDatasetSchema.parse(JSON.parse(queries))
      : null,
  };
}

const ratio = (part: number, whole: number) =>
  whole === 0 ? 1 : Math.round((part / whole) * 1000) / 1000;

export type FixtureAnalysis = {
  project: Awaited<ReturnType<typeof readSourceProject>>;
  mined: ReturnType<typeof minePlaywrightTests>;
  capabilities: ReturnType<typeof discoverCapabilities>;
};
export async function analyzeFixture(
  directory: string,
): Promise<FixtureAnalysis> {
  const project = await readSourceProject(directory);
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  return { project, mined, capabilities: discoverCapabilities(mined.graph) };
}

export type CapabilityEvaluationReport = {
  family: "capabilities";
  precision: number;
  recall: number;
  matched: string[];
  falsePositives: string[];
  falseNegatives: string[];
};
export function evaluateCapabilityExtraction(
  analysis: FixtureAnalysis,
  truth: GroundTruth,
): CapabilityEvaluationReport {
  const actual = analysis.capabilities.report.capabilities.map(
    (item) => item.id,
  );
  const result = evaluateCapabilities(actual, truth.capabilities);
  if (result.status !== "evaluated") throw new Error("Unreachable");
  return {
    family: "capabilities",
    precision: ratio(result.matchedIds.length, actual.length),
    recall: ratio(result.matchedIds.length, truth.capabilities.length),
    matched: result.matchedIds,
    falsePositives: result.falsePositiveIds,
    falseNegatives: result.falseNegativeIds,
  };
}

/** Any discovery strategy: the baseline, or an alternative to compare (spec §117). */
export type DiscoveryFunction = (
  analysis: FixtureAnalysis,
) => WorkflowV1[] | Promise<WorkflowV1[]>;
export type DiscoveryStrategy = { name: string; discover: DiscoveryFunction };
export const baselineDiscovery = (analysis: FixtureAnalysis): WorkflowV1[] =>
  candidates(analysis).map((candidate) => candidate.workflow);
export const baselineStrategy: DiscoveryStrategy = {
  name: "baseline",
  discover: baselineDiscovery,
};
/** Reasoning-assisted discovery (R-WI), with the caller's solver. */
export function reasoningStrategy(
  solver: SolverProvider,
  options: ReasoningDiscoveryOptions = {},
): DiscoveryStrategy {
  return {
    name: "reasoning",
    discover: async (analysis) =>
      (
        await discoverWorkflowsByReasoning(
          analysis.capabilities.graph,
          analysis.capabilities.report,
          analysis.mined.report,
          solver,
          options,
        )
      ).candidates.map((candidate) => candidate.workflow),
  };
}
const candidates = (analysis: FixtureAnalysis): WorkflowCandidate[] =>
  discoverWorkflows(
    analysis.capabilities.graph,
    analysis.capabilities.report,
    analysis.mined.report,
  ).report.candidates;
/**
 * Approves every discovered candidate, as a reviewer accepting all of them
 * would. The worktree is reported clean: these approvals are synthetic and
 * never written anywhere.
 */
export function approveAllCandidates(analysis: FixtureAnalysis) {
  return candidates(analysis).map((candidate) =>
    approveCandidate(candidate, {
      approvedBy: "Evaluation",
      approvedAt: "2026-01-01T00:00:00.000Z",
      validation: validateWorkflow(candidate.workflow, {
        graph: analysis.mined.graph,
        traces: analysis.mined.report,
      }),
      repository: { ...analysis.project.repository, dirty: false },
    }),
  );
}

export type WorkflowCaseResult = {
  id: string;
  found: boolean;
  entrypointCorrect: boolean;
  /** Longest common subsequence of major steps over expected steps (inputs order-free). */
  majorStepScore: number;
  terminalCorrect: boolean;
  /** Candidate steps whose target the reviewed workflow does not contain. */
  inventedSteps: string[];
  /** Step insertions, deletions and substitutions a reviewer needs (inputs order-free). */
  editDistance: number;
  /** Roles and required flags match the truth; null when the truth gives neither. */
  applicabilityCorrect: boolean | null;
};
export type DiscoveryEvaluationReport = {
  family: "workflow-discovery";
  strategy: string;
  /** Candidates matching a reviewed workflow, over all candidates. */
  precision: number;
  /** Reviewed workflows found, over all reviewed workflows. */
  recall: number;
  entrypointAccuracy: number;
  meanMajorStepScore: number;
  terminalAccuracy: number;
  inventedStepCount: number;
  /** Invented steps over all steps of found candidates. */
  inventedStepRate: number;
  /** Over found workflows whose truth states roles or flags. */
  applicabilityAccuracy: number;
  /** Over every reviewed workflow: a missing one costs all of its steps. */
  meanEditDistance: number;
  unexpectedCandidates: string[];
  cases: WorkflowCaseResult[];
};
const INPUTS = new Set(["input", "select"]);
function normalize(steps: { target: string; action: string }[]) {
  const result: string[] = [];
  let run: string[] = [];
  for (const item of [...steps, null]) {
    if (item && INPUTS.has(item.action)) {
      run.push(item.target);
      continue;
    }
    result.push(...run.sort(compare));
    run = [];
    if (item) result.push(item.target);
  }
  return result;
}
function lcs(a: string[], b: string[]): number {
  const table = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 1; i <= a.length; i += 1)
    for (let j = 1; j <= b.length; j += 1) {
      const row = table[i] as number[];
      const previous = table[i - 1] as number[];
      row[j] =
        a[i - 1] === b[j - 1]
          ? (previous[j - 1] as number) + 1
          : Math.max(previous[j] as number, row[j - 1] as number);
    }
  return (table[a.length] as number[])[b.length] as number;
}
function levenshtein(a: string[], b: string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1)
      row[j] = Math.min(
        (previous[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = row;
  }
  return previous[b.length] as number;
}
const same = (a: string[], b: string[]) =>
  a.length === b.length &&
  [...a]
    .sort(compare)
    .every((item, index) => item === [...b].sort(compare)[index]);
export async function evaluateWorkflowDiscovery(
  analysis: FixtureAnalysis,
  truth: GroundTruth,
  strategy: DiscoveryStrategy = baselineStrategy,
): Promise<DiscoveryEvaluationReport> {
  const candidates = await strategy.discover(analysis);
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const cases = [...truth.workflows]
    .sort((a, b) => compare(a.id, b.id))
    .map((expected): WorkflowCaseResult => {
      const found = byId.get(expected.id);
      if (!found)
        return {
          id: expected.id,
          found: false,
          entrypointCorrect: false,
          majorStepScore: 0,
          terminalCorrect: false,
          inventedSteps: [],
          editDistance: normalize(expected.steps).length,
          applicabilityCorrect: null,
        };
      const actualSteps = found.steps.flatMap((item) =>
        item.target ? [{ target: item.target, action: item.action.type }] : [],
      );
      const wanted = normalize(expected.steps);
      const got = normalize(actualSteps);
      const terminal = found.terminal as Record<string, unknown>;
      const targets = new Set(expected.steps.map((item) => item.target));
      const flags = (found.preconditions ?? []).flatMap((item) =>
        item.type === "feature_flag" && item.enabled ? [item.flag] : [],
      );
      const measured =
        expected.roles !== undefined || expected.flags !== undefined;
      return {
        id: expected.id,
        found: true,
        entrypointCorrect: found.entrypoints.some(
          (entry) => entry.route === expected.entrypoint,
        ),
        majorStepScore: ratio(lcs(wanted, got), wanted.length),
        terminalCorrect:
          terminal.type === expected.terminal.type &&
          (expected.terminal.target === undefined ||
            terminal.target === expected.terminal.target) &&
          (expected.terminal.text === undefined ||
            terminal.text === expected.terminal.text),
        inventedSteps: actualSteps
          .map((item) => item.target)
          .filter((target) => !targets.has(target)),
        editDistance: levenshtein(wanted, got),
        applicabilityCorrect: measured
          ? (expected.roles === undefined ||
              (found.roles !== undefined &&
                same(found.roles, expected.roles))) &&
            same(flags, expected.flags ?? [])
          : null,
      };
    });
  const expectedIds = new Set(truth.workflows.map((item) => item.id));
  const found = cases.filter((item) => item.found);
  const mean = (values: number[]) =>
    values.length === 0
      ? 0
      : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) /
        1000;
  const foundSteps = candidates
    .filter((item) => expectedIds.has(item.id))
    .reduce(
      (sum, item) => sum + item.steps.filter((step) => step.target).length,
      0,
    );
  const inventedStepCount = found.reduce(
    (sum, item) => sum + item.inventedSteps.length,
    0,
  );
  const applicable = found.filter((item) => item.applicabilityCorrect !== null);
  return {
    family: "workflow-discovery",
    strategy: strategy.name,
    precision: ratio(
      candidates.filter((item) => expectedIds.has(item.id)).length,
      candidates.length,
    ),
    recall: ratio(found.length, cases.length),
    entrypointAccuracy: ratio(
      found.filter((item) => item.entrypointCorrect).length,
      found.length,
    ),
    meanMajorStepScore: mean(found.map((item) => item.majorStepScore)),
    terminalAccuracy: ratio(
      found.filter((item) => item.terminalCorrect).length,
      found.length,
    ),
    inventedStepCount,
    inventedStepRate:
      foundSteps === 0 ? 0 : ratio(inventedStepCount, foundSteps),
    applicabilityAccuracy: ratio(
      applicable.filter((item) => item.applicabilityCorrect).length,
      applicable.length,
    ),
    meanEditDistance: mean(cases.map((item) => item.editDistance)),
    unexpectedCandidates: candidates
      .map((item) => item.id)
      .filter((id) => !expectedIds.has(id))
      .sort(compare),
    cases,
  };
}

export type DiscoveryComparisonReport = {
  family: "workflow-discovery-comparison";
  /** One report per strategy, in the order given; the first is the reference. */
  strategies: DiscoveryEvaluationReport[];
};
/** Runs each strategy against the same truth (reasoning spec §117). */
export async function compareDiscoveryStrategies(
  analysis: FixtureAnalysis,
  truth: GroundTruth,
  strategies: DiscoveryStrategy[],
): Promise<DiscoveryComparisonReport> {
  const reports: DiscoveryEvaluationReport[] = [];
  for (const strategy of strategies)
    reports.push(await evaluateWorkflowDiscovery(analysis, truth, strategy));
  return { family: "workflow-discovery-comparison", strategies: reports };
}

export type ResolverEvaluationReport = {
  family: "resolver";
  top1Accuracy: number;
  ambiguityAccuracy: number;
  unsupportedAccuracy: number;
  controlsPassed: boolean;
  misses: { query: string; expected: string; actual: string }[];
};
/** Resolver accuracy on `queries.json` against the compiled reviewed workflows. */
export function evaluateResolverAccuracy(
  analysis: FixtureAnalysis,
  truth: GroundTruth,
): ResolverEvaluationReport {
  if (!truth.queries) throw new Error(`No queries.json in ${truth.directory}.`);
  const approved = approveAllCandidates(analysis);
  const report = runResolverEvaluation(
    createResolver(compileWorkflows(approved).searchIndex),
    truth.queries,
  );
  const outcomes = [...report.cases, ...report.controls];
  const accuracy = (type: string) => {
    const relevant = outcomes.filter((item) => item.expected.type === type);
    return ratio(
      relevant.filter((item) => item.correct).length,
      relevant.length,
    );
  };
  return {
    family: "resolver",
    top1Accuracy: accuracy("workflow"),
    ambiguityAccuracy: accuracy("ambiguous"),
    unsupportedAccuracy: accuracy("unsupported"),
    controlsPassed: report.controls.every((item) => item.correct),
    misses: outcomes
      .filter((item) => !item.correct)
      .map((item) => ({
        query: item.query,
        expected:
          item.expected.type === "workflow"
            ? item.expected.id
            : item.expected.type,
        actual:
          item.actual.type === "workflow_help"
            ? item.actual.workflowId
            : item.actual.type,
      })),
  };
}

export type ImpactEvaluationReport = {
  family: "impact";
  /** Expected-affected workflows reported with some impact. */
  affectedRecall: number;
  /** Expected-unaffected workflows reported as affected. */
  falsePositiveRate: number;
  /** Expected-affected workflows reported with exactly the expected severity. */
  severityAccuracy: number;
  cases: {
    id: string;
    results: { workflowId: string; expected: string; actual: string }[];
  }[];
};
const exec = promisify(execFile);
/**
 * Applies each case's edits to a temporary Git copy of the fixture with every
 * discovered workflow approved at the base, then runs deterministic impact.
 */
export async function evaluateImpact(
  fixture: string,
  truth: GroundTruth,
): Promise<ImpactEvaluationReport> {
  const tracked = (
    await exec("git", ["-C", fixture, "ls-files", "-z", "--", "."])
  ).stdout
    .split("\0")
    .filter(Boolean);
  if (tracked.length === 0)
    throw new Error(
      `${fixture} has no Git-tracked files to copy for impact cases.`,
    );
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Evaluation",
    GIT_AUTHOR_EMAIL: "evaluation@pathcompiler.invalid",
    GIT_COMMITTER_NAME: "Evaluation",
    GIT_COMMITTER_EMAIL: "evaluation@pathcompiler.invalid",
  };
  const cases: ImpactEvaluationReport["cases"] = [];
  for (const item of [...truth.impactCases].sort((a, b) =>
    compare(a.id, b.id),
  )) {
    const repository = await mkdtemp(
      path.join(os.tmpdir(), "pathcompiler-eval-"),
    );
    const git = async (...args: string[]) =>
      (await exec("git", ["-C", repository, ...args], { env })).stdout.trim();
    try {
      for (const file of tracked) {
        await mkdir(path.dirname(path.join(repository, file)), {
          recursive: true,
        });
        await cp(path.join(fixture, file), path.join(repository, file));
      }
      await git("init", "--quiet");
      await git("add", ".");
      await git("commit", "--quiet", "-m", "base");
      const base = await git("rev-parse", "HEAD");
      const analysis = await analyzeFixture(repository);
      const approved = approveAllCandidates(analysis);
      for (const edit of item.edits) {
        const target = path.join(repository, edit.file);
        const content = await readFile(target, "utf8");
        if (!content.includes(edit.from))
          throw new Error(
            `Impact case ${item.id}: ${edit.file} does not contain the edit's "from" text.`,
          );
        await writeFile(
          target,
          edit.all
            ? content.replaceAll(edit.from, edit.to)
            : content.replace(edit.from, edit.to),
        );
      }
      await git("commit", "--quiet", "-am", item.id);
      const delta = await analyzeCommitRange({
        directory: repository,
        base,
        head: "HEAD",
      });
      const impact = analyzeWorkflowImpact(delta, approved);
      const actual = new Map(
        impact.impacts.map((entry) => [entry.workflowId, entry.severity]),
      );
      cases.push({
        id: item.id,
        results: Object.entries(item.expected)
          .sort(([a], [b]) => compare(a, b))
          .map(([workflowId, expected]) => ({
            workflowId,
            expected,
            actual: actual.get(workflowId) ?? "none",
          })),
      });
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  }
  const results = cases.flatMap((item) => item.results);
  const affected = results.filter((item) => item.expected !== "none");
  const unaffected = results.filter((item) => item.expected === "none");
  return {
    family: "impact",
    affectedRecall: ratio(
      affected.filter((item) => item.actual !== "none").length,
      affected.length,
    ),
    falsePositiveRate:
      unaffected.length === 0
        ? 0
        : Math.round(
            (unaffected.filter((item) => item.actual !== "none").length /
              unaffected.length) *
              1000,
          ) / 1000,
    severityAccuracy: ratio(
      affected.filter((item) => item.actual === item.expected).length,
      affected.length,
    ),
    cases,
  };
}
