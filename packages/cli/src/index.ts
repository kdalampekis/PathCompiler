import {
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";
import { createGitHubProvider } from "@pathcompiler/adapter-github";
import {
  analyzeNextProject,
  scanNextRepository,
  suggestTargets,
} from "@pathcompiler/adapter-nextjs";
import { reconcileBehavior } from "@pathcompiler/behavior-reconciliation";
import {
  type CandidateEvaluation,
  evaluateCandidate,
  TestRunSchema,
  testRunFromPlaywrightJson,
} from "@pathcompiler/candidate-evaluator";
import {
  type CapabilityDiscoveryReport,
  CapabilityExpectationsSchema,
  discoverCapabilities,
  discoverProductSurfaces,
} from "@pathcompiler/capability-engine";
import {
  analyticsPolicy,
  CONFIG_FILE,
  defaultConfigYaml,
  loadConfig,
  type PathCompilerConfig,
  reasoningEnabled,
} from "@pathcompiler/config";
import {
  analyzeFixture,
  baselineStrategy,
  compareDiscoveryStrategies,
  type DiscoveryEvaluationReport,
  evaluateCapabilityExtraction,
  evaluateImpact,
  evaluateReasoningCases,
  evaluateResolverAccuracy,
  evaluateWorkflowDiscovery,
  loadGroundTruth,
  loadReasoningCases,
  reasoningStrategy,
} from "@pathcompiler/evaluation";
import {
  actionCategories,
  buildFormalModel,
} from "@pathcompiler/formal-abstraction";
import {
  type FormalProductModel,
  parseFormalModel,
} from "@pathcompiler/formal-model";
import {
  associatePullRequest,
  enrichNodeHistory,
  openGitRepository,
  openGitRepository as openRepository,
} from "@pathcompiler/git-intelligence";
import {
  createAppAuth,
  createJobQueue,
  createLocalRepositoryProvider,
  createWebhookHandler,
  createWorkflowCheckWorker,
  githubAppManifest,
} from "@pathcompiler/github-app";
import {
  analyzeCommitRange,
  analyzeCommitRangeDetailed,
} from "@pathcompiler/graph-delta";
import {
  createFileEventSink,
  createHttpService,
} from "@pathcompiler/http-service";
import { analyzeWorkflowImpact } from "@pathcompiler/impact-analysis";
import { serveStdio } from "@pathcompiler/mcp-server";
import {
  describeModelRequest,
  redactValue,
} from "@pathcompiler/model-provider";
import {
  buildObservedGraph,
  computeWorkflowAnalytics,
  readEventDirectory,
} from "@pathcompiler/observed-graph";
import {
  type CheapestPlanResult,
  type CostWeights,
  costsFromCategories,
  createProductReasoner,
  DEFAULT_COST_WEIGHTS,
  type DeadFeatureReport,
  detectDeadFeatures,
  type ExplanationResult,
  evaluatePlan,
  type FormalValue,
  findCheapestPlan,
  findMinimalEnablement,
  type MinimalEnablementResult,
  type Plan,
  type PlanEnumerationResult,
  type PlanEvaluation,
  type PlanResult,
  type ProductProperty,
  type PropertyResult,
  propertiesFromInvariants,
  type ReachabilityQuery,
  type ReachabilityResult,
  uxMetrics,
} from "@pathcompiler/reasoner-core";
import { createStaticTransport, PathCompiler } from "@pathcompiler/sdk-js";
import {
  analyzeSemanticChange,
  describeContext,
  type SemanticChangeReport,
  summarizeSemanticChange,
} from "@pathcompiler/semantic-change";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { readSourceProject } from "@pathcompiler/source-model";
import {
  type GenerationReport,
  generateTests,
  type TestSetup,
  TestSetupSchema,
} from "@pathcompiler/test-generator";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { clusterTraces } from "@pathcompiler/trace-clustering";
import {
  COMPILER_VERSION,
  compileWorkflows,
  EXPORT_FORMATS,
  type ExportFormat,
  exportArtifacts,
  GENERATED_MARKER,
  renderHelpPages,
} from "@pathcompiler/workflow-compiler";
import {
  discoverWorkflows,
  parseCandidateYaml,
  serializeCandidateYaml,
} from "@pathcompiler/workflow-discovery";
import type { WorkflowV1 } from "@pathcompiler/workflow-ir";
import {
  acceptDeprecation,
  acceptProposal,
  decideProposal,
  detectNewWorkflows,
  generateProposals,
  ProposalError,
  parseProposalYaml,
  proposalFileName,
  serializeProposalYaml,
} from "@pathcompiler/workflow-proposals";
import {
  type ApprovedWorkflow,
  approveCandidate,
  parseApprovedWorkflowYaml,
  parseDeprecatedWorkflowYaml,
  parseRejectedWorkflowYaml,
  type RejectedWorkflow,
  ReviewError,
  ReviewerSchema,
  rejectCandidate,
  reviewPaths,
  serializeReviewedYaml,
  WorkflowIdSchema,
} from "@pathcompiler/workflow-review";
import { validateWorkflow } from "@pathcompiler/workflow-validator";
import { z } from "zod";

export const HELP = `PathCompiler — local Next.js source analysis

Usage: pathcompiler scan <directory> [--explain-model-context] [--json] [--out <directory>] [--exclude <directory> ...]
       pathcompiler init [directory]
       pathcompiler config show [--json]
       pathcompiler graph inspect [--json] [--out <directory>]
       pathcompiler capabilities list [--json] [--out <directory>]
       pathcompiler targets suggest [directory] [--json] [--exclude <directory> ...]
       pathcompiler tests mine [directory] [--out <directory>] [--exclude <directory> ...]
       pathcompiler tests generate [directory] [--setup <json-file>] [--out <directory>] [--exclude <directory> ...]
       pathcompiler surfaces discover [directory] [--out <directory>] [--exclude <directory> ...]
       pathcompiler capabilities discover [directory] [--expect <json-file>] [--out <directory>] [--exclude <directory> ...]
       pathcompiler workflows discover [directory] [--out <directory>] [--exclude <directory> ...]
       pathcompiler workflows detect <base> <head> [directory] [--out <directory>] [--exclude <directory> ...]
       pathcompiler workflows validate <id> [directory] [--out <directory>] [--exclude <directory> ...]
       pathcompiler workflows list [--out <directory>] [--json]
       pathcompiler workflows show <id> [--out <directory>] [--json]
       pathcompiler workflows approve <id> [directory] [--by <name>] [--out <directory>] [--exclude <directory> ...]
       pathcompiler workflows reject <id> [--by <name>] [--reason <text>] [--out <directory>]
       pathcompiler diff <base> <head> [directory] [--out <directory>] [--exclude <directory> ...]
       pathcompiler impact <base> <head> [directory] [--reasoning] [--out <directory>] [--exclude <directory> ...]
       pathcompiler proposals generate <base> <head> [directory] [--reasoning] [--out <directory>] [--exclude <directory> ...]
       pathcompiler proposals list [--out <directory>] [--json]
       pathcompiler proposals show <proposal> [--out <directory>]
       pathcompiler proposals accept <proposal> [directory] [--by <name>] [--reason <text>] [--out <directory>]
       pathcompiler proposals reject|ignore <proposal> [--by <name>] [--reason <text>] [--out <directory>]
       pathcompiler build [--out <directory>] [--format json,yaml,markdown]
       pathcompiler docs export [--dir <directory>] [--out <directory>]
       pathcompiler github-app manifest --name <name> --url <url> --webhook <https-url>
       pathcompiler github-app serve --config <json-file> [--port <number>] [--host <address>]
       pathcompiler mcp [--out <directory>]
       pathcompiler serve [--out <directory>] [--port <number>] [--host <address>] [--events]
       pathcompiler observe graph|workflows [--release <id>] [--json] [--out <directory>]
       pathcompiler observe reconcile [directory] [--model <json-file>] [--json] [--out <directory>]
       pathcompiler git inspect [directory] --node <node-id> [--limit <1-100>] [--out <directory>]
       pathcompiler github inspect [directory] --repo <owner/name> (--pr <number> | --commit <sha>) [--out <directory>]
       pathcompiler eval capabilities|workflow-discovery|resolver|impact|reasoning [directory] [--compare] [--json] [--out <directory>]
       pathcompiler evaluate <base> <candidate> [directory] [--criteria <json-file>] [--tests <json-file>] [--json] [--out <directory>] [--exclude <directory> ...]
       pathcompiler reason verify [directory] [--property <json-file>] [--context <name=value> ...] [--model <json-file>] [--max-depth <n>] [--timeout-ms <n>] [--json] [--out <directory>]
       pathcompiler reason diff <base> <head> [directory] [--json] [--out <directory>] [--exclude <directory> ...]
       pathcompiler reason dead-features [directory] [--model <json-file>] [--json] [--out <directory>]
       pathcompiler reason optimize <goal> [directory] [--context <name=value> ...] [--weight <category=n> ...] [--json] [--out <directory>]
       pathcompiler reason alternatives <goal> [directory] [--context <name=value> ...] [--slack <0-10>] [--limit <1-1000>] [--json] [--out <directory>]
       pathcompiler reason reachable|plan|why-not|enable <goal> [directory] [--context <name=value> ...] [--max-depth <n>] [--timeout-ms <n>] [--model <json-file>] [--json] [--out <directory>] [--exclude <directory> ...]

Writes .pathcompiler/graph/source-graph.json and .pathcompiler/reports/scan-summary.json
under the current working directory, or under the directory supplied to --out.
--exclude accepts scan-root-relative directory/file paths, not glob patterns.
targets suggest defaults to the current directory and prints candidates without writing files.
--json returns a versioned target report including provenance and scan diagnostics.
tests mine writes reports/test-traces.json and graph/test-graph.json under .pathcompiler
(or --out), preserving source scan artifacts. Traces are evidence, not approved workflows.
git inspect reads local history for a current source node, writing reports/git-evidence.json
and graph/history-graph.json. Defaults to 20 commits per provenance file; supports --exclude.
github inspect requires GITHUB_TOKEN with Pull requests read permission. It reads GitHub
PR evidence into reports/pr-evidence.json and graph/pr-graph.json; supports --exclude.
surfaces discover writes reports/product-surfaces.json and graph/surface-graph.json.
Surfaces are static candidates requiring review, not approved capabilities or workflows.
capabilities discover mines source/test evidence into reports/capabilities.json and
graph/capability-graph.json. --expect supplies evaluation-only capability IDs;
without ground truth, false positives are reported as not evaluated.
workflows discover writes workflows/candidates/*.yaml, reports/workflow-candidates.json
and graph/workflow-graph.json. Candidates require review; browser validation has not run.
workflows validate reads the candidate under .pathcompiler (or --out), rescans the
repository, and writes reports/validation/<id>.json. Failed checks exit nonzero.
workflows approve re-validates a clean, current candidate and writes workflows/<id>.yaml
with approvedBy/approvedAt/approvedCommit; commit that file. workflows reject writes
workflows/rejected/<id>.yaml. Both take the reviewer from --by or PATHCOMPILER_USER and
never replace an existing review decision. Candidate YAML remains as discovery cache.
diff exports both commits read-only, re-analyzes each and writes reports/graph-delta.json
with changed files, symbols, routes, semantic targets and APIs plus the node/edge delta.
impact applies deterministic rules to that delta for every approved workflow and writes
reports/workflow-impact.json (severity none/low/medium/high, reasons, affected steps).
proposals generate writes proposals/<id>.<head-sha>.yaml for medium/high impact: the
head-commit rediscovery, validation, evidence and a readable diff. Approved files change
only through proposals accept (re-validated on a clean checkout of that head commit).
<proposal> is the file name without .yaml.
workflows detect finds capabilities new in base..head with no approved or rejected workflow,
scores signals (new action, write API, Playwright flow, route/dialog, commit subject) and
writes reports/new-workflows.json plus candidates backed by two or more signals and a test.
docs export renders docs/help/<id>.md and index.md from approved workflows. It replaces
only files it generated and refuses to overwrite hand-written Markdown.
build compiles only approved workflows/<id>.yaml records into generated/search-index.json,
generated/runtime-manifest.json (browser-safe) and generated/documentation.json.
github-app serve verifies GitHub webhooks (GITHUB_WEBHOOK_SECRET), acknowledges push and
pull_request events immediately, analyzes them in a background queue using configured local
clones, and publishes a "PathCompiler Workflow Check" run with a scoped installation token.
mcp serves the read-only PathCompiler MCP tools over stdio from those generated files.
serve runs the HTTP runtime API on 127.0.0.1:4310 by default from the same files and
requires PATHCOMPILER_API_TOKEN (Authorization: Bearer <token>). --events enables
POST /v1/events/batch: semantic events are validated against the default privacy policy and
appended as NDJSON under events/<project>/<day>.ndjson; PATHCOMPILER_INGEST_TOKEN optionally
sets a token that may only post events. observe graph aggregates the stored events into
reports/observed-graph.json: transition counts, sessions, frequencies, median times and
role/release segments (what happened; never compared with the formal model here).
observe workflows reconstructs guide runs per workflow version: starts, completions,
abandonments, unfinished runs, completion rate (only with 30+ runs), median/p95 duration,
actions per run, a step funnel and privacy-suppressed role/release segments, written to
reports/workflow-analytics.json. observe reconcile compares the formal model (extracted from
the repository, or --model) with the stored events per observed role: possible+observed,
possible+unobserved, and observed-but-formally-unexpected (high priority, with the model's
reasons and candidate causes; never labelled a bug). Writes reports/reconciliation.json.
reason reachable asks whether a goal of the Formal Product Model can be reached under
fixed context values (role, flags; omitted ones are free). Without --model it extracts the
model from the repository and its tests (static evidence). It answers reachable (with a
witness trace), unreachable (k-induction proof) or unknown, and writes
reports/reasoning/<goal>.json. Unreachable means unreachable in the model: read it with the
model coverage and uncertainties it reports. reason plan returns the shortest plan
(canonical among equals) and compares it with workflows/<capability>.yaml when that
approved workflow exists, writing reports/reasoning/plans/<goal>.json. reason why-not explains an
unreachable goal with a minimal set of product constraints (context, preconditions, initial
state) and their source evidence, writing reports/reasoning/why-not/<goal>.json. reason enable
lists the minimal sets of policy changes (a context value, or a role, flag or permission guard)
that would make an unreachable goal reachable, each with a witness, writing
reports/reasoning/enablement/<goal>.json. It is diagnostic only and never changes anything.
reason alternatives enumerates every plan from the shortest length up to --slack (default 1)
more steps, each reaching the goal only at its last step, and groups them into business variants
(goal, entry capability, route family, major actions; navigation links, field order and detours
do not count), writing reports/reasoning/alternatives/<goal>.json. reason optimize finds the
cheapest plan under per-category costs (--weight navigation|entry|field|submit|confirmation|back|
cancel|other=n; default 1 each), proven optimal when every plan that could be cheaper was
enumerated, ranks the variants by cost and reports UX metrics as hypotheses, writing
reports/reasoning/optimize/<goal>.json. reason dead-features checks every capability goal and
capability action for reachability and flags unreachable capabilities, actions that can never be
performed, and capabilities whose UI and API exist with no formal transitions (potential model or
product gaps), each with possible causes, writing reports/reasoning/dead-features.json.
eval scores PathCompiler itself against the reviewed ground truth in <directory>/eval
(capabilities.json, workflows/*.yaml, impact-cases/*.json, queries.json): capability
precision/recall, workflow discovery (recall, entrypoints, major steps, terminals, invented
steps), resolver accuracy, or impact recall/false positives/severity on edited Git copies of
the Git-tracked directory. It writes reports/eval/<family>.json; results are deterministic.
eval reasoning [directory] runs the reviewed reasoning cases under <directory> (for example
fixtures/reasoning: reachable, unreachable, permissions, feature-flags, alternative-plans,
counterexamples, commit-diffs) against the model extracted from each case's fixture, with
seeded edits applied to a temporary copy. With pathcompiler.yaml it needs reasoning.reachability.
eval workflow-discovery --compare also runs reasoning-assisted discovery (formal model, shortest
plan per capability goal, roles and flags from reachability) and reports both strategies side by
side, adding invented-step rate, applicability accuracy and edit distance; the baseline stays the
discovery used everywhere else. With pathcompiler.yaml it needs reasoning.planning.
evaluate independently evaluates a candidate commit (a human PR or harness output) against its
base: intended vs. observed semantic change (--criteria: expectedChanges, protectedProperties,
recommendationId, mutation), invariant and protected-property checks on both commits, approved
workflow impact, and business-level tests (--tests: Playwright JSON reporter output or
{ tests: [{ name, status }] }). It writes reports/evaluation/<candidate>.json and exits nonzero
when the candidate fails. Claims in the criteria never change the outcome.
reason verify checks the model's invariants and any properties in --property (kinds:
never, always, invariant, via) by bounded model checking, writing
reports/reasoning/verification.json. A violation prints a counterexample and exits nonzero (also with --json).
reason diff builds both commits' models and reports goals that became reachable or
unreachable per context, with root causes traced to changed files, in
reports/semantic-change.json. impact and proposals generate accept --reasoning to add
those findings as impact reasons (reachability-removed is high severity).
Reasoning output is for developers only.
scan --explain-model-context is a dry run of the model boundary: it builds the capability
request a model provider would receive (product surfaces and graph evidence; never file
contents, hidden files such as .env, binaries or excluded paths), redacts obvious secrets,
and writes the exact payload with its size, evidence counts, referenced paths and redaction
counts to reports/model-context.json. Nothing is sent; no provider is called.
tests generate writes candidate Playwright tests to <out>/generated-tests/ (review required):
one positive test per reachable capability goal, planned from an empty product, and one
negative test per role value or flag the reasoner proves blocks the goal. --setup names a
JSON file mapping context variables to UI controls ({ schemaVersion: 1, start, context:
{ <variable>: { control: "select", target, values } | { control: "checkbox", target } } });
contexts it cannot establish are skipped. Completion assertions come from test-backed
workflow candidates; tests without one are flagged as weak.
init writes pathcompiler.yaml with every default spelled out. When pathcompiler.yaml exists in
the working directory, it gates capabilities: reason commands need reasoning.enabled plus their
flag, observe needs modes.observe, evaluate needs modes.evaluate, reasoning.impact turns on
--reasoning, and analytics.ingest enables serve ingestion with the analytics privacy policy.
Without the file nothing is gated. API keys never go in the file (model_provider.api_key_env
names an environment variable).
No repository code is executed and no source is sent to a model or network service.
`;

const CLI_OPTIONS = {
  help: { type: "boolean", short: "h" },
  out: { type: "string" },
  json: { type: "boolean" },
  exclude: { type: "string", multiple: true },
  node: { type: "string" },
  limit: { type: "string" },
  repo: { type: "string" },
  pr: { type: "string" },
  commit: { type: "string" },
  expect: { type: "string" },
  by: { type: "string" },
  reason: { type: "string" },
  port: { type: "string" },
  host: { type: "string" },
  config: { type: "string" },
  name: { type: "string" },
  url: { type: "string" },
  webhook: { type: "string" },
  format: { type: "string", multiple: true },
  dir: { type: "string" },
  context: { type: "string", multiple: true },
  "max-depth": { type: "string" },
  "timeout-ms": { type: "string" },
  model: { type: "string" },
  reasoning: { type: "boolean" },
  property: { type: "string" },
  criteria: { type: "string" },
  tests: { type: "string" },
  events: { type: "boolean" },
  release: { type: "string" },
  compare: { type: "boolean" },
  "explain-model-context": { type: "boolean" },
  slack: { type: "string" },
  weight: { type: "string", multiple: true },
  setup: { type: "string" },
} as const;
const parse = (args: string[]) =>
  parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: CLI_OPTIONS,
  });

export async function runCli(
  args: string[],
  cwd = process.cwd(),
): Promise<string> {
  const { values, positionals } = parse(args);
  if (values.help) return HELP;
  if (positionals[0] === "init") return runInit(positionals, cwd);
  // pathcompiler.yaml gates capabilities; without it nothing is gated.
  const configured = await loadConfig(cwd);
  if (positionals[0] === "config")
    return runConfigShow(positionals, values, configured);
  if (configured)
    applyConfig(positionals, values, configured.config, configured.file);
  if (
    (positionals[0] === "graph" && positionals[1] === "inspect") ||
    (positionals[0] === "capabilities" && positionals[1] === "list")
  )
    return runInspect(positionals, values, cwd);
  if (
    (values.port !== undefined || values.host !== undefined) &&
    !["serve", "mcp", "github-app"].includes(positionals[0] ?? "")
  )
    throw new Error("--port and --host are only supported by serve.");
  if (
    (values.config !== undefined ||
      values.name !== undefined ||
      values.url !== undefined ||
      values.webhook !== undefined) &&
    positionals[0] !== "github-app"
  )
    throw new Error(
      "--config, --name, --url and --webhook are only supported by github-app.",
    );
  if (
    (values.context !== undefined ||
      values["max-depth"] !== undefined ||
      values["timeout-ms"] !== undefined ||
      values.model !== undefined) &&
    positionals[0] !== "reason" &&
    !(
      positionals[0] === "observe" &&
      positionals[1] === "reconcile" &&
      values.context === undefined
    )
  )
    throw new Error(
      "--context, --max-depth, --timeout-ms and --model are only supported by reason reachable, plan, why-not and verify (and --model, --max-depth, --timeout-ms by observe reconcile).",
    );
  if (
    values.property !== undefined &&
    !(positionals[0] === "reason" && positionals[1] === "verify")
  )
    throw new Error("--property is only supported by reason verify.");
  if (
    values.reasoning &&
    !(
      positionals[0] === "impact" ||
      (positionals[0] === "proposals" && positionals[1] === "generate")
    )
  )
    throw new Error(
      "--reasoning is only supported by impact and proposals generate.",
    );
  if (values.events && positionals[0] !== "serve")
    throw new Error("--events is only supported by serve.");
  if (values.release !== undefined && positionals[0] !== "observe")
    throw new Error(
      "--release is only supported by observe graph and observe workflows.",
    );
  if (positionals[0] === "observe") return runObserve(positionals, values, cwd);
  if (values["explain-model-context"] && positionals[0] !== "scan")
    throw new Error("--explain-model-context is only supported by scan.");
  if (values.weight !== undefined && positionals[0] !== "reason")
    throw new Error("--weight is only supported by reason optimize.");
  if (values.slack !== undefined && positionals[0] !== "reason")
    throw new Error("--slack is only supported by reason alternatives.");
  if (values.compare && positionals[0] !== "eval")
    throw new Error("--compare is only supported by eval workflow-discovery.");
  if (values.setup !== undefined && positionals[0] !== "tests")
    throw new Error("--setup is only supported by tests generate.");
  if (positionals[0] === "tests" && positionals[1] === "generate")
    return runGenerateTests(positionals, values, cwd);
  if (positionals[0] === "eval") return runEval(positionals, values, cwd);
  if (
    positionals[0] === "scan" &&
    positionals.length === 2 &&
    positionals[1] &&
    values["explain-model-context"]
  )
    return explainModelContext(
      path.resolve(cwd, positionals[1]),
      values,
      cwd,
      configured?.config.model_provider.provider ?? "none",
    );

  if (positionals[0] === "github-app") return runGitHubApp(positionals, values);
  if (
    (values.criteria !== undefined || values.tests !== undefined) &&
    positionals[0] !== "evaluate"
  )
    throw new Error("--criteria and --tests are only supported by evaluate.");
  if (positionals[0] === "evaluate")
    return runEvaluate(positionals, values, cwd);
  if (positionals[0] === "reason" && positionals[1] === "diff")
    return runSemanticDiff(positionals, values, cwd);
  if (positionals[0] === "reason" && positionals[1] === "dead-features")
    return runDeadFeatures(positionals, values, cwd);
  if (positionals[0] === "reason" && positionals[1] === "verify")
    return runVerify(positionals, values, cwd);
  if (positionals[0] === "reason") return runReason(positionals, values, cwd);
  if (values.format !== undefined && positionals[0] !== "build")
    throw new Error("--format is only supported by build.");
  if (values.dir !== undefined && positionals[0] !== "docs")
    throw new Error("--dir is only supported by docs export.");
  if (
    positionals[0] === "docs" &&
    positionals[1] === "export" &&
    positionals.length === 2
  ) {
    if (values.exclude !== undefined)
      throw new Error(
        "docs export renders approved workflows and does not support --exclude.",
      );
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const target = path.resolve(cwd, values.dir ?? "docs/help");
    const pages = renderHelpPages(
      compileWorkflows(await readApproved(output)).documentation,
    );
    const wanted = new Set(pages.map(([file]) => file));
    let existing: string[] = [];
    try {
      existing = (await readdir(target)).filter((name) => name.endsWith(".md"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Preflight: never replace or delete hand-written Markdown.
    const generated: string[] = [];
    for (const name of existing) {
      const content = await readFile(path.join(target, name), "utf8");
      if (!content.startsWith(GENERATED_MARKER)) {
        if (wanted.has(name))
          throw new Error(
            `Refusing to replace hand-written ${path.join(target, name)}. Move it or choose another --dir.`,
          );
      } else generated.push(name);
    }
    await mkdir(target, { recursive: true });
    for (const [name, content] of pages) {
      const file = path.join(target, name);
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, content, "utf8");
      await rename(temporary, file);
    }
    const stale = generated.filter((name) => !wanted.has(name));
    for (const name of stale) await unlink(path.join(target, name));
    return `Exported ${pages.length - 1} help pages and an index to ${target}${stale.length ? `; removed ${stale.length} pages of workflows no longer approved` : ""}.\nPages are generated from approved workflows; edit workflows, not Markdown.\n`;
  }
  const proposalDecision =
    positionals[0] === "proposals" &&
    ["accept", "reject", "ignore"].includes(positionals[1] ?? "");
  const review =
    proposalDecision ||
    (positionals[0] === "workflows" &&
      (positionals[1] === "approve" || positionals[1] === "reject"));
  if (values.by !== undefined && !review)
    throw new Error(
      "--by is only supported by workflows approve/reject and proposals accept/reject/ignore.",
    );
  if (
    values.reason !== undefined &&
    !(
      proposalDecision ||
      (positionals[0] === "workflows" && positionals[1] === "reject")
    )
  )
    throw new Error(
      "--reason is only supported by workflows reject and proposals accept/reject/ignore.",
    );
  if (positionals[0] === "proposals")
    return runProposals(positionals, values, cwd);
  if (
    positionals[0] === "workflows" &&
    (positionals[1] === "list" || positionals[1] === "show")
  ) {
    if (values.exclude !== undefined)
      throw new Error(
        "workflows list and show read stored artifacts and do not support --exclude.",
      );
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    if (positionals[1] === "list" && positionals.length === 2) {
      const workflows = await listWorkflows(output);
      if (values.json)
        return `${JSON.stringify({ schemaVersion: 1, workflows }, null, 2)}\n`;
      const count = (state: string) =>
        workflows.filter((item) => item.state === state).length;
      return `${workflows.length} workflows: ${count("approved")} approved, ${count("rejected")} rejected, ${count("candidate")} candidates, ${count("deprecated")} deprecated.\n${workflows
        .map(
          (item) =>
            `${item.state.padEnd(9)} ${item.id}  ${item.title}  (commit ${item.commit.slice(0, 12)})`,
        )
        .join("\n")}${workflows.length ? "\n" : ""}`;
    }
    if (positionals[1] === "show" && positionals.length === 3) {
      const id = workflowId(positionals[2]);
      const stored = await readReviewState(output, id);
      const [state, relative, content, artifact] =
        stored.approved !== undefined
          ? ([
              "approved",
              stored.paths.approved,
              stored.approved,
              parseStored(stored.approved, id, parseApprovedWorkflowYaml),
            ] as const)
          : stored.deprecated !== undefined
            ? ([
                "deprecated",
                stored.paths.deprecated,
                stored.deprecated,
                parseStored(stored.deprecated, id, parseDeprecatedWorkflowYaml),
              ] as const)
            : stored.rejected !== undefined
              ? ([
                  "rejected",
                  stored.paths.rejected,
                  stored.rejected,
                  parseStored(stored.rejected, id, parseRejectedWorkflowYaml),
                ] as const)
              : stored.candidate !== undefined
                ? ([
                    "candidate",
                    stored.paths.candidate,
                    stored.candidate,
                    parseStored(stored.candidate, id, parseCandidateYaml),
                  ] as const)
                : [];
      if (!state)
        throw new Error(
          `No workflow ${id} under ${output}. Run workflows discover, or pass the --out used earlier.`,
        );
      const file = path.join(output, relative);
      if (values.json)
        return `${JSON.stringify({ schemaVersion: 1, state, path: file, artifact }, null, 2)}\n`;
      return `Workflow ${id}: ${state}\nFile: ${file}\n\n${content}`;
    }
    throw new Error(
      "Expected: workflows list, or workflows show <id>. Use --help for arguments and options.",
    );
  }
  if (
    values.expect !== undefined &&
    !(positionals[0] === "capabilities" && positionals[1] === "discover")
  )
    throw new Error("--expect is only supported by capabilities discover.");
  if (
    positionals[0] === "github" &&
    positionals[1] === "inspect" &&
    positionals.length <= 3
  ) {
    if (values.json || values.node !== undefined || values.limit !== undefined)
      throw new Error(
        "github inspect supports --repo, --pr or --commit, --out and --exclude.",
      );
    if (
      !values.repo ||
      (values.pr === undefined) === (values.commit === undefined)
    )
      throw new Error(
        "github inspect requires --repo <owner/name> and exactly one of --pr <number> or --commit <sha>.",
      );
    const [owner, repo, extra] = values.repo.split("/");
    if (!owner || !repo || extra !== undefined)
      throw new Error("--repo must be a GitHub owner/name pair.");
    const token = process.env.GITHUB_TOKEN;
    if (!token)
      throw new Error(
        "Set GITHUB_TOKEN with Pull requests read permission before running github inspect.",
      );
    const provider = createGitHubProvider({ owner, repo, token });
    const directory = path.resolve(cwd, positionals[2] ?? ".");
    const git = await openGitRepository(directory);
    const project = await readSourceProject(directory, {
      exclude: values.exclude ?? [],
    });
    const source = analyzeNextProject(project);
    const pr =
      values.pr !== undefined
        ? await provider.getPullRequest(values.pr)
        : await provider.findPullRequestForCommit(values.commit ?? "");
    if (!pr)
      return "No pull request is associated with that commit. No artifacts written.\n";
    const result = associatePullRequest(source.graph, pr, {
      repositoryPath: git.getRepositoryPath(),
    });
    const after = await git.getSnapshot();
    if (
      after.commit !== project.repository.commit ||
      after.dirty !== project.repository.dirty
    )
      throw new Error(
        "Repository changed while reading PR evidence. Rescan and retry.",
      );
    result.report.diagnostics.push(...source.summary.diagnostics);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    await writeArtifacts(output, [
      [
        "reports/pr-evidence.json",
        `${JSON.stringify(result.report, null, 2)}\n`,
      ],
      ["graph/pr-graph.json", `${result.graph.serialize()}\n`],
    ]);
    return `Associated PR #${pr.number} with ${result.report.associatedNodeIds.length} graph nodes.\nArtifacts: ${output}\nPR context is supporting evidence; it does not establish current product behavior.\n`;
  }
  if (
    values.repo !== undefined ||
    values.pr !== undefined ||
    values.commit !== undefined
  )
    throw new Error(
      "--repo, --pr and --commit are only supported by github inspect.",
    );
  if (
    positionals[0] === "git" &&
    positionals[1] === "inspect" &&
    positionals.length <= 3
  ) {
    if (!values.node)
      throw new Error(
        "git inspect requires --node <node-id>. Run scan to find source graph node IDs.",
      );
    if (values.json)
      throw new Error(
        "git inspect writes JSON artifacts; --json is only supported by targets suggest.",
      );
    const limit = values.limit === undefined ? 20 : Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("--limit must be an integer from 1 to 100.");
    const directory = path.resolve(cwd, positionals[2] ?? ".");
    const project = await readSourceProject(directory, {
      exclude: values.exclude ?? [],
    });
    const source = analyzeNextProject(project);
    const result = await enrichNodeHistory(
      await openGitRepository(directory),
      source.graph,
      values.node,
      { limit },
    );
    result.report.diagnostics.push(...source.summary.diagnostics);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    await writeArtifacts(output, [
      [
        "reports/git-evidence.json",
        `${JSON.stringify(result.report, null, 2)}\n`,
      ],
      ["graph/history-graph.json", `${result.graph.serialize()}\n`],
    ]);
    return `Inspected ${result.report.commits.length} local commits for ${values.node}.\nArtifacts: ${output}\nCommit messages describe intent; component/action links are file associations requiring review.\n`;
  }
  if (values.node !== undefined || values.limit !== undefined)
    throw new Error("--node and --limit are only supported by git inspect.");
  if (
    positionals[0] === "targets" &&
    positionals[1] === "suggest" &&
    positionals.length <= 3
  ) {
    if (values.out !== undefined)
      throw new Error(
        "targets suggest prints to stdout and does not support --out.",
      );
    const report = suggestTargets(
      await scanNextRepository(path.resolve(cwd, positionals[2] ?? "."), {
        exclude: values.exclude ?? [],
      }),
    );
    if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
    const mappings = report.targets
      .map((item) =>
        [
          item.target.semanticId
            ? `Annotated target: ${item.target.semanticId}`
            : item.suggestedTarget
              ? `Suggested target: ${item.suggestedTarget}`
              : "Needs review: no safe target suggestion",
          `File: ${item.file}`,
          `Locator: ${item.locator}`,
          `Confidence: ${item.target.confidence} (${item.target.source})`,
          ...item.target.issues.map((issue) => `Issue: ${issue}`),
        ].join("\n"),
      )
      .join("\n\n");
    const diagnostics = report.diagnostics
      .map(
        (item) =>
          `${item.code}${item.file ? ` (${item.file})` : ""}: ${item.message}`,
      )
      .join("\n");
    return `${mappings || "No UI targets found."}\n\nSuggestions require review. No files changed. Repeated elements require runtime scoping.\n${diagnostics ? `Diagnostics:\n${diagnostics}\n` : ""}`;
  }
  if (
    positionals[0] === "tests" &&
    positionals[1] === "mine" &&
    positionals.length <= 3
  ) {
    if (values.json)
      throw new Error(
        "tests mine writes JSON artifacts; --json is only supported by targets suggest.",
      );
    const project = await readSourceProject(
      path.resolve(cwd, positionals[2] ?? "."),
      { exclude: values.exclude ?? [] },
    );
    const source = analyzeNextProject(project);
    const result = minePlaywrightTests(project, source.graph);
    result.report.diagnostics.push(
      ...source.summary.diagnostics.filter(
        (item) =>
          !result.report.diagnostics.some(
            (existing) => JSON.stringify(existing) === JSON.stringify(item),
          ),
      ),
    );
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    await writeArtifacts(output, [
      [
        "reports/test-traces.json",
        `${JSON.stringify(result.report, null, 2)}\n`,
      ],
      ["graph/test-graph.json", `${result.graph.serialize()}\n`],
    ]);
    const partial = result.report.traces.filter(
      (trace) => trace.partial,
    ).length;
    return `Mined ${result.report.traces.length} Playwright tests (${partial} partial traces).\nArtifacts: ${output}\nStatic evidence only; tests were not executed. See test-traces.json for diagnostics.\n`;
  }
  if (values.json)
    throw new Error(
      "--json is only supported by targets suggest, workflows list and workflows show.",
    );
  if (
    positionals[0] === "workflows" &&
    positionals[1] === "approve" &&
    positionals.length >= 3 &&
    positionals.length <= 4
  ) {
    const id = workflowId(positionals[2]);
    const approvedBy = reviewer(values.by);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const stored = await readReviewState(output, id);
    refuseReviewed(stored, id, output);
    const { candidate, report, project, reportPath } = await validateStored(
      output,
      id,
      path.resolve(cwd, positionals[3] ?? "."),
      values.exclude ?? [],
    );
    let record: ApprovedWorkflow;
    try {
      record = approveCandidate(candidate, {
        approvedBy,
        approvedAt: new Date().toISOString(),
        validation: report,
        repository: project.repository,
      });
    } catch (error) {
      if (error instanceof ReviewError)
        throw new Error(`${error.message} Validation report: ${reportPath}.`, {
          cause: error,
        });
      throw error;
    }
    const file = path.join(output, stored.paths.approved);
    await writeExclusive(file, serializeReviewedYaml(record));
    return `Approved ${id} at commit ${record.approval.approvedCommit} by ${approvedBy}.\nArtifact: ${file}\nValidation warnings reviewed: ${report.warnings.length} (see ${reportPath}).\nCommit the approved file; it is the runtime source of truth. Browser verification is separate.\n`;
  }
  if (
    positionals[0] === "workflows" &&
    positionals[1] === "reject" &&
    positionals.length === 3
  ) {
    if (values.exclude !== undefined)
      throw new Error(
        "workflows reject does not rescan and does not support --exclude.",
      );
    const id = workflowId(positionals[2]);
    const rejectedBy = reviewer(values.by);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const stored = await readReviewState(output, id);
    refuseReviewed(stored, id, output);
    if (stored.candidate === undefined)
      throw new Error(
        `No candidate ${id} under ${output}. Run workflows discover first.`,
      );
    const candidate = parseStored(stored.candidate, id, parseCandidateYaml);
    let record: RejectedWorkflow;
    try {
      record = rejectCandidate(candidate, {
        rejectedBy,
        rejectedAt: new Date().toISOString(),
        ...(values.reason === undefined ? {} : { reason: values.reason }),
      });
    } catch (error) {
      throw new Error(
        "Cannot record the rejection. --reason must be 1–500 characters.",
        { cause: error },
      );
    }
    const file = path.join(output, stored.paths.rejected);
    await writeExclusive(file, serializeReviewedYaml(record));
    return `Rejected ${id} by ${rejectedBy}.\nRecord: ${file}\nThe candidate stays in discovery cache; remove the record to review it again.\n`;
  }
  if (
    (positionals[0] === "mcp" || positionals[0] === "serve") &&
    positionals.length === 1
  ) {
    if (values.exclude !== undefined)
      throw new Error(
        `${positionals[0]} serves generated artifacts and does not support --exclude.`,
      );
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    if (positionals[0] === "mcp") {
      if (values.port !== undefined || values.host !== undefined)
        throw new Error("--port and --host are only supported by serve.");
      await serveStdio(await loadGeneratedClient(output));
      process.stderr.write(
        `PathCompiler MCP server ready on stdio (artifacts: ${output}).\n`,
      );
      return "";
    }
    const token = process.env.PATHCOMPILER_API_TOKEN;
    if (!token || token.length < 16)
      throw new Error(
        "Set PATHCOMPILER_API_TOKEN to a secret of at least 16 characters before running serve.",
      );
    const port = values.port === undefined ? 4310 : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65_535)
      throw new Error("--port must be an integer from 0 to 65535.");
    const host = values.host ?? "127.0.0.1";
    const ingestToken = process.env.PATHCOMPILER_INGEST_TOKEN;
    if (ingestToken !== undefined && ingestToken.length < 16)
      throw new Error(
        "PATHCOMPILER_INGEST_TOKEN must be at least 16 characters when set.",
      );
    const eventsDirectory = path.join(output, "events");
    const server = createHttpService({
      client: await loadGeneratedClient(output),
      token,
      ...(values.events
        ? {
            events: {
              sink: createFileEventSink(eventsDirectory),
              ...(ingestToken ? { ingestToken } : {}),
              ...(configured
                ? { policy: analyticsPolicy(configured.config) }
                : {}),
            },
          }
        : {}),
      onError: (error) =>
        process.stderr.write(
          `PathCompiler HTTP error: ${error instanceof Error ? error.message : String(error)}\n`,
        ),
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
    const address = server.address();
    const bound = address && typeof address === "object" ? address.port : port;
    return `PathCompiler HTTP service listening on http://${host.includes(":") ? `[${host}]` : host}:${bound} (artifacts: ${output}).\n${values.events ? `Event ingestion: POST /v1/events/batch → ${eventsDirectory}/<project>/<day>.ndjson${ingestToken ? " (ingest token accepted)" : ""}.\n` : ""}`;
  }
  if (
    positionals[0] === "impact" &&
    positionals.length >= 3 &&
    positionals.length <= 4
  ) {
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const approved = await readApproved(output);
    if (!approved.length)
      throw new Error(
        `No approved workflows under ${path.join(output, "workflows")}. Approve workflows before analyzing impact.`,
      );
    const range = {
      directory: path.resolve(cwd, positionals[3] ?? "."),
      base: positionals[1] ?? "",
      head: positionals[2] ?? "",
      exclude: values.exclude ?? [],
    };
    let delta: Awaited<ReturnType<typeof analyzeCommitRange>>;
    let semantic: SemanticChangeReport | undefined;
    if (values.reasoning) {
      const detailed = await analyzeCommitRangeDetailed(range);
      delta = detailed.delta;
      semantic = await semanticChange(detailed);
    } else delta = await analyzeCommitRange(range);
    const report = analyzeWorkflowImpact(
      delta,
      approved,
      semantic ? { semantic: semantic.affectedWorkflows } : {},
    );
    await writeArtifacts(output, [
      ["reports/graph-delta.json", `${JSON.stringify(delta, null, 2)}\n`],
      ["reports/workflow-impact.json", `${JSON.stringify(report, null, 2)}\n`],
      ...(semantic
        ? ([
            [
              "reports/semantic-change.json",
              `${JSON.stringify(semantic, null, 2)}\n`,
            ],
          ] as const)
        : []),
    ]);
    const lines = report.impacts.map(
      (item) =>
        `${item.severity.padEnd(6)} ${item.workflowId}${item.reasons.length ? `  ${item.reasons.map((reason) => reason.code).join(", ")}` : ""}`,
    );
    return `Impact of ${delta.base.commit.slice(0, 12)}..${delta.head.commit.slice(0, 12)} on ${report.impacts.length} approved workflows:\n${lines.join("\n")}\nReport: ${path.join(output, "reports/workflow-impact.json")}\nApproved workflows were not changed. Medium/high impact needs a reviewed update.\n`;
  }
  if (
    positionals[0] === "diff" &&
    positionals.length >= 3 &&
    positionals.length <= 4
  ) {
    const delta = await analyzeCommitRange({
      directory: path.resolve(cwd, positionals[3] ?? "."),
      base: positionals[1] ?? "",
      head: positionals[2] ?? "",
      exclude: values.exclude ?? [],
    });
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const relative = "reports/graph-delta.json";
    await writeArtifacts(output, [
      [relative, `${JSON.stringify(delta, null, 2)}\n`],
    ]);
    const count = (list: {
      added: string[];
      removed: string[];
      changed: string[];
    }) =>
      `+${list.added.length} -${list.removed.length} ~${list.changed.length}`;
    const { summary } = delta;
    return `Graph delta ${delta.base.commit.slice(0, 12)}..${delta.head.commit.slice(0, 12)}: ${summary.files.length} files changed.\nRoutes ${count(summary.routes)}, targets ${count(summary.targets)}, APIs ${count(summary.apis)}, symbols ${count(summary.symbols)}.\nNodes +${delta.addedNodes.length} -${delta.removedNodes.length} ~${delta.changedNodes.length}; edges +${delta.addedEdges.length} -${delta.removedEdges.length}.\nReport: ${path.join(output, relative)}\n`;
  }
  if (positionals[0] === "build" && positionals.length === 1) {
    if (values.exclude !== undefined)
      throw new Error(
        "build compiles stored approved workflows and does not support --exclude.",
      );
    const formats = (values.format ?? ["json"])
      .flatMap((item) => item.split(","))
      .map((item) => item.trim());
    const unknown = formats.filter(
      (item) => !(EXPORT_FORMATS as readonly string[]).includes(item),
    );
    if (unknown.length || !formats.length)
      throw new Error(
        `--format must be ${EXPORT_FORMATS.join(", ")} (comma-separated or repeated).`,
      );
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const compiled = compileWorkflows(await readApproved(output));
    const files = exportArtifacts(compiled, formats as ExportFormat[]);
    await writeArtifacts(output, files);
    return `Compiled ${compiled.searchIndex.workflows.length} approved workflows with compiler ${COMPILER_VERSION} (${[...new Set(formats)].sort().join(", ")}).\nArtifacts: ${files.map(([file]) => path.join(output, file)).join(", ")}\nStatic artifacts need no PathCompiler server at runtime. Candidates and rejected workflows are excluded; the runtime manifest omits evidence, commits and review data.\n`;
  }
  if (
    positionals[0] === "workflows" &&
    positionals[1] === "detect" &&
    positionals.length >= 4 &&
    positionals.length <= 5
  ) {
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const scanned = path.resolve(cwd, positionals[4] ?? ".");
    const { delta, base, head } = await analyzeCommitRangeDetailed({
      directory: scanned,
      base: positionals[2] ?? "",
      head: positionals[3] ?? "",
      exclude: values.exclude ?? [],
    });
    const headCapabilities = discoverCapabilities(head.mined.graph);
    const report = detectNewWorkflows({
      delta,
      baseCapabilities: discoverCapabilities(base.mined.graph).report
        .capabilities,
      headCapabilities: headCapabilities.report.capabilities,
      candidates: discoverWorkflows(
        headCapabilities.graph,
        headCapabilities.report,
        head.mined.report,
      ).report.candidates,
      approved: await readApproved(output),
      rejected: await readRejected(output),
      commitSubjects: (await rangeCommits(scanned, delta)).map(
        (commit) => commit.message.split("\n")[0] ?? "",
      ),
    });
    await writeArtifacts(output, [
      ["reports/new-workflows.json", `${JSON.stringify(report, null, 2)}\n`],
    ]);
    const written: string[] = [];
    for (const detection of report.detections) {
      if (!detection.candidate) continue;
      const file = path.join(
        output,
        reviewPaths(detection.candidate.workflow.id).candidate,
      );
      if ((await readOptional(file)) !== undefined) continue;
      await writeExclusive(file, serializeCandidateYaml(detection.candidate));
      written.push(detection.candidate.workflow.id);
    }
    return `${report.detections.length} new capabilities without approved workflows:\n${report.detections
      .map(
        (item) =>
          `${item.status.padEnd(21)} ${item.capabilityId}  confidence ${item.confidence} (${item.signals.map((signal) => signal.signal).join(", ")})`,
      )
      .join(
        "\n",
      )}${report.detections.length ? "\n" : ""}Wrote ${written.length} candidates (${head.commit.slice(0, 12)}); existing candidate files were kept.\nReport: ${path.join(output, "reports/new-workflows.json")}\nCandidates require validation and approval at their commit.\n`;
  }
  if (
    positionals[0] === "workflows" &&
    positionals[1] === "validate" &&
    positionals.length >= 3 &&
    positionals.length <= 4
  ) {
    const id = workflowId(positionals[2]);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const { report, reportPath } = await validateStored(
      output,
      id,
      path.resolve(cwd, positionals[3] ?? "."),
      values.exclude ?? [],
    );
    if (!report.valid)
      throw new Error(
        `Workflow ${id} failed validation (${report.errors.length} errors). See ${reportPath}.`,
      );
    return `Workflow ${id} passed static validation (${report.warnings.length} warnings).\nReport: ${reportPath}\nBrowser verification has not run. Review warnings before approval or execution.\n`;
  }
  if (
    positionals[0] === "workflows" &&
    positionals[1] === "discover" &&
    positionals.length <= 3
  ) {
    const project = await readSourceProject(
      path.resolve(cwd, positionals[2] ?? "."),
      { exclude: values.exclude ?? [] },
    );
    const source = analyzeNextProject(project);
    const mined = minePlaywrightTests(project, source.graph);
    const capabilities = discoverCapabilities(mined.graph);
    const result = discoverWorkflows(
      capabilities.graph,
      capabilities.report,
      mined.report,
    );
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const candidates = result.report.candidates.map(
      (candidate) =>
        [
          `workflows/candidates/${candidate.workflow.id}.yaml`,
          serializeCandidateYaml(candidate),
        ] as const,
    );
    // Preflight every destination before replacing any candidate or report.
    for (const [relative] of candidates) {
      let existing: string;
      try {
        existing = await readFile(path.join(output, relative), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      try {
        parseCandidateYaml(existing);
      } catch (error) {
        throw new Error(
          `Refusing to replace ${relative}: it is not a valid unapproved candidate. Choose a new --out directory or move the existing artifact.`,
          { cause: error },
        );
      }
    }
    await writeArtifacts(output, [
      ...candidates,
      [
        "reports/workflow-candidates.json",
        `${JSON.stringify(result.report, null, 2)}\n`,
      ],
      ["graph/workflow-graph.json", `${result.graph.serialize()}\n`],
    ]);
    return `Discovered ${result.report.candidates.length} workflow candidates; ${result.report.skipped.length} capabilities need more evidence.\nArtifacts: ${output}\nAll candidates require review. Schema passed; repository, evidence, test comparison and browser validation have not run.\n`;
  }
  if (
    positionals[0] === "capabilities" &&
    positionals[1] === "discover" &&
    positionals.length <= 3
  ) {
    let expectedCapabilityIds: string[] | undefined;
    if (values.expect !== undefined) {
      try {
        expectedCapabilityIds = CapabilityExpectationsSchema.parse(
          JSON.parse(await readFile(path.resolve(cwd, values.expect), "utf8")),
        ).capabilityIds;
      } catch (error) {
        throw new Error(
          "Cannot read capability expectations. Provide a JSON file with schemaVersion: 1 and unique capabilityIds (domain.action).",
          { cause: error },
        );
      }
    }
    const project = await readSourceProject(
      path.resolve(cwd, positionals[2] ?? "."),
      { exclude: values.exclude ?? [] },
    );
    const source = analyzeNextProject(project);
    const mined = minePlaywrightTests(project, source.graph);
    const result = discoverCapabilities(
      mined.graph,
      expectedCapabilityIds === undefined ? {} : { expectedCapabilityIds },
    );
    for (const diagnostic of [
      ...source.summary.diagnostics,
      ...mined.report.diagnostics,
    ])
      if (
        !result.report.diagnostics.some(
          (item) => JSON.stringify(item) === JSON.stringify(diagnostic),
        )
      )
        result.report.diagnostics.push(diagnostic);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    await writeArtifacts(output, [
      [
        "reports/capabilities.json",
        `${JSON.stringify(result.report, null, 2)}\n`,
      ],
      ["graph/capability-graph.json", `${result.graph.serialize()}\n`],
    ]);
    const evaluation = result.report.evaluation;
    const measured =
      evaluation.status === "evaluated"
        ? `False positives: ${evaluation.falsePositiveCount}; false negatives: ${evaluation.falseNegativeCount}.`
        : "False positives: not evaluated (supply --expect for measured counts).";
    return `Discovered ${result.report.capabilities.length} candidate capabilities.\n${measured}\nArtifacts: ${output}\nAll candidates require review. Confidence measures rule strength, not probability; tests were not executed.\n`;
  }
  if (
    positionals[0] === "surfaces" &&
    positionals[1] === "discover" &&
    positionals.length <= 3
  ) {
    const source = await scanNextRepository(
      path.resolve(cwd, positionals[2] ?? "."),
      { exclude: values.exclude ?? [] },
    );
    const result = discoverProductSurfaces(source.graph);
    result.report.diagnostics.push(...source.summary.diagnostics);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    await writeArtifacts(output, [
      [
        "reports/product-surfaces.json",
        `${JSON.stringify(result.report, null, 2)}\n`,
      ],
      ["graph/surface-graph.json", `${result.graph.serialize()}\n`],
    ]);
    return `Discovered ${result.report.surfaces.length} candidate product surfaces.\nArtifacts: ${output}\nStatic render relationships require review; they do not establish runtime visibility or approval.\n`;
  }
  if (positionals[0] !== "scan" || positionals.length !== 2 || !positionals[1])
    throw new Error(
      "Expected: pathcompiler scan, targets suggest, tests mine, git inspect, github inspect, surfaces discover, capabilities discover, workflows discover/detect/validate/list/show/approve/reject, diff, impact, proposals, build, docs export, github-app, mcp, or serve. Use --help for arguments and options.",
    );
  const result = await scanNextRepository(path.resolve(cwd, positionals[1]), {
    exclude: values.exclude ?? [],
  });
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const artifacts = [
    ["graph/source-graph.json", `${result.graph.serialize()}\n`],
    [
      "reports/scan-summary.json",
      `${JSON.stringify(result.summary, null, 2)}\n`,
    ],
  ] as const;
  await writeArtifacts(output, artifacts);
  return `Scanned ${result.summary.filesAnalyzed} source files: ${result.summary.nodes} nodes, ${result.summary.edges} edges.\nArtifacts: ${output}\nDiagnostics: ${result.summary.diagnostics.length} (see scan-summary.json).\n`;
}

async function runGenerateTests(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  if (positionals.length > 3)
    throw new Error(
      "Expected: pathcompiler tests generate [directory]. Use --help for options.",
    );
  if (values.model !== undefined)
    throw new Error(
      "tests generate extracts the model from the repository; --model is not supported.",
    );
  const project = await readSourceProject(
    path.resolve(cwd, positionals[2] ?? "."),
    { exclude: values.exclude ?? [] },
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const discovered = discoverCapabilities(mined.graph);
  const { model } = buildFormalModel(
    discovered.graph,
    discovered.report,
    mined.report,
  );
  const terminals = Object.fromEntries(
    discoverWorkflows(
      discovered.graph,
      discovered.report,
      mined.report,
    ).report.candidates.map((candidate) => [
      candidate.capabilityId,
      candidate.workflow.terminal,
    ]),
  );
  let setup: TestSetup | undefined;
  if (values.setup !== undefined) {
    const parsed = TestSetupSchema.safeParse(
      JSON.parse(await readFile(path.resolve(cwd, values.setup), "utf8")),
    );
    if (!parsed.success)
      throw new Error(
        `Invalid test setup ${values.setup}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
      );
    setup = parsed.data;
  }
  const solver = await createZ3SolverProvider();
  let report: GenerationReport;
  try {
    report = await generateTests({
      reasoner: createProductReasoner(solver),
      model,
      graph: discovered.graph,
      terminals,
      ...(setup ? { setup } : {}),
    });
  } finally {
    await solver.close();
  }
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  await writeArtifacts(output, [
    ...report.tests.map(
      (item) => [`generated-tests/${item.file}`, item.content] as const,
    ),
    [
      "reports/generated-tests.json",
      `${JSON.stringify({ ...report, tests: report.tests.map(({ content: _content, ...rest }) => rest) }, null, 2)}\n`,
    ],
  ]);
  const positive = report.tests.filter((item) => item.kind === "positive");
  const weak = report.tests.filter((item) => item.weakAssertion).length;
  return [
    `Generated ${report.tests.length} candidate tests (${positive.length} positive, ${report.tests.length - positive.length} negative) in ${path.join(output, "generated-tests")}; ${weak} have a weak completion check.`,
    ...report.skipped.map((item) => `  skipped ${item.goal}: ${item.reason}`),
    "Review before adopting: generated tests are candidates, not part of the product's suite.",
    "",
  ].join("\n");
}

async function runDeadFeatures(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  if (positionals.length > 3)
    throw new Error(
      "Expected: pathcompiler reason dead-features [directory]. Use --help for options.",
    );
  const { model, capabilities } = await loadReasoningModel(
    positionals[2],
    values,
    cwd,
  );
  const solver = await createZ3SolverProvider();
  let report: DeadFeatureReport;
  try {
    report = await detectDeadFeatures(createProductReasoner(solver), model, {
      ...(capabilities
        ? {
            capabilities: capabilities.capabilities.map((item) => ({
              id: item.id,
              uiEvidence: item.inferences.map((entry) => entry.nodeId),
              apiEvidence: item.apiEvidence.map((entry) => entry.nodeId),
            })),
          }
        : {}),
    });
  } finally {
    await solver.close();
  }
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const file = "reports/reasoning/dead-features.json";
  await writeArtifacts(output, [
    [file, `${JSON.stringify(report, null, 2)}\n`],
  ]);
  if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
  const lines = [
    `Checked ${report.checked.goals} capability goals, ${report.checked.actions} actions${capabilities ? ` and ${report.checked.capabilities} discovered capabilities` : ""}: ${report.findings.length === 0 ? "no dead features or missing transitions." : `${report.findings.length} candidate finding(s) to review:`}`,
  ];
  for (const finding of report.findings)
    lines.push(
      finding.kind === "unreachable-capability"
        ? `  UNREACHABLE CAPABILITY ${finding.capabilityId}: no context reaches ${finding.goal} (${finding.constraints.map((item) => item.description).join("; ")}). Possible causes: ${finding.possibleCauses.join(", ")}.`
        : finding.kind === "dead-action"
          ? `  DEAD ACTION ${finding.actionId}${finding.semanticTarget ? ` [${finding.semanticTarget}]` : ""}: can never be performed. Possible causes: ${finding.possibleCauses.join(", ")}.`
          : finding.kind === "missing-transition"
            ? `  POTENTIAL MODEL OR PRODUCT GAP ${finding.capabilityId}: UI (${finding.uiEvidence.join(", ")}) and API (${finding.apiEvidence.join(", ")}) exist, but no formal trace connects them. Possible causes: ${finding.possibleCauses.join(", ")}.`
            : `  UNKNOWN ${finding.subject}: ${finding.reason}.`,
    );
  lines.push(
    "Findings are candidates for review, not verdicts.",
    `Report: ${path.join(output, file)}`,
  );
  return `${lines.join("\n")}\n`;
}

const COST_CATEGORIES = [
  "navigation",
  "entry",
  "field",
  "submit",
  "confirmation",
  "back",
  "cancel",
  "other",
] as const;
async function runOptimize(
  goal: string,
  model: FormalProductModel,
  query: ReachabilityQuery,
  extraction: Awaited<ReturnType<typeof loadReasoningModel>>["extraction"],
  values: Values,
  cwd: string,
): Promise<string> {
  const weights: CostWeights = {};
  for (const entry of values.weight ?? []) {
    const [category, raw] = entry.split("=");
    const value = Number(raw);
    if (
      !COST_CATEGORIES.includes(category as (typeof COST_CATEGORIES)[number]) ||
      !(value > 0)
    )
      throw new Error(
        `--weight expects <category>=<positive number> with a category from ${COST_CATEGORIES.join(", ")}; got ${entry}.`,
      );
    weights[category as (typeof COST_CATEGORIES)[number]] = value;
  }
  // Categories come from the extraction; a supplied model has none, so
  // every action is "other".
  const categories = extraction ? actionCategories(extraction) : {};
  const costs = costsFromCategories(model, categories, weights);
  const solver = await createZ3SolverProvider();
  let result: CheapestPlanResult;
  let alternatives: PlanEnumerationResult | undefined;
  try {
    const reasoner = createProductReasoner(solver);
    result = await findCheapestPlan(reasoner, model, { ...query, costs });
    // Alternatives for the ranking: every plan up to one step longer.
    if (result.status === "found")
      alternatives = await reasoner.enumeratePlans(model, {
        ...query,
        slack: 1,
      });
  } finally {
    await solver.close();
  }
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const file = `reports/reasoning/optimize/${goal}.json`;
  const given =
    Object.entries(query.context ?? {})
      .map(([name, value]) => `${name}=${value}`)
      .join(", ") || "any context";
  if (result.status !== "found") {
    const report = { schemaVersion: 1, type: "optimization_result", result };
    await writeArtifacts(output, [
      [file, `${JSON.stringify(report, null, 2)}\n`],
    ]);
    if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
    return `${goal} under ${given}: ${result.status === "impossible" ? "IMPOSSIBLE (no plan)" : `UNKNOWN (${result.status === "unknown" ? result.reason : ""})`}.\nReport: ${path.join(output, file)}\n`;
  }
  // Variants (the cheapest plan plus every plan up to one step longer),
  // ranked by their cheapest member.
  const pool = [
    result.plan,
    ...(alternatives?.status === "found" ? alternatives.plans : []),
  ];
  const costOf = (plan: Plan) =>
    plan.steps.reduce((total, step) => total + (costs[step.actionId] ?? 1), 0);
  const variants = clusterTraces(pool)
    .variants.map((variant) => ({
      majorActions: variant.signature.majorActions,
      cost: Math.min(
        ...variant.members.map((index) => costOf(pool[index] as Plan)),
      ),
      plans: variant.members.length,
    }))
    .sort((a, b) => a.cost - b.cost);
  const metrics = uxMetrics(result.plan, categories, {
    variants: variants.length,
    cost: result.plan.cost,
  });
  const report = {
    schemaVersion: 1,
    type: "optimization_result",
    weights: { ...DEFAULT_COST_WEIGHTS, ...weights },
    result,
    variants,
    uxMetrics: metrics,
  };
  await writeArtifacts(output, [
    [file, `${JSON.stringify(report, null, 2)}\n`],
  ]);
  if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
  const lines = [
    `${goal} under ${given}: cheapest plan costs ${result.plan.cost} (${result.costOptimality === "optimal" ? "optimal" : "optimality not guaranteed"}; ${result.plan.length} steps).`,
    ...result.plan.steps.map(
      (step, index) =>
        `  ${index + 1}. ${step.actionId}${step.semanticTarget ? ` [${step.semanticTarget}]` : ""} (${categories[step.actionId] ?? "other"}, ${step.cost})`,
    ),
    `Variants by cost: ${variants.map((variant) => `${variant.majorActions.join(" → ")} = ${variant.cost}`).join("; ")}.`,
    `UX metrics (hypotheses): ${metrics.actions} actions, ${metrics.pageTransitions} page transitions, ${metrics.formFields} form fields, ${metrics.dialogInteractions} dialog interactions, ${metrics.confirmations} confirmations.`,
    ...metrics.hypotheses.map((item) => `  - ${item}`),
    `Report: ${path.join(output, file)}`,
  ];
  return `${lines.join("\n")}\n`;
}

async function runAlternatives(
  goal: string,
  model: FormalProductModel,
  query: ReachabilityQuery & { slack?: number; limit?: number },
  values: Values,
  cwd: string,
): Promise<string> {
  const solver = await createZ3SolverProvider();
  let result: PlanEnumerationResult;
  try {
    result = await createProductReasoner(solver).enumeratePlans(model, query);
  } finally {
    await solver.close();
  }
  const clustering =
    result.status === "found" ? clusterTraces(result.plans) : undefined;
  const report = {
    schemaVersion: 1,
    type: "alternatives_result",
    result,
    ...(clustering ? { variants: clustering } : {}),
  };
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const file = `reports/reasoning/alternatives/${goal}.json`;
  await writeArtifacts(output, [
    [file, `${JSON.stringify(report, null, 2)}\n`],
  ]);
  if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
  const given =
    Object.entries(query.context ?? {})
      .map(([name, value]) => `${name}=${value}`)
      .join(", ") || "any context";
  if (result.status !== "found" || !clustering)
    return `${goal} under ${given}: ${result.status === "impossible" ? "IMPOSSIBLE (no plan)" : `UNKNOWN (${result.status === "unknown" ? result.reason : ""})`}.\nReport: ${path.join(output, file)}\n`;
  const lines = [
    `${goal} under ${given}: ${clustering.variants.length} variant(s) from ${result.plans.length} plans of ${result.shortest}–${result.maxLength} steps${result.complete ? "" : " (limit reached; more plans exist)"}; ${Math.round(clustering.duplicateRate * 100)}% of plans repeat a variant.`,
  ];
  for (const [index, variant] of clustering.variants.entries()) {
    const plan = result.plans[variant.representative];
    lines.push(
      `  ${index + 1}. ${variant.signature.majorActions.join(" → ")} (${variant.members.length} plan${variant.members.length === 1 ? "" : "s"}; entry ${variant.signature.entryCapability ?? "none"})`,
      `     shortest: ${plan?.steps.map((step) => step.actionId).join(" → ")}`,
    );
  }
  lines.push(`Report: ${path.join(output, file)}`);
  return `${lines.join("\n")}\n`;
}

async function runEnable(
  goal: string,
  model: FormalProductModel,
  query: ReachabilityQuery,
  extraction: Awaited<ReturnType<typeof loadReasoningModel>>["extraction"],
  values: Values,
  cwd: string,
): Promise<string> {
  const solver = await createZ3SolverProvider();
  let result: MinimalEnablementResult;
  try {
    result = await findMinimalEnablement(
      createProductReasoner(solver),
      model,
      query,
      {
        ...(query.maxDepth === undefined ? {} : { maxDepth: query.maxDepth }),
        ...(query.timeoutMs === undefined
          ? {}
          : { timeoutMs: query.timeoutMs }),
      },
    );
  } finally {
    await solver.close();
  }
  const report = {
    schemaVersion: 1,
    type: "enablement_result",
    result,
    ...(extraction
      ? {
          modelCoverage: extraction.coverage,
          uncertainties: extraction.uncertainties,
        }
      : {}),
  };
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const file = `reports/reasoning/enablement/${goal}.json`;
  await writeArtifacts(output, [
    [file, `${JSON.stringify(report, null, 2)}\n`],
  ]);
  if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
  const given =
    Object.entries(result.context)
      .map(([name, value]) => `${name}=${value}`)
      .join(", ") || "any context";
  const lines = [
    result.status === "already-reachable"
      ? `${goal} under ${given}: ALREADY REACHABLE; nothing to enable.`
      : result.status === "not-enableable"
        ? `${goal} under ${given}: NOT ENABLEABLE by context, role, flag or permission changes; the block is structural (see reason why-not).`
        : result.status === "unknown"
          ? `${goal} under ${given}: UNKNOWN${result.limit ? ` (${result.limit})` : ""}.`
          : `${goal} under ${given}: ${result.corrections.length} minimal change set(s) of size ${result.corrections[0]?.changes.length}${result.minimum ? "" : " (minimality not guaranteed)"}:`,
  ];
  for (const [index, correction] of result.corrections.entries()) {
    lines.push(`  ${index + 1}.`);
    for (const change of correction.changes)
      lines.push(`     - ${change.description}: ${change.suggestion}`);
  }
  lines.push(
    "Diagnostic only: nothing was changed. Permission and flag changes are a product decision.",
    `Report: ${path.join(output, file)}`,
  );
  return `${lines.join("\n")}\n`;
}

async function runReason(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const mode = positionals[1];
  if (
    (mode !== "reachable" &&
      mode !== "plan" &&
      mode !== "why-not" &&
      mode !== "enable" &&
      mode !== "alternatives" &&
      mode !== "optimize") ||
    positionals.length < 3 ||
    positionals.length > 4
  )
    throw new Error(
      "Expected: pathcompiler reason reachable|plan|why-not|enable|alternatives|optimize <goal> [directory]. Use --help for options.",
    );
  if (
    mode !== "alternatives" &&
    (values.slack !== undefined || values.limit !== undefined)
  )
    throw new Error(
      "--slack and --limit are only supported by reason alternatives.",
    );
  if (mode !== "optimize" && values.weight !== undefined)
    throw new Error("--weight is only supported by reason optimize.");
  const goal = positionals[2] as string;
  const integer = (flag: string, value: string | undefined) => {
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value))
      throw new Error(`--${flag} must be a non-negative integer.`);
    return Number(value);
  };
  const maxDepth = integer("max-depth", values["max-depth"]);
  const timeoutMs = integer("timeout-ms", values["timeout-ms"]);
  const { model, extraction } = await loadReasoningModel(
    positionals[3],
    values,
    cwd,
  );
  const context = parseContext(values.context, model);
  const query = {
    goal,
    context,
    ...(maxDepth === undefined ? {} : { maxDepth }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
  if (mode === "enable")
    return runEnable(goal, model, query, extraction, values, cwd);
  if (mode === "optimize")
    return runOptimize(goal, model, query, extraction, values, cwd);
  if (mode === "alternatives") {
    const slack = integer("slack", values.slack);
    const limit = integer("limit", values.limit);
    return runAlternatives(
      goal,
      model,
      {
        ...query,
        ...(slack === undefined ? {} : { slack }),
        ...(limit === undefined ? {} : { limit }),
      },
      values,
      cwd,
    );
  }
  const solver = await createZ3SolverProvider();
  let result: ReachabilityResult | PlanResult | ExplanationResult;
  try {
    const reasoner = createProductReasoner(solver);
    result =
      mode === "plan"
        ? await reasoner.findPlan(model, query)
        : mode === "why-not"
          ? await reasoner.explainUnreachable(model, query)
          : await reasoner.checkReachability(model, query);
  } finally {
    await solver.close();
  }
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  let evaluation: PlanEvaluation | undefined;
  let compared: string | undefined;
  if (result.status === "found") {
    const capability = model.goals.find(
      (item) => item.id === goal,
    )?.capabilityId;
    const file = capability
      ? path.join(output, "workflows", `${capability}.yaml`)
      : undefined;
    const approved = file ? await readOptional(file) : undefined;
    evaluation = evaluatePlan(
      model,
      result.plan,
      approved ? parseApprovedWorkflowYaml(approved).workflow : undefined,
    );
    if (approved) compared = capability;
  }
  const report = {
    schemaVersion: 1,
    type:
      mode === "plan"
        ? "plan_result"
        : mode === "why-not"
          ? "explanation_result"
          : "reachability_result",
    result,
    ...(evaluation ? { evaluation } : {}),
    ...(compared ? { comparedWorkflow: compared } : {}),
    ...(extraction
      ? {
          modelCoverage: extraction.coverage,
          uncertainties: extraction.uncertainties,
        }
      : {}),
  };
  const file =
    mode === "plan"
      ? `reports/reasoning/plans/${goal}.json`
      : mode === "why-not"
        ? `reports/reasoning/why-not/${goal}.json`
        : `reports/reasoning/${goal}.json`;
  await writeArtifacts(output, [
    [file, `${JSON.stringify(report, null, 2)}\n`],
  ]);
  if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
  const given =
    Object.entries(result.context)
      .map(([name, value]) => `${name}=${value}`)
      .join(", ") || "any context";
  const lines: string[] = [];
  const steps = (
    context: Record<string, FormalValue>,
    list: { index: number; actionId: string; semanticTarget?: string }[],
  ) => {
    const chosen = Object.entries(context)
      .filter(([name]) => !(name in result.context))
      .map(([name, value]) => `${name}=${value}`);
    if (chosen.length > 0) lines.push(`Witness context: ${chosen.join(", ")}`);
    for (const step of list)
      lines.push(
        `  ${step.index + 1}. ${step.actionId}${step.semanticTarget ? ` [${step.semanticTarget}]` : ""}`,
      );
  };
  if (result.status === "found") {
    const { plan, optimality } = result;
    lines.push(
      `${goal} under ${given}: PLAN FOUND (${plan.length} steps, cost ${plan.cost}; shortest${optimality.cost === "optimal" ? " and cheapest" : ", cheapest not guaranteed"})`,
    );
    steps(plan.context, plan.steps);
    const major = evaluation?.majorSteps;
    if (major)
      lines.push(
        `Approved workflow ${compared}: ${major.matched}/${major.expected.length} major steps matched${major.missing.length > 0 ? ` (missing ${major.missing.join(", ")})` : ""}${major.extra.length > 0 ? ` (extra ${major.extra.join(", ")})` : ""}.`,
      );
    else lines.push("No approved workflow to compare with.");
  } else if (result.status === "reachable") {
    lines.push(`${goal} under ${given}: REACHABLE`);
    steps(result.trace.context, result.trace.actions);
  } else if (
    result.status === "unreachable" ||
    result.status === "impossible"
  ) {
    lines.push(
      `${goal} under ${given}: ${result.status.toUpperCase()}`,
      `No path exists in the model (k-induction closed at depth ${result.proof.depth}).`,
    );
    const explanation =
      mode === "why-not" && result.status === "unreachable"
        ? (result as Extract<ExplanationResult, { status: "unreachable" }>)
            .explanation
        : undefined;
    if (explanation) {
      lines.push(
        `Why${explanation.minimal ? "" : " (not minimized: the solver returned unknown)"}:`,
        ...explanation.summary.map((line) => `  ${line}`),
        "Source:",
      );
      for (const item of explanation.constraints) {
        const sources = item.evidence.filter((ref) => ref.type !== "test");
        const tests = item.evidence.length - sources.length;
        lines.push(
          `  ${item.id}: ${
            sources
              .map((ref) =>
                ref.locator.includes("/") && !ref.id.includes(ref.locator)
                  ? `${ref.id} (${ref.locator})`
                  : ref.id,
              )
              .join("; ") || "no source evidence"
          }${tests > 0 ? ` (+${tests} tests)` : ""}`,
        );
      }
      lines.push(
        `Evidence commit: ${result.model.repositoryCommit ?? "unbound"}`,
      );
    }
  } else
    lines.push(
      `${goal} under ${given}: UNKNOWN`,
      `Reason: ${result.reason}. ${result.detail}`,
    );
  lines.push(
    `Model: ${result.model.id} (${result.model.source}, ${result.model.hash}); slice ${result.stats.slice.variables}/${result.stats.slice.totalVariables} variables, ${result.stats.slice.actions}/${result.stats.slice.totalActions} actions; ${result.stats.solverCalls} solver calls, ${result.stats.durationMs} ms.`,
  );
  if (extraction) {
    const { transitions } = extraction.coverage;
    lines.push(
      `Model coverage: ${transitions.total} transitions (${transitions.deterministic} deterministic, ${transitions.tests} from tests, ${transitions.semanticOnly} semantic-only); ${extraction.uncertainties.length} uncertainties.`,
    );
    if (result.status === "unreachable" || result.status === "impossible")
      lines.push(
        "Unreachable in the extracted model; review its uncertainties and verify in the browser before relying on it.",
      );
  }
  lines.push(`Artifact: ${path.join(output, file)}`);
  return `${lines.join("\n")}\n`;
}

async function loadReasoningModel(
  directory: string | undefined,
  values: Values,
  cwd: string,
): Promise<{
  model: FormalProductModel;
  extraction: ReturnType<typeof buildFormalModel> | undefined;
  capabilities?: CapabilityDiscoveryReport;
}> {
  if (values.model !== undefined) {
    if (directory !== undefined || values.exclude !== undefined)
      throw new Error(
        "--model reasons over the given model; do not also pass a directory or --exclude.",
      );
    try {
      return {
        model: parseFormalModel(
          JSON.parse(await readFile(path.resolve(cwd, values.model), "utf8")),
        ),
        extraction: undefined,
      };
    } catch (error) {
      throw new Error(
        `Cannot read the Formal Product Model in ${values.model}. Provide JSON matching @pathcompiler/formal-model (schemaVersion 1).`,
        { cause: error },
      );
    }
  }
  const project = await readSourceProject(path.resolve(cwd, directory ?? "."), {
    exclude: values.exclude ?? [],
  });
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  const extraction = buildFormalModel(
    capabilities.graph,
    capabilities.report,
    mined.report,
  );
  return {
    model: extraction.model,
    extraction,
    capabilities: capabilities.report,
  };
}

/** `name=value` entries, typed by the model's variable declarations. */
function parseContext(
  entries: string[] | undefined,
  model: FormalProductModel,
): Record<string, FormalValue> {
  const context: Record<string, FormalValue> = {};
  for (const entry of entries ?? []) {
    const separator = entry.indexOf("=");
    if (separator <= 0)
      throw new Error(`--context expects name=value, got "${entry}".`);
    const name = entry.slice(0, separator);
    const raw = entry.slice(separator + 1);
    const variable = model.variables.find((item) => item.id === name);
    context[name] =
      variable?.type === "boolean" && (raw === "true" || raw === "false")
        ? raw === "true"
        : variable?.type === "integer" && /^-?\d+$/.test(raw)
          ? Number(raw)
          : raw;
  }
  return context;
}

async function runVerify(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  if (positionals.length > 3)
    throw new Error(
      "Expected: pathcompiler reason verify [directory]. Use --help for options.",
    );
  const integer = (flag: string, value: string | undefined) => {
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value))
      throw new Error(`--${flag} must be a non-negative integer.`);
    return Number(value);
  };
  const maxDepth = integer("max-depth", values["max-depth"]);
  const timeoutMs = integer("timeout-ms", values["timeout-ms"]);
  const { model, extraction } = await loadReasoningModel(
    positionals[2],
    values,
    cwd,
  );
  const context = parseContext(values.context, model);
  let declared: unknown[] = [];
  if (values.property !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        await readFile(path.resolve(cwd, values.property), "utf8"),
      );
    } catch (error) {
      throw new Error(
        `Cannot read properties from ${values.property}. Provide a JSON array of properties or { "properties": [...] }.`,
        { cause: error },
      );
    }
    declared = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          "properties" in parsed &&
          Array.isArray(parsed.properties)
        ? parsed.properties
        : [];
    if (declared.length === 0)
      throw new Error(
        `${values.property} has no properties. Provide a JSON array of properties or { "properties": [...] }.`,
      );
  }
  const properties = [
    ...propertiesFromInvariants(model),
    ...(declared as ProductProperty[]),
  ].map((property) => ({
    ...property,
    context: { ...context, ...(property.context ?? {}) },
  }));
  if (properties.length === 0)
    throw new Error(
      "The model declares no invariants; pass --property <json-file> with properties to verify.",
    );
  const solver = await createZ3SolverProvider();
  const results: PropertyResult[] = [];
  try {
    const reasoner = createProductReasoner(solver);
    for (const property of properties)
      results.push(
        await reasoner.verifyProperty(model, property, {
          ...(maxDepth === undefined ? {} : { maxDepth }),
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        }),
      );
  } finally {
    await solver.close();
  }
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const file = "reports/reasoning/verification.json";
  const report = {
    schemaVersion: 1,
    type: "verification_result",
    model: results[0]?.model,
    results,
    ...(extraction
      ? {
          modelCoverage: extraction.coverage,
          uncertainties: extraction.uncertainties,
        }
      : {}),
  };
  await writeArtifacts(output, [
    [file, `${JSON.stringify(report, null, 2)}\n`],
  ]);
  const count = (status: PropertyResult["status"]) =>
    results.filter((item) => item.status === status).length;
  const lines = [
    `Verified ${results.length} properties: ${count("holds")} hold, ${count("violated")} violated, ${count("unknown")} unknown.`,
  ];
  for (const result of results) {
    const given = describeContext(result.context);
    if (result.status === "holds")
      lines.push(
        `✓ ${result.property.id} (${given})${result.vacuous ? " — vacuous: the goal is unreachable" : ""}`,
      );
    else if (result.status === "unknown")
      lines.push(
        `? ${result.property.id} (${given}): ${result.reason}. ${result.detail}`,
      );
    else {
      lines.push(
        `✗ ${result.property.id} (${given}): ${result.property.description}`,
        `  Counterexample${Object.keys(result.counterexample.context).length ? ` (${describeContext(result.counterexample.context)})` : ""}:`,
        ...result.counterexample.actions.map(
          (step) =>
            `    ${step.index + 1}. ${step.actionId}${step.semanticTarget ? ` [${step.semanticTarget}]` : ""}`,
        ),
      );
    }
  }
  if (extraction)
    lines.push(
      `Checked in the extracted model (${extraction.coverage.transitions.total} transitions, ${extraction.uncertainties.length} uncertainties); a violation can also be an extraction error, so confirm it in the browser.`,
    );
  lines.push(`Report: ${path.join(output, file)}`);
  const text = `${lines.join("\n")}\n`;
  // Violations always exit nonzero; the report is written either way.
  if (count("violated") > 0)
    throw new Error(`Property violations found.\n${text}`);
  return values.json ? `${JSON.stringify(report, null, 2)}\n` : text;
}

async function readJsonFile(cwd: string, file: string, what: string) {
  try {
    return JSON.parse(
      await readFile(path.resolve(cwd, file), "utf8"),
    ) as unknown;
  } catch (error) {
    throw new Error(`Cannot read ${what} from ${file}; provide a JSON file.`, {
      cause: error,
    });
  }
}

async function runEvaluate(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  if (positionals.length < 3 || positionals.length > 4)
    throw new Error(
      "Expected: pathcompiler evaluate <base> <candidate> [directory]. Use --help for options.",
    );
  const criteria =
    values.criteria === undefined
      ? undefined
      : await readJsonFile(cwd, values.criteria, "evaluation criteria");
  const rawTests =
    values.tests === undefined
      ? undefined
      : await readJsonFile(cwd, values.tests, "test results");
  const tests =
    rawTests === undefined
      ? undefined
      : rawTests && typeof rawTests === "object" && "suites" in rawTests
        ? testRunFromPlaywrightJson(rawTests)
        : TestRunSchema.parse(rawTests);
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const approved = await readApproved(output);
  const range = await analyzeCommitRangeDetailed({
    directory: path.resolve(cwd, positionals[3] ?? "."),
    base: positionals[1] ?? "",
    head: positionals[2] ?? "",
    exclude: values.exclude ?? [],
  });
  const solver = await createZ3SolverProvider();
  let evaluation: CandidateEvaluation;
  try {
    evaluation = await evaluateCandidate(range, solver, {
      ...(criteria === undefined ? {} : { criteria }),
      ...(tests === undefined ? {} : { tests }),
      approved,
    });
  } finally {
    await solver.close();
  }
  const file = `reports/evaluation/${evaluation.candidate}.json`;
  await writeArtifacts(output, [
    [file, `${JSON.stringify(evaluation, null, 2)}\n`],
  ]);
  const { formalResults: formal, testResults: testing } = evaluation;
  const text = `${[
    `Candidate ${evaluation.candidate.slice(0, 12)} against ${evaluation.base.slice(0, 12)}: ${evaluation.status.toUpperCase()} → ${evaluation.recommendedNextStep}${evaluation.eligibleForExperiment ? " (eligible for an experiment)" : ""}`,
    `Intended change: ${evaluation.intendedChange.declared ? `${evaluation.intendedChange.expected.filter((item) => item.met).length}/${evaluation.intendedChange.expected.length} expected changes met` : "no declared intent"}; ${evaluation.intendedChange.observed.length} reachability changes observed.`,
    `Properties: ${formal.holds}/${formal.checked} hold, ${formal.violated} violated, ${formal.unknown} unknown.`,
    `Workflows needing review: ${evaluation.workflowRegression.reviewRequired.map((item) => item.workflowId).join(", ") || "none"}.`,
    `Tests: ${testing.executed ? `${testing.passed} passed, ${testing.failed} failed, ${testing.skipped} skipped` : "not supplied (static coverage only)"}.`,
    ...evaluation.risks.map((item) => `✗ ${item.message}`),
    ...evaluation.warnings.map((item) => `⚠ ${item.message}`),
    ...evaluation.evidenceGaps.map((item) => `· ${item}`),
    `Report: ${path.join(output, file)}`,
  ].join("\n")}\n`;
  if (evaluation.status === "fail")
    throw new Error(`Candidate evaluation failed.\n${text}`);
  return values.json ? `${JSON.stringify(evaluation, null, 2)}\n` : text;
}

async function runObserve(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const reconcile = positionals[1] === "reconcile";
  if (
    !(
      ((positionals[1] === "graph" || positionals[1] === "workflows") &&
        positionals.length === 2) ||
      (reconcile && positionals.length <= 3)
    )
  )
    throw new Error(
      "Expected: pathcompiler observe graph|workflows, or observe reconcile [directory]. Use --help for options.",
    );
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  // Same project name `serve` uses for ingestion.
  const project = path.basename(path.dirname(output));
  const directory = path.join(output, "events", encodeURIComponent(project));
  const events = await readEventDirectory(directory);
  if (events.length === 0)
    throw new Error(
      `No stored events under ${directory}. Run pathcompiler serve --events and send events first.`,
    );
  if (reconcile) {
    const { model, extraction } = await loadReasoningModel(
      positionals[2],
      values,
      cwd,
    );
    const solver = await createZ3SolverProvider();
    let report: Awaited<ReturnType<typeof reconcileBehavior>>;
    try {
      const integer = (value: string | undefined) =>
        value === undefined ? undefined : Number(value);
      const maxDepth = integer(values["max-depth"]);
      const timeoutMs = integer(values["timeout-ms"]);
      report = await reconcileBehavior(model, events, solver, {
        ...(maxDepth === undefined ? {} : { maxDepth }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
    } finally {
      await solver.close();
    }
    const file = "reports/reconciliation.json";
    const full = {
      ...report,
      ...(extraction
        ? {
            modelCoverage: extraction.coverage,
            uncertainties: extraction.uncertainties,
          }
        : {}),
    };
    await writeArtifacts(output, [
      [file, `${JSON.stringify(full, null, 2)}\n`],
    ]);
    if (values.json) return `${JSON.stringify(full, null, 2)}\n`;
    const count = (name: string) =>
      report.items.filter((item) => item.class === name).length;
    return `${[
      `Reconciled ${report.items.length} goal/target × role pairs (roles: ${report.roles.map((item) => `${item.role} ${item.sessions}`).join(", ")} sessions): ${count("possible-observed")} possible+observed, ${count("possible-unobserved")} possible+unobserved, ${count("unexpected-observed")} observed but formally unexpected, ${count("insufficient-data")} insufficient data, ${count("unknown")} unknown.`,
      ...report.discrepancies.map((item) =>
        item.type === "unexpected_observed"
          ? `! HIGH ${item.kind} ${item.id} observed for role ${item.role} in ${item.observed.sessions} sessions, but the model says it cannot happen. ${item.formalReason.join(" ")} Possible causes: ${item.possibleCauses.join("; ")}.`
          : `- ${item.kind} ${item.id} is reachable for role ${item.role} but unobserved in ${item.roleSessions} sessions.`,
      ),
      "Discrepancies are evidence to investigate, not verdicts.",
      `Report: ${path.join(output, file)}`,
    ].join("\n")}\n`;
  }
  if (positionals[1] === "workflows") {
    const report = computeWorkflowAnalytics(events, {
      ...(values.release === undefined ? {} : { release: values.release }),
    });
    const file = "reports/workflow-analytics.json";
    await writeArtifacts(output, [
      [file, `${JSON.stringify(report, null, 2)}\n`],
    ]);
    if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
    const percent = (value: number | null) =>
      value === null ? "n/a" : `${Math.round(value * 100)}%`;
    return `${[
      `Workflow analytics from ${events.length} events${values.release ? ` (release ${values.release})` : ""}:`,
      ...report.workflows.map(
        (item) =>
          `  ${item.workflowId} v${item.workflowVersion}: ${item.starts} starts, ${item.completions} completed, ${item.abandonments} abandoned, ${item.unfinished} unfinished; completion ${percent(item.completionRate)}; median ${item.medianDurationMs ?? "n/a"} ms, p95 ${item.p95DurationMs ?? "n/a"} ms${item.sufficient ? "" : ` (fewer than ${report.minRuns} runs: no rates)`}`,
      ),
      ...(report.workflows.length === 0
        ? ["  No guide runs recorded (workflow.started events)."]
        : []),
      `Report: ${path.join(output, file)}`,
    ].join("\n")}\n`;
  }
  const graph = buildObservedGraph(events, {
    projectId: project,
    ...(values.release === undefined ? {} : { release: values.release }),
  });
  const file = "reports/observed-graph.json";
  await writeArtifacts(output, [[file, `${JSON.stringify(graph, null, 2)}\n`]]);
  if (values.json) return `${JSON.stringify(graph, null, 2)}\n`;
  const top = [...graph.edges]
    .filter(
      (edge) => edge.from !== "session:start" && edge.to !== "session:end",
    )
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const insufficient = graph.edges.filter((edge) => !edge.sufficient).length;
  return `${[
    `Observed ${graph.events} events in ${graph.sessions} sessions${values.release ? ` (release ${values.release})` : ""}: ${graph.nodes.length} states, ${graph.edges.length} transitions.`,
    ...top.map(
      (edge) =>
        `  ${edge.from} → ${edge.to}: ${edge.count}× (${Math.round(edge.frequency * 100)}%, ${edge.sessions} sessions${edge.medianMs === null ? "" : `, median ${edge.medianMs} ms`})`,
    ),
    `${insufficient} transitions have fewer than ${graph.minSessions} sessions; treat them as anecdotes, not evidence.`,
    `Report: ${path.join(output, file)}`,
  ].join("\n")}\n`;
}

/** Read-only summaries of existing artifacts (spec §43). */
async function runInspect(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  if (positionals.length !== 2)
    throw new Error(
      `Expected: pathcompiler ${positionals[0]} ${positionals[1]} [--json] [--out <directory>].`,
    );
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  if (positionals[0] === "graph") {
    // The most derived graph available: capabilities include tests and source.
    const names = [
      "capability-graph.json",
      "test-graph.json",
      "source-graph.json",
    ];
    for (const name of names) {
      const text = await readOptional(path.join(output, "graph", name));
      if (text === undefined) continue;
      const snapshot = JSON.parse(text) as {
        nodes: { type: string }[];
        edges: { type: string }[];
      };
      const tally = (items: { type: string }[]) =>
        Object.fromEntries(
          [...new Set(items.map((item) => item.type))]
            .sort()
            .map((type) => [
              type,
              items.filter((item) => item.type === type).length,
            ]),
        );
      const summary = {
        graph: path.join(output, "graph", name),
        nodes: tally(snapshot.nodes),
        edges: tally(snapshot.edges),
      };
      if (values.json) return `${JSON.stringify(summary, null, 2)}\n`;
      const lines = (record: Record<string, number>) =>
        Object.entries(record).map(([type, n]) => `  ${type}: ${n}`);
      return `${[
        `Graph ${summary.graph}: ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges.`,
        "Nodes:",
        ...lines(summary.nodes),
        "Edges:",
        ...lines(summary.edges),
      ].join("\n")}\n`;
    }
    throw new Error(
      `No graph under ${path.join(output, "graph")}. Run pathcompiler scan, tests mine or capabilities discover first.`,
    );
  }
  const text = await readOptional(
    path.join(output, "reports/capabilities.json"),
  );
  if (text === undefined)
    throw new Error(
      `No ${path.join(output, "reports/capabilities.json")}. Run pathcompiler capabilities discover first.`,
    );
  const report = JSON.parse(text) as {
    capabilities: {
      id: string;
      title: string;
      confidence: number;
      confidenceBand: string;
      roles: string[];
    }[];
  };
  if (values.json)
    return `${JSON.stringify(
      report.capabilities.map(
        ({ id, title, confidence, confidenceBand, roles }) => ({
          id,
          title,
          confidence,
          confidenceBand,
          roles,
        }),
      ),
      null,
      2,
    )}\n`;
  return `${[
    `${report.capabilities.length} candidate capabilities (review required):`,
    ...report.capabilities.map(
      (item) =>
        `  ${item.id.padEnd(28)} ${item.title} — ${item.confidenceBand} (${item.confidence})${item.roles.length ? `, roles ${item.roles.join("/")}` : ""}`,
    ),
  ].join("\n")}\n`;
}

async function runInit(positionals: string[], cwd: string): Promise<string> {
  if (positionals.length > 2)
    throw new Error("Expected: pathcompiler init [directory].");
  const directory = path.resolve(cwd, positionals[1] ?? ".");
  const file = path.join(directory, CONFIG_FILE);
  if ((await readOptional(file)) !== undefined)
    throw new Error(
      `${file} already exists; edit it instead of re-running init.`,
    );
  await mkdir(directory, { recursive: true });
  await writeExclusive(file, defaultConfigYaml(path.basename(directory)));
  return `Wrote ${file}. Capabilities beyond understanding, guiding and evaluating are off; enable them there.\n`;
}

function runConfigShow(
  positionals: string[],
  values: Values,
  configured: { config: PathCompilerConfig; file: string } | null,
): string {
  if (positionals[1] !== "show" || positionals.length !== 2)
    throw new Error("Expected: pathcompiler config show [--json].");
  if (values.json)
    return `${JSON.stringify(configured ? { file: configured.file, config: configured.config } : { file: null, config: null }, null, 2)}\n`;
  if (!configured)
    return `No ${CONFIG_FILE} here: nothing is gated. Run pathcompiler init to create one.\n`;
  const { config } = configured;
  const on = (record: Record<string, unknown>) =>
    Object.entries(record)
      .filter(([, value]) => value === true)
      .map(([key]) => key)
      .join(", ") || "none";
  return `${[
    `Configuration: ${configured.file}`,
    `Modes on: ${on(config.modes)}`,
    `Reasoning on: ${config.reasoning.enabled ? on(config.reasoning) : "none (reasoning.enabled is false)"}`,
    `Analytics: ${config.analytics.enabled ? "enabled" : "disabled"}; ingestion ${config.analytics.ingest ? "on" : "off"}; PII ${config.analytics.collect_pii ? "allowed" : "not collected"}; allowed context keys: ${config.analytics.allowed_context_keys.join(", ") || "none"}`,
    `Model provider: ${config.model_provider.provider}${config.model_provider.api_key_env ? ` (key from $${config.model_provider.api_key_env})` : ""}`,
    `Autonomous mutation: ${config.improvement_policy.autonomous_mutation ? "allowed" : "off"}`,
  ].join("\n")}\n`;
}

/** Applies pathcompiler.yaml: refuses disabled capabilities, enables configured defaults. */
function applyConfig(
  positionals: string[],
  values: Values,
  config: PathCompilerConfig,
  file: string,
): void {
  const refuse = (what: string, keys: string) => {
    throw new Error(
      `${what} is disabled in ${file}. Set ${keys} to enable it.`,
    );
  };
  const [command, sub] = positionals;
  if (command === "reason") {
    const capability =
      sub === "reachable" || sub === "dead-features"
        ? "reachability"
        : sub === "plan"
          ? "planning"
          : sub === "why-not" || sub === "enable"
            ? "unsat_explanations"
            : sub === "alternatives"
              ? "enumeration"
              : sub === "optimize"
                ? "optimization"
                : sub === "verify"
                  ? "property_checking"
                  : sub === "diff"
                    ? "semantic_diff"
                    : undefined;
    if (capability && !reasoningEnabled(config, capability))
      refuse(
        `reason ${sub}`,
        `reasoning.enabled and reasoning.${capability} to true`,
      );
  }
  if (
    command === "tests" &&
    sub === "generate" &&
    !reasoningEnabled(config, "planning")
  )
    refuse(
      "tests generate",
      "reasoning.enabled and reasoning.planning to true",
    );
  if (
    command === "eval" &&
    sub === "reasoning" &&
    !reasoningEnabled(config, "reachability")
  )
    refuse(
      "eval reasoning",
      "reasoning.enabled and reasoning.reachability to true",
    );
  if (
    command === "eval" &&
    (values as { compare?: boolean }).compare &&
    !reasoningEnabled(config, "planning")
  )
    refuse(
      "eval workflow-discovery --compare",
      "reasoning.enabled and reasoning.planning to true",
    );
  if (command === "evaluate" && !config.modes.evaluate)
    refuse("evaluate (mode 5)", "modes.evaluate to true");
  if (command === "observe") {
    if (!config.modes.observe)
      refuse(`observe ${sub ?? ""}`.trim(), "modes.observe to true");
    if (sub === "reconcile" && !reasoningEnabled(config, "reachability"))
      refuse(
        "observe reconcile",
        "reasoning.enabled and reasoning.reachability to true",
      );
  }
  const flags = values as { reasoning?: boolean; events?: boolean };
  if (command === "impact" || (command === "proposals" && sub === "generate")) {
    if (flags.reasoning && !reasoningEnabled(config, "impact"))
      refuse("--reasoning", "reasoning.enabled and reasoning.impact to true");
    if (reasoningEnabled(config, "impact")) flags.reasoning = true;
  }
  if (command === "serve" && config.analytics.ingest) flags.events = true;
}

async function semanticChange(
  range: Parameters<typeof analyzeSemanticChange>[0],
): Promise<SemanticChangeReport> {
  const solver = await createZ3SolverProvider();
  try {
    return await analyzeSemanticChange(range, solver);
  } finally {
    await solver.close();
  }
}

async function runSemanticDiff(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  if (positionals.length < 4 || positionals.length > 5)
    throw new Error(
      "Expected: pathcompiler reason diff <base> <head> [directory]. Use --help for options.",
    );
  if (
    values.context ||
    values.model ||
    values["max-depth"] ||
    values["timeout-ms"]
  )
    throw new Error(
      "reason diff compares every enumerable context itself; --context, --model, --max-depth and --timeout-ms do not apply.",
    );
  const range = await analyzeCommitRangeDetailed({
    directory: path.resolve(cwd, positionals[4] ?? "."),
    base: positionals[2] ?? "",
    head: positionals[3] ?? "",
    exclude: values.exclude ?? [],
  });
  const report = await semanticChange(range);
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const file = "reports/semantic-change.json";
  await writeArtifacts(output, [
    [file, `${JSON.stringify(report, null, 2)}\n`],
  ]);
  if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
  const { base, head } = report.models;
  return `${[
    `PathCompiler Product Logic ${report.commitRange.base.slice(0, 12)}..${report.commitRange.head.slice(0, 12)}`,
    ...summarizeSemanticChange(report),
    `Models: ${base.transitions.total} → ${head.transitions.total} transitions (extracted; ${head.uncertainties} uncertainties at head); ${report.stats.queries} queries, ${report.stats.solverCalls} solver calls, ${report.stats.durationMs} ms.`,
    "Reachability is checked in the extracted models; verify important changes in the browser.",
    `Report: ${path.join(output, file)}`,
  ].join("\n")}\n`;
}

async function writeArtifacts(
  output: string,
  artifacts: readonly (readonly [string, string])[],
): Promise<void> {
  for (const [relative, content] of artifacts) {
    const target = path.join(output, relative);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, content, "utf8");
    await rename(temporary, target);
  }
}

function workflowId(value: string | undefined): string {
  const parsed = WorkflowIdSchema.safeParse(value ?? "");
  if (!parsed.success)
    throw new Error(
      "Workflow ID must be a discovered domain.action ID, optionally followed by its variant hash.",
    );
  return parsed.data;
}

function reviewer(flag: string | undefined): string {
  const value = flag ?? process.env.PATHCOMPILER_USER;
  if (value === undefined)
    throw new Error(
      "Record who is reviewing: pass --by <name> or set PATHCOMPILER_USER.",
    );
  const parsed = ReviewerSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Reviewer must be 1–120 characters on one line, without leading/trailing whitespace.",
    );
  return parsed.data;
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readReviewState(output: string, id: string) {
  const paths = reviewPaths(id);
  const [candidate, approved, rejected, deprecated] = await Promise.all([
    readOptional(path.join(output, paths.candidate)),
    readOptional(path.join(output, paths.approved)),
    readOptional(path.join(output, paths.rejected)),
    readOptional(path.join(output, paths.deprecated)),
  ]);
  return { paths, candidate, approved, rejected, deprecated };
}

function refuseReviewed(
  stored: Awaited<ReturnType<typeof readReviewState>>,
  id: string,
  output: string,
): void {
  if (stored.approved !== undefined)
    throw new Error(
      `Workflow ${id} is already approved (${path.join(output, stored.paths.approved)}). Approved workflows change only through reviewed proposals.`,
    );
  if (stored.rejected !== undefined)
    throw new Error(
      `Workflow ${id} was already rejected (${path.join(output, stored.paths.rejected)}). Remove that record to review it again.`,
    );
  if (stored.deprecated !== undefined)
    throw new Error(
      `Workflow ${id} was deprecated (${path.join(output, stored.paths.deprecated)}). Remove that record to review it again.`,
    );
}

function parseStored<T extends { workflow: { id: string } }>(
  content: string,
  id: string,
  parse: (input: string) => T,
): T {
  const artifact = parse(content);
  if (artifact.workflow.id !== id)
    throw new Error(`Stored workflow filename and ID disagree for ${id}.`);
  return artifact;
}

async function validateStored(
  output: string,
  id: string,
  directory: string,
  exclude: string[],
) {
  const content = await readOptional(
    path.join(output, reviewPaths(id).candidate),
  );
  if (content === undefined)
    throw new Error(
      `No candidate ${id} under ${output}. Run workflows discover first.`,
    );
  const candidate = parseStored(content, id, parseCandidateYaml);
  const project = await readSourceProject(directory, { exclude });
  const source = analyzeNextProject(project);
  const mined = minePlaywrightTests(project, source.graph);
  const report = validateWorkflow(candidate.workflow, {
    graph: mined.graph,
    traces: mined.report,
  });
  const relative = `reports/validation/${id}.json`;
  await writeArtifacts(output, [
    [relative, `${JSON.stringify(report, null, 2)}\n`],
  ]);
  return {
    candidate,
    report,
    project,
    reportPath: path.join(output, relative),
  };
}

async function listWorkflows(output: string) {
  const entries = new Map<
    string,
    {
      id: string;
      state: "candidate" | "approved" | "rejected" | "deprecated";
      title: string;
      confidence: number;
      commit: string;
      path: string;
    }
  >();
  const sources: [
    "candidate" | "approved" | "rejected" | "deprecated",
    string,
    (input: string) => { workflow: WorkflowV1 },
  ][] = [
    ["candidate", "workflows/candidates", parseCandidateYaml],
    ["rejected", "workflows/rejected", parseRejectedWorkflowYaml],
    ["deprecated", "workflows/deprecated", parseDeprecatedWorkflowYaml],
    ["approved", "workflows", parseApprovedWorkflowYaml],
  ];
  // Later sources take precedence: approved > rejected > candidate.
  for (const [state, relative, parse] of sources) {
    let names: string[];
    try {
      names = (
        await readdir(path.join(output, relative), { withFileTypes: true })
      )
        .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
        .map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const name of names) {
      const file = path.join(output, relative, name);
      const id = workflowId(name.slice(0, -".yaml".length));
      let workflow: WorkflowV1;
      try {
        workflow = parseStored(
          await readFile(file, "utf8"),
          id,
          parse,
        ).workflow;
      } catch (error) {
        throw new Error(
          `Cannot read ${file} as a ${state} workflow. Fix or move it, then retry.`,
          { cause: error },
        );
      }
      entries.set(id, {
        id,
        state,
        title: workflow.title,
        confidence: workflow.confidence.overall,
        commit: workflow.repository.commit,
        path: file,
      });
    }
  }
  return [...entries.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

type Values = ReturnType<typeof parse>["values"];

const PROPOSAL_NAME =
  /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*(?:--[a-f0-9]{12})?\.[a-f0-9]{40}(?:[a-f0-9]{24})?$/;

async function runProposals(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const directory = path.join(output, "proposals");
  const command = positionals[1];
  if (command !== "generate" && values.exclude !== undefined)
    throw new Error("--exclude is only supported by proposals generate.");
  if (values.json && command !== "list")
    throw new Error("--json is only supported by proposals list.");
  if (
    command === "generate" &&
    positionals.length >= 4 &&
    positionals.length <= 5
  ) {
    const approved = await readApproved(output);
    if (!approved.length)
      throw new Error(
        `No approved workflows under ${path.join(output, "workflows")}. Approve workflows first.`,
      );
    const scanned = path.resolve(cwd, positionals[4] ?? ".");
    const { delta, base, head } = await analyzeCommitRangeDetailed({
      directory: scanned,
      base: positionals[2] ?? "",
      head: positionals[3] ?? "",
      exclude: values.exclude ?? [],
    });
    const semantic = values.reasoning
      ? await semanticChange({ delta, base, head })
      : undefined;
    const impact = analyzeWorkflowImpact(
      delta,
      approved,
      semantic ? { semantic: semantic.affectedWorkflows } : {},
    );
    const capabilities = discoverCapabilities(head.mined.graph);
    const existing = new Set(
      discoverCapabilities(base.mined.graph).report.capabilities.map(
        (capability) => capability.id,
      ),
    );
    const newCapabilities = capabilities.report.capabilities
      .filter((capability) => !existing.has(capability.id))
      .map((capability) => ({
        id: capability.id,
        domain: capability.domain,
        entity: capability.entity,
        title: capability.title,
      }));
    const candidates = discoverWorkflows(
      capabilities.graph,
      capabilities.report,
      head.mined.report,
    ).report.candidates;
    const commits = await rangeCommits(scanned, delta);
    const proposals = generateProposals({
      impact,
      approved,
      candidates,
      validate: (workflow) =>
        validateWorkflow(workflow, {
          graph: head.mined.graph,
          traces: head.mined.report,
        }),
      changedFiles: delta.summary.files,
      commits,
      newCapabilities,
    });
    await writeArtifacts(output, [
      ["reports/graph-delta.json", `${JSON.stringify(delta, null, 2)}\n`],
      ["reports/workflow-impact.json", `${JSON.stringify(impact, null, 2)}\n`],
      ...(semantic
        ? ([
            [
              "reports/semantic-change.json",
              `${JSON.stringify(semantic, null, 2)}\n`,
            ],
          ] as const)
        : []),
    ]);
    const written: string[] = [];
    const kept: string[] = [];
    for (const proposal of proposals) {
      const file = path.join(
        directory,
        proposalFileName(proposal.workflowId, proposal.head.commit),
      );
      if ((await readOptional(file)) !== undefined) {
        kept.push(path.basename(file, ".yaml"));
        continue;
      }
      await writeExclusive(file, serializeProposalYaml(proposal));
      written.push(path.basename(file, ".yaml"));
    }
    return `Wrote ${written.length} proposals for medium/high impact${kept.length ? `; kept ${kept.length} existing` : ""}.\n${[...written, ...kept].map((name) => `  ${name}`).join("\n")}${written.length + kept.length ? "\n" : ""}Approved workflows were not changed. Review with proposals show/accept/reject/ignore.\n`;
  }
  if (command === "list" && positionals.length === 2) {
    let names: string[] = [];
    try {
      names = (await readdir(directory))
        .filter((name) => name.endsWith(".yaml"))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const items = [];
    for (const name of names) {
      const proposal = await readProposal(directory, name.slice(0, -5));
      items.push({
        name: name.slice(0, -5),
        workflowId: proposal.workflowId,
        head: proposal.head.commit,
        severity: proposal.impact.severity,
        status: proposal.review.status,
        kind:
          proposal.kind === "workflow-update-proposal"
            ? "update"
            : "deprecation",
        match:
          proposal.kind === "workflow-update-proposal"
            ? proposal.match.method
            : null,
        valid:
          proposal.kind === "workflow-update-proposal"
            ? (proposal.validation?.valid ?? null)
            : null,
      });
    }
    if (values.json)
      return `${JSON.stringify({ schemaVersion: 1, proposals: items }, null, 2)}\n`;
    return `${items.length} proposals.\n${items
      .map(
        (item) =>
          `${item.status.padEnd(8)} ${item.severity.padEnd(6)} ${item.kind.padEnd(11)} ${item.name}${item.valid === false ? "  (proposed workflow invalid)" : ""}`,
      )
      .join("\n")}${items.length ? "\n" : ""}`;
  }
  const name = positionals[2] ?? "";
  if (!PROPOSAL_NAME.test(name))
    throw new Error(
      "Proposal must be named <workflow-id>.<head-sha> (its file name without .yaml).",
    );
  const file = path.join(directory, `${name}.yaml`);
  const proposal = await readProposal(directory, name);
  if (command === "show" && positionals.length === 3)
    return `${proposal.kind === "workflow-update-proposal" ? proposal.diff : `${proposal.summary}\n`}\n${serializeProposalYaml(proposal)}`;
  const decidedBy = reviewer(values.by);
  const decidedAt = new Date().toISOString();
  const note = values.reason === undefined ? {} : { note: values.reason };
  try {
    if (
      command === "accept" &&
      proposal.kind === "workflow-deprecation-proposal" &&
      positionals.length === 3
    ) {
      const paths = reviewPaths(proposal.workflowId);
      const approvedFile = path.join(output, paths.approved);
      const content = await readOptional(approvedFile);
      if (content === undefined)
        throw new Error(
          `No approved workflow ${proposal.workflowId} to deprecate at ${approvedFile}.`,
        );
      const result = acceptDeprecation(
        proposal,
        parseStored(content, proposal.workflowId, parseApprovedWorkflowYaml),
        { decidedBy, decidedAt, ...note },
      );
      const deprecatedFile = path.join(output, paths.deprecated);
      await writeExclusive(
        deprecatedFile,
        serializeReviewedYaml(result.deprecated),
      );
      await writeArtifacts(output, [
        [path.relative(output, file), serializeProposalYaml(result.proposal)],
      ]);
      // Explicit, reviewed removal from the runtime source of truth; Git keeps history.
      await unlink(approvedFile);
      return `Deprecated ${proposal.workflowId} by ${decidedBy}.\nRecord: ${deprecatedFile}\nRemoved ${approvedFile} from approved workflows; commit both changes and rebuild.\n`;
    }
    if (
      command === "accept" &&
      proposal.kind === "workflow-update-proposal" &&
      positionals.length >= 3 &&
      positionals.length <= 4
    ) {
      if (!proposal.proposed)
        throw new ProposalError(
          "no-proposed-workflow",
          `No candidate matched. Write the updated workflow under \`proposed\` in ${file}, then accept.`,
        );
      const project = await readSourceProject(
        path.resolve(cwd, positionals[3] ?? "."),
      );
      const mined = minePlaywrightTests(
        project,
        analyzeNextProject(project).graph,
      );
      const result = acceptProposal(proposal, {
        decidedBy,
        decidedAt,
        ...note,
        validation: validateWorkflow(proposal.proposed, {
          graph: mined.graph,
          traces: mined.report,
        }),
        repository: project.repository,
        current: await readCurrentApproved(output, proposal.workflowId),
      });
      const approvedFile = path.join(
        output,
        reviewPaths(proposal.workflowId).approved,
      );
      // The reviewed update path: replace the approved record, then record the decision.
      await writeArtifacts(output, [
        [
          reviewPaths(proposal.workflowId).approved,
          serializeReviewedYaml(result.approved),
        ],
        [path.relative(output, file), serializeProposalYaml(result.proposal)],
      ]);
      return `Accepted ${name} (${result.proposal.review.status === "accepted" ? result.proposal.review.mode : ""}) by ${decidedBy}.\nApproved: ${approvedFile}\nCommit the updated approved file and rebuild generated artifacts.\n`;
    }
    if (
      (command === "reject" || command === "ignore") &&
      positionals.length === 3
    ) {
      const decided = decideProposal(
        proposal,
        command === "reject" ? "rejected" : "ignored",
        {
          decidedBy,
          decidedAt,
          ...note,
        },
      );
      await writeArtifacts(output, [
        [path.relative(output, file), serializeProposalYaml(decided)],
      ]);
      return `${command === "reject" ? "Rejected" : "Ignored for this change"}: ${name} by ${decidedBy}. The approved workflow is unchanged.\n`;
    }
  } catch (error) {
    if (error instanceof ProposalError)
      throw new Error(`${error.message} Proposal: ${file}.`, { cause: error });
    throw error;
  }
  throw new Error(
    "Expected: proposals generate <base> <head> [directory], list, show <proposal>, accept <proposal> [directory], reject <proposal> or ignore <proposal>.",
  );
}

/** Commits in base..head touching changed files (date-bounded file histories). */
async function rangeCommits(
  scanned: string,
  delta: {
    base: { commit: string };
    head: { commit: string };
    summary: { files: { path: string; status: string }[] };
  },
) {
  const git = await openRepository(scanned);
  const baseCommit = await git.getCommit(delta.base.commit);
  const commits = new Map<
    string,
    { sha: string; authorDate: string; message: string }
  >();
  for (const file of delta.summary.files.slice(0, 50)) {
    if (file.status === "removed") continue;
    const history = await git.getCommitsForPath(file.path, {
      revision: delta.head.commit,
      limit: 20,
    });
    for (const commit of history.commits)
      if (
        commit.sha !== baseCommit.sha &&
        commit.authorDate >= baseCommit.authorDate
      )
        commits.set(commit.sha, commit);
  }
  return [...commits.values()].sort((a, b) =>
    a.authorDate < b.authorDate
      ? 1
      : a.authorDate > b.authorDate
        ? -1
        : a.sha < b.sha
          ? -1
          : 1,
  );
}

async function readRejected(output: string) {
  const directory = path.join(output, "workflows/rejected");
  let names: string[];
  try {
    names = (await readdir(directory))
      .filter((name) => name.endsWith(".yaml"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return Promise.all(
    names.map(async (name) =>
      parseStored(
        await readFile(path.join(directory, name), "utf8"),
        workflowId(name.slice(0, -".yaml".length)),
        parseRejectedWorkflowYaml,
      ),
    ),
  );
}

const GitHubAppConfigSchema = z.strictObject({
  appId: z.string().regex(/^\d+$/),
  privateKeyPath: z.string().min(1),
  repositories: z
    .record(
      z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/),
      z.strictObject({
        path: z.string().min(1),
        appDirectory: z.string().min(1).optional(),
        pathcompilerDirectory: z.string().min(1).optional(),
      }),
    )
    .refine((value) => Object.keys(value).length > 0, "Configure a repository"),
  /** Adds the product logic (semantic reachability) section to checks. */
  reasoning: z.boolean().optional(),
});

async function runGitHubApp(positionals: string[], values: Values) {
  if (positionals[1] === "manifest" && positionals.length === 2)
    return `${JSON.stringify(
      githubAppManifest({
        name: values.name ?? "",
        url: values.url ?? "",
        webhookUrl: values.webhook ?? "",
      }),
      null,
      2,
    )}\n`;
  if (positionals[1] !== "serve" || positionals.length !== 2)
    throw new Error(
      "Expected: github-app manifest --name --url --webhook, or github-app serve --config <json-file>.",
    );
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || secret.length < 16)
    throw new Error(
      "Set GITHUB_WEBHOOK_SECRET to the app's webhook secret (16+ characters).",
    );
  if (!values.config)
    throw new Error("github-app serve requires --config <json-file>.");
  const configFile = path.resolve(values.config);
  let config: z.infer<typeof GitHubAppConfigSchema>;
  try {
    config = GitHubAppConfigSchema.parse(
      JSON.parse(await readFile(configFile, "utf8")),
    );
  } catch (error) {
    throw new Error(
      'Invalid GitHub App config. Provide JSON with appId, privateKeyPath and repositories {"owner/repo": {path}}.',
      { cause: error },
    );
  }
  const relative = (file: string) =>
    path.resolve(path.dirname(configFile), file);
  const auth = createAppAuth({
    appId: config.appId,
    privateKey: await readFile(relative(config.privateKeyPath), "utf8"),
  });
  const worker = createWorkflowCheckWorker({
    auth,
    repositories: createLocalRepositoryProvider(
      Object.fromEntries(
        Object.entries(config.repositories).map(([name, repository]) => [
          name,
          { ...repository, path: relative(repository.path) },
        ]),
      ),
    ),
    ...(config.reasoning
      ? { reasoning: { solver: createZ3SolverProvider } }
      : {}),
  });
  const queue = createJobQueue(
    async (job) => {
      await worker(job);
    },
    (error, job) =>
      process.stderr.write(
        `PathCompiler check failed for ${job.owner}/${job.repo}@${job.head.slice(0, 12)}: ${error instanceof Error ? error.message : String(error)}\n`,
      ),
  );
  const server = createServer(createWebhookHandler({ secret, queue }));
  const port = values.port === undefined ? 4320 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error("--port must be an integer from 0 to 65535.");
  const host = values.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return `PathCompiler GitHub App webhook listening on http://${host}:${address && typeof address === "object" ? address.port : port} (${Object.keys(config.repositories).length} repositories). Expose it over HTTPS.\n`;
}

async function readProposal(directory: string, name: string) {
  const file = path.join(directory, `${name}.yaml`);
  const content = await readOptional(file);
  if (content === undefined)
    throw new Error(
      `No proposal ${name}. Run proposals list to see available proposals.`,
    );
  try {
    const proposal = parseProposalYaml(content);
    if (
      proposalFileName(proposal.workflowId, proposal.head.commit) !==
      `${name}.yaml`
    )
      throw new Error(
        "Proposal file name does not match its workflow and head commit.",
      );
    return proposal;
  } catch (error) {
    throw new Error(
      `Cannot read ${file} as a workflow update proposal. Fix or move it.`,
      {
        cause: error,
      },
    );
  }
}

async function loadGeneratedClient(output: string): Promise<PathCompiler> {
  const [searchIndex, runtimeManifest, documentation] = await Promise.all(
    ["search-index", "runtime-manifest", "documentation"].map(async (name) => {
      const file = path.join(output, `generated/${name}.json`);
      const content = await readOptional(file);
      if (content === undefined)
        throw new Error(`Missing ${file}. Run pathcompiler build first.`);
      try {
        return JSON.parse(content) as unknown;
      } catch (error) {
        throw new Error(
          `Cannot parse ${file}. Rebuild it with pathcompiler build.`,
          { cause: error },
        );
      }
    }),
  );
  return new PathCompiler({
    project: path.basename(path.dirname(output)),
    transport: createStaticTransport({
      searchIndex,
      runtimeManifest,
      documentation,
    }),
  });
}

async function readCurrentApproved(output: string, id: string) {
  const file = path.join(output, reviewPaths(id).approved);
  const content = await readOptional(file);
  if (content === undefined)
    throw new Error(
      `No approved ${id} at ${file}; a proposal can only update an approved workflow.`,
    );
  return parseStored(content, id, parseApprovedWorkflowYaml);
}

async function readApproved(output: string) {
  const directory = path.join(output, "workflows");
  let names: string[];
  try {
    names = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const name of names) {
    const file = path.join(directory, name);
    try {
      records.push(
        parseStored(
          await readFile(file, "utf8"),
          workflowId(name.slice(0, -".yaml".length)),
          parseApprovedWorkflowYaml,
        ),
      );
    } catch (error) {
      throw new Error(
        `Cannot read ${file} as an approved workflow. Fix or move it, then rebuild.`,
        { cause: error },
      );
    }
  }
  return records;
}

/** Atomically creates a new file; never replaces an existing review decision. */
async function writeExclusive(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  try {
    await link(temporary, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `Refusing to replace existing review decision ${target}.`,
        { cause: error },
      );
    throw error;
  } finally {
    await unlink(temporary);
  }
}

const EVAL_FAMILIES = [
  "capabilities",
  "workflow-discovery",
  "resolver",
  "impact",
  "reasoning",
] as const;
async function runEval(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const family = EVAL_FAMILIES.find((item) => item === positionals[1]);
  if (!family || positionals.length > 3)
    throw new Error(
      `Expected: pathcompiler eval ${EVAL_FAMILIES.join("|")} [directory]. Use --help for options.`,
    );
  if (values.exclude !== undefined)
    throw new Error("--exclude is not supported by eval.");
  if (values.compare && family !== "workflow-discovery")
    throw new Error("--compare is only supported by eval workflow-discovery.");
  const directory = path.resolve(cwd, positionals[2] ?? ".");
  // Reasoning cases name their fixture; the directory is the cases root.
  const truth =
    family === "reasoning"
      ? undefined
      : await loadGroundTruth(path.join(directory, "eval"));
  const report = !truth
    ? await (async () => {
        const solver = await createZ3SolverProvider();
        try {
          return await evaluateReasoningCases(
            directory,
            await loadReasoningCases(directory),
            solver,
          );
        } finally {
          await solver.close();
        }
      })()
    : family === "workflow-discovery" && values.compare
      ? await (async () => {
          const analysis = await analyzeFixture(directory);
          const solver = await createZ3SolverProvider();
          try {
            return await compareDiscoveryStrategies(analysis, truth, [
              baselineStrategy,
              reasoningStrategy(solver),
            ]);
          } finally {
            await solver.close();
          }
        })()
      : family === "impact"
        ? await evaluateImpact(directory, truth)
        : await (async () => {
            const analysis = await analyzeFixture(directory);
            return family === "capabilities"
              ? evaluateCapabilityExtraction(analysis, truth)
              : family === "workflow-discovery"
                ? await evaluateWorkflowDiscovery(analysis, truth)
                : evaluateResolverAccuracy(analysis, truth);
          })();
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const file = `reports/eval/${values.compare ? "workflow-discovery-comparison" : family}.json`;
  const text = `${JSON.stringify(report, null, 2)}\n`;
  await writeArtifacts(output, [[file, text]]);
  if (values.json) return text;
  const lines: string[] = [];
  if (report.family === "capabilities")
    lines.push(
      `Capabilities: precision ${report.precision}, recall ${report.recall}.`,
      ...report.falsePositives.map((id) => `  unexpected ${id}`),
      ...report.falseNegatives.map((id) => `  missed ${id}`),
    );
  const discovery = (item: DiscoveryEvaluationReport) => [
    `Workflow discovery (${item.strategy}): precision ${item.precision}, recall ${item.recall}, entrypoints ${item.entrypointAccuracy}, major steps ${item.meanMajorStepScore}, terminals ${item.terminalAccuracy}, invented steps ${item.inventedStepCount} (rate ${item.inventedStepRate}), applicability ${item.applicabilityAccuracy}, mean edit distance ${item.meanEditDistance}.`,
    ...item.cases.map((entry) =>
      entry.found
        ? `  ${entry.id}: steps ${entry.majorStepScore}, edit distance ${entry.editDistance}, terminal ${entry.terminalCorrect ? "correct" : "wrong"}${entry.entrypointCorrect ? "" : ", entrypoint wrong"}${entry.applicabilityCorrect === false ? ", applicability wrong" : ""}`
        : `  ${entry.id}: not discovered`,
    ),
    ...item.unexpectedCandidates.map((id) => `  unexpected ${id}`),
  ];
  if (report.family === "workflow-discovery-comparison")
    lines.push(...report.strategies.flatMap(discovery));
  if (report.family === "workflow-discovery") lines.push(...discovery(report));
  if (report.family === "reasoning")
    lines.push(
      `Reasoning cases: ${report.passed}/${report.total} passed; verdicts ${report.verdictAccuracy}, plans ${report.planAccuracy}, diffs ${report.diffAccuracy}, unknown rate ${report.unknownRate}.`,
      ...report.cases
        .filter((item) => !item.passed)
        .map((item) => `  FAIL ${item.id}: ${item.detail}`),
    );
  if (report.family === "resolver")
    lines.push(
      `Resolver: top-1 ${report.top1Accuracy}, ambiguity ${report.ambiguityAccuracy}, unsupported ${report.unsupportedAccuracy}, controls ${report.controlsPassed ? "passed" : "failed"}.`,
      ...report.misses.map(
        (item) =>
          `  "${item.query}": expected ${item.expected}, got ${item.actual}`,
      ),
    );
  if (report.family === "impact")
    lines.push(
      `Impact: affected recall ${report.affectedRecall}, false-positive rate ${report.falsePositiveRate}, severity accuracy ${report.severityAccuracy}.`,
      ...report.cases.flatMap((item) =>
        item.results
          .filter((result) => result.expected !== result.actual)
          .map(
            (result) =>
              `  ${item.id} ${result.workflowId}: expected ${result.expected}, got ${result.actual}`,
          ),
      ),
    );
  return `${lines.join("\n")}\nReport: ${path.join(output, file)}\n`;
}

async function explainModelContext(
  directory: string,
  values: Values,
  cwd: string,
  provider: string,
): Promise<string> {
  const project = await readSourceProject(directory, {
    exclude: values.exclude ?? [],
  });
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const { report } = discoverProductSurfaces(mined.graph);
  const request = { surfaces: report.surfaces, evidence: report.evidence };
  const { value: payload, redactions } = redactValue(request);
  const entry = describeModelRequest(
    "inferCapabilities",
    provider,
    payload,
    redactions,
  );
  const context = {
    schemaVersion: 1,
    kind: "model-context",
    provider,
    sent: false,
    requests: [{ ...entry, payload }],
    neverSent: [
      "file contents (privacy.source_upload is always false)",
      "hidden files and directories, including .env",
      "binary files",
      "paths excluded with --exclude or Git ignore rules",
    ],
    excluded: values.exclude ?? [],
  };
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const file = "reports/model-context.json";
  await writeArtifacts(output, [
    [file, `${JSON.stringify(context, null, 2)}\n`],
  ]);
  if (values.json) return `${JSON.stringify(context, null, 2)}\n`;
  const redacted = Object.values(redactions).reduce((a, b) => a + b, 0);
  return [
    `Model context dry run (provider: ${provider}; nothing sent).`,
    `inferCapabilities: ${entry.bytes} bytes, ${report.surfaces.length} surfaces, evidence ${Object.entries(
      entry.evidenceNodes,
    )
      .map(([type, count]) => `${type} ${count}`)
      .join(", ")}.`,
    `Paths referenced (${entry.files.length}): ${entry.files.join(", ")}.`,
    `Secrets redacted: ${redacted}.`,
    "Never sent: file contents, hidden files (.env), binaries, excluded paths.",
    `Exact payload: ${path.join(output, file)}`,
    "",
  ].join("\n");
}
