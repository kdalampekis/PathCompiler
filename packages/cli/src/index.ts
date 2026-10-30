import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { createGitHubProvider } from "@pathcompiler/adapter-github";
import {
  analyzeNextProject,
  analyzeNextProjectCached,
  scanNextRepository,
  suggestTargets,
} from "@pathcompiler/adapter-nextjs";
import {
  type ActionDecision,
  type ActionRequest,
  createActionGate,
  evaluateGate,
  type GateOptions,
  type LabeledAction,
} from "@pathcompiler/agent-gate";
import {
  type ExtractionResult,
  extractBehavior,
  readSourceFiles,
} from "@pathcompiler/behavior-extraction";
import {
  type BehaviorSpec,
  formatExpression,
  fromFormalModel,
  isHumanBacked,
  parseBehaviorSpec,
  serializeBehaviorSpec,
  weakestConfidence,
} from "@pathcompiler/behavior-ir";
import {
  analyzeDropOffs,
  computePathEfficiency,
  type DropOffReport,
  type PathEfficiencyReport,
  reconcileBehavior,
} from "@pathcompiler/behavior-reconciliation";
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
  parseConfig,
  reasoningEnabled,
} from "@pathcompiler/config";
import {
  contractExecutor,
  createRecord,
  generateEval,
  listCounterexamples,
  type RegressionEval,
  readCounterexample,
  recordCounterexample,
  runEval as runRegressionEval,
  runSpecEval,
} from "@pathcompiler/counterexamples";
import {
  createFileCache,
  createJsonLogger,
  type Logger,
  noopLogger,
  PERFORMANCE_TARGETS_MS,
  type PhaseTiming,
  timed,
} from "@pathcompiler/diagnostics";
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
  createExperimentSpec,
  ExperimentError,
  parseExperimentSpec,
} from "@pathcompiler/experiment-core";
import {
  deriveFindings,
  type FindingInputs,
  type FindingsReport,
} from "@pathcompiler/findings";
import {
  actionCategories,
  buildFormalModel,
  interpretCapabilities,
  selectCapabilityInterpretations,
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
  createHarnessTask,
  evaluationCriteria,
  HarnessContractError,
  type HarnessTaskSpec,
  parseHarnessTask,
  parseMutationResult,
} from "@pathcompiler/harness-contracts";
import {
  createFileEventSink,
  createHttpService,
} from "@pathcompiler/http-service";
import {
  analyzeWorkflowImpact,
  scoreCommitRisk,
  WorkflowImpactReportSchema,
} from "@pathcompiler/impact-analysis";
import {
  type GateReport,
  gateFindings,
  type SubjectUsage,
} from "@pathcompiler/improvement-gate";
import {
  buildMemoryRecord,
  ImprovementMemoryRecordSchema,
  rankWithMemory,
} from "@pathcompiler/improvement-memory";
import { serveStdio } from "@pathcompiler/mcp-server";
import {
  describeModelRequest,
  FixtureModelProvider,
  interpretAmbiguities,
  NoopModelProvider,
  type PathCompilerModelProvider,
  redactValue,
} from "@pathcompiler/model-provider";
import {
  createLocalModelProvider,
  createOpenAIModelProvider,
  DEFAULT_OPENAI_KEY_ENV,
} from "@pathcompiler/model-provider-openai";
import {
  buildObservedGraph,
  buildTransitionModel,
  checkGoal,
  checkReachProperty,
  compareReach,
  compareReleaseBehavior,
  computeWorkflowAnalytics,
  type FormalGoalChange,
  readEventDirectory,
} from "@pathcompiler/observed-graph";
import {
  type AdoptionDecision,
  decideAdoption,
  measureOutcome,
  type OutcomeAssessment,
  recordApproval,
} from "@pathcompiler/outcome-analysis";
import {
  formatPrGuardMarkdown,
  verifyPullRequest,
} from "@pathcompiler/pr-guard";
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
  ProductPropertySchema,
  type PropertyResult,
  propertiesFromInvariants,
  type ReachabilityQuery,
  type ReachabilityResult,
  uxMetrics,
} from "@pathcompiler/reasoner-core";
import {
  createReasoningService,
  serveReasoningStdio,
} from "@pathcompiler/reasoning-service";
import {
  type ImprovementRecommendation,
  recommend,
} from "@pathcompiler/recommendation-engine";
import {
  fixtureRepairProvider,
  runRepairLoop,
} from "@pathcompiler/repair-loop";
import {
  calibrationFromReviews,
  collectReviewFeedback,
  prioritizeReviews,
} from "@pathcompiler/review-priority";
import { createStaticTransport, PathCompiler } from "@pathcompiler/sdk-js";
import {
  analyzeSemanticChange,
  describeContext,
  type SemanticChangeReport,
  summarizeSemanticChange,
} from "@pathcompiler/semantic-change";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import {
  readSourceProject,
  type SourceProject,
} from "@pathcompiler/source-model";
import {
  type GenerationReport,
  generateTests,
  type TestSetup,
  TestSetupSchema,
} from "@pathcompiler/test-generator";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { clusterTraces } from "@pathcompiler/trace-clustering";
import {
  type Counterexample,
  createSmtVerifier,
  createVerificationRouter,
  type RuleBasis,
  type VerificationReport,
  verifySpec,
} from "@pathcompiler/verification";
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
import {
  diagnoseBrowserFailure,
  validateWorkflow,
} from "@pathcompiler/workflow-validator";
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
       pathcompiler mcp-reasoning [directory] [--model <json-file>]
       pathcompiler serve [--out <directory>] [--port <number>] [--host <address>] [--events] [--allow-origin <origin> ...]
       pathcompiler observe graph|workflows|transitions [--release <id>] [--json] [--out <directory>]
       pathcompiler observe check <goal> [--at-least <p> | --at-most <p>] [--baseline <release>] [--release <id>] [--json] [--out <directory>]
       pathcompiler observe reconcile [directory] [--model <json-file>] [--json] [--out <directory>]
       pathcompiler observe efficiency [directory] [--model <json-file>] [--json] [--out <directory>]
       pathcompiler observe drop-offs [directory] [--model <json-file>] [--json] [--out <directory>]
       pathcompiler observe release-diff <base-release> <head-release> [directory] [--commits <base>..<head>] [--json] [--out <directory>]
       pathcompiler git inspect [directory] --node <node-id> [--limit <1-100>] [--out <directory>]
       pathcompiler github inspect [directory] --repo <owner/name> (--pr <number> | --commit <sha>) [--out <directory>]
       pathcompiler findings [workflow|capability|goal] [--json] [--out <directory>]
       pathcompiler gate [--json] [--out <directory>]
       pathcompiler recommend [--property <json-file>] [--json] [--out <directory>]
       pathcompiler experiment create <recommendation-id> <evaluation.json> <control-release> <treatment-release> [--json] [--out <directory>]
       pathcompiler experiment measure <experiment.json> [evaluation.json] [--json] [--out <directory>]
       pathcompiler experiment decide <outcome.json> [--json] [--out <directory>]
       pathcompiler experiment approve|decline <decision.json> [--by <name>] [--reason <text>]
       pathcompiler memory record <recommendation-id> [--json] [--out <directory>]
       pathcompiler memory list [--json] [--out <directory>]
       pathcompiler behavior export [directory] [--json] [--out <directory>] [--exclude <directory> ...]
       pathcompiler verify-pr --base <ref> --candidate <ref> [directory] [--bind <name>=<entity> ...] [--strict] [--json] [--out <directory>] [--exclude <directory> ...]
       pathcompiler counterexamples list|record <report.json>|eval <id> --spec <behavior-spec.json>|run <eval.json> --spec <behavior-spec.json> [--strict-neighbors] [--json] [--out <directory>]
       pathcompiler repair propose [directory] --fixture <proposals.json> [--max-attempts <n>] [--bind <name>=<entity> ...] [--exclude <directory> ...] [--json] [--out <directory>]
       pathcompiler agent check <behavior-spec.json> --request <action.json> [--enforce all|approved_only] [--on-unknown block|allow] [--json]
       pathcompiler agent eval <behavior-spec.json> --cases <labeled-actions.json> [--json]
       pathcompiler behavior extract [directory] [--bind <name>=<entity> ...] [--commit <sha>] [--json] [--out <directory>] [--exclude <directory> ...]
       pathcompiler behavior verify <behavior-spec.json> [--operation <id> ...] [--json] [--out <directory>]
       pathcompiler behavior validate <behavior-spec.json> [--json]
       pathcompiler behavior show <behavior-spec.json> [--json]
       pathcompiler harness task <recommendation-id> <base-commit> [--json] [--out <directory>]
       pathcompiler harness import <mutation-result.json> [directory] [--tests <json-file>] [--browser <json-file>] [--json] [--out <directory>]
       pathcompiler review queue [--impact <json-file>] [--json] [--out <directory>]
       pathcompiler review feedback [--json] [--out <directory>]
       pathcompiler diagnose <browser-report.json> [directory] [--base <commit>] [--context <name=value> ...] [--json] [--out <directory>] [--exclude <directory> ...]
       pathcompiler analyze [directory] [--model-fixtures <json-file>] [--json] [--out <directory>] [--exclude <directory> ...]
       pathcompiler eval capabilities|workflow-discovery|resolver|impact|reasoning [directory] [--compare] [--json] [--out <directory>]
       pathcompiler evaluate <base> <candidate> [directory] [--criteria <json-file>] [--tests <json-file>] [--browser <json-file>] [--json] [--out <directory>] [--exclude <directory> ...]
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
sets a token that may only post events. --allow-origin <origin> (repeatable, exact origins
only, never *) lets a browser app on another origin call the API (CORS).
observe graph aggregates the stored events into
reports/observed-graph.json: transition counts, sessions, frequencies, median times and
role/release segments (what happened; never compared with the formal model here).
observe workflows reconstructs guide runs per workflow version: starts, completions,
abandonments, unfinished runs, completion rate (only with 30+ runs), median/p95 duration,
actions per run, a step funnel and privacy-suppressed role/release segments, written to
reports/workflow-analytics.json. observe reconcile compares the formal model (extracted from
the repository, or --model) with the stored events per observed role: possible+observed,
possible+unobserved, and observed-but-formally-unexpected (high priority, with the model's
reasons and candidate causes; never labelled a bug). Writes reports/reconciliation.json.
observe efficiency divides the median observed path cost (navigations plus target activations
per completion) by the cheapest formal path for each goal and observed role (Path Efficiency
Ratio; 30+ completions), lists friction at 1.5x or more, and writes reports/path-efficiency.json.
It is a friction signal, not proof that the shortest path is the best experience.
observe check <goal> model-checks the observed Markov chain: completion and abandonment
probability with bounds from per-transition 95% intervals (every state's Wilson intervals as an interval Markov chain, so
small samples give wide bounds), and expected transitions to completion. --at-least/--at-most
<p> decides P(completion) only when the whole interval agrees (otherwise inconclusive), and
--baseline <release> compares with another release (a change only when the bounds do not
overlap). Estimates describe observed users, not what the product allows.
observe transitions estimates a Markov chain from the observed graph: per-state transition
probabilities with 95% Wilson intervals (30+ outgoing transitions to count as sufficient) and the
probability of eventually reaching each goal from session start, written to
reports/transition-model.json. Estimates describe observed users, not what the product allows.
observe release-diff compares, per goal, the share of sessions reaching it in two releases (95%
Wilson intervals; a change needs 30+ sessions per release and non-overlapping intervals). With
--commits it also runs the semantic diff between the releases' commits and classifies each goal:
expected change, unexplained behavior change, formal change not observed, stable, or
insufficient data. Writes reports/release-behavior.json.
observe drop-offs counts, per goal and observed role, sessions that activated one of the goal's
controls but never reached it, and where they stopped. Points where 20%+ of attempts end (with
30+ attempts) are friction, listed with the valid formal routes (R6 variants) that avoid them.
Writes reports/drop-offs.json.
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
{ tests: [{ name, status }] }). --browser takes browser verification reports (one or an array)
from running workflows against the candidate's preview (verifyCandidateWorkflows): a failed run
fails the candidate with a diagnosed likely cause, reports for another commit are ignored, and
workflows needing review without a run are flagged. It writes reports/evaluation/<candidate>.json
and exits nonzero when the candidate fails. Claims in the criteria never change the outcome.
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
Developer reasoning: with PATHCOMPILER_DEVELOPER_TOKEN set (16+ characters, different from the
API and ingest tokens), serve adds POST /v1/reason/<operation> (reachability, why-unreachable,
plan, alternatives, verify-property, minimal-enablement, dead-features) over the working
directory's model or --model. Only the developer token is accepted there, and it is refused
everywhere else. mcp-reasoning serves the same operations as a separate developer MCP server on
stdio (pathcompiler.check_reachability, explain_unreachable, find_plan, list_alternative_paths,
verify_product_property, minimal_enablement, dead_features). Results are product-semantic; solver
statistics are removed. With pathcompiler.yaml both need reasoning.enabled.
init writes pathcompiler.yaml with every default spelled out. When pathcompiler.yaml exists in
the working directory, it gates capabilities: reason commands need reasoning.enabled plus their
flag, observe needs modes.observe, evaluate needs modes.evaluate, reasoning.impact turns on
--reasoning, and analytics.ingest enables serve ingestion with the analytics privacy policy.
Without the file nothing is gated. API keys never go in the file (model_provider.api_key_env
names an environment variable).
analyze finds capabilities the deterministic rules could not name with confidence (low
confidence, no semantic target, label conflicts, same domain and verb), sends only those
clusters' surfaces and graph evidence to model_provider (anthropic, openai or local; none sends
nothing), and checks every answer against that evidence. It writes
reports/semantic-hypotheses.json: rename, merge or confirm hypotheses, each supported or
rejected (unsupported verb or entity, evidence of other surfaces, merge across entities), and
the exact context sent. It then interprets each ambiguous capability (P1): candidate meanings
from the rule and the hypotheses are removed when a hard constraint rules them out (the
handler's endpoint cannot perform the verb, an entity no route or endpoint mentions, another
action's ID with a different handler), and the rest are re-scored and fused (code outranks
models). A joint selection (P2, weighted soft constraints solved by Z3) then picks one
meaning per capability so that actions with different handlers never share one, in
reports/semantic-interpretations.json. Capabilities are never changed.
--model-fixtures replays recorded responses ([{ kind, request | key, response }]) instead
of calling a provider.
findings derives product findings from the reports already under the output directory
(semantic-change, workflow-impact, release-behavior, path-efficiency, drop-offs,
reconciliation): release and permission regressions, workflow friction, low adoption and
runtime/formal discrepancies, each with fused confidence and lineage to its report entries,
grouped into improvement opportunities with explained priority, in reports/findings.json.
A subject argument keeps only its findings. Findings are not recommendations.
gate decides per opportunity in reports/findings.json whether to collect more data, log
only, surface the finding, recommend, offer it to a harness, or make no change, in that
order of questions (evidence, impact, actionability, autonomy), applying improvement_policy
and its budgets; usage comes from stored events. Each decision has an explained value
assessment, in reports/gate-decisions.json. Nothing is eligible for a harness unless both
improvement_policy.autonomous_mutation and modes.self_improvement are true. With
pathcompiler.yaml, gate needs modes.recommend.
recommend turns gate decisions recommend and eligible_for_harness into recommendations from
deterministic templates: FIX for regressions (restore lost reachability; remove access a role
newly gained), IMPROVE for friction, PROMOTE for low adoption. Each has a falsifiable
hypothesis whose confidence (a template prior) is separate from the finding's, desired
outcomes, protected behaviors (--property R8 properties and the other approved workflows) and
acceptance criteria, in reports/recommendations.json. It needs modes.recommend too.
experiment create specifies (never deploys) an experiment for an IMPROVE or PROMOTE
recommendation whose candidate evaluation passed: control and treatment releases, population,
50/50 session allocation, primary and secondary metrics from the desired outcomes, guardrails
(held metrics, the other approved workflows, no unexpected observations) and success criteria,
frozen with a hash before anything is measured, in experiments/<id>.json.
experiment measure compares the control and treatment releases in stored events against the
frozen spec (refusing an edited one): goal reach shares or guide completion rates with 95%
intervals, guardrail breaches and sample thresholds, giving improved, neutral, worse or
inconclusive. Metrics events cannot measure are listed as gaps; the candidate evaluation's
formal status is reported separately. It writes reports/outcomes/<experiment>.json.
experiment decide turns an outcome into an adoption decision for a human: adopt (improved and
the candidate passed), rollback (worse; the hypothesis is rejected), iterate (neutral), reject
(the candidate failed), extend_experiment (too few sessions or overlapping intervals) or
inconclusive, in decisions/<experiment>.json, pending approval. experiment approve and decline
record the human decision (--by, --reason) once; nothing is deployed or rolled back.
memory record links a recommendation's lifecycle (its experiment, outcome and decision under
the output directory) into memory/<recommendation>.json, with lessons only from approved
decisions. recommend then weighs those lessons: an earlier rejected hypothesis for the same
subject and category halves the priority (one observation, never a rule). memory list shows
the records. Nothing is trained.
behavior export converts the repository's extracted Formal Product Model into a BehaviorIR
specification (reports/behavior-spec.json): the solver-neutral intermediate representation every
rule of which carries provenance (source type, explicit/inferred/human-approved, extraction
method, confidence). behavior validate checks a specification file (references, scopes, types,
mandatory provenance) and behavior show lists its rules with their provenance. Rules extracted
automatically are candidates, not business ground truth.
counterexamples keeps the concrete actions that broke a rule (verify-pr stores them under
<out>/counterexamples) and turns each into a regression eval: the counterexample itself, nearby
actions that break the same rule, and nearby actions that must still be allowed, labeled by the
trusted specification (--spec for eval). run replays an eval against a candidate's specification
(--spec): it checks the candidate's extracted preconditions on every case and asks the verifier
the same question; it exits nonzero when the candidate would accept something it must reject.
Neighbors it rejects are reported as over-restrictive and fail only with --strict-neighbors.
repair propose takes the first violated rule of the code in the directory and runs a bounded,
logged repair loop: the violation and its counterexample go to a repair provider together with the
source file of the operation (nothing else from the repository), and a proposed change is accepted
only if the violated property now holds, no other property became violated and the regression eval
built from the counterexample passes. It tries up to --max-attempts (default 3, at most 10) from
the original files each time and writes reports/repair.json and, if repaired, repair/<id>.patch.
Nothing is changed, merged or deployed: apply the patch yourself after reviewing it. The provider
is a --fixture file of prepared proposals ({"proposals": [{"edits": [{"path", "contentFile"}],
"rationale"}]}); no model adapter is wired in yet, and the CLI does not run your tests, so the
patch must be tested before it is applied. It exits nonzero when no repair was found.
agent check decides whether an agent's action may run: the request names an operation with its
inputs, the acting context and the relevant stored state, and the specification is evaluated on
those concrete values (no solver): the operation's preconditions, the actor's permissions, every
applicable business rule and data policy, and the invariants of the state the action would
produce. It prints PASS or BLOCK with the violated rule, the values that violate it and the
missing precondition, and exits nonzero on BLOCK. A rule it cannot evaluate for lack of a value
is reported as missing, and the default is to block (--on-unknown allow changes that);
--enforce approved_only blocks only on rules a person approved. agent eval runs a labeled set of
safe and unsafe actions and reports the unsafe block rate, the safe allow rate and the false
block rate; an unsafe action that no rule describes is reported as missed.
verify-pr extracts the behavior at two Git revisions (--base, --candidate), verifies the rules at
both and reports only what the change introduces: a rule that held at the base and is violated at
the candidate (a new reachable violation, with a counterexample), the behavior that changed
(a precondition got weaker or stricter, or is just a refactoring), and what it could not model.
The approved rules are taken from the base, so a change cannot weaken a rule by editing it. A
violated human-approved rule exits nonzero; findings that need a person (an extracted rule
violated, rules removed or edited, code the extractor cannot model) say "review" and exit nonzero
only with --strict. It writes reports/pr-guard.json and reports/pr-guard.md.
behavior verify asks, for every operation, whether each invariant is preserved, each applicable
business rule or data policy is enforced and each deny or constrained permission is respected,
within a supported fragment (linear integer arithmetic, booleans, finite enums, string
equality; one execution of one operation from any state satisfying the invariants). A result is
VERIFIED, VIOLATED (with a counterexample re-evaluated by the specification's own evaluator),
UNKNOWN or UNSUPPORTED, and says how far the rule can be trusted. VERIFIED means the encoded
rule holds within that model, not that the business rule is right. It exits nonzero on a
violation and writes reports/behavior-verification.json.
behavior extract reads SQL DDL, Zod models, OpenAPI documents, test assertions and an optional
approved-rules.json from the directory (and if (…) throw guard clauses of exported
functions as operation contracts) and writes reports/behavior-spec.json plus
reports/behavior-extraction.json (every extracted fact with its source, and every construct it
could not model). It uses no model. --bind payment=payments maps a code identifier to the
entity or operation prefix its variables use (also applied to OpenAPI operation IDs).
harness task (mode 6 only) writes a provider-neutral HarnessTaskSpec for a recommendation the
gate made eligible_for_harness, which needs improvement_policy.autonomous_mutation and
modes.self_improvement: objective, intended semantic changes, protected behaviors, acceptance
criteria and lineage, in harness/tasks/<id>.json. See examples/harness-contract/ for the task
and MutationResult schemas. harness import reads a harness's MutationResult, checks that it
answers an exported task (task, recommendation, base commit), stores it in harness/results/, and,
when it names a candidate commit, evaluates that candidate against the task's base in
[directory] with criteria frozen from the task; the harness's claimed outcome is checked against
the independent evaluation, never trusted. A blocked or failed result is recorded with its
questions. It exits nonzero when the candidate fails.
review queue orders pending candidates and proposals by uncertainty × business impact × usage
× change severity, each factor explained; --impact maps workflow IDs or domains to (0, 1], and
usage comes from stored events (guide runs) when present. Missing inputs are neutral. review
feedback turns the stored decisions (approved, rejected, accepted/edited/rejected/ignored
proposals) into labeled data and a confidence calibration, in reports/review-calibration.json.
diagnose ranks the likely causes of a failed browser verification report (C8): stale
target, permission mismatch, feature flag mismatch, backend changed, formal model wrong or
network issue. It fuses the failure's stage and code, whether the target is still in the
directory's source, and the formal model's role and flag guards on the failing target
evaluated against --context (the run's role and flags), in reports/diagnosis.json. --base
<commit> (the approved commit) diffs the API endpoints up to the report's candidate commit (or
HEAD), which separates "backend changed" from "formal model wrong" for outcome failures.
Rankings are hypotheses for a developer, never verdicts.
No repository code is executed. Only analyze with a configured model_provider sends anything
to a model, and never file contents; nothing else is sent to a network service.
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
  "no-cache": { type: "boolean" },
  weight: { type: "string", multiple: true },
  setup: { type: "string" },
  commits: { type: "string" },
  "model-fixtures": { type: "string" },
  "at-least": { type: "string" },
  base: { type: "string" },
  "allow-origin": { type: "string", multiple: true },
  bind: { type: "string", multiple: true },
  candidate: { type: "string" },
  spec: { type: "string" },
  fixture: { type: "string" },
  "max-attempts": { type: "string" },
  "strict-neighbors": { type: "boolean" },
  request: { type: "string" },
  cases: { type: "string" },
  enforce: { type: "string" },
  "on-unknown": { type: "string" },
  strict: { type: "boolean" },
  operation: { type: "string", multiple: true },
  browser: { type: "string" },
  impact: { type: "string" },
  "at-most": { type: "string" },
  baseline: { type: "string" },
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
      (positionals[0] === "serve" || positionals[0] === "mcp-reasoning") &&
      values.model !== undefined &&
      values.context === undefined &&
      values["max-depth"] === undefined &&
      values["timeout-ms"] === undefined
    ) &&
    !(
      positionals[0] === "observe" &&
      ["reconcile", "efficiency", "drop-offs"].includes(positionals[1] ?? "") &&
      values.context === undefined
    ) &&
    !(
      positionals[0] === "diagnose" &&
      values.model === undefined &&
      values["max-depth"] === undefined &&
      values["timeout-ms"] === undefined
    )
  )
    throw new Error(
      "--context, --max-depth, --timeout-ms and --model are only supported by reason reachable, plan, why-not and verify (and --model, --max-depth, --timeout-ms by observe reconcile; --context by diagnose).",
    );
  if (
    values.property !== undefined &&
    !(positionals[0] === "reason" && positionals[1] === "verify") &&
    positionals[0] !== "recommend"
  )
    throw new Error(
      "--property is only supported by reason verify and recommend.",
    );
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
  if (values["allow-origin"] !== undefined && positionals[0] !== "serve")
    throw new Error("--allow-origin is only supported by serve.");
  if (
    (values["at-least"] !== undefined ||
      values["at-most"] !== undefined ||
      values.baseline !== undefined) &&
    positionals[0] !== "observe"
  )
    throw new Error(
      "--at-least, --at-most and --baseline are only supported by observe check.",
    );
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
  if (positionals[0] === "mcp-reasoning") {
    if (positionals.length > 2)
      throw new Error(
        "Expected: pathcompiler mcp-reasoning [directory]. Use --help for options.",
      );
    await serveReasoningStdio(
      await developerReasoningService(positionals[1], values, cwd),
    );
    process.stderr.write(
      "PathCompiler developer reasoning MCP server ready on stdio.\n",
    );
    return "";
  }
  if (positionals[0] === "eval") return runEval(positionals, values, cwd);
  if (values["model-fixtures"] !== undefined && positionals[0] !== "analyze")
    throw new Error("--model-fixtures is only supported by analyze.");
  if (positionals[0] === "verify-pr")
    return runVerifyPr(positionals, values, cwd);
  if (values.base !== undefined && positionals[0] !== "diagnose")
    throw new Error("--base is only supported by diagnose and verify-pr.");
  if (values.candidate !== undefined || values.strict !== undefined)
    throw new Error(
      "--candidate and --strict are only supported by verify-pr.",
    );
  if (
    (values.fixture !== undefined || values["max-attempts"] !== undefined) &&
    positionals[0] !== "repair"
  )
    throw new Error(
      "--fixture and --max-attempts are only supported by repair.",
    );
  if (
    (values.spec !== undefined || values["strict-neighbors"] !== undefined) &&
    positionals[0] !== "counterexamples"
  )
    throw new Error(
      "--spec and --strict-neighbors are only supported by counterexamples.",
    );
  if (
    (values.request !== undefined ||
      values.cases !== undefined ||
      values.enforce !== undefined ||
      values["on-unknown"] !== undefined) &&
    positionals[0] !== "agent"
  )
    throw new Error(
      "--request, --cases, --enforce and --on-unknown are only supported by agent.",
    );
  if (values.impact !== undefined && positionals[0] !== "review")
    throw new Error("--impact is only supported by review queue.");
  if (positionals[0] === "review") return runReview(positionals, values, cwd);
  if (positionals[0] === "findings")
    return runFindings(positionals, values, cwd);
  if (positionals[0] === "recommend")
    return runRecommend(positionals, values, cwd);
  if (positionals[0] === "experiment")
    return runExperiment(positionals, values, cwd);
  if (positionals[0] === "memory") return runMemory(positionals, values, cwd);
  if (positionals[0] === "behavior")
    return runBehavior(positionals, values, cwd);
  if (positionals[0] === "agent") return runAgent(positionals, values, cwd);
  if (positionals[0] === "repair") return runRepair(positionals, values, cwd);
  if (positionals[0] === "counterexamples")
    return runCounterexamples(positionals, values, cwd);
  if (positionals[0] === "harness") return runHarness(positionals, values, cwd);
  if (positionals[0] === "gate")
    return runGate(
      positionals,
      values,
      cwd,
      configured?.config ?? parseConfig("version: 1\n"),
    );
  if (positionals[0] === "diagnose")
    return runDiagnose(positionals, values, cwd);
  if (positionals[0] === "analyze")
    return runAnalyze(
      positionals,
      values,
      cwd,
      configured?.config.model_provider ?? { provider: "none" },
    );
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
    (values.criteria !== undefined ||
      values.tests !== undefined ||
      values.browser !== undefined) &&
    positionals[0] !== "evaluate"
  )
    throw new Error(
      "--criteria, --tests and --browser are only supported by evaluate (and --tests, --browser by harness import).",
    );
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
    const source = await analyzeProject(
      project,
      path.resolve(cwd, values.out ?? ".pathcompiler"),
      values["no-cache"],
    );
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
    const source = await analyzeProject(
      project,
      path.resolve(cwd, values.out ?? ".pathcompiler"),
      values["no-cache"],
    );
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
    const source = await analyzeProject(
      project,
      path.resolve(cwd, values.out ?? ".pathcompiler"),
      values["no-cache"],
    );
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
    // Developer reasoning: opt in with its own token; never the API token.
    const developerToken = process.env.PATHCOMPILER_DEVELOPER_TOKEN;
    if (developerToken !== undefined && developerToken.length < 16)
      throw new Error(
        "PATHCOMPILER_DEVELOPER_TOKEN must be at least 16 characters when set.",
      );
    if (developerToken && configured && !configured.config.reasoning.enabled)
      throw new Error(
        `Developer reasoning endpoints are disabled in ${configured.file}. Set reasoning.enabled to true, or unset PATHCOMPILER_DEVELOPER_TOKEN.`,
      );
    const reasoning = developerToken
      ? {
          token: developerToken,
          service: await developerReasoningService(undefined, values, cwd),
        }
      : undefined;
    const server = createHttpService({
      client: await loadGeneratedClient(output),
      token,
      ...(reasoning ? { reasoning } : {}),
      ...(values["allow-origin"]
        ? { allowedOrigins: values["allow-origin"] }
        : {}),
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
    return `PathCompiler HTTP service listening on http://${host.includes(":") ? `[${host}]` : host}:${bound} (artifacts: ${output}).\n${values.events ? `Event ingestion: POST /v1/events/batch → ${eventsDirectory}/<project>/<day>.ndjson${ingestToken ? " (ingest token accepted)" : ""}.\n` : ""}${reasoning ? "Developer reasoning: POST /v1/reason/<operation> (developer token only).\n" : ""}`;
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
    const risk = scoreCommitRisk(
      report,
      semantic ? { uncertainty: semantic.uncertainty } : {},
    );
    await writeArtifacts(output, [
      ["reports/graph-delta.json", `${JSON.stringify(delta, null, 2)}\n`],
      ["reports/workflow-impact.json", `${JSON.stringify(report, null, 2)}\n`],
      ["reports/commit-risk.json", `${JSON.stringify(risk, null, 2)}\n`],
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
    return `Impact of ${delta.base.commit.slice(0, 12)}..${delta.head.commit.slice(0, 12)} on ${report.impacts.length} approved workflows:\n${lines.join("\n")}\nChange risk: ${risk.level.toUpperCase()} (definite ${risk.counts.definite}, probable ${risk.counts.probable}, uncertain ${risk.counts.uncertain}; a rule level, not an incident probability).\nReport: ${path.join(output, "reports/workflow-impact.json")}, ${path.join(output, "reports/commit-risk.json")}\nApproved workflows were not changed. Medium/high impact needs a reviewed update.\n`;
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
    const source = await analyzeProject(
      project,
      path.resolve(cwd, values.out ?? ".pathcompiler"),
      values["no-cache"],
    );
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
    const source = await analyzeProject(
      project,
      path.resolve(cwd, values.out ?? ".pathcompiler"),
      values["no-cache"],
    );
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
  const directory = path.resolve(cwd, positionals[1]);
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const logger = cliLogger();
  const timings: PhaseTiming[] = [];
  const project = await timed(
    timings,
    "read source",
    () => readSourceProject(directory, { exclude: values.exclude ?? [] }),
    logger,
  );
  const result = await timed(
    timings,
    "analyze",
    () =>
      values["no-cache"]
        ? { ...analyzeNextProject(project), cached: false }
        : analyzeNextProjectCached(
            project,
            createFileCache(path.join(output, "cache", "analysis"), {
              onCorrupt: (key) =>
                logger.log("warn", "corrupt cache entry recomputed", { key }),
            }),
          ),
    logger,
    { commit: project.repository.commit },
  );
  // The §53 counts need tests, capabilities and candidates; scan writes only
  // its own artifacts.
  const mined = await timed(
    timings,
    "mine tests",
    () => minePlaywrightTests(project, result.graph),
    logger,
  );
  const discovered = await timed(
    timings,
    "discover capabilities",
    () => discoverCapabilities(mined.graph),
    logger,
  );
  // Discovery needs a committed repository; the table then says why the
  // count is missing instead of failing the scan.
  let candidates: number | "n/a" = "n/a";
  let candidatesUnavailable: string | undefined;
  try {
    candidates = await timed(
      timings,
      "discover workflows",
      () =>
        discoverWorkflows(discovered.graph, discovered.report, mined.report)
          .report.candidates.length,
      logger,
    );
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    candidatesUnavailable = error.message;
  }
  const artifacts = [
    ["graph/source-graph.json", `${result.graph.serialize()}\n`],
    [
      "reports/scan-summary.json",
      `${JSON.stringify(result.summary, null, 2)}\n`,
    ],
  ] as const;
  await writeArtifacts(output, artifacts);
  const counts = result.summary.nodeCounts;
  const total = timings.reduce((sum, item) => sum + item.durationMs, 0);
  const rows: [string, number | "n/a"][] = [
    ["Files", result.summary.filesAnalyzed],
    ["Routes", counts.Route ?? 0],
    ["Components", counts.Component ?? 0],
    ["UI actions", counts.UIAction ?? 0],
    ["API endpoints", counts.APIEndpoint ?? 0],
    ["Tests", mined.report.traces.length],
    ["Capabilities", discovered.report.capabilities.length],
    ["Candidate workflows", candidates],
    ["Warnings", result.summary.diagnostics.length],
  ];
  return `${[
    `Scanned ${result.summary.filesAnalyzed} source files: ${result.summary.nodes} nodes, ${result.summary.edges} edges.`,
    `Artifacts: ${output}`,
    `Diagnostics: ${result.summary.diagnostics.length} (see scan-summary.json).`,
    "",
    "Scan complete",
    "",
    ...rows.map(
      ([label, count]) => `${label.padEnd(20)}${String(count).padStart(5)}`,
    ),
    ...(candidatesUnavailable
      ? [`Candidate workflows not counted: ${candidatesUnavailable}`]
      : []),
    "",
    `Phases: ${timings.map((item) => `${item.phase} ${item.durationMs} ms${item.phase === "analyze" && result.cached ? " (cached)" : ""}`).join(", ")}; total ${total} ms (development target for a fixture-sized repository: < ${PERFORMANCE_TARGETS_MS["fixture scan"] / 1000} s).`,
  ].join("\n")}\n`;
}

/** JSON logs on stderr when PATHCOMPILER_LOG is `json` or `debug`; silent otherwise. */
function cliLogger(): Logger {
  const mode = process.env.PATHCOMPILER_LOG;
  if (mode !== "json" && mode !== "debug") return noopLogger;
  return createJsonLogger({
    write: (line) => process.stderr.write(line),
    level: mode === "debug" ? "debug" : "info",
  });
}

/** The developer reasoning service over the repository's (or a given) model. */
async function developerReasoningService(
  directory: string | undefined,
  values: Values,
  cwd: string,
) {
  const { model, capabilities } = await loadReasoningModel(
    directory,
    values,
    cwd,
  );
  // The solver lives as long as the serving process.
  const solver = await createZ3SolverProvider();
  return createReasoningService({
    reasoner: createProductReasoner(solver),
    model,
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
  const mined = minePlaywrightTests(
    project,
    (
      await analyzeProject(
        project,
        path.resolve(cwd, values.out ?? ".pathcompiler"),
        values["no-cache"],
      )
    ).graph,
  );
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
  const mined = minePlaywrightTests(
    project,
    (
      await analyzeProject(
        project,
        path.resolve(cwd, values.out ?? ".pathcompiler"),
        values["no-cache"],
      )
    ).graph,
  );
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
  const rawBrowser =
    values.browser === undefined
      ? undefined
      : await readJsonFile(cwd, values.browser, "browser verification reports");
  const browser =
    rawBrowser === undefined
      ? undefined
      : Array.isArray(rawBrowser)
        ? rawBrowser
        : [rawBrowser];
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
      ...(browser === undefined ? {} : { browser }),
      approved,
    });
  } finally {
    await solver.close();
  }
  return reportEvaluation(evaluation, output, values);
}

/** Writes an evaluation report, and fails (nonzero exit) when the candidate fails. */
async function reportEvaluation(
  evaluation: CandidateEvaluation,
  output: string,
  values: Values,
): Promise<string> {
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
    `Browser: ${evaluation.browserResults.executed ? `${evaluation.browserResults.verified.length} verified, ${evaluation.browserResults.failed.length} failed` : "not supplied"}.`,
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
  const efficiency = positionals[1] === "efficiency";
  const dropOffs = positionals[1] === "drop-offs";
  const releaseDiff = positionals[1] === "release-diff";
  const check = positionals[1] === "check";
  if (
    (values["at-least"] !== undefined ||
      values["at-most"] !== undefined ||
      values.baseline !== undefined) &&
    !check
  )
    throw new Error(
      "--at-least, --at-most and --baseline are only supported by observe check.",
    );
  if (
    !(
      (check && positionals.length === 3) ||
      (["graph", "workflows", "transitions"].includes(positionals[1] ?? "") &&
        positionals.length === 2) ||
      ((reconcile || efficiency || dropOffs) && positionals.length <= 3) ||
      (releaseDiff && positionals.length >= 4 && positionals.length <= 5)
    )
  )
    throw new Error(
      "Expected: pathcompiler observe graph|workflows|transitions, observe check <goal>, observe reconcile|efficiency|drop-offs [directory], or observe release-diff <base-release> <head-release> [directory]. Use --help for options.",
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
  if (values.commits !== undefined && !releaseDiff)
    throw new Error("--commits is only supported by observe release-diff.");
  if (releaseDiff) {
    const [baseRelease, headRelease] = positionals.slice(2, 4) as [
      string,
      string,
    ];
    let formalChanges: FormalGoalChange[] | undefined;
    if (values.commits !== undefined) {
      const [base, head] = values.commits.split("..");
      if (!base || !head)
        throw new Error(
          "--commits expects <base-commit>..<head-commit>, the commits the two releases were built from.",
        );
      const semantic = await semanticChange(
        await analyzeCommitRangeDetailed({
          directory: path.resolve(cwd, positionals[4] ?? "."),
          base,
          head,
          exclude: values.exclude ?? [],
        }),
      );
      formalChanges = [
        ...semantic.removedReachability.map((item) => ({
          goal: item.goal,
          direction: "removed" as const,
        })),
        ...semantic.newReachability.map((item) => ({
          goal: item.goal,
          direction: "added" as const,
        })),
      ];
    }
    const diff = compareReleaseBehavior(events, baseRelease, headRelease, {
      ...(formalChanges ? { formalChanges } : {}),
    });
    await writeArtifacts(output, [
      ["reports/release-behavior.json", `${JSON.stringify(diff, null, 2)}\n`],
    ]);
    if (values.json) return `${JSON.stringify(diff, null, 2)}\n`;
    return `${[
      `Release behavior ${baseRelease} → ${headRelease} (hypotheses; ${diff.sessions.base} → ${diff.sessions.head} sessions, ${diff.minSessions}+ per release to call a change${formalChanges ? "" : "; no formal diff: pass --commits"}):`,
      ...diff.goals.map(
        (goal) =>
          `  ${goal.goal}: ${goal.base.share} → ${goal.head.share} (${goal.observed}; formal ${goal.formal}) — ${goal.class}`,
      ),
      `Report: ${path.join(output, "reports/release-behavior.json")}`,
    ].join("\n")}\n`;
  }
  if (dropOffs) {
    const { model } = await loadReasoningModel(positionals[2], values, cwd);
    const solver = await createZ3SolverProvider();
    let report: DropOffReport;
    try {
      report = await analyzeDropOffs(model, events, solver);
    } finally {
      await solver.close();
    }
    await writeArtifacts(output, [
      ["reports/drop-offs.json", `${JSON.stringify(report, null, 2)}\n`],
    ]);
    if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
    const lines = [
      `Drop-offs (hypotheses; rates need ${report.minAttempts}+ attempts, friction at ${report.frictionShare * 100}%+ of attempts):`,
    ];
    for (const item of report.items) {
      lines.push(
        `  ${item.goal} (${item.role}): ${item.attempts} attempts, ${item.completions} completed${item.dropOffRate === null ? "" : `, drop-off rate ${item.dropOffRate}`}${item.points[0] ? `; most left after ${item.points[0].target} (${item.points[0].sessions})` : ""}`,
      );
      for (const friction of item.friction)
        lines.push(
          friction.alternatives.length > 0
            ? `    friction at ${friction.target} (${friction.share}): valid routes avoiding it: ${friction.alternatives.map((route) => route.join(" → ")).join("; ")}`
            : `    friction at ${friction.target} (${friction.share}): no valid route avoids it`,
        );
    }
    lines.push(`Report: ${path.join(output, "reports/drop-offs.json")}`, "");
    return lines.join("\n");
  }
  if (efficiency) {
    const { model } = await loadReasoningModel(positionals[2], values, cwd);
    const solver = await createZ3SolverProvider();
    let report: PathEfficiencyReport;
    try {
      report = await computePathEfficiency(model, events, solver);
    } finally {
      await solver.close();
    }
    await writeArtifacts(output, [
      ["reports/path-efficiency.json", `${JSON.stringify(report, null, 2)}\n`],
    ]);
    if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
    const lines = [
      `Path efficiency (hypotheses; ${report.unit}, ratios need ${report.minCompletions}+ completions):`,
      ...report.items.map((item) =>
        item.ratio !== null
          ? `  ${item.goal} (${item.role}): median ${item.observedCost?.median} vs minimum ${item.minimumFormalCost} → ${item.ratio}× over ${item.completions} completions`
          : `  ${item.goal} (${item.role}): ${item.completions} completions; ${item.minimumFormalCost === null ? "no formal path for this role (see observe reconcile)" : "too few to compute a ratio"}`,
      ),
      ...(report.friction.length > 0
        ? [
            `Friction (ratio ≥ 1.5): ${report.friction.map((item) => `${item.goal} (${item.role}) ${item.ratio}×`).join(", ")}. A friction signal, not proof the shortest path is the best experience.`,
          ]
        : []),
      `Report: ${path.join(output, "reports/path-efficiency.json")}`,
      "",
    ];
    return lines.join("\n");
  }
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
  if (check) {
    const goal = positionals[2] as string;
    if (values["at-least"] !== undefined && values["at-most"] !== undefined)
      throw new Error("Pass --at-least or --at-most, not both.");
    const model = buildTransitionModel(graph);
    const raw = values["at-least"] ?? values["at-most"];
    const bound = raw === undefined ? undefined : Number(raw);
    if (bound !== undefined && !(bound >= 0 && bound <= 1))
      throw new Error(
        `--at-least and --at-most take a probability between 0 and 1, got "${raw}".`,
      );
    const result = {
      schemaVersion: 1,
      kind: "probabilistic-check",
      release: values.release ?? null,
      check: checkGoal(model, goal),
      property:
        bound === undefined
          ? null
          : checkReachProperty(model, {
              goal,
              op: values["at-least"] !== undefined ? "at-least" : "at-most",
              bound,
            }),
      comparison:
        values.baseline === undefined
          ? null
          : {
              baseline: values.baseline,
              ...compareReach(
                buildTransitionModel(
                  buildObservedGraph(events, {
                    projectId: project,
                    release: values.baseline,
                  }),
                ),
                model,
                goal,
              ),
            },
    };
    const target = "reports/probabilistic-check.json";
    await writeArtifacts(output, [
      [target, `${JSON.stringify(result, null, 2)}\n`],
    ]);
    if (values.json) return `${JSON.stringify(result, null, 2)}\n`;
    const range = (value: { point: number; lower: number; upper: number }) =>
      `${value.point} (bounds ${value.lower}–${value.upper} from per-transition 95% intervals)`;
    return `${[
      `Observed behavior of ${goal}${values.release ? ` in release ${values.release}` : ""} (estimates from ${model.sessions} sessions):`,
      `  P(completion) = ${range(result.check.reach)}`,
      `  P(abandonment) = ${range(result.check.abandonment)}`,
      `  Expected transitions to completion: ${result.check.expectedTransitions ?? "n/a"}`,
      ...(result.check.sufficient
        ? []
        : [
            "  Some states on the way have fewer than 30 transitions; bounds are wide.",
          ]),
      ...(result.property
        ? [
            `  Property P(completion) ${result.property.property.op} ${result.property.property.bound}: ${result.property.verdict}`,
          ]
        : []),
      ...(result.comparison
        ? [
            `  Against ${result.comparison.baseline}: ${result.comparison.direction} (${range(result.comparison.base)} → ${range(result.comparison.head)})`,
          ]
        : []),
      `Report: ${path.join(output, target)}`,
    ].join("\n")}\n`;
  }
  if (positionals[1] === "transitions") {
    const model = buildTransitionModel(graph);
    const target = "reports/transition-model.json";
    await writeArtifacts(output, [
      [target, `${JSON.stringify(model, null, 2)}\n`],
    ]);
    if (values.json) return `${JSON.stringify(model, null, 2)}\n`;
    const thin = model.states.filter(
      (state) => !state.absorbing && !state.sufficient,
    ).length;
    return `${[
      `Transition model (estimates) from ${model.sessions} sessions${values.release ? ` (release ${values.release})` : ""}: ${model.states.length} states; ${thin} below ${model.minTransitions} outgoing transitions.`,
      ...model.goals.map(
        (goal) =>
          `  P(reach ${goal.goal} from session start) = ${goal.probability}${goal.sufficient ? "" : " (insufficient data on some path)"}`,
      ),
      `Report: ${path.join(output, target)}`,
    ].join("\n")}\n`;
  }
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
  if (command === "mcp-reasoning" && !config.reasoning.enabled)
    refuse("mcp-reasoning", "reasoning.enabled to true");
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
  if (
    (command === "gate" || command === "recommend") &&
    !config.modes.recommend
  )
    refuse(`${command} (mode 4, Recommend)`, "modes.recommend to true");
  if (command === "observe") {
    if (!config.modes.observe)
      refuse(`observe ${sub ?? ""}`.trim(), "modes.observe to true");
    if (sub === "drop-offs" && !reasoningEnabled(config, "enumeration"))
      refuse(
        "observe drop-offs",
        "reasoning.enabled and reasoning.enumeration to true",
      );
    if (
      sub === "release-diff" &&
      (values as { commits?: string }).commits !== undefined &&
      !reasoningEnabled(config, "semantic_diff")
    )
      refuse(
        "observe release-diff --commits",
        "reasoning.enabled and reasoning.semantic_diff to true",
      );
    if (sub === "efficiency" && !reasoningEnabled(config, "optimization"))
      refuse(
        "observe efficiency",
        "reasoning.enabled and reasoning.optimization to true",
      );
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
  const source = await analyzeProject(project, output);
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
    const risk = scoreCommitRisk(
      impact,
      semantic ? { uncertainty: semantic.uncertainty } : {},
    );
    await writeArtifacts(output, [
      ["reports/graph-delta.json", `${JSON.stringify(delta, null, 2)}\n`],
      ["reports/workflow-impact.json", `${JSON.stringify(impact, null, 2)}\n`],
      ["reports/commit-risk.json", `${JSON.stringify(risk, null, 2)}\n`],
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
    return `Wrote ${written.length} proposals for medium/high impact${kept.length ? `; kept ${kept.length} existing` : ""}.\n${[...written, ...kept].map((name) => `  ${name}`).join("\n")}${written.length + kept.length ? "\n" : ""}Change risk: ${risk.level.toUpperCase()} (definite ${risk.counts.definite}, probable ${risk.counts.probable}, uncertain ${risk.counts.uncertain}; a rule level, not an incident probability).\nApproved workflows were not changed. Review with proposals show/accept/reject/ignore.\n`;
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
        (
          await analyzeProject(
            project,
            path.resolve(cwd, values.out ?? ".pathcompiler"),
            values["no-cache"],
          )
        ).graph,
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
  const mined = minePlaywrightTests(
    project,
    (
      await analyzeProject(
        project,
        path.resolve(cwd, values.out ?? ".pathcompiler"),
        values["no-cache"],
      )
    ).graph,
  );
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

const ModelFixturesSchema = z.array(
  z.strictObject({
    kind: z.enum([
      "inferCapabilities",
      "synthesizeWorkflow",
      "explainImpact",
      "generateAliases",
      "summarizeEvidence",
    ]),
    key: z.string().min(1).optional(),
    request: z.unknown().optional(),
    response: z.unknown(),
  }),
);

/** The configured provider; keys come only from the environment. */
async function configuredModelProvider(
  config: PathCompilerConfig["model_provider"],
): Promise<PathCompilerModelProvider> {
  const key = (fallback: string | undefined) => {
    const name = config.api_key_env ?? fallback;
    const value = name ? process.env[name] : undefined;
    if (fallback && !value)
      throw new Error(
        `model_provider.provider is ${config.provider} but $${name} is not set. Export the API key, or set model_provider.api_key_env to the variable that holds it.`,
      );
    return value;
  };
  const model = () => {
    if (!config.model)
      throw new Error(
        `model_provider.provider is ${config.provider}; set model_provider.model to the model to use.`,
      );
    return config.model;
  };
  switch (config.provider) {
    case "none":
      return new NoopModelProvider();
    case "anthropic": {
      // Loaded only when chosen: the one package with a vendor SDK (ADR 0071).
      const anthropic = await import("@pathcompiler/model-provider-anthropic");
      return anthropic.createAnthropicModelProvider({
        apiKey: key(anthropic.DEFAULT_ANTHROPIC_KEY_ENV) as string,
        ...(config.model ? { model: config.model } : {}),
      });
    }
    case "openai":
      return createOpenAIModelProvider({
        apiKey: key(DEFAULT_OPENAI_KEY_ENV) as string,
        model: model(),
        ...(config.base_url ? { baseUrl: config.base_url } : {}),
      });
    case "local": {
      const apiKey = key(undefined);
      return createLocalModelProvider({
        model: model(),
        ...(config.base_url ? { baseUrl: config.base_url } : {}),
        ...(apiKey ? { apiKey } : {}),
      });
    }
  }
}

async function runAnalyze(
  positionals: string[],
  values: Values,
  cwd: string,
  config: PathCompilerConfig["model_provider"],
): Promise<string> {
  if (positionals.length > 2)
    throw new Error(
      "Expected: pathcompiler analyze [directory]. Use --help for options.",
    );
  const directory = path.resolve(cwd, positionals[1] ?? ".");
  const project = await readSourceProject(directory, {
    exclude: values.exclude ?? [],
  });
  const mined = minePlaywrightTests(
    project,
    (
      await analyzeProject(
        project,
        path.resolve(cwd, values.out ?? ".pathcompiler"),
        values["no-cache"],
      )
    ).graph,
  );
  const surfaces = discoverProductSurfaces(mined.graph).report.surfaces;
  const { capabilities } = discoverCapabilities(mined.graph).report;
  const fixtures = values["model-fixtures"];
  const provider = fixtures
    ? new FixtureModelProvider(
        ModelFixturesSchema.parse(
          JSON.parse(await readFile(path.resolve(cwd, fixtures), "utf8")),
        ),
      )
    : await configuredModelProvider(config);
  const report = await interpretAmbiguities({
    provider,
    graph: mined.graph,
    surfaces,
    capabilities,
  });
  // P1: candidate meanings (rule and hypotheses) filtered by hard constraints.
  const interpretations = interpretCapabilities({
    graph: mined.graph,
    capabilities,
    subjects: report.clusters.flatMap((cluster) =>
      cluster.capabilities.map((item) => item.id),
    ),
    hypotheses: report.hypotheses,
  });
  // P2: one joint choice; actions with different handlers never share a meaning.
  let joint: Awaited<
    ReturnType<typeof selectCapabilityInterpretations>
  > | null = null;
  if (interpretations.items.length > 0) {
    const solver = await createZ3SolverProvider();
    try {
      joint = await selectCapabilityInterpretations({
        report: interpretations,
        graph: mined.graph,
        capabilities,
        solver,
      });
    } finally {
      await solver.close();
    }
  }
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const file = "reports/semantic-hypotheses.json";
  const interpretationFile = "reports/semantic-interpretations.json";
  await writeArtifacts(output, [
    [file, `${JSON.stringify(report, null, 2)}\n`],
    [
      interpretationFile,
      `${JSON.stringify({ ...interpretations, joint }, null, 2)}\n`,
    ],
  ]);
  if (values.json)
    return `${JSON.stringify({ ...report, interpretations: { ...interpretations, joint } }, null, 2)}\n`;
  const lines = [
    `Semantic analysis (provider: ${report.provider}): ${report.clusters.length} ambiguous clusters of ${capabilities.length} capabilities.`,
  ];
  for (const cluster of report.clusters)
    lines.push(
      `  ${cluster.id}: ${cluster.capabilities.map((item) => `${item.id} (${item.reasons.join(", ")})`).join("; ")}`,
    );
  if (report.provider === "none")
    lines.push(
      "No model provider is configured; nothing was sent. Set model_provider in pathcompiler.yaml to interpret the clusters.",
    );
  else {
    lines.push(
      `Hypotheses: ${report.summary.supported} supported, ${report.summary.rejected} rejected (never applied).`,
    );
    for (const hypothesis of report.hypotheses)
      lines.push(
        `  ${hypothesis.status === "supported" ? "+" : "-"} ${hypothesis.kind} ${hypothesis.capabilityIds.join(", ") || "(none)"} → "${hypothesis.title}"${hypothesis.rejections.length ? ` [${hypothesis.rejections.join(", ")}]` : ""}`,
      );
    lines.push(
      `Sent ${report.context.requests.length} requests, ${report.context.requests.reduce((sum, item) => sum + item.bytes, 0)} bytes; never file contents.`,
    );
  }
  const { summary } = interpretations;
  lines.push(
    `Interpretations: ${summary.subjects} capabilities, ${summary.changed} with a different best meaning, ${summary.ruleImpossible} whose rule meaning violates a hard constraint, ${summary.unresolved} unresolved.`,
  );
  for (const item of interpretations.items)
    if (item.changed || item.best === null)
      lines.push(
        `  ${item.subject} → ${item.best ?? "(unresolved)"} (${item.assessment.confidence.band}); impossible: ${
          item.candidates
            .filter((candidate) => candidate.status === "impossible")
            .map(
              (candidate) =>
                `${candidate.value} [${candidate.violations.map((violation) => violation.split(":")[0]).join(", ")}]`,
            )
            .join("; ") || "none"
        }`,
      );
  if (joint)
    lines.push(
      joint.status === "optimal"
        ? `Joint selection: ${joint.assignments.filter((item) => item.joint).length} meanings differ from the per-capability best.${joint.assignments
            .filter((item) => item.joint)
            .map(
              (item) =>
                `\n  ${item.subject} → ${item.value ?? "(none)"} (alone: ${item.localBest ?? "unresolved"})`,
            )
            .join("")}`
        : `Joint selection: ${joint.status}${joint.reason ? ` (${joint.reason})` : ""}; per-capability results stand.`,
    );
  lines.push(
    `Reports: ${path.join(output, file)}, ${path.join(output, interpretationFile)}`,
    "",
  );
  return lines.join("\n");
}

async function runDiagnose(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const [, reportFile, directory, ...rest] = positionals;
  if (!reportFile || rest.length > 0)
    throw new Error(
      "Expected: pathcompiler diagnose <browser-report.json> [directory]. Use --help for options.",
    );
  let report: unknown;
  try {
    report = JSON.parse(await readFile(path.resolve(cwd, reportFile), "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read the browser verification report ${reportFile}. Provide the JSON verifyWorkflowInBrowser returned (schemaVersion 2).`,
      { cause: error },
    );
  }
  const project = await readSourceProject(path.resolve(cwd, directory ?? "."), {
    exclude: values.exclude ?? [],
  });
  const mined = minePlaywrightTests(
    project,
    (
      await analyzeProject(
        project,
        path.resolve(cwd, values.out ?? ".pathcompiler"),
        values["no-cache"],
      )
    ).graph,
  );
  const capabilities = discoverCapabilities(mined.graph);
  const { model } = buildFormalModel(
    capabilities.graph,
    capabilities.report,
    mined.report,
  );
  const sourceTargets = mined.graph.nodesByType("UIAction").flatMap((node) => {
    const id = z
      .object({ semanticId: z.string().optional() })
      .parse(node.data?.target ?? {}).semanticId;
    return id ? [id] : [];
  });
  const context = Object.fromEntries(
    Object.entries(parseContext(values.context, model)).filter(
      (entry): entry is [string, string | boolean] =>
        typeof entry[1] === "string" || typeof entry[1] === "boolean",
    ),
  );
  let changedEndpoints: string[] | undefined;
  if (values.base !== undefined) {
    const candidate =
      (report as { candidateCommit?: string | null }).candidateCommit ?? "HEAD";
    const { summary } = (
      await analyzeCommitRangeDetailed({
        directory: path.resolve(cwd, directory ?? "."),
        base: values.base,
        head: candidate,
        exclude: values.exclude ?? [],
      })
    ).delta;
    changedEndpoints = [
      ...new Set([
        ...summary.apis.added,
        ...summary.apis.removed,
        ...summary.apis.changed,
      ]),
    ].sort();
  }
  const diagnosis = diagnoseBrowserFailure({
    report: report as Parameters<typeof diagnoseBrowserFailure>[0]["report"],
    model,
    sourceTargets,
    ...(values.context ? { context } : {}),
    ...(changedEndpoints ? { changedEndpoints } : {}),
  });
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const file = "reports/diagnosis.json";
  await writeArtifacts(output, [
    [file, `${JSON.stringify(diagnosis, null, 2)}\n`],
  ]);
  if (values.json) return `${JSON.stringify(diagnosis, null, 2)}\n`;
  if (!diagnosis.failure)
    return `The report shows a passing run; nothing to diagnose.\nReport: ${path.join(output, file)}\n`;
  return [
    `Failure: ${diagnosis.failure.code} at ${diagnosis.failure.stage}${diagnosis.failure.target ? ` (${diagnosis.failure.target})` : ""}.`,
    `Likely cause: ${diagnosis.top ?? "none supported by the evidence"} (a hypothesis).`,
    ...diagnosis.causes.map(
      (item) =>
        `  ${item.rank}. ${item.cause}: ${item.assessment.status}, ${item.assessment.confidence.band}${item.evidence
          .filter((evidence) => evidence.stance === "supports")
          .map((evidence) => `\n     + ${evidence.summary}`)
          .join("")}`,
    ),
    `Report: ${path.join(output, file)}`,
    "",
  ].join("\n");
}

/** Parsed `*.yaml` records in a directory under the output; none when it does not exist. */
async function readRecords<T>(
  directory: string,
  parse: (input: string) => T,
  what: string,
): Promise<{ name: string; record: T }[]> {
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
  const records: { name: string; record: T }[] = [];
  for (const name of names) {
    const file = path.join(directory, name);
    try {
      records.push({ name, record: parse(await readFile(file, "utf8")) });
    } catch (error) {
      throw new Error(`Cannot read ${file} as ${what}. Fix or move it.`, {
        cause: error,
      });
    }
  }
  return records;
}

async function runReview(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const sub = positionals[1];
  if (positionals.length !== 2 || (sub !== "queue" && sub !== "feedback"))
    throw new Error(
      "Expected: pathcompiler review queue or review feedback. Use --help for options.",
    );
  if (values.impact !== undefined && sub !== "queue")
    throw new Error("--impact is only supported by review queue.");
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const proposals = await readRecords(
    path.join(output, "proposals"),
    parseProposalYaml,
    "a proposal",
  );
  if (sub === "feedback") {
    const feedback = collectReviewFeedback({
      approved: await readApproved(output),
      rejected: (
        await readRecords(
          path.join(output, "workflows", "rejected"),
          parseRejectedWorkflowYaml,
          "a rejected workflow",
        )
      ).map((item) => item.record),
      proposals: proposals.map((item) => item.record),
    });
    const calibration = calibrationFromReviews(feedback);
    const report = {
      schemaVersion: 1,
      kind: "review-calibration",
      feedback,
      calibration,
    };
    const file = "reports/review-calibration.json";
    await writeArtifacts(output, [
      [file, `${JSON.stringify(report, null, 2)}\n`],
    ]);
    if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
    const counts = new Map<string, number>();
    for (const item of feedback)
      counts.set(item.decision, (counts.get(item.decision) ?? 0) + 1);
    return `${[
      `Review feedback: ${feedback.length} decisions${feedback.length ? ` (${[...counts].map(([decision, count]) => `${count} ${decision}`).join(", ")})` : ""}.`,
      ...calibration.bands.map(
        (band) =>
          `  ${band.band}: ${band.correct}/${band.samples} accepted as proposed${band.samples < calibration.minSamples ? ` (fewer than ${calibration.minSamples}: not yet a calibration)` : ""}`,
      ),
      `Report: ${path.join(output, file)}`,
    ].join("\n")}\n`;
  }
  const pending = new Set(
    (await listWorkflows(output))
      .filter((item) => item.state === "candidate")
      .map((item) => item.id),
  );
  const candidates = (
    await readRecords(
      path.join(output, "workflows", "candidates"),
      parseCandidateYaml,
      "a workflow candidate",
    )
  )
    .map((item) => item.record.workflow)
    .filter((workflow) => pending.has(workflow.id));
  let businessImpact: Record<string, number> | undefined;
  if (values.impact !== undefined)
    try {
      businessImpact = z
        .record(z.string(), z.number())
        .parse(
          JSON.parse(await readFile(path.resolve(cwd, values.impact), "utf8")),
        );
    } catch (error) {
      throw new Error(
        `Cannot read ${values.impact}: expected a JSON object of workflow IDs or domains to numbers in (0, 1].`,
        { cause: error },
      );
    }
  const project = path.basename(path.dirname(output));
  const events = await readEventDirectory(
    path.join(output, "events", encodeURIComponent(project)),
  );
  const usage =
    events.length === 0
      ? undefined
      : Object.fromEntries(
          computeWorkflowAnalytics(events).workflows.map((item) => [
            item.workflowId,
            item.starts,
          ]),
        );
  const queue = prioritizeReviews({
    candidates,
    proposals: proposals.map(({ name, record }) => ({
      name,
      proposal: record,
    })),
    ...(usage ? { usage } : {}),
    ...(businessImpact ? { businessImpact } : {}),
  });
  const file = "reports/review-queue.json";
  await writeArtifacts(output, [[file, `${JSON.stringify(queue, null, 2)}\n`]]);
  if (values.json) return `${JSON.stringify(queue, null, 2)}\n`;
  return `${[
    `Review queue: ${queue.items.length} pending items (priority orders review; it is not a probability).`,
    ...queue.items.map(
      (item, index) =>
        `  ${index + 1}. ${item.priority} ${item.kind} ${item.id}: uncertainty ${item.factors.uncertainty.value} × impact ${item.factors.businessImpact.value} × usage ${item.factors.usage.value} × severity ${item.factors.severity.value}`,
    ),
    `Report: ${path.join(output, file)}`,
  ].join("\n")}\n`;
}

async function runFindings(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  if (positionals.length > 2)
    throw new Error(
      "Expected: pathcompiler findings [workflow|capability|goal]. Use --help for options.",
    );
  const subject = positionals[1];
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  // Reports written by impact, reason diff and observe; each is optional.
  const sources: [keyof FindingInputs, string, z.ZodType][] = [
    [
      "semantic",
      "semantic-change",
      z.looseObject({ type: z.literal("semantic_change_report") }),
    ],
    ["impact", "workflow-impact", WorkflowImpactReportSchema],
    [
      "releaseDiff",
      "release-behavior",
      z.looseObject({ baseRelease: z.string(), goals: z.array(z.unknown()) }),
    ],
    [
      "efficiency",
      "path-efficiency",
      z.looseObject({ friction: z.array(z.unknown()) }),
    ],
    ["dropOffs", "drop-offs", z.looseObject({ items: z.array(z.unknown()) })],
    [
      "reconciliation",
      "reconciliation",
      z.looseObject({
        items: z.array(z.unknown()),
        discrepancies: z.array(z.unknown()),
      }),
    ],
  ];
  const inputs: Record<string, unknown> = {};
  const used: string[] = [];
  for (const [key, name, schema] of sources) {
    const file = path.join(output, "reports", `${name}.json`);
    const content = await readOptional(file);
    if (content === undefined) continue;
    try {
      inputs[key] = schema.parse(JSON.parse(content));
    } catch (error) {
      throw new Error(
        `Cannot read ${file}. Regenerate it with the command that writes it.`,
        { cause: error },
      );
    }
    used.push(name);
  }
  if (used.length === 0)
    throw new Error(
      `No reports under ${path.join(output, "reports")} to derive findings from. Run impact (--reasoning), reason diff, or observe reconcile, efficiency, drop-offs or release-diff first.`,
    );
  const derived = deriveFindings(inputs as FindingInputs);
  const report = subject
    ? (() => {
        const opportunities = derived.opportunities.filter(
          (item) => item.subject === subject,
        );
        const ids = new Set(opportunities.flatMap((item) => item.findingIds));
        return {
          ...derived,
          findings: derived.findings.filter(
            (item) => ids.has(item.id) || item.target.id === subject,
          ),
          opportunities,
        };
      })()
    : derived;
  const file = "reports/findings.json";
  await writeArtifacts(output, [
    [file, `${JSON.stringify(report, null, 2)}\n`],
  ]);
  if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
  return `${[
    `Findings (hypotheses, not recommendations) from ${used.join(", ")}: ${report.findings.length} findings in ${report.opportunities.length} opportunities.`,
    ...report.opportunities.flatMap((opportunity) => [
      `  ${opportunity.subject} (priority ${opportunity.priority.score}): ${opportunity.kinds.join(", ")}`,
      ...report.findings
        .filter((finding) => opportunity.findingIds.includes(finding.id))
        .map(
          (finding) =>
            `    ${finding.severity} ${finding.kind} ${finding.target.id}${finding.target.context ? ` [${finding.target.context}]` : ""}, confidence ${finding.confidence.confidence.band}: ${finding.summary}`,
        ),
    ]),
    `Report: ${path.join(output, file)}`,
  ].join("\n")}\n`;
}

async function runGate(
  positionals: string[],
  values: Values,
  cwd: string,
  config: PathCompilerConfig,
): Promise<string> {
  if (positionals.length !== 1)
    throw new Error("Expected: pathcompiler gate. Use --help for options.");
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const file = path.join(output, "reports", "findings.json");
  const content = await readOptional(file);
  if (content === undefined)
    throw new Error(`No findings at ${file}. Run pathcompiler findings first.`);
  let findings: FindingsReport;
  try {
    findings = z
      .looseObject({
        kind: z.literal("findings"),
        findings: z.array(z.looseObject({ id: z.string() })),
        opportunities: z.array(z.looseObject({ id: z.string() })),
      })
      .parse(JSON.parse(content)) as unknown as FindingsReport;
  } catch (error) {
    throw new Error(`Cannot read ${file}. Rerun pathcompiler findings.`, {
      cause: error,
    });
  }
  const project = path.basename(path.dirname(output));
  const events = await readEventDirectory(
    path.join(output, "events", encodeURIComponent(project)),
  );
  let usage: Record<string, SubjectUsage> | undefined;
  if (events.length > 0) {
    const sessions = new Set(
      events.map((event) => `${event.projectId}\u0000${event.sessionId}`),
    ).size;
    usage = Object.fromEntries(
      computeWorkflowAnalytics(events).workflows.map((item) => [
        item.workflowId,
        {
          affected: item.starts,
          eligible: sessions,
          completionRate: item.completionRate,
        },
      ]),
    );
  }
  // Mode 6 is opt-in twice: the policy and the operating mode.
  const policy = {
    ...config.improvement_policy,
    autonomous_mutation:
      config.improvement_policy.autonomous_mutation &&
      config.modes.self_improvement,
  };
  const report = gateFindings(findings, policy, usage ? { usage } : {});
  const target = "reports/gate-decisions.json";
  await writeArtifacts(output, [
    [target, `${JSON.stringify(report, null, 2)}\n`],
  ]);
  if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
  return `${[
    `Gate decisions for ${report.decisions.length} opportunities (recommendations ${report.budgets.recommendations.used}/${report.budgets.recommendations.max} this run):`,
    ...report.decisions.map(
      (item) =>
        `  ${item.decision} ${item.subject}: ${item.rationale.at(-1) ?? ""}`,
    ),
    `Report: ${path.join(output, target)}`,
  ].join("\n")}\n`;
}

async function runRecommend(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  if (positionals.length !== 1)
    throw new Error(
      "Expected: pathcompiler recommend. Use --help for options.",
    );
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const read = async (name: string, command: string) => {
    const file = path.join(output, "reports", name);
    const content = await readOptional(file);
    if (content === undefined)
      throw new Error(`No ${file}. Run pathcompiler ${command} first.`);
    try {
      return JSON.parse(content) as unknown;
    } catch (error) {
      throw new Error(`Cannot read ${file}. Rerun pathcompiler ${command}.`, {
        cause: error,
      });
    }
  };
  const findings = z
    .looseObject({ kind: z.literal("findings") })
    .parse(
      await read("findings.json", "findings"),
    ) as unknown as FindingsReport;
  const gate = z
    .looseObject({ kind: z.literal("gate-decisions") })
    .parse(await read("gate-decisions.json", "gate")) as unknown as GateReport;
  let properties: ProductProperty[] = [];
  if (values.property !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        await readFile(path.resolve(cwd, values.property), "utf8"),
      );
      properties = z
        .array(ProductPropertySchema)
        .parse(
          Array.isArray(parsed)
            ? parsed
            : (parsed as { properties?: unknown }).properties,
        );
    } catch (error) {
      throw new Error(
        `Cannot read properties from ${values.property}. Provide a JSON array of properties or { "properties": [...] }.`,
        { cause: error },
      );
    }
  }
  const generated = recommend({
    findings,
    gate,
    approvedWorkflows: (await readApproved(output)).map(
      (record) => record.workflow.id,
    ),
    properties: properties.map(({ id, kind, description }) => ({
      id,
      kind,
      description,
    })),
  });
  // I8: earlier lessons for the same subject and category weigh on priority.
  const memory = (
    await readJsonRecords(path.join(output, "memory"), (value) =>
      ImprovementMemoryRecordSchema.parse(value),
    )
  ).map((item) => item.record);
  const report = {
    ...generated,
    recommendations: rankWithMemory(generated.recommendations, memory),
  };
  const file = "reports/recommendations.json";
  await writeArtifacts(output, [
    [file, `${JSON.stringify(report, null, 2)}\n`],
  ]);
  if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
  return `${[
    `Recommendations: ${report.recommendations.length} (${report.skipped.length} opportunities not escalated by the gate).`,
    ...report.recommendations.map(
      (item) =>
        `  ${item.category.toUpperCase()} ${item.target.subject}: ${item.hypothesis.statement} (finding confidence ${item.findingConfidence.band}; intervention ${item.hypothesis.confidence.band}, a template prior)`,
    ),
    `Report: ${path.join(output, file)}`,
    "Recommendations are for human review; nothing was changed.",
  ].join("\n")}\n`;
}

async function runExperiment(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  if (positionals[1] === "measure") return runMeasure(positionals, values, cwd);
  if (positionals[1] === "decide") return runDecide(positionals, values, cwd);
  if (positionals[1] === "approve" || positionals[1] === "decline")
    return runApproveDecision(positionals, values, cwd);
  const [, sub, recommendationId, evaluationFile, control, treatment, ...rest] =
    positionals;
  if (
    sub !== "create" ||
    !recommendationId ||
    !evaluationFile ||
    !control ||
    !treatment ||
    rest.length > 0
  )
    throw new Error(
      "Expected: pathcompiler experiment create <recommendation-id> <evaluation.json> <control-release> <treatment-release>. Use --help for options.",
    );
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const recommendations = await readOptional(
    path.join(output, "reports", "recommendations.json"),
  );
  if (recommendations === undefined)
    throw new Error(
      `No ${path.join(output, "reports", "recommendations.json")}. Run pathcompiler recommend first.`,
    );
  const recommendation = (
    JSON.parse(recommendations) as {
      recommendations?: ImprovementRecommendation[];
    }
  ).recommendations?.find((item) => item.id === recommendationId);
  if (!recommendation)
    throw new Error(
      `No recommendation ${recommendationId} in reports/recommendations.json.`,
    );
  const evaluation = z
    .looseObject({
      type: z.literal("candidate_evaluation"),
      id: z.string(),
      candidate: z.string(),
      status: z.string(),
    })
    .parse(
      await readJsonFile(cwd, evaluationFile, "candidate evaluation"),
    ) as unknown as CandidateEvaluation;
  let spec: ReturnType<typeof createExperimentSpec>;
  try {
    spec = createExperimentSpec({
      recommendation,
      evaluation,
      controlRelease: control,
      treatmentRelease: treatment,
    });
  } catch (error) {
    if (error instanceof ExperimentError)
      throw new Error(`Cannot specify an experiment: ${error.message}`, {
        cause: error,
      });
    throw error;
  }
  const file = `experiments/${encodeURIComponent(spec.id)}.json`;
  await writeArtifacts(output, [[file, `${JSON.stringify(spec, null, 2)}\n`]]);
  if (values.json) return `${JSON.stringify(spec, null, 2)}\n`;
  return `${[
    `Experiment ${spec.id} specified (not deployed): ${spec.control.release} (control) vs ${spec.treatment.release} (treatment, ${spec.treatment.commit.slice(0, 12)}).`,
    `  Primary: ${spec.primaryMetric.metric} ${spec.primaryMetric.direction} on ${spec.primaryMetric.on}, by at least ${spec.successCriteria.minimumRelativeImprovement * 100}% relative, ${spec.successCriteria.minSessionsPerArm}+ sessions per arm.`,
    `  Guardrails: ${spec.guardrails.map((item) => `${item.metric} on ${item.on}`).join("; ")}.`,
    `Criteria frozen at ${spec.frozenAt} (hash ${spec.frozenHash.slice(0, 12)}): ${path.join(output, file)}`,
  ].join("\n")}\n`;
}

async function runMeasure(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const [, , specFile, evaluationFile, ...rest] = positionals;
  if (!specFile || rest.length > 0)
    throw new Error(
      "Expected: pathcompiler experiment measure <experiment.json> [evaluation.json]. Use --help for options.",
    );
  const spec = await readJsonFile(cwd, specFile, "experiment spec");
  const evaluation =
    evaluationFile === undefined
      ? undefined
      : z
          .looseObject({ status: z.string() })
          .parse(
            await readJsonFile(cwd, evaluationFile, "candidate evaluation"),
          );
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const project = path.basename(path.dirname(output));
  const events = await readEventDirectory(
    path.join(output, "events", encodeURIComponent(project)),
  );
  let outcome: ReturnType<typeof measureOutcome>;
  try {
    outcome = measureOutcome({
      spec,
      events,
      ...(evaluation ? { evaluationStatus: evaluation.status } : {}),
    });
  } catch (error) {
    throw new Error(
      `Cannot measure ${specFile}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const file = `reports/outcomes/${encodeURIComponent(outcome.experimentId)}.json`;
  await writeArtifacts(output, [
    [file, `${JSON.stringify(outcome, null, 2)}\n`],
  ]);
  if (values.json) return `${JSON.stringify(outcome, null, 2)}\n`;
  const show = (item: ReturnType<typeof measureOutcome>["primaryMetric"]) =>
    item.control && item.treatment
      ? `${item.control.value} (${item.control.sessions} sessions) → ${item.treatment.value} (${item.treatment.sessions})${item.significant ? "" : ", intervals overlap"}`
      : "not measured";
  return `${[
    `Outcome of ${outcome.experimentId}: ${outcome.outcome.toUpperCase()}. ${outcome.rationale}`,
    `  Primary ${outcome.primaryMetric.metric} on ${outcome.primaryMetric.on}: ${show(outcome.primaryMetric)}`,
    ...outcome.guardrails.map(
      (item) =>
        `  Guardrail ${item.metric} on ${item.on}: ${show(item)}${item.breached ? " — BREACHED" : ""}`,
    ),
    `  Formal (candidate evaluation): ${outcome.formal.status ?? "not supplied"}; behavior and formal results are separate.`,
    ...outcome.evidenceGaps.map((item) => `  · ${item}`),
    `Report: ${path.join(output, file)}`,
  ].join("\n")}\n`;
}

async function runDecide(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const [, , outcomeFile, ...rest] = positionals;
  if (!outcomeFile || rest.length > 0)
    throw new Error(
      "Expected: pathcompiler experiment decide <outcome.json>. Use --help for options.",
    );
  const outcome = z
    .looseObject({ kind: z.literal("outcome-assessment") })
    .parse(
      await readJsonFile(cwd, outcomeFile, "outcome assessment"),
    ) as unknown as OutcomeAssessment;
  const decision = decideAdoption(outcome);
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const file = `decisions/${encodeURIComponent(decision.experimentId)}.json`;
  if (await readOptional(path.join(output, file)))
    throw new Error(
      `A decision for ${decision.experimentId} already exists at ${path.join(output, file)}; decisions are not overwritten.`,
    );
  await writeArtifacts(output, [
    [file, `${JSON.stringify(decision, null, 2)}\n`],
  ]);
  if (values.json) return `${JSON.stringify(decision, null, 2)}\n`;
  return `${[
    `Recommended decision for ${decision.experimentId}: ${decision.decision.toUpperCase()} (hypothesis ${decision.hypothesis})${decision.alternatives.length ? `; alternatives: ${decision.alternatives.join(", ")}` : ""}.`,
    ...decision.reasons.map((item) => `  - ${item}`),
    `Pending human approval: pathcompiler experiment approve|decline ${path.join(path.relative(cwd, output), file)} --by <name>`,
  ].join("\n")}\n`;
}

async function runApproveDecision(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const [, verb, decisionFile, ...rest] = positionals;
  if (!decisionFile || rest.length > 0)
    throw new Error(
      `Expected: pathcompiler experiment ${verb} <decision.json> [--by <name>]. Use --help for options.`,
    );
  const file = path.resolve(cwd, decisionFile);
  const decision = z
    .looseObject({ kind: z.literal("adoption-decision") })
    .parse(
      await readJsonFile(cwd, decisionFile, "adoption decision"),
    ) as unknown as AdoptionDecision;
  const decided = recordApproval(decision, {
    approved: verb === "approve",
    decidedBy: reviewer(values.by),
    decidedAt: new Date().toISOString(),
    ...(values.reason ? { note: values.reason } : {}),
  });
  await writeFile(file, `${JSON.stringify(decided, null, 2)}\n`);
  return `${verb === "approve" ? "Approved" : "Declined"} ${decided.decision} for ${decided.experimentId} by ${decided.approval.status === "pending" ? "" : decided.approval.decidedBy}. Carry it out in your deployment or experiment platform; PathCompiler does not.\n`;
}

/** Parsed `*.json` records in a directory; none when it does not exist. */
async function readJsonRecords<T>(
  directory: string,
  parse: (value: unknown) => T,
): Promise<{ name: string; record: T }[]> {
  let names: string[];
  try {
    names = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: { name: string; record: T }[] = [];
  for (const name of names) {
    const file = path.join(directory, name);
    try {
      records.push({
        name,
        record: parse(JSON.parse(await readFile(file, "utf8"))),
      });
    } catch (error) {
      throw new Error(`Cannot read ${file}. Fix or move it.`, { cause: error });
    }
  }
  return records;
}

async function runMemory(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const directory = path.join(output, "memory");
  if (positionals[1] === "list" && positionals.length === 2) {
    const records = (
      await readJsonRecords(directory, (value) =>
        ImprovementMemoryRecordSchema.parse(value),
      )
    ).map((item) => item.record);
    if (values.json) return `${JSON.stringify(records, null, 2)}\n`;
    return `${[
      `Improvement memory: ${records.length} records.`,
      ...records.map(
        (record) =>
          `  ${record.recommendationId}: ${record.decision ?? "no decision"} (${record.approval ?? "open"})${record.reusableLessons.map((lesson) => `\n    lesson (${lesson.verdict}): ${lesson.statement}`).join("")}`,
      ),
    ].join("\n")}\n`;
  }
  const recommendationId = positionals[2];
  if (
    positionals[1] !== "record" ||
    !recommendationId ||
    positionals.length !== 3
  )
    throw new Error(
      "Expected: pathcompiler memory record <recommendation-id> or memory list. Use --help for options.",
    );
  const recommendations = await readOptional(
    path.join(output, "reports", "recommendations.json"),
  );
  const recommendation = recommendations
    ? (
        JSON.parse(recommendations) as {
          recommendations?: ImprovementRecommendation[];
        }
      ).recommendations?.find((item) => item.id === recommendationId)
    : undefined;
  if (!recommendation)
    throw new Error(
      `No recommendation ${recommendationId} in ${path.join(output, "reports", "recommendations.json")}. Run pathcompiler recommend first.`,
    );
  const experiments = (
    await readJsonRecords(path.join(output, "experiments"), (value) =>
      parseExperimentSpec(value),
    )
  )
    .map((item) => item.record)
    .filter((item) => item.recommendationId === recommendationId)
    .sort((a, b) => (a.frozenAt < b.frozenAt ? 1 : -1));
  const experiment = experiments[0];
  const forExperiment = async (folder: string) =>
    experiment
      ? await readOptional(
          path.join(
            output,
            folder,
            `${encodeURIComponent(experiment.id)}.json`,
          ),
        )
      : undefined;
  const outcome = await forExperiment(path.join("reports", "outcomes"));
  const decision = await forExperiment("decisions");
  const record = buildMemoryRecord({
    recommendation,
    ...(experiment ? { experiment } : {}),
    ...(outcome ? { outcome: JSON.parse(outcome) as OutcomeAssessment } : {}),
    ...(decision ? { decision: JSON.parse(decision) as AdoptionDecision } : {}),
  });
  const file = `memory/${encodeURIComponent(recommendationId)}.json`;
  await writeArtifacts(output, [
    [file, `${JSON.stringify(record, null, 2)}\n`],
  ]);
  if (values.json) return `${JSON.stringify(record, null, 2)}\n`;
  return `${[
    `Recorded ${recommendationId}: ${
      [
        experiment ? "experiment" : undefined,
        outcome ? "outcome" : undefined,
        decision
          ? `decision ${record.decision} (${record.approval})`
          : undefined,
      ]
        .filter(Boolean)
        .join(", ") || "recommendation only"
    }; ${record.reusableLessons.length} lesson(s).`,
    `Memory: ${path.join(output, file)}`,
  ].join("\n")}\n`;
}

async function runHarness(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  if (positionals[1] === "import")
    return runHarnessImport(positionals, values, cwd);
  const [, sub, recommendationId, baseCommit, ...rest] = positionals;
  if (sub !== "task" || !recommendationId || !baseCommit || rest.length > 0)
    throw new Error(
      "Expected: pathcompiler harness task <recommendation-id> <base-commit>. Use --help for options.",
    );
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const read = async (name: string, command: string) => {
    const content = await readOptional(path.join(output, "reports", name));
    if (content === undefined)
      throw new Error(
        `No ${path.join(output, "reports", name)}. Run pathcompiler ${command} first.`,
      );
    return JSON.parse(content) as unknown;
  };
  const recommendation = (
    (await read("recommendations.json", "recommend")) as {
      recommendations?: ImprovementRecommendation[];
    }
  ).recommendations?.find((item) => item.id === recommendationId);
  if (!recommendation)
    throw new Error(
      `No recommendation ${recommendationId} in reports/recommendations.json.`,
    );
  const decision = (
    (await read("gate-decisions.json", "gate")) as GateReport
  ).decisions.find(
    (item) => item.opportunityId === recommendation.opportunityId,
  );
  if (!decision)
    throw new Error(
      `No gate decision for ${recommendation.opportunityId}. Rerun pathcompiler gate.`,
    );
  let task: ReturnType<typeof createHarnessTask>;
  try {
    task = createHarnessTask({
      recommendation,
      gate: decision,
      projectId: path.basename(path.dirname(output)),
      baseCommit,
    });
  } catch (error) {
    if (error instanceof HarnessContractError || error instanceof z.ZodError)
      throw new Error(`Cannot create a harness task: ${error.message}`, {
        cause: error,
      });
    throw error;
  }
  const file = `harness/tasks/${encodeURIComponent(task.id)}.json`;
  await writeArtifacts(output, [[file, `${JSON.stringify(task, null, 2)}\n`]]);
  if (values.json) return `${JSON.stringify(task, null, 2)}\n`;
  return `${[
    `Harness task ${task.id} (schema ${task.schemaVersion}) for ${recommendation.id}:`,
    `  ${task.objective.summary}`,
    `  Intended: ${task.objective.desiredSemanticChange.map((item) => `${item.kind}${item.goal ? ` ${item.goal}` : ""}${item.context ? ` [${item.context}]` : ""}`).join("; ")}`,
    `Task: ${path.join(output, file)}`,
    "The harness's result is evaluated independently (pathcompiler evaluate); its claims are never trusted.",
  ].join("\n")}\n`;
}

async function runHarnessImport(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const [, , resultFile, directory, ...rest] = positionals;
  if (!resultFile || rest.length > 0)
    throw new Error(
      "Expected: pathcompiler harness import <mutation-result.json> [directory]. Use --help for options.",
    );
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const raw = await readJsonFile(cwd, resultFile, "mutation result");
  // Results must not carry secrets (handoff §61); they are stored with the repository.
  const secrets = redactValue(raw).redactions;
  if (Object.keys(secrets).length > 0)
    throw new Error(
      `${resultFile} appears to contain secrets (${Object.keys(secrets).join(", ")}). Remove them and have the harness rerun; nothing was stored.`,
    );
  const taskId = z
    .looseObject({ harnessTaskId: z.string() })
    .parse(raw).harnessTaskId;
  const tasks = await readJsonRecords(
    path.join(output, "harness", "tasks"),
    (value) => parseHarnessTask(value),
  );
  const task: HarnessTaskSpec | undefined = tasks.find(
    (item) => item.record.id === taskId,
  )?.record;
  if (!task)
    throw new Error(
      `No exported task ${taskId} under ${path.join(output, "harness", "tasks")}. Import results only for tasks created with pathcompiler harness task.`,
    );
  let result: ReturnType<typeof parseMutationResult>;
  try {
    result = parseMutationResult(raw, task);
  } catch (error) {
    throw new Error(
      `Invalid MutationResult ${resultFile}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  await writeArtifacts(output, [
    [
      `harness/results/${encodeURIComponent(result.id)}.json`,
      `${JSON.stringify(result, null, 2)}\n`,
    ],
  ]);
  const candidate = result.repository.candidateCommit;
  if (!candidate)
    return `${[
      `Mutation ${result.id} is ${result.status}; there is no candidate to evaluate.`,
      `  ${result.implementationSummary}`,
      ...result.unresolvedQuestions.map((item) => `  ? ${item}`),
      "A blocked harness is a valid outcome: review the questions before changing the recommendation.",
    ].join("\n")}\n`;
  const tests =
    values.tests === undefined
      ? undefined
      : await readJsonFile(cwd, values.tests, "test results");
  const browser =
    values.browser === undefined
      ? undefined
      : await readJsonFile(cwd, values.browser, "browser verification reports");
  const range = await analyzeCommitRangeDetailed({
    directory: path.resolve(cwd, directory ?? "."),
    base: task.repository.baseCommit,
    head: candidate,
    exclude: values.exclude ?? [],
  });
  const solver = await createZ3SolverProvider();
  let evaluation: CandidateEvaluation;
  try {
    evaluation = await evaluateCandidate(range, solver, {
      criteria: evaluationCriteria(task, result),
      approved: await readApproved(output),
      ...(tests === undefined
        ? {}
        : {
            tests:
              tests && typeof tests === "object" && "suites" in tests
                ? testRunFromPlaywrightJson(tests)
                : tests,
          }),
      ...(browser === undefined
        ? {}
        : { browser: Array.isArray(browser) ? browser : [browser] }),
    });
  } finally {
    await solver.close();
  }
  return reportEvaluation(evaluation, output, values);
}

/**
 * Repository analysis through the content-hash cache (C4) under
 * `<out>/cache/analysis`; a cached result is identical to a fresh one.
 */
async function analyzeProject(
  project: SourceProject,
  output: string,
  noCache = false,
): Promise<ReturnType<typeof analyzeNextProject>> {
  if (noCache) return analyzeNextProject(project);
  return analyzeNextProjectCached(
    project,
    createFileCache(path.join(output, "cache", "analysis")),
  );
}

/** Rules of a specification with their provenance, in a stable order. */
function behaviorRules(spec: BehaviorSpec) {
  const text = (expr: Parameters<typeof formatExpression>[0] | undefined) =>
    expr ? formatExpression(expr) : "";
  return [
    ...spec.invariants.map((item) => ({
      kind: "invariant",
      id: item.id,
      text: text(item.expression),
      provenance: item.provenance,
    })),
    ...spec.businessRules.map((item) => ({
      kind: "business rule",
      id: item.id,
      text: `${text(item.when)} => ${text(item.must)}`,
      provenance: item.provenance,
    })),
    ...spec.permissions.map((item) => ({
      kind: "permission",
      id: item.id,
      text: `${item.role} ${item.effect === "deny" ? "may never" : "may"} ${item.action}${item.constraint ? ` when ${text(item.constraint)}` : ""}`,
      provenance: item.provenance,
    })),
    ...spec.dataPolicies.map((item) => ({
      kind: "data policy",
      id: item.id,
      text: text(item.rule),
      provenance: item.provenance,
    })),
    ...spec.temporalRules.map((item) => ({
      kind: "temporal rule",
      id: item.id,
      text: `${item.before} ${item.kind === "must_precede" ? "MUST_PRECEDE" : "NEVER_AFTER"} ${item.after}`,
      provenance: item.provenance,
    })),
    ...spec.operations.map((item) => ({
      kind: "operation",
      id: item.id,
      text: `${item.parameters.join(", ")}: ${item.preconditions.map(text).join(" && ") || "true"}`,
      provenance: item.provenance,
    })),
  ];
}

/** Keeps the counterexample of every new violation a PR guard report names. */
async function storeFindings(
  report: Awaited<ReturnType<typeof verifyPullRequest>>,
  directory: string,
): Promise<number> {
  let created = 0;
  for (const finding of report.findings) {
    if (
      !finding.counterexample ||
      !finding.rule ||
      (finding.kind !== "regression" && finding.kind !== "new_violation")
    )
      continue;
    const result = await recordCounterexample(
      directory,
      createRecord({
        rule: finding.rule,
        counterexample: finding.counterexample,
        trigger: "pr_guard",
        commit: report.head.commit,
        specHash: report.head.specHash,
        now: new Date().toISOString(),
        violation: finding.message,
      }),
    );
    if (result.created) created += 1;
  }
  return created;
}

async function runCounterexamples(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const [, sub, argument, ...rest] = positionals;
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const directory = path.join(output, "counterexamples");
  const usage = new Error(
    "Expected: pathcompiler counterexamples list, record <report.json>, eval <id> --spec <behavior-spec.json>, or run <eval.json> --spec <behavior-spec.json>. Use --help for options.",
  );
  if (rest.length > 0) throw usage;
  if (sub === "list" && !argument) {
    const records = await listCounterexamples(directory);
    if (values.json) return `${JSON.stringify(records, null, 2)}\n`;
    return records.length === 0
      ? `No counterexamples in ${directory}.\n`
      : `${records
          .map(
            (item) =>
              `${item.id} ${item.status} ${item.operation} violates ${item.rule.id}${item.commit ? ` at ${item.commit.slice(0, 12)}` : ""}`,
          )
          .join("\n")}\n`;
  }
  if (sub === "record" && argument) {
    const report = (await readJsonFile(cwd, argument, "report")) as {
      findings?: {
        counterexample?: Counterexample;
        rule?: RuleBasis;
        kind?: string;
        message?: string;
      }[];
      results?: {
        counterexample?: Counterexample;
        rule?: RuleBasis;
        status?: string;
      }[];
      head?: { commit: string | null; specHash: string };
      specHash?: string;
    };
    const items = [
      ...(report.findings ?? [])
        .filter(
          (item) => item.kind === "regression" || item.kind === "new_violation",
        )
        .map((item) => ({ ...item, violation: item.message })),
      ...(report.results ?? []).filter((item) => item.status === "VIOLATED"),
    ].filter((item) => item.counterexample && item.rule);
    if (!report.findings && !report.results)
      throw new Error(
        `${argument} is neither a verify-pr report nor a behavior verify report.`,
      );
    let created = 0;
    for (const item of items) {
      const result = await recordCounterexample(
        directory,
        createRecord({
          rule: item.rule as RuleBasis,
          counterexample: item.counterexample as Counterexample,
          trigger: report.findings ? "pr_guard" : "verification",
          commit: report.head?.commit ?? null,
          specHash: report.head?.specHash ?? report.specHash ?? null,
          now: new Date().toISOString(),
          ...("violation" in item && typeof item.violation === "string"
            ? { violation: item.violation }
            : {}),
        }),
      );
      if (result.created) created += 1;
    }
    return `Recorded ${created} new counterexample(s) (${items.length - created} already known) in ${directory}.\n`;
  }
  if (sub === "eval" && argument) {
    if (!values.spec)
      throw new Error(
        "counterexamples eval needs --spec <behavior-spec.json>, the specification the rule is approved in.",
      );
    const record = await readCounterexample(directory, argument);
    const evaluation = generateEval(
      record,
      await readBehaviorSpec(cwd, values.spec),
    );
    const file = `counterexamples/evals/${evaluation.id}.json`;
    await writeArtifacts(output, [
      [file, `${JSON.stringify(evaluation, null, 2)}\n`],
    ]);
    if (values.json) return `${JSON.stringify(evaluation, null, 2)}\n`;
    return `${[
      `${evaluation.id}: ${evaluation.description}`,
      ...evaluation.cases.map(
        (item) => `  ${item.id} must be ${item.expect} (${item.change})`,
      ),
      `Eval: ${path.join(output, file)}`,
    ].join("\n")}\n`;
  }
  if (sub === "run" && argument) {
    if (!values.spec)
      throw new Error(
        "counterexamples run needs --spec <behavior-spec.json>, the candidate's specification.",
      );
    const evaluation = (await readJsonFile(
      cwd,
      argument,
      "regression eval",
    )) as RegressionEval;
    if (!Array.isArray(evaluation.cases) || !evaluation.property)
      throw new Error(`${argument} is not a regression eval.`);
    const spec = await readBehaviorSpec(cwd, values.spec);
    const solver = await createZ3SolverProvider();
    try {
      const run = await runRegressionEval(evaluation, contractExecutor(spec), {
        strictNeighbors: values["strict-neighbors"] === true,
      });
      const verified = await runSpecEval(
        evaluation,
        spec,
        createVerificationRouter([createSmtVerifier(solver)]),
      );
      const passed = run.passed && verified.status === "VERIFIED";
      const text = `${[
        `${evaluation.id} (${evaluation.description}): ${passed ? "PASS" : "FAIL"}`,
        `  extracted contract: ${run.cases.filter((item) => item.passed).length}/${run.cases.length} cases as expected${run.failed.length > 0 ? `; accepted something it must reject or rejected something required: ${run.failed.join(", ")}` : ""}`,
        ...(run.overRestrictive.length > 0
          ? [
              `  over-restrictive (the specification allows these): ${run.overRestrictive.join(", ")}`,
            ]
          : []),
        `  verifier: ${verified.status}${verified.reason ? ` (${verified.reason})` : ""}`,
        ...(verified.counterexample
          ? [
              `  counterexample: ${JSON.stringify({ ...verified.counterexample.inputs, ...verified.counterexample.context })}`,
            ]
          : []),
      ].join("\n")}\n`;
      if (!passed) throw new Error(text);
      return values.json
        ? `${JSON.stringify({ run, verified }, null, 2)}\n`
        : text;
    } finally {
      await solver.close();
    }
  }
  throw usage;
}

async function runRepair(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const [, sub, argument, ...rest] = positionals;
  if (sub !== "propose" || rest.length > 0)
    throw new Error(
      "Expected: pathcompiler repair propose [directory] --fixture <proposals.json>. Use --help for options.",
    );
  if (!values.fixture)
    throw new Error(
      "repair propose needs a provider: pass --fixture <proposals.json>. No model adapter is wired into the CLI yet.",
    );
  const attempts =
    values["max-attempts"] === undefined ? 3 : Number(values["max-attempts"]);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10)
    throw new Error("--max-attempts must be an integer from 1 to 10.");
  const directory = path.resolve(cwd, argument ?? ".");
  const fixtureFile = path.resolve(cwd, values.fixture);
  const fixture = (await readJsonFile(
    cwd,
    values.fixture,
    "repair proposals",
  )) as {
    proposals?: {
      edits?: { path?: string; content?: string; contentFile?: string }[];
      rationale?: string;
    }[];
  };
  if (!Array.isArray(fixture.proposals))
    throw new Error(
      `${values.fixture} must be a JSON object with a "proposals" array.`,
    );
  // A proposal may point at a file for its content, relative to the fixture.
  const proposals = [];
  for (const proposal of fixture.proposals)
    proposals.push({
      rationale: proposal.rationale,
      edits: await Promise.all(
        (proposal.edits ?? []).map(async (item) => ({
          path: item.path,
          content: item.contentFile
            ? await readFile(
                path.resolve(path.dirname(fixtureFile), item.contentFile),
                "utf8",
              )
            : item.content,
        })),
      ),
    });
  const files = await readSourceFiles(directory, values.exclude ?? []);
  const solver = await createZ3SolverProvider();
  try {
    const report = await runRepairLoop({
      files,
      options: { bindings: parseBindings(values.bind) },
      provider: fixtureRepairProvider(
        proposals,
        `fixture ${path.basename(values.fixture)}`,
      ),
      solver,
      maxIterations: attempts,
      now: new Date().toISOString(),
    });
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const artifacts: [string, string][] = [
      ["reports/repair.json", `${JSON.stringify(report, null, 2)}\n`],
    ];
    if (report.patch && report.target)
      artifacts.push([
        `repair/${report.target.counterexample}.patch`,
        report.patch.map((item) => item.diff).join(""),
      ]);
    await writeArtifacts(output, artifacts);
    const text = `${[
      report.status === "already_verified"
        ? "Nothing to repair: no rule is violated."
        : `${report.status === "repaired" ? "Repair found" : "No repair found"} for ${report.target ? `${report.target.rule.id} (${report.target.counterexample})` : "the violation"} after ${report.attempts.length} attempt(s).`,
      ...report.attempts.map(
        (attempt) =>
          `  attempt ${attempt.iteration}: ${attempt.outcome}${
            attempt.outcome === "rejected"
              ? ` (${attempt.checks
                  .filter((item) => !item.passed)
                  .map((item) => `${item.name}: ${item.detail}`)
                  .join("; ")})`
              : ""
          }`,
      ),
      ...(report.reason ? [report.reason] : []),
      ...(report.otherViolations > 0
        ? [
            `${report.otherViolations} other violation(s) remain; run the loop again for each.`,
          ]
        : []),
      ...(report.patch
        ? [
            `Patch (not applied): ${path.join(output, `repair/${report.target?.counterexample}.patch`)}. Review it, run your tests, then apply it with git apply.`,
          ]
        : []),
      report.approval.note,
      `Report: ${path.join(output, "reports/repair.json")}`,
    ].join("\n")}\n`;
    if (report.status === "not_repaired") throw new Error(text);
    return values.json ? `${JSON.stringify(report, null, 2)}\n` : text;
  } finally {
    await solver.close();
  }
}

async function runAgent(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const [, sub, argument, ...rest] = positionals;
  if ((sub !== "check" && sub !== "eval") || !argument || rest.length > 0)
    throw new Error(
      "Expected: pathcompiler agent check <behavior-spec.json> --request <action.json>, or agent eval <behavior-spec.json> --cases <labeled-actions.json>. Use --help for options.",
    );
  const enforce = values.enforce ?? "all";
  const onUnknown = values["on-unknown"] ?? "block";
  if (enforce !== "all" && enforce !== "approved_only")
    throw new Error("--enforce must be all or approved_only.");
  if (onUnknown !== "block" && onUnknown !== "allow")
    throw new Error("--on-unknown must be block or allow.");
  const options: GateOptions = { enforce, onUnknown };
  const gate = createActionGate(await readBehaviorSpec(cwd, argument), options);
  if (sub === "check") {
    if (!values.request)
      throw new Error("agent check needs --request <action.json>.");
    const request = (await readJsonFile(
      cwd,
      values.request,
      "action request",
    )) as ActionRequest;
    if (!request || typeof request.operation !== "string")
      throw new Error(
        `${values.request} must be a JSON object with an "operation" and optional "inputs", "context" and "state".`,
      );
    const decision = gate.check(request);
    const text = values.json
      ? `${JSON.stringify(decision, null, 2)}\n`
      : formatDecision(decision);
    if (decision.decision === "BLOCK") throw new Error(text);
    return text;
  }
  if (!values.cases)
    throw new Error("agent eval needs --cases <labeled-actions.json>.");
  const file = (await readJsonFile(cwd, values.cases, "labeled actions")) as {
    cases?: LabeledAction[];
  };
  if (!Array.isArray(file.cases))
    throw new Error(
      `${values.cases} must be a JSON object with a "cases" array.`,
    );
  const result = evaluateGate(gate, file.cases);
  if (values.json) return `${JSON.stringify(result, null, 2)}\n`;
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  return `${[
    `Gate on ${result.safe + result.unsafe} labeled actions (${result.unsafe} unsafe, ${result.safe} safe):`,
    `  unsafe block rate ${percent(result.unsafeBlockRate)}; safe allow rate ${percent(result.safeAllowRate)}; false block rate ${percent(result.falseBlockRate)}; mean ${result.meanLatencyMs.toFixed(2)} ms per check`,
    `  blocked with the expected rule named: ${result.rightReason}`,
    ...result.missedUnsafe.map((id) => `  missed unsafe action: ${id}`),
    ...result.falseBlocks.map(
      (item) => `  blocked a safe action: ${item.id}: ${item.summary}`,
    ),
    ...result.wrongReason.map(
      (item) =>
        `  blocked ${item.id} for another reason (expected ${item.expected}; named ${item.got.join(", ")})`,
    ),
    "The gate only knows the rules in the specification: an unsafe action no rule describes is not blocked.",
  ].join("\n")}\n`;
}

function formatDecision(decision: ActionDecision): string {
  const lines = [decision.summary];
  for (const item of decision.violations) {
    lines.push(
      `  ${item.enforced ? "violated" : "not enforced"} ${item.kind}${item.id ? ` ${item.id}` : ""}: ${item.explanation}`,
    );
    if (item.basis)
      lines.push(
        `    rule trust: ${item.basis.humanBacked ? "human-approved" : "extracted"}, ${item.basis.confidence} confidence (${item.basis.sources.join("; ")})`,
      );
  }
  for (const item of decision.unresolved)
    lines.push(
      `  cannot check ${item.rule}: missing ${item.missing.join(", ") || "a value"}`,
    );
  for (const item of decision.warnings) lines.push(`  note: ${item}`);
  return `${lines.join("\n")}\n`;
}

function parseBindings(entries: readonly string[] | undefined) {
  const bindings: Record<string, string> = {};
  for (const entry of entries ?? []) {
    const [name, target, ...extra] = entry.split("=");
    if (!name || !target || extra.length > 0)
      throw new Error(
        `--bind expects <name>=<entity>, for example --bind payment=payments; got "${entry}".`,
      );
    bindings[name] = target;
  }
  return bindings;
}

async function runVerifyPr(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  if (positionals.length > 2 || !values.base || !values.candidate)
    throw new Error(
      "Expected: pathcompiler verify-pr --base <ref> --candidate <ref> [directory]. Use --help for options.",
    );
  const directory = path.resolve(cwd, positionals[1] ?? ".");
  const git = await openGitRepository(directory);
  const scratch = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-pr-"));
  const solver = await createZ3SolverProvider();
  try {
    const exclude = values.exclude ?? [];
    const sides: {
      commit: string;
      files: Awaited<ReturnType<typeof readSourceFiles>>;
    }[] = [];
    for (const [index, ref] of [values.base, values.candidate].entries()) {
      const target = path.join(scratch, String(index));
      await mkdir(target);
      const commit = await git.exportCommit(ref, target);
      sides.push({ commit, files: await readSourceFiles(target, exclude) });
    }
    const [base, head] = sides as [
      (typeof sides)[number],
      (typeof sides)[number],
    ];
    const report = await verifyPullRequest({
      base: base.files,
      head: head.files,
      baseRef: values.base,
      headRef: values.candidate,
      baseCommit: base.commit,
      headCommit: head.commit,
      options: { bindings: parseBindings(values.bind) },
      solver,
      strict: values.strict === true,
    });
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const markdown = formatPrGuardMarkdown(report);
    await writeArtifacts(output, [
      ["reports/pr-guard.json", `${JSON.stringify(report, null, 2)}\n`],
      ["reports/pr-guard.md", markdown],
    ]);
    const stored = await storeFindings(
      report,
      path.join(output, "counterexamples"),
    );
    const text = `${markdown}${stored > 0 ? `Stored ${stored} new counterexample(s) in ${path.join(output, "counterexamples")} (counterexamples eval <id> makes a regression eval).\n` : ""}Report: ${path.join(output, "reports/pr-guard.json")}\n`;
    if (report.verdict === "fail")
      throw new Error(`The change newly violates the specification.\n${text}`);
    return values.json ? `${JSON.stringify(report, null, 2)}\n` : text;
  } finally {
    await solver.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

function formatExtraction(result: ExtractionResult, output: string): string {
  const bySource = new Map<string, number>();
  for (const entry of result.ledger)
    bySource.set(
      entry.provenance.sourceType,
      (bySource.get(entry.provenance.sourceType) ?? 0) + 1,
    );
  const spec = result.spec;
  return `${[
    `Extracted BehaviorIR ${spec.id} (${result.specHash.slice(0, 19)}) without a model:`,
    `  ${spec.variables.length} variables, ${spec.operations.length} operations, ${spec.invariants.length} invariants, ${spec.businessRules.length} business rules, ${spec.permissions.length} permissions, ${(spec.dataConstraints ?? []).length} data constraints`,
    `  facts by source: ${[...bySource].map(([name, count]) => `${name} ${count}`).join(", ") || "none"}`,
    `  files read: ${
      Object.entries(result.inputs)
        .filter(([, list]) => list.length > 0)
        .map(([name, list]) => `${name} ${list.length}`)
        .join(", ") || "none"
    }`,
    result.unsupported.length > 0
      ? `  ${result.unsupported.length} constructs not modeled (listed, not guessed):\n${result.unsupported
          .slice(0, 10)
          .map(
            (item) =>
              `    ${item.file}${item.lines ? `:${item.lines}` : ""} ${item.construct}: ${item.reason}`,
          )
          .join(
            "\n",
          )}${result.unsupported.length > 10 ? `\n    … ${result.unsupported.length - 10} more in reports/behavior-extraction.json` : ""}`
      : "",
    ...result.conflicts.map((item) => `  conflict: ${item}`),
    "Extracted rules are candidates with provenance, not business ground truth; review them (behavior show) before relying on them.",
    `Specification: ${path.join(output, "reports/behavior-spec.json")}`,
  ]
    .filter(Boolean)
    .join("\n")}\n`;
}

async function readBehaviorSpec(
  cwd: string,
  argument: string,
): Promise<BehaviorSpec> {
  try {
    return parseBehaviorSpec(
      await readJsonFile(cwd, argument, "behavior specification"),
    );
  } catch (error) {
    const issues =
      error instanceof z.ZodError
        ? error.issues
            .slice(0, 10)
            .map(
              (item) => `  ${item.path.join(".") || "(root)"}: ${item.message}`,
            )
            .join("\n")
        : String(error);
    throw new Error(
      `${argument} is not a valid BehaviorIR specification:\n${issues}`,
      { cause: error },
    );
  }
}

function formatVerification(
  report: VerificationReport,
  spec: BehaviorSpec,
  file: string,
): string {
  const lines = [
    `Verified ${report.results.length} properties of ${spec.id} (${report.specHash.slice(0, 19)}): ${report.summary.VERIFIED} verified, ${report.summary.VIOLATED} violated, ${report.summary.UNKNOWN} unknown, ${report.summary.UNSUPPORTED} unsupported.`,
  ];
  const show = (
    value: Record<string, unknown>,
    relevant: (id: string) => boolean,
  ) =>
    Object.entries(value)
      .filter(([id]) => relevant(id))
      .map(([id, item]) => `${id}=${JSON.stringify(item)}`)
      .join(", ");
  for (const result of report.results) {
    // A routine proof is a count; one with a real caveat is worth reading.
    const notable = result.caveats.filter((item) =>
      /Vacuous|did not model/.test(item),
    );
    if (result.status === "VERIFIED" && notable.length === 0) continue;
    const { property } = result;
    const name =
      property.kind === "invariant_preserved"
        ? `${property.operation} preserves ${property.invariant}`
        : property.kind === "rule_enforced"
          ? `${property.operation} enforces ${property.rule}`
          : property.kind === "permission_enforced"
            ? `${property.operation} respects ${property.permission}`
            : `${property.operation} guarantees its postconditions`;
    lines.push(`${result.status} ${name}`);
    if (result.rule)
      lines.push(
        `  rule: ${result.rule.text} (${result.rule.humanBacked ? "human-approved" : "extracted candidate"}, ${result.rule.confidence} confidence; ${result.rule.sources.join("; ")})`,
      );
    if (result.reason) lines.push(`  ${result.reason}`);
    const cex = result.counterexample;
    if (cex) {
      const operation = spec.operations.find(
        (item) => item.id === cex.operation,
      );
      const mentioned = new Set<string>();
      const text = [
        cex.violated,
        ...(operation?.preconditions.map((item) => formatExpression(item)) ??
          []),
        ...(operation?.effects.map(
          (item) => `${item.variable} ${formatExpression(item.value)}`,
        ) ?? []),
      ].join(" ");
      for (const variable of spec.variables)
        if (text.includes(variable.id)) mentioned.add(variable.id);
      const relevant = (id: string) => mentioned.has(id);
      lines.push(
        `  counterexample (re-evaluated ${cex.replayed ? "and confirmed" : "but NOT confirmed"}):`,
        `    inputs: ${show(cex.inputs, relevant) || "-"}`,
        `    context: ${show(cex.context, relevant) || "-"}`,
        `    state before: ${show(cex.state, relevant) || "-"}`,
      );
      if (cex.after)
        lines.push(`    state after: ${show(cex.after, relevant) || "-"}`);
    }
    for (const caveat of result.status === "VERIFIED"
      ? notable
      : result.caveats)
      lines.push(`  caveat: ${caveat}`);
  }
  lines.push(
    "VERIFIED means the encoded rule holds for one execution of the operation within the supported fragment, given the specification; it does not mean the specification is the business's rule or that the code outside the model is correct.",
    `Report: ${file}`,
  );
  return `${lines.join("\n")}\n`;
}

async function runBehavior(
  positionals: string[],
  values: Values,
  cwd: string,
): Promise<string> {
  const [, sub, argument, ...rest] = positionals;
  if (sub === "export" && rest.length === 0) {
    const { model } = await loadReasoningModel(argument, values, cwd);
    const spec = fromFormalModel(model);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const file = "reports/behavior-spec.json";
    await writeArtifacts(output, [[file, serializeBehaviorSpec(spec)]]);
    if (values.json) return serializeBehaviorSpec(spec);
    return `Exported ${spec.transitions.length} transitions, ${spec.workflows.length} workflows, ${spec.invariants.length} invariants and ${spec.variables.length} variables as BehaviorIR.\nEvery rule carries provenance; extracted rules are inferred candidates, not business ground truth.\nSpecification: ${path.join(output, file)}\n`;
  }
  if (sub === "verify" && argument && rest.length === 0) {
    const spec = await readBehaviorSpec(cwd, argument);
    const solver = await createZ3SolverProvider();
    let report: VerificationReport;
    try {
      report = await verifySpec(
        createVerificationRouter([createSmtVerifier(solver)]),
        spec,
        values.operation ? { operations: values.operation } : {},
      );
    } finally {
      await solver.close();
    }
    const unknownOperation = (values.operation ?? []).filter(
      (id) => !spec.operations.some((item) => item.id === id),
    );
    if (unknownOperation.length > 0)
      throw new Error(
        `No operation ${unknownOperation.join(", ")} in ${argument}. Operations: ${spec.operations.map((item) => item.id).join(", ") || "none"}.`,
      );
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const file = "reports/behavior-verification.json";
    await writeArtifacts(output, [
      [file, `${JSON.stringify(report, null, 2)}\n`],
    ]);
    const text = formatVerification(report, spec, path.join(output, file));
    if (report.summary.VIOLATED > 0)
      throw new Error(`Rule violations found.\n${text}`);
    return values.json ? `${JSON.stringify(report, null, 2)}\n` : text;
  }
  if (sub === "extract" && rest.length === 0) {
    const directory = path.resolve(cwd, argument ?? ".");
    const bindings = parseBindings(values.bind);
    const files = await readSourceFiles(directory, values.exclude ?? []);
    const result = extractBehavior(files, {
      bindings,
      id:
        path
          .basename(directory)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_") || "extracted",
      repositoryCommit: values.commit ?? null,
    });
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const report = {
      schemaVersion: 1,
      specHash: result.specHash,
      inputs: result.inputs,
      ledger: result.ledger,
      unsupported: result.unsupported,
      conflicts: result.conflicts,
    };
    await writeArtifacts(output, [
      ["reports/behavior-spec.json", serializeBehaviorSpec(result.spec)],
      [
        "reports/behavior-extraction.json",
        `${JSON.stringify(report, null, 2)}\n`,
      ],
    ]);
    if (values.json) return serializeBehaviorSpec(result.spec);
    return formatExtraction(result, output);
  }
  if ((sub === "validate" || sub === "show") && argument && rest.length === 0) {
    let spec: BehaviorSpec;
    try {
      spec = parseBehaviorSpec(
        await readJsonFile(cwd, argument, "behavior specification"),
      );
    } catch (error) {
      const issues =
        error instanceof z.ZodError
          ? error.issues
              .slice(0, 10)
              .map(
                (item) =>
                  `  ${item.path.join(".") || "(root)"}: ${item.message}`,
              )
              .join("\n")
          : String(error);
      throw new Error(
        `${argument} is not a valid BehaviorIR specification:\n${issues}`,
        { cause: error },
      );
    }
    const counts = {
      variables: spec.variables.length,
      workflows: spec.workflows.length,
      transitions: spec.transitions.length,
      operations: spec.operations.length,
      invariants: spec.invariants.length,
      permissions: spec.permissions.length,
      temporalRules: spec.temporalRules.length,
      dataPolicies: spec.dataPolicies.length,
      businessRules: spec.businessRules.length,
    };
    const rules = behaviorRules(spec);
    if (values.json)
      return `${JSON.stringify({ valid: true, id: spec.id, counts, rules }, null, 2)}\n`;
    if (sub === "validate")
      return `${argument} is a valid BehaviorIR specification (${Object.entries(
        counts,
      )
        .filter(([, count]) => count > 0)
        .map(([name, count]) => `${count} ${name}`)
        .join(", ")}).\n`;
    return `${[
      `BehaviorIR ${spec.id} (${spec.metadata.producer} ${spec.metadata.producerVersion}${spec.metadata.repositoryCommit ? `, commit ${spec.metadata.repositoryCommit.slice(0, 12)}` : ""}):`,
      ...rules.map(
        (rule) =>
          `  ${rule.kind} ${rule.id}: ${rule.text}\n    provenance: ${rule.provenance
            .map(
              (record) =>
                `${record.sourceType}/${record.origin}${record.sourceFile ? ` ${record.sourceFile}${record.sourceLines ? `:${record.sourceLines}` : ""}` : ""}`,
            )
            .join(
              "; ",
            )}; confidence ${weakestConfidence(rule.provenance)}${isHumanBacked(rule.provenance) ? "; human-backed" : ""}`,
      ),
      rules.length === 0 ? "  (no rules)" : "",
    ]
      .filter(Boolean)
      .join("\n")}\n`;
  }
  throw new Error(
    "Expected: pathcompiler behavior export|extract [directory], behavior verify|validate|show <file>. Use --help for options.",
  );
}
