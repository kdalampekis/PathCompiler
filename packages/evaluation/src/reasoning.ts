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
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import type { FormalProductModel } from "@pathcompiler/formal-model";
import {
  createProductReasoner,
  evaluatePlan,
  findMinimalEnablement,
  formalExprVariables,
  ProductPropertySchema,
} from "@pathcompiler/reasoner-core";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { clusterTraces } from "@pathcompiler/trace-clustering";
import { z } from "zod";

/**
 * Reasoning evaluation cases (reasoning spec §88–§89): queries against the
 * model extracted from a fixture, optionally after seeded edits, with the
 * expected answer reviewed by hand.
 */
export const REASONING_CATEGORIES = [
  "reachable",
  "unreachable",
  "permissions",
  "feature-flags",
  "alternative-plans",
  "counterexamples",
  "commit-diffs",
] as const;
const context = z.record(
  z.string(),
  z.union([z.string(), z.boolean(), z.number()]),
);
const goal = z.string().min(1);
export const ReasoningCaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  category: z.enum(REASONING_CATEGORIES),
  /** Fixture directory name, next to the cases root (`fixtures/<name>`). */
  fixture: z.string().min(1),
  description: z.string().min(1),
  /** Seeded changes applied to a copy of the fixture before extraction. */
  edits: z
    .array(
      z.strictObject({
        file: z.string().min(1),
        from: z.string().min(1),
        to: z.string(),
      }),
    )
    .optional(),
  query: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("reachability"),
      goal,
      context: context.optional(),
      expected: z.enum(["reachable", "unreachable"]),
    }),
    z.strictObject({
      kind: z.literal("plan"),
      goal,
      context: context.optional(),
      /** Semantic targets the plan must visit, in order (a subsequence). */
      expectedTargets: z.array(z.string().min(1)).min(1),
    }),
    z.strictObject({
      kind: z.literal("explanation"),
      goal,
      context,
      /** Constraint descriptions the explanation must cite. */
      expectedConstraints: z.array(z.string().min(1)).min(1),
    }),
    z.strictObject({
      kind: z.literal("property"),
      property: z.unknown(),
      expected: z.enum(["holds", "violated"]),
      /** For violations: the action the counterexample must end with. */
      lastAction: z.string().min(1).optional(),
    }),
    z.strictObject({
      kind: z.literal("alternatives"),
      goal,
      context: context.optional(),
      slack: z.number().int().min(0).max(10).optional(),
      /** Major actions of every expected business variant, in order. */
      expectedVariants: z.array(z.array(z.string().min(1)).min(1)).min(1),
    }),
    z.strictObject({
      kind: z.literal("enablement"),
      goal,
      context,
      /** Every minimal correction set, as `context:<variable>` or `guard:<action>(<variables>)`. */
      expectedCorrections: z.array(z.array(z.string().min(1)).min(1)),
    }),
    z.strictObject({
      kind: z.literal("diff"),
      /** Base is the unedited fixture; after is the edited copy. */
      goals: z.array(goal).min(1),
      expectedAdded: z.array(z.strictObject({ goal, context })).optional(),
      expectedRemoved: z.array(z.strictObject({ goal, context })).optional(),
    }),
  ]),
});
export type ReasoningCase = z.infer<typeof ReasoningCaseSchema>;

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Loads `<root>/<category>/*.json`, sorted by ID. */
export async function loadReasoningCases(
  root: string,
): Promise<ReasoningCase[]> {
  const cases: ReasoningCase[] = [];
  for (const category of REASONING_CATEGORIES) {
    let names: string[] = [];
    try {
      names = (await readdir(path.join(root, category))).filter((name) =>
        name.endsWith(".json"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const name of names) {
      const file = path.join(root, category, name);
      const parsed = ReasoningCaseSchema.safeParse(
        JSON.parse(await readFile(file, "utf8")),
      );
      if (!parsed.success)
        throw new Error(
          `Invalid reasoning case ${file}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
        );
      if (parsed.data.category !== category)
        throw new Error(
          `Reasoning case ${file} declares category ${parsed.data.category}; move it to ${parsed.data.category}/.`,
        );
      cases.push(parsed.data);
    }
  }
  return cases.sort((a, b) => compare(a.id, b.id));
}

export type ReasoningCaseResult = {
  id: string;
  category: ReasoningCase["category"];
  kind: ReasoningCase["query"]["kind"];
  passed: boolean;
  /** Solver gave up (`unknown`); never counted as a correct "unreachable". */
  unknown: boolean;
  detail: string;
};
export type ReasoningEvaluationReport = {
  family: "reasoning";
  total: number;
  passed: number;
  /** Reachability, explanation, property and enablement answers that match the truth. */
  verdictAccuracy: number;
  unknownRate: number;
  /** Plans that replay correctly and visit the expected targets, and enumerations that yield the expected variants. */
  planAccuracy: number;
  diffAccuracy: number;
  byCategory: Record<string, { total: number; passed: number }>;
  cases: ReasoningCaseResult[];
};

const exec = promisify(execFile);
async function extractModel(
  fixture: string,
  edits: ReasoningCase["edits"],
  caseId: string,
): Promise<FormalProductModel> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "pathcompiler-reasoning-"),
  );
  try {
    const tracked = (
      await exec("git", ["-C", fixture, "ls-files", "-z", "--", "."])
    ).stdout
      .split("\0")
      .filter(Boolean);
    if (tracked.length === 0)
      throw new Error(
        `${fixture} has no Git-tracked files to copy for reasoning cases.`,
      );
    for (const file of tracked) {
      await mkdir(path.dirname(path.join(directory, file)), {
        recursive: true,
      });
      await cp(path.join(fixture, file), path.join(directory, file));
    }
    for (const edit of edits ?? []) {
      const target = path.join(directory, edit.file);
      const content = await readFile(target, "utf8");
      if (!content.includes(edit.from))
        throw new Error(
          `Reasoning case ${caseId}: ${edit.file} does not contain the edit's "from" text.`,
        );
      await writeFile(target, content.replace(edit.from, edit.to));
    }
    // A fixed snapshot commit: case results do not depend on the checkout.
    const project = await readSourceProject(directory, {
      snapshot: { commit: "0".repeat(40) },
    });
    const mined = minePlaywrightTests(
      project,
      analyzeNextProject(project).graph,
    );
    const capabilities = discoverCapabilities(mined.graph);
    return buildFormalModel(
      capabilities.graph,
      capabilities.report,
      mined.report,
    ).model;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const matches = (
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
) => Object.entries(expected).every(([key, value]) => actual[key] === value);

export async function evaluateReasoningCases(
  root: string,
  cases: readonly ReasoningCase[],
  solver: SolverProvider,
): Promise<ReasoningEvaluationReport> {
  const reasoner = createProductReasoner(solver);
  const models = new Map<string, Promise<FormalProductModel>>();
  const model = (item: ReasoningCase, edited: boolean) => {
    const fixture = path.resolve(root, "..", item.fixture);
    const edits = edited ? (item.edits ?? []) : [];
    const key = `${fixture}\u0000${JSON.stringify(edits)}`;
    if (!models.has(key))
      models.set(key, extractModel(fixture, edits, item.id));
    return models.get(key) as Promise<FormalProductModel>;
  };
  const results: ReasoningCaseResult[] = [];
  for (const item of cases) {
    const query = item.query;
    const extracted = await model(item, true);
    const result = (passed: boolean, detail: string, unknown = false) =>
      results.push({
        id: item.id,
        category: item.category,
        kind: query.kind,
        passed,
        unknown,
        detail,
      });
    if (query.kind === "reachability") {
      const answer = await reasoner.checkReachability(extracted, {
        goal: query.goal,
        ...(query.context ? { context: query.context } : {}),
      });
      result(
        answer.status === query.expected,
        `${answer.status} (expected ${query.expected})`,
        answer.status === "unknown",
      );
    } else if (query.kind === "plan") {
      const answer = await reasoner.findPlan(extracted, {
        goal: query.goal,
        ...(query.context ? { context: query.context } : {}),
      });
      if (answer.status !== "found") {
        result(false, `no plan: ${answer.status}`, answer.status === "unknown");
        continue;
      }
      const replay = evaluatePlan(extracted, answer.plan);
      const targets = answer.plan.steps.flatMap((step) =>
        step.semanticTarget ? [step.semanticTarget] : [],
      );
      let next = 0;
      for (const target of targets)
        if (target === query.expectedTargets[next]) next += 1;
      result(
        replay.goalReached &&
          replay.invalidActionCount === 0 &&
          next === query.expectedTargets.length,
        `plan ${answer.plan.steps.map((step) => step.actionId).join(" → ")}`,
      );
    } else if (query.kind === "explanation") {
      const answer = await reasoner.explainUnreachable(extracted, {
        goal: query.goal,
        context: query.context,
      });
      if (answer.status !== "unreachable") {
        result(
          false,
          `${answer.status} (expected unreachable)`,
          answer.status === "unknown",
        );
        continue;
      }
      const cited = answer.explanation.constraints.map(
        (entry) => entry.description,
      );
      const missing = query.expectedConstraints.filter(
        (entry) => !cited.includes(entry),
      );
      result(
        missing.length === 0,
        missing.length === 0
          ? `cites ${query.expectedConstraints.join("; ")}`
          : `missing ${missing.join("; ")} (cited ${cited.join("; ")})`,
      );
    } else if (query.kind === "property") {
      const property = ProductPropertySchema.parse(query.property);
      const answer = await reasoner.verifyProperty(extracted, property);
      const last =
        answer.status === "violated"
          ? answer.counterexample.actions.at(-1)?.actionId
          : undefined;
      result(
        answer.status === query.expected &&
          (query.lastAction === undefined || last === query.lastAction),
        `${answer.status}${last ? ` ending with ${last}` : ""} (expected ${query.expected})`,
        answer.status === "unknown",
      );
    } else if (query.kind === "alternatives") {
      const answer = await reasoner.enumeratePlans(extracted, {
        goal: query.goal,
        ...(query.context ? { context: query.context } : {}),
        ...(query.slack === undefined ? {} : { slack: query.slack }),
      });
      if (answer.status !== "found") {
        result(
          false,
          `no plans: ${answer.status}`,
          answer.status === "unknown",
        );
        continue;
      }
      const variants = clusterTraces(answer.plans).variants.map((variant) =>
        variant.signature.majorActions.join(" → "),
      );
      const wanted = query.expectedVariants.map((list) => list.join(" → "));
      result(
        answer.complete && JSON.stringify(variants) === JSON.stringify(wanted),
        `${variants.length} variants from ${answer.plans.length} plans: ${variants.join("; ")}`,
      );
    } else if (query.kind === "enablement") {
      const answer = await findMinimalEnablement(reasoner, extracted, {
        goal: query.goal,
        context: query.context,
      });
      const sets = answer.corrections.map((correction) =>
        correction.changes
          .map((change) =>
            change.kind === "context"
              ? `context:${change.variable}`
              : `guard:${change.actionId}(${[...new Set(formalExprVariables(change.condition))].sort(compare).join(",")})`,
          )
          .sort(compare)
          .join(" + "),
      );
      const wanted = query.expectedCorrections.map((set) =>
        [...set].sort(compare).join(" + "),
      );
      const same =
        answer.minimum &&
        sets.length === wanted.length &&
        [...sets]
          .sort(compare)
          .every((set, index) => set === [...wanted].sort(compare)[index]);
      result(
        same,
        `${answer.status}: ${sets.join("; ") || "no corrections"}${answer.minimum ? "" : " (not minimum)"}`,
        answer.status === "unknown",
      );
    } else {
      const before = await model(item, false);
      const comparison = await reasoner.compareModels(before, extracted, {
        goals: query.goals,
        otherValue: "unlisted",
      });
      const has = (
        list: typeof comparison.newReachability,
        wanted: { goal: string; context: Record<string, unknown> },
      ) =>
        list.some(
          (entry) =>
            entry.goal === wanted.goal &&
            matches(entry.context, wanted.context),
        );
      const missing = [
        ...(query.expectedAdded ?? [])
          .filter((wanted) => !has(comparison.newReachability, wanted))
          .map((wanted) => `+${wanted.goal} ${JSON.stringify(wanted.context)}`),
        ...(query.expectedRemoved ?? [])
          .filter((wanted) => !has(comparison.removedReachability, wanted))
          .map((wanted) => `-${wanted.goal} ${JSON.stringify(wanted.context)}`),
      ];
      result(
        missing.length === 0,
        missing.length === 0
          ? `${comparison.newReachability.length} added, ${comparison.removedReachability.length} removed`
          : `missing ${missing.join("; ")}`,
        comparison.uncertainty.some((entry) => entry.kind === "unknown-result"),
      );
    }
  }
  const ratio = (part: number, whole: number) =>
    whole === 0 ? 1 : Math.round((part / whole) * 1000) / 1000;
  const of = (kinds: string[]) =>
    results.filter((entry) => kinds.includes(entry.kind));
  const byCategory: ReasoningEvaluationReport["byCategory"] = {};
  for (const entry of results) {
    const bucket = byCategory[entry.category] ?? { total: 0, passed: 0 };
    bucket.total += 1;
    if (entry.passed) bucket.passed += 1;
    byCategory[entry.category] = bucket;
  }
  const verdicts = of([
    "reachability",
    "explanation",
    "property",
    "enablement",
  ]);
  const plans = of(["plan", "alternatives"]);
  return {
    family: "reasoning",
    total: results.length,
    passed: results.filter((entry) => entry.passed).length,
    verdictAccuracy: ratio(
      verdicts.filter((entry) => entry.passed).length,
      verdicts.length,
    ),
    unknownRate:
      results.length === 0
        ? 0
        : ratio(
            results.filter((entry) => entry.unknown).length,
            results.length,
          ),
    planAccuracy: ratio(
      plans.filter((entry) => entry.passed).length,
      plans.length,
    ),
    diffAccuracy: ratio(
      of(["diff"]).filter((entry) => entry.passed).length,
      of(["diff"]).length,
    ),
    byCategory,
    cases: results,
  };
}
