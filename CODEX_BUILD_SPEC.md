# PathCompiler — Codex Build Specification

> **Working product name:** PathCompiler  
> **Working repository name:** `pathcompiler`  
> **Tagline:** Compile your codebase into executable product workflows.
>
> This document is the implementation contract for Codex and human contributors.
> Read `PRODUCT_ARCHITECTURE.md` first for the complete product vision and rationale.
> Then use this file as the authoritative build order for the first working version.

---

# 0. Mission

Build a developer platform that continuously converts a living software repository into versioned, evidence-backed, executable product workflows.

The system must:

1. inspect source code;
2. inspect routes, UI actions, APIs, state transitions, permissions, feature flags and tests;
3. inspect relevant Git commits and pull-request context;
4. construct a structured product graph;
5. infer candidate business capabilities and workflows;
6. preserve provenance for every important inference;
7. allow workflows to be reviewed and approved;
8. compile approved workflows into stable runtime artifacts;
9. expose those artifacts through headless APIs/SDKs/MCP;
10. optionally execute in-app guidance through a runtime SDK;
11. after future code changes, incrementally identify affected workflows and propose updates.

The graph is an **offline/build-time intermediate representation**.

The approved workflows are the **first-class runtime artifacts**.

Do not build GraphRAG as the default runtime path.

---

# 1. Product Boundary

PathCompiler owns:

- repository ingestion;
- code/product graph generation;
- workflow discovery;
- workflow provenance;
- workflow versioning;
- workflow validation;
- workflow impact analysis;
- workflow compilation;
- runtime resolution;
- runtime workflow manifests;
- SDK/API/MCP contracts.

The customer owns:

- the final UI;
- the design system;
- how an assistant renders a response;
- whether a workflow appears in chat, a sidebar, command palette or help center;
- application-specific authorization decisions;
- consequential action confirmation.

Optional PathCompiler UI packages may provide defaults, but the product must remain headless-first.

---

# 2. Primary MVP Constraint

Do **not** attempt to support every programming language or framework.

The first supported stack is:

```text
Git provider:       local Git first, GitHub second
Language:           TypeScript / JavaScript
Frontend:           React
Framework:          Next.js App Router
Tests:              Playwright
Package manager:    pnpm
Runtime:            Node.js 22+
```

Support for other stacks is explicitly deferred.

The initial system must prove that the architecture works end-to-end on:

1. a purpose-built fixture app;
2. one real Next.js product repository.

---

# 3. Non-Goals for the First Version

Do not build these before the core loop works:

- billing;
- enterprise SSO;
- multiple Git providers;
- multiple frontend frameworks;
- autonomous destructive execution;
- a graph database;
- multi-region infrastructure;
- polished marketing website;
- advanced analytics dashboard;
- fully autonomous workflow publication;
- mobile SDK;
- no-code workflow builder;
- generic browser computer-use agent;
- embeddings-based graph traversal at runtime.

Prefer a small, correct compiler over a broad, fragile platform.

---

# 4. Repository Structure

Create a TypeScript monorepo using `pnpm` workspaces.

Recommended structure:

```text
pathcompiler/
│
├── AGENTS.md
├── PRODUCT_ARCHITECTURE.md
├── CODEX_BUILD_SPEC.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.workspace.ts
│
├── packages/
│   ├── workflow-ir/
│   ├── graph-core/
│   ├── source-model/
│   ├── adapter-nextjs/
│   ├── git-intelligence/
│   ├── test-miner-playwright/
│   ├── evidence/
│   ├── capability-engine/
│   ├── workflow-discovery/
│   ├── workflow-validator/
│   ├── workflow-compiler/
│   ├── workflow-registry/
│   ├── resolver/
│   ├── runtime-core/
│   ├── sdk-js/
│   ├── react/
│   ├── ui/
│   ├── mcp-server/
│   └── cli/
│
├── apps/
│   └── dashboard/
│
├── fixtures/
│   └── next-demo/
│
├── examples/
│   ├── custom-assistant/
│   ├── headless-help/
│   └── react-guide/
│
├── schemas/
│   └── workflow.schema.json
│
├── docs/
│   ├── decisions/
│   ├── phases/
│   └── protocol/
│
└── .github/
    └── workflows/
```

Do not create all packages with placeholder implementations on day one.

Create packages only when their phase begins.

---

# 5. Technology Decisions

## 5.1 Language

Use TypeScript for the first version.

Reasons:

- target codebases are TypeScript/Next.js;
- TypeScript compiler APIs are available;
- SDK/runtime packages are naturally TypeScript;
- one language reduces early complexity.

Python can be added later for model/analysis workers if justified.

## 5.2 Package manager

Use `pnpm`.

## 5.3 Build

Use TypeScript project references or a lightweight package build setup.

Avoid unnecessary monorepo infrastructure initially.

Do not add Turborepo unless build time or orchestration complexity justifies it.

## 5.4 Tests

Use Vitest for packages.

Use Playwright for browser/runtime verification.

## 5.5 Schemas

Use Zod as the TypeScript source of truth for runtime validation.

Generate JSON Schema where useful.

## 5.6 Graph storage

Phase 1–3:

- in-memory graph;
- deterministic JSON serialization.

Do not introduce Neo4j or another graph database yet.

A graph database may be evaluated only after real traversal requirements justify it.

## 5.7 Persistence

For local MVP:

```text
.pathcompiler/
  cache/
  graph/
  workflows/
  generated/
```

For hosted control plane later:

- PostgreSQL;
- object storage for large snapshots if required.

---

# 6. Core Invariants

These are architectural invariants.

Codex must not violate them without updating an ADR.

## Invariant 1 — Graph is not runtime truth

The graph helps discover and maintain workflows.

Approved workflow artifacts are runtime truth.

## Invariant 2 — Provenance everywhere

Important inferred capabilities and workflow steps must point back to evidence.

## Invariant 3 — Deterministic core first

Use parsers/rules/tests for facts that can be determined statically.

Use LLMs for semantic interpretation, not for facts already available deterministically.

## Invariant 4 — Provider independence

The core system cannot depend directly on one LLM vendor.

All model calls go through an interface.

## Invariant 5 — Headless output

Core packages return structured data.

UI packages are consumers.

## Invariant 6 — Workflow version binding

A workflow version must be traceable to a repository commit/release.

## Invariant 7 — Safe incremental updates

A new commit must not silently rewrite approved workflows.

Breaking semantic changes require review.

## Invariant 8 — Tests before autonomy

Automatic acceptance is allowed only for explicitly safe change classes.

---

# 7. Domain Vocabulary

Use these terms consistently.

## Source Entity

Implementation-level element found in code:

```text
file
function
component
route
API
schema
event
test
permission
feature flag
```

## Product Surface

A user-visible place or interaction:

```text
Clients page
Add Client button
Plan Structure panel
```

## Capability

A meaningful thing the product lets a user do:

```text
create client
invite client
change plan structure
```

## Business Process

A user goal composed of one or more capabilities.

## Workflow

A validated executable representation of a business process.

## Semantic Target

Stable product identifier for a user-facing element/action:

```text
clients.create
client.form.submit
plan.structure.selector
```

## Evidence

A source that supports a claim:

```text
code
test
commit
PR
documentation
runtime verification
```

## Workflow IR

Framework-independent representation of an approved/candidate workflow.

## Runtime Manifest

Browser-safe compiled form of an approved workflow.

---

# 8. Workflow IR v1

Implement the Workflow IR before implementing workflow discovery.

The schema must be versioned.

Required conceptual shape:

```ts
type WorkflowV1 = {
  schemaVersion: 1;

  id: string;
  title: string;
  description?: string;

  domain: string;

  intent: {
    action: string;
    entity: string;
    qualifiers?: string[];
  };

  roles?: string[];

  entrypoints: Array<{
    route?: string;
    state?: string;
  }>;

  preconditions?: WorkflowCondition[];

  steps: WorkflowStep[];

  terminal: WorkflowTerminalCondition;

  provenance: WorkflowProvenance;

  repository: {
    commit: string;
    branch?: string;
  };

  confidence: {
    overall: number;
    dimensions?: Record<string, number>;
  };

  status:
    | "candidate"
    | "approved"
    | "deprecated"
    | "rejected";
};
```

A workflow step:

```ts
type WorkflowStep = {
  id: string;

  target?: string;

  action:
    | { type: "click" }
    | { type: "input"; inputKind?: string }
    | { type: "select" }
    | { type: "navigate"; route: string }
    | { type: "explain" }
    | { type: "wait" };

  instruction?: {
    text?: string;
    key?: string;
  };

  expected?: WorkflowCondition;

  optional?: boolean;

  branches?: Array<{
    when: WorkflowCondition;
    next: string;
  }>;

  next?: string;

  evidence: EvidenceRef[];
};
```

Conditions should support at least:

```text
route matches
semantic target appears
event emitted
URL changed
element state
explicit next
```

Do not over-design the DSL before real examples demand more.

---

# 9. Evidence Model

Implement a common evidence structure.

```ts
type EvidenceRef = {
  id: string;

  type:
    | "source_file"
    | "symbol"
    | "route"
    | "api"
    | "test"
    | "commit"
    | "pull_request"
    | "documentation"
    | "runtime";

  locator: string;

  repositoryCommit: string;

  summary?: string;

  confidence?: number;
};
```

Every generated candidate workflow must include evidence.

A candidate with insufficient evidence must remain low-confidence and require review.

---

# 10. Product Graph Model

Implement a generic graph package.

Minimum node types:

```text
Repository
File
Symbol
Component
Route
UIAction
APIEndpoint
DataEntity
Permission
FeatureFlag
Test
ProductSurface
Capability
WorkflowCandidate
Commit
PullRequest
```

Minimum edge types:

```text
CONTAINS
IMPORTS
CALLS
RENDERS
HANDLES
NAVIGATES_TO
CALLS_API
READS
WRITES
REQUIRES_PERMISSION
GUARDED_BY_FLAG
TESTED_BY
SUPPORTED_BY
CHANGED_BY
IMPLEMENTS
EXPOSES_ACTION
NEXT_STATE
```

Requirements:

- stable IDs;
- deterministic serialization;
- graph diff support;
- query by node type;
- inbound/outbound neighbors;
- transitive traversal with max depth;
- no persistence dependency.

---

# 11. Stable IDs

IDs must be deterministic whenever possible.

Example:

```text
file:src/features/clients/AddClientModal.tsx

symbol:src/features/clients/AddClientModal.tsx#AddClientModal

route:/admin/clients

api:POST:/api/clients

ui:clients.create
```

Avoid random UUIDs for implementation-derived nodes.

Stable IDs are critical for incremental graph diffing.

---

# 12. Phase 0 — Repository Foundation

## Goal

Create a clean monorepo and lock the contracts before analysis code is written.

## Tasks

1. initialize Git repository;
2. initialize pnpm workspace;
3. create root TypeScript config;
4. configure ESLint or Biome;
5. configure Vitest;
6. create `workflow-ir`;
7. create `graph-core`;
8. create fixture Next.js app;
9. add CI for:
   - install;
   - lint;
   - typecheck;
   - tests.

## Fixture app

The fixture must contain at least these flows:

```text
Create Client
Edit Client
Deactivate Client
Create Plan
Change Plan Structure
```

Include:

- multiple routes;
- modal flow;
- form validation;
- API routes;
- role permission;
- feature flag;
- Playwright tests;
- one intentionally branching workflow.

## Acceptance criteria

```text
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

all succeed.

Workflow schema unit tests cover:

- valid workflow;
- invalid version;
- missing terminal;
- duplicate step IDs;
- broken next reference;
- invalid confidence.

Graph tests cover:

- deterministic IDs;
- serialization round trip;
- traversal;
- graph diff.

Do not start Phase 1 before this passes.

---

# 13. Phase 1 — Static Next.js Analyzer

## Goal

Turn a Next.js repository into a deterministic source graph.

Create:

```text
packages/source-model
packages/adapter-nextjs
packages/cli
```

## CLI command

```bash
pathcompiler scan ./fixtures/next-demo
```

Output:

```text
.pathcompiler/graph/source-graph.json
.pathcompiler/reports/scan-summary.json
```

## Extract at minimum

### Files and symbols

- files;
- exported functions;
- React components;
- hooks.

### Routes

App Router route detection:

```text
app/**/page.*
app/**/route.*
```

Normalize dynamic segments.

### Imports

Local package imports.

### React component relationships

Where reliably inferable:

```text
component RENDERS component
```

### UI actions

Detect interactive JSX:

```text
button
link
form submit
onClick
onSubmit
router.push
Link href
```

### API relationships

Infer straightforward calls:

```text
fetch
axios if adapter exists
server action where identifiable
```

### Permissions and flags

Initial heuristic support:

```text
if (role === ...)
can(...)
featureFlags.*
```

Do not pretend heuristic extraction is certain.

Mark uncertainty.

## Acceptance criteria

Running scan on the fixture produces stable output across repeated runs.

Changing only formatting must not materially change the graph.

Unit tests verify:

- route discovery;
- component extraction;
- button/event extraction;
- navigation detection;
- API edge detection.

---

# 14. Phase 2 — Semantic Targets

## Goal

Create a stable contract between repository analysis and browser guidance.

Implement support for:

```tsx
data-pathcompiler="clients.create"
```

and later:

```tsx
<WorkflowTarget id="clients.create">
```

For MVP, the attribute is enough.

Analyzer behavior:

- explicitly annotated targets receive highest confidence;
- existing `data-testid` and accessible role/name can be captured as fallback evidence;
- brittle CSS selectors are not first-class semantic targets.

## CLI

```bash
pathcompiler targets suggest
```

Output candidate target mappings.

Example:

```text
Suggested target:
clients.create

File:
src/features/clients/AddClientButton.tsx

Confidence:
0.92
```

Do not automatically modify customer code in the first version.

Later add:

```bash
pathcompiler targets apply
```

behind explicit approval.

## Acceptance criteria

Every fixture workflow used in browser guidance has stable semantic targets.

---

# 15. Phase 3 — Playwright Test Mining

## Goal

Use E2E tests as high-confidence behavioral evidence.

Create:

```text
packages/test-miner-playwright
```

Parse straightforward Playwright sequences:

```ts
page.goto(...)
getByRole(...).click()
getByLabel(...).fill()
expect(page).toHaveURL(...)
```

Produce structured test traces:

```ts
type TestTrace = {
  testName: string;
  sourceFile: string;
  actions: TestAction[];
  assertions: TestAssertion[];
};
```

Map test actions onto source/product graph targets where possible.

## Important rule

A Playwright test is evidence, not automatically a user workflow.

Tests may:

- include setup;
- use shortcuts;
- manipulate APIs directly;
- test invalid behavior.

## Acceptance criteria

Fixture E2E tests generate traces with:

- start route;
- action sequence;
- target hints;
- terminal assertion.

At least the `clients.create` workflow should be reconstructable primarily from test evidence.

---

# 16. Phase 4 — Git Intelligence

## Goal

Add development history as semantic evidence.

Create:

```text
packages/git-intelligence
```

First support local Git.

Functions:

```ts
getCurrentCommit()
getDefaultBranch()
getDiff(base, head)
getCommitsForPath(path, options)
getBlame(path)
getCommitMessage(sha)
```

Avoid loading the entire Git history.

Use current-code-first traversal:

```text
current node
 ↓
relevant files/symbols
 ↓
path history / blame
 ↓
relevant commits
```

## Commit evidence

Extract:

```text
SHA
message
author date
changed paths
diff hunks
```

The commit message is semantic evidence, not truth.

## Acceptance criteria

Given a fixture commit that changes `AddClientModal`, the system links that commit to the relevant graph nodes.

---

# 17. Phase 5 — GitHub PR Adapter

## Goal

Enrich Git evidence with PR context.

Do not build a full GitHub App yet.

Create a provider interface:

```ts
interface GitProvider {
  getPullRequest(id: string): Promise<PullRequestRecord>;
  findPullRequestForCommit(sha: string): Promise<PullRequestRecord | null>;
}
```

Implement GitHub through token-authenticated API access.

Capture:

```text
PR title
body
changed files
linked commits
merge commit
```

Comments are optional for first version.

Store PR evidence separately from source truth.

## Acceptance criteria

A test fixture/mock PR is associated with changed graph nodes.

---

# 18. Phase 6 — Product Surface Graph

## Goal

Promote technical nodes into user-visible product surfaces.

Create:

```text
packages/evidence
packages/capability-engine
```

A product surface may represent:

```text
page
panel
modal
form
user action
```

Use deterministic rules first.

Example:

```text
Route /admin/clients
+
ClientsPage component
+
Add Client button
+
AddClientModal
```

becomes candidate surface:

```text
Clients
 └── Create Client
```

LLM assistance may be added only behind a provider interface.

## Model interface

```ts
interface SemanticModel {
  classifyCapabilities(input: CapabilityClassificationInput):
    Promise<CapabilityClassificationResult>;

  summarizeEvidence(input: EvidenceSummaryInput):
    Promise<EvidenceSummaryResult>;
}
```

Never call an OpenAI SDK directly from core packages.

---

# 19. Phase 7 — Capability Discovery

## Goal

Generate evidence-backed candidate capabilities.

Example:

```yaml
id: clients.create
domain: clients
verb: create
entity: client
roles:
  - nutritionist

evidence:
  - AddClientButton
  - AddClientModal
  - POST /api/clients
  - create-client.spec.ts

confidence: 0.96
```

Rules:

- capability IDs must be stable;
- duplicate inferred capabilities must merge;
- evidence must remain attached;
- confidence must not be presented as objective probability;
- low-confidence capabilities require review.

## Acceptance criteria

Fixture scan identifies all five intentionally modeled capabilities.

False-positive count must be reported.

---

# 20. Phase 8 — Workflow Candidate Discovery

## Goal

Compile capabilities, navigation, tests and state transitions into candidate workflows.

Create:

```text
packages/workflow-discovery
```

Preferred evidence priority:

```text
1. explicitly approved semantic targets
2. E2E tests
3. deterministic UI/navigation graph
4. API effects
5. docs / PR / commit semantics
6. model inference
```

Candidate example:

```text
Create Client

entry:
  /admin/clients

steps:
  clients.create
  client.form.name
  client.form.submit

terminal:
  route /admin/clients/:id
  OR client.created
```

## Required outputs

```text
.pathcompiler/workflows/candidates/*.yaml
```

Every candidate includes:

- confidence;
- evidence;
- repository commit;
- unresolved ambiguities;
- validation status.

## Acceptance criteria

The fixture's `clients.create` workflow is generated automatically and validates structurally.

At least three workflows are generated with correct major steps.

---

# 21. Phase 9 — Workflow Validation

Create:

```text
packages/workflow-validator
```

Validators:

## Structural

- schema valid;
- referenced steps exist;
- no impossible `next`;
- terminal reachable;
- no unbounded accidental cycle.

## Repository

- target exists;
- route exists;
- target evidence matches current commit.

## Evidence

- major steps have evidence;
- weak evidence is reported.

## Test-backed

- compare with Playwright traces where available.

## Browser validation

Deferred to next phase.

Output:

```ts
type ValidationReport = {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  checks: ValidationCheck[];
};
```

No hidden validation.

---

# 22. Phase 10 — Browser Verification

## Goal

Verify a candidate workflow in the real fixture application.

Create a small verification runner using Playwright.

Input:

```text
candidate workflow
running app URL
test user/session
```

The runner should:

1. open entry route;
2. resolve semantic target;
3. perform only safe fixture actions;
4. verify expected transition;
5. continue;
6. verify terminal state.

Do not generalize browser automation beyond the needs of the workflow validator.

Output browser evidence.

## Acceptance criteria

`clients.create` passes end-to-end browser verification.

A deliberately stale target must fail with a useful error.

---

# 23. Phase 11 — Human Review Model

Do not build a polished visual editor yet.

First build review state and commands.

CLI:

```bash
pathcompiler workflows list
pathcompiler workflows show clients.create
pathcompiler workflows approve clients.create
pathcompiler workflows reject clients.create
```

Approved files move to:

```text
.pathcompiler/workflows/approved/
```

or a repository-visible location:

```text
.pathcompiler/workflows/
```

Recommended source-of-truth file:

```text
.pathcompiler/workflows/clients.create.yaml
```

Candidate metadata can remain under cache.

Approval must record:

```text
approvedBy
approvedAt
approvedCommit
```

For a local tool, `approvedBy` may be a configured user string.

---

# 24. Phase 12 — Workflow Compiler

Create:

```text
packages/workflow-compiler
```

Compile approved IR into:

## Search record

```json
{
  "id": "clients.create",
  "title": "Create a client",
  "aliases": [],
  "action": "create",
  "entity": "client",
  "roles": ["nutritionist"],
  "routes": ["/admin/clients"]
}
```

## Runtime manifest

Only browser-safe information.

## Documentation record

Resolved explanatory structure.

Outputs:

```text
.pathcompiler/generated/
  search-index.json
  runtime-manifest.json
  documentation.json
```

The compiler must be deterministic.

Same approved workflow + same compiler version = same output.

---

# 25. Phase 13 — Runtime Resolver

Create:

```text
packages/resolver
```

API:

```ts
resolveProductHelp({
  query,
  context
})
```

Initial retrieval:

1. lexical normalization;
2. action/entity matching;
3. alias matching;
4. simple embedding adapter optional;
5. context filters:
   - route;
   - role;
   - feature flags;
   - permissions.

No graph traversal required.

Result:

```ts
type ProductHelpResult =
  | WorkflowHelpResult
  | AmbiguousResult
  | UnsupportedResult;
```

## Acceptance criteria

Twenty paraphrases for fixture workflows achieve a manually reviewed target accuracy.

Do not hardcode example questions directly into matching tests in a way that makes the evaluation meaningless.

---

# 26. Phase 14 — Headless JS SDK

Create:

```text
packages/sdk-js
```

Core API:

```ts
const client = new PathCompiler({
  project: "...",
  transport: ...
});

await client.resolve(...);
await client.workflows.get(...);
await client.workflows.search(...);
```

Transport abstraction:

```ts
interface RuntimeTransport {
  resolve(request: ResolveRequest): Promise<ProductHelpResult>;
  getWorkflow(id: string): Promise<Workflow>;
  getRuntimeManifest(id: string): Promise<RuntimeManifest>;
}
```

Implement:

- local static transport first;
- HTTP transport later.

This enables bundled/offline use.

---

# 27. Phase 15 — React Runtime

Create:

```text
packages/react
packages/runtime-core
```

Headless primitives:

```text
PathCompilerProvider
useProductHelp
useWorkflow
useWorkflowProgress
useGuideRuntime
```

Semantic target support:

```tsx
data-pathcompiler="clients.create"
```

Runtime engine:

- stateful;
- route-aware;
- page-to-page;
- explicit stopping;
- timeout;
- pause/resume;
- target-not-found fallback.

Do not couple `runtime-core` to React.

React is an adapter.

---

# 28. Phase 16 — Optional UI Components

Create:

```text
packages/ui
```

Only after headless runtime works.

Components:

```text
ProductHelpCard
WorkflowChecklist
GuideOverlay
WorkflowSearch
```

Requirements:

- accessible;
- themeable;
- replaceable;
- no mandatory dependency for SDK users.

This package is convenience, not core.

---

# 29. Phase 17 — MCP Server

Create:

```text
packages/mcp-server
```

Expose:

```text
pathcompiler.resolve_help
pathcompiler.search_workflows
pathcompiler.get_workflow
pathcompiler.get_related_workflows
pathcompiler.get_supported_actions
```

Admin/developer tools may later expose:

```text
pathcompiler.get_impacted_workflows
pathcompiler.get_change_evidence
```

MCP must call the same core services as REST/SDK.

Do not implement separate business logic in the MCP package.

---

# 30. Phase 18 — HTTP Service

Build a minimal runtime service.

Endpoints:

```text
POST /v1/help/resolve
POST /v1/workflows/search
GET  /v1/workflows/:id
GET  /v1/workflows/:id/runtime
```

Do not build auth/billing complexity yet.

For local MVP, a simple API token is sufficient.

Server behavior must mirror SDK behavior.

---

# 31. Phase 19 — Incremental Graph Diff

This phase begins the core self-maintaining promise.

Given:

```text
base commit
head commit
```

Compute:

```text
changed files
changed symbols
changed routes
changed targets
changed APIs
```

Re-run analysis only for affected graph regions where practical.

Graph diff output:

```ts
type GraphDelta = {
  addedNodes: GraphNode[];
  removedNodes: GraphNode[];
  changedNodes: GraphNodeChange[];
  addedEdges: GraphEdge[];
  removedEdges: GraphEdge[];
};
```

Correctness is more important than maximum incremental performance.

A full re-scan with correct diffing is acceptable initially.

---

# 32. Phase 20 — Workflow Impact Analysis

Input:

```text
GraphDelta
approved workflows
```

Output:

```ts
type WorkflowImpact = {
  workflowId: string;
  severity: "none" | "low" | "medium" | "high";
  reasons: ImpactReason[];
  affectedSteps: string[];
};
```

Rules:

- semantic target removed → high;
- terminal API removed → high;
- route changed → high;
- implementation file moved but semantic target stable → low;
- copy-only text change → low/none;
- permission condition changed → high.

Model inference can supplement but not replace deterministic impact rules.

---

# 33. Phase 21 — Workflow Update Proposals

For medium/high impact workflows:

```text
old approved workflow
+
new product graph
+
diff evidence
+
new tests
+
commit/PR semantic evidence
```

generate a proposed workflow update.

Never overwrite approved workflow directly.

Store proposal:

```text
.pathcompiler/proposals/
  plans.change_structure.<head-sha>.yaml
```

Review modes:

```text
accept
edit
reject
ignore-for-this-change
```

A proposal must include a human-readable diff.

---

# 34. Phase 22 — New Workflow Detection

New capability with no approved workflow should generate:

```text
New workflow candidate
```

Example:

```text
plans.duplicate
```

Detection confidence should consider:

- new user-facing action;
- new route or dialog;
- new write API;
- new Playwright flow;
- commit/PR title.

No single signal is sufficient in every case.

---

# 35. Phase 23 — Workflow Deprecation

If a workflow loses critical implementation support:

```text
semantic targets missing
API gone
route gone
replacement capability detected
```

generate a deprecation proposal.

Do not automatically delete approved workflow files.

---

# 36. Phase 24 — GitHub App

Only now build the real GitHub integration.

Requirements:

- GitHub App installation;
- least-privilege permissions;
- webhook signature verification;
- push events;
- pull request events;
- check runs;
- installation tokens.

Webhook handler:

1. verify;
2. acknowledge quickly;
3. enqueue work;
4. process asynchronously;
5. publish check result.

GitHub Check example:

```text
PathCompiler Workflow Check

✓ 17 workflows unaffected
⚠ 2 workflows require review
+ 1 possible new workflow
```

---

# 37. Phase 25 — Control Plane Dashboard

Create:

```text
apps/dashboard
```

Minimum screens:

```text
Projects
Product Map
Workflows
Workflow Detail
Pending Changes
Evidence
Settings
```

First visual editor can be simple.

Do not invest heavily in graph visualization before the review loop proves useful.

Workflow Detail must show:

- steps;
- source evidence;
- confidence;
- current commit;
- validation report;
- pending diff.

---

# 38. Phase 26 — Static Export

CLI:

```bash
pathcompiler build
```

Outputs runtime artifacts that can be bundled with customer app.

Support:

```text
JSON
YAML
Markdown
```

The static mode must not require PathCompiler servers at runtime.

This is important for:

- privacy;
- latency;
- enterprise deployment;
- developer trust.

---

# 39. Phase 27 — Documentation Export

Use approved workflows to generate:

```text
docs/help/*.md
```

A workflow should produce a documentation page without duplicating business knowledge manually.

Do not make Markdown the source of truth.

Markdown is a renderer/export.

---

# 40. Phase 28 — Assistant Tool Adapters

Provide provider-neutral core function:

```ts
resolveProductHelp()
```

Then adapters:

```text
OpenAI tool schema
Anthropic tool schema
LangChain-style tool wrapper
generic JSON Schema tool description
```

No provider SDK belongs in core packages.

---

# 41. Phase 29 — Example Existing Assistant

Build `examples/custom-assistant`.

It should demonstrate:

```text
existing assistant
       ↓
resolveProductHelp
       ↓
structured result
       ↓
custom UI
```

The example must prove that PathCompiler does not require the PathCompiler UI package.

---

# 42. Phase 30 — Full Reference Demo

The fixture application must demonstrate:

1. repository scan;
2. product graph;
3. workflow discovery;
4. workflow approval;
5. compile;
6. query resolver;
7. custom assistant answer;
8. navigate action;
9. interactive guide;
10. code change;
11. impacted workflow detected;
12. update proposal;
13. approval;
14. new runtime output.

This is the first true MVP definition of done.

---

# 43. CLI Contract

Target commands:

```bash
pathcompiler init
pathcompiler scan
pathcompiler graph inspect
pathcompiler targets suggest
pathcompiler tests mine
pathcompiler capabilities list
pathcompiler workflows discover
pathcompiler workflows list
pathcompiler workflows show <id>
pathcompiler workflows validate <id>
pathcompiler workflows approve <id>
pathcompiler workflows reject <id>
pathcompiler build
pathcompiler diff <base> <head>
pathcompiler impact <base> <head>
pathcompiler mcp
```

Do not implement commands before their underlying package exists.

---

# 44. Configuration File

`pathcompiler.yaml`

Initial schema:

```yaml
version: 1

project:
  name: Example SaaS

repository:
  default_branch: main

framework:
  adapter: nextjs

analysis:
  include:
    - src/**
    - app/**
    - tests/**
  exclude:
    - node_modules/**
    - .next/**
    - dist/**

sources:
  code: true
  tests: true
  commits: true
  pull_requests: false
  docs: true

workflows:
  auto_propose: true
  auto_approve: false
  minimum_candidate_confidence: 0.70

runtime:
  modes:
    - explain
    - navigate
    - guide

privacy:
  source_upload: false
```

Validate configuration with Zod.

---

# 45. Model Use Policy

LLMs are optional semantic helpers.

Never require an LLM for:

- parsing routes;
- parsing imports;
- reading Git diffs;
- validating workflow references;
- graph diffing;
- checking target existence;
- checking schema validity.

Use LLMs for:

- capability naming;
- semantic merging;
- interpreting PR intent;
- workflow candidate synthesis when deterministic evidence is incomplete;
- natural-language aliases;
- human-readable change explanation.

All model outputs must use structured schemas and be validated.

---

# 46. Model Provider Interface

```ts
interface PathCompilerModelProvider {
  inferCapabilities(
    request: InferCapabilitiesRequest
  ): Promise<InferCapabilitiesResponse>;

  synthesizeWorkflow(
    request: SynthesizeWorkflowRequest
  ): Promise<SynthesizeWorkflowResponse>;

  explainImpact(
    request: ExplainImpactRequest
  ): Promise<ExplainImpactResponse>;

  generateAliases(
    request: GenerateAliasesRequest
  ): Promise<GenerateAliasesResponse>;
}
```

Create:

```text
packages/model-provider
```

later when first needed.

Initially provide:

```text
NoopModelProvider
FixtureModelProvider
```

for deterministic tests.

An OpenAI adapter may be implemented separately.

---

# 47. Privacy Rules

Never send an entire repository to an LLM by default.

Model requests must use minimum necessary evidence.

Potential preprocessing:

- strip obvious secrets;
- never include `.env`;
- honor excludes;
- avoid binary files;
- record what context was sent.

Add a dry-run mode:

```bash
pathcompiler scan --explain-model-context
```

that shows what would be sent to model providers.

---

# 48. Security Rules

Before hosted deployment:

- verify GitHub webhook signatures;
- encrypt tokens;
- use least-privilege GitHub permissions;
- never log repository credentials;
- redact secrets;
- isolate project data;
- make source retention configurable;
- maintain audit logs for workflow approvals.

Do not claim enterprise security before these exist.

---

# 49. Quality Rules

Every package must have:

- explicit public API;
- tests;
- no circular package dependencies;
- typed error classes where appropriate;
- no silent catch-and-ignore;
- deterministic behavior for deterministic inputs.

Avoid:

```text
any
large god classes
hidden global state
unbounded retries
implicit network access in core packages
```

---

# 50. Dependency Direction

Maintain this conceptual direction:

```text
workflow-ir
graph-core
source-model
      ↓
adapters / miners
      ↓
capability-engine
      ↓
workflow-discovery
      ↓
workflow-validator
      ↓
workflow-compiler
      ↓
workflow-registry
      ↓
resolver / runtime-core
      ↓
sdk / react / MCP / HTTP / UI
```

UI/integration packages may depend downward.

Core packages must never import UI packages.

---

# 51. Error Taxonomy

Create explicit errors:

```text
ConfigurationError
RepositoryAnalysisError
UnsupportedFrameworkError
WorkflowValidationError
TargetResolutionError
WorkflowNotFoundError
AmbiguousWorkflowError
ModelProviderError
GitProviderError
```

Errors intended for users must have actionable messages.

---

# 52. Logging

Implement structured logs.

Fields where relevant:

```text
project
commit
phase
workflow_id
node_id
duration_ms
```

Avoid source-code content in logs unless debug mode explicitly requests it.

---

# 53. Observability

For local CLI:

```text
phase durations
counts
warnings
```

Example:

```text
Scan complete

Files              242
Routes               31
Components          118
UI actions           87
API endpoints        24
Tests                16
Capabilities         22
Candidate workflows  14
Warnings              3
```

This output is important for debuggability.

---

# 54. Evaluation Harness

Create an evaluation dataset for the fixture.

Ground truth:

```text
capabilities.json
workflows/*.yaml
impact-cases/*.json
queries.json
```

Measure:

## Capability extraction

```text
precision
recall
```

## Workflow discovery

```text
correct entrypoint
correct major steps
correct terminal
unsupported invented step count
```

## Resolver

```text
top-1 accuracy
ambiguity accuracy
unsupported accuracy
```

## Impact analysis

```text
affected workflow recall
false-positive rate
severity correctness
```

Never optimize only against anecdotal examples.

---

# 55. Golden Tests

Use golden/snapshot tests for:

- graph serialization;
- compiled manifests;
- CLI report output where stable;
- workflow candidate generation with fixture model provider.

Snapshots must be readable.

Do not use snapshots to hide unclear behavior.

---

# 56. Commit Strategy During Codex Build

For large implementation runs:

- one coherent phase per commit when possible;
- do not commit failing tests;
- commit messages describe intent;
- update phase notes after each completed phase.

Suggested:

```text
feat(workflow-ir): add versioned workflow schema
feat(graph): add deterministic graph core
feat(nextjs): extract app routes and UI actions
feat(playwright): mine e2e action traces
```

---

# 57. ADRs

When Codex needs to make a material architecture decision not already settled here:

1. do not silently choose;
2. create:
   ```text
   docs/decisions/NNNN-title.md
   ```
3. record:
   - context;
   - decision;
   - alternatives;
   - consequences;
4. choose the simplest reversible path unless the spec clearly implies otherwise.

Examples requiring ADR:

- graph database adoption;
- switching monorepo build system;
- changing Workflow IR semantics;
- making a hosted service mandatory;
- changing runtime target identification strategy.

---

# 58. Codex Working Protocol

At the start of a substantial task:

1. read `AGENTS.md`;
2. read the relevant section of `PRODUCT_ARCHITECTURE.md`;
3. read the relevant phase in this file;
4. inspect current repository state;
5. run baseline tests;
6. state a short implementation plan;
7. make changes;
8. run focused tests;
9. run full required verification;
10. summarize:
    - changed files;
    - behavior;
    - tests;
    - unresolved risks.

Do not rewrite unrelated code.

---

# 59. Phase Tracking

Create:

```text
docs/phases/STATUS.md
```

Format:

```md
# Build Status

## Phase 0 — Repository Foundation
Status: complete

Evidence:
- pnpm test passes
- workflow IR tests
- graph tests

## Phase 1 — Static Next.js Analyzer
Status: in_progress

Remaining:
- API call edges
- feature flag extraction
```

Codex must update it when finishing a phase.

This prevents future sessions from relying on chat memory.

---

# 60. README Requirements

README should eventually explain:

```text
What PathCompiler is
Why it exists
Architecture in one diagram
Quick start
CLI
Runtime integration
MCP
Development
Current limitations
```

Do not turn README into the full architecture document.

Link to the architecture/spec files.

---

# 61. Initial README Positioning

Recommended opening:

```md
# PathCompiler

Compile your codebase into executable product workflows.

PathCompiler analyzes source code, tests and Git history to discover how users accomplish tasks in your software. It turns those processes into versioned workflow artifacts that can power AI assistants, in-app guidance, help centers, onboarding and future software agents.
```

---

# 62. API Design Principle

Every runtime feature should be usable without our UI.

Test:

> Could a developer use this entirely from their own assistant and frontend?

If no, revise the API.

---

# 63. Runtime Result v1

Implement a structured result similar to:

```ts
type WorkflowHelpResult = {
  type: "workflow_help";

  workflowId: string;
  workflowVersion: number;

  confidence: number;

  content: {
    title: string;
    summary?: string;
    steps: Array<{
      id: string;
      text: string;
    }>;
  };

  entrypoint?: {
    route?: string;
  };

  capabilities: {
    explain: boolean;
    navigate: boolean;
    guide: boolean;
    checklist: boolean;
    execute: boolean;
  };
};
```

No HTML.

No React nodes.

No provider-specific tool object in core.

---

# 64. Ambiguity Contract

If two workflows are close:

```ts
type AmbiguousResult = {
  type: "ambiguous";

  candidates: Array<{
    workflowId: string;
    title: string;
    confidence: number;
  }>;
};
```

Do not let the resolver arbitrarily select a low-margin winner.

---

# 65. Unsupported Contract

```ts
type UnsupportedResult = {
  type: "unsupported";
  reason:
    | "no_matching_workflow"
    | "not_available_for_context"
    | "workflow_not_verified";
};
```

This is preferable to hallucinated instructions.

---

# 66. MCP v1 Contract

Tools:

```text
pathcompiler.resolve_help
pathcompiler.search_workflows
pathcompiler.get_workflow
```

Keep v1 minimal.

Each MCP tool delegates to the same resolver/registry packages.

---

# 67. Optional UI v1 Contract

Provide one generic card and one guide overlay only.

Do not spend significant time on aesthetics.

The purpose is to demonstrate:

```text
structured result
     ↓
optional renderer
```

not to establish the final product design.

---

# 68. Browser Guide Behavior

Guide engine must support:

```text
click
route change
target appear
explicit next
terminal event/state
```

Required failure modes:

```text
target not found
wrong route
permission unavailable
workflow manifest mismatch
timeout
user cancels
```

Never trap the user in the guide.

---

# 69. Workflow Manifest Safety

Browser runtime manifest must exclude:

- repository paths;
- PR content;
- commit messages;
- private analysis;
- model prompts;
- secret/internal metadata.

Only runtime-safe data.

---

# 70. Versioning

Track:

```text
workflow schema version
workflow revision
repository commit
compiler version
runtime manifest version
```

Do not conflate them.

Example:

```yaml
schema_version: 1
workflow_revision: 7
repository_commit: abc123
compiler_version: 0.1.0
```

---

# 71. Incremental Update Classification

Implement change classes:

## Safe metadata change

Examples:

```text
component file moved
display text changed
implementation refactor
```

Semantic target and state remain valid.

Potentially auto-acceptable later.

## Workflow-affecting change

Examples:

```text
target removed
step added
route moved
terminal condition changed
permission changed
branch added
```

Requires review.

## New capability

Requires review.

## Capability removed

Requires review/deprecation.

---

# 72. Commit Message Use

Commit/PR language can contribute semantic evidence, but never override contradictory current code.

Priority:

```text
current implementation
+
tests
+
runtime verification
>
historical prose
```

Historical prose explains intent, not current truth.

---

# 73. Git History Scope

Do not index every historical commit semantically.

Start with:

- commits touching currently relevant files;
- recent history;
- blame-derived commits;
- merge PRs linked to those changes.

Add deeper history only on demand.

---

# 74. Human Review UI Later

When dashboard editor is built, use a state-machine graph representation.

Node inspector should expose:

```text
semantic target
instruction
expected state
evidence
confidence
source locations
```

Actions:

```text
approve
edit
reject
merge
deprecate
```

Keep YAML as portable source representation.

---

# 75. Runtime Context

Resolver should accept:

```ts
type RuntimeContext = {
  route?: string;
  locale?: string;
  role?: string;
  permissions?: string[];
  featureFlags?: Record<string, boolean>;
  tenant?: string;
  productRelease?: string;
};
```

Do not require all fields.

---

# 76. Feature Flags

Workflow variants may differ by feature flag.

Do not duplicate entire workflows if only one step differs unless necessary.

First version may choose the simpler representation:

- separate workflow versions with applicability conditions.

Optimize only after real cases appear.

---

# 77. Roles and Permissions

A workflow may be valid but unavailable for the current user.

Resolver must distinguish:

```text
does not exist
```

from:

```text
exists but unavailable for context
```

Do not leak sensitive admin workflows through browser search if the user lacks permission.

---

# 78. Localization

Core workflow identity is language-independent.

Content can be:

```text
resolved text
translation key
both
```

For MVP, use resolved English text plus optional keys.

Do not block compiler work on full localization infrastructure.

---

# 79. Headless Example

Reference usage:

```ts
const result = await client.resolve({
  query: "How do I create a client?",
  context: {
    route: "/admin",
    role: "nutritionist"
  }
});

if (result.type === "workflow_help") {
  renderWithMyOwnDesignSystem(result);
}
```

This must work without `@pathcompiler/ui`.

---

# 80. Static Example

```ts
import manifest from "./.pathcompiler/generated/runtime-manifest.json";
import { createStaticClient } from "@pathcompiler/sdk";

const client = createStaticClient(manifest);
```

This proves runtime independence from hosted infrastructure.

---

# 81. MCP Example

Agent config points to:

```bash
pathcompiler mcp
```

Agent can call:

```text
pathcompiler.resolve_help
```

No custom PathCompiler assistant required.

---

# 82. GitHub Check Example

After Phase 24:

```text
PathCompiler

2 workflows affected

HIGH
clients.create
Reason: terminal route changed

MEDIUM
clients.invite
Reason: shared ClientForm component changed

NEW CAPABILITY
clients.bulk_import

Review: <dashboard link>
```

---

# 83. Performance Targets for MVP

Not hard production SLOs.

Reasonable development targets:

```text
fixture scan:             < 10 s
small project scan:       < 30 s
resolver local lookup:    < 100 ms excluding embeddings/model
static workflow compile:  < 2 s
```

Correctness takes priority.

---

# 84. Caching

Cache expensive parsing by:

```text
file content hash
compiler version
adapter version
```

Do not introduce distributed caching early.

---

# 85. Determinism

Given:

```text
same repository commit
same config
same deterministic analyzer version
```

static graph output must be stable.

Semantic model-derived sections may contain model metadata and explicit nondeterminism.

Never mix model-generated values into stable IDs.

---

# 86. Model Evaluation

When model-assisted capability/workflow inference begins:

Create fixed evaluation examples.

Compare providers/models only against:

```text
correct capability identification
unsupported invention rate
workflow major-step accuracy
impact explanation usefulness
```

Do not select a model based only on subjective prose quality.

---

# 87. First Development Milestone

The very first milestone Codex should execute is **Phase 0 only**.

Do not ask Codex:

> Build the entire product.

Ask:

> Implement Phase 0 from CODEX_BUILD_SPEC.md. Do not begin Phase 1. Run all specified verification and update docs/phases/STATUS.md.

Review the result.

Then proceed phase by phase.

---

# 88. Second Development Milestone

After Phase 0 is reviewed:

> Implement Phase 1 — Static Next.js Analyzer. Preserve all existing contracts. Do not implement model inference or workflow discovery yet.

This prevents premature architecture drift.

---

# 89. Third Development Milestone

Proceed to semantic targets and Playwright mining.

Only after deterministic evidence extraction works should semantic model inference begin.

---

# 90. Definition of MVP

MVP is achieved when the reference demo proves:

```text
Next.js repo
   ↓
scan
   ↓
product graph
   ↓
candidate workflow
   ↓
review/approval
   ↓
compile
   ↓
resolve query
   ↓
custom rendered answer
   ↓
optional walkthrough
   ↓
new code commit
   ↓
workflow impact detected
   ↓
update proposal
```

All steps must be demonstrable locally.

---

# 91. Definition of Product-Ready Alpha

Alpha additionally requires:

- GitHub App;
- project dashboard;
- PR checks;
- stable JS SDK;
- MCP server;
- static export;
- documentation;
- at least two unrelated Next.js repositories successfully integrated.

---

# 92. Explicit Deferred Decisions

Do not decide these prematurely:

- graph database vendor;
- vector database vendor;
- billing provider;
- queue provider;
- cloud provider;
- workflow marketplace;
- mobile runtime;
- visual graph library;
- enterprise deployment architecture.

Use interfaces where necessary and wait for evidence.

---

# 93. Suggested Model Usage During Development

For the Codex coding agent itself, use a high-capability coding model for:

- architecture-sensitive phases;
- parser design;
- Workflow IR;
- incremental impact engine;
- cross-package refactors.

Use a cheaper/faster model for:

- repetitive tests;
- docs;
- fixtures;
- small isolated adapters.

Model choice is an execution concern and must not leak into PathCompiler's architecture.

---

# 94. Initial Codex Prompt

Use this after placing the files at the repo root:

```text
Read AGENTS.md, PRODUCT_ARCHITECTURE.md, and CODEX_BUILD_SPEC.md.

We are starting from an empty repository.

Implement Phase 0 — Repository Foundation only.

Requirements:
- Follow the repository structure and invariants in CODEX_BUILD_SPEC.md.
- Do not start Phase 1.
- Prefer the smallest correct implementation.
- Create the fixture Next.js app with the workflows required by Phase 0.
- Add tests for Workflow IR and graph-core.
- Add CI.
- Create docs/phases/STATUS.md and mark only completed work as complete.
- Run install, lint, typecheck, and tests.
- Fix failures before finishing.
- Do not make architecture decisions that contradict the spec; if an unresolved material decision is required, create an ADR.
- At the end, summarize changed files, commands run, test results, and remaining risks.
```

---

# 95. Subsequent Codex Prompt Template

```text
Read AGENTS.md, PRODUCT_ARCHITECTURE.md, CODEX_BUILD_SPEC.md, and docs/phases/STATUS.md.

Implement Phase <N> — <NAME> only.

Before editing:
1. inspect the existing implementation;
2. run the current baseline checks;
3. identify the exact package boundaries affected.

During implementation:
- preserve prior public contracts unless this phase explicitly changes them;
- add focused tests;
- avoid unrelated refactors;
- record a material new architecture decision in an ADR.

Before finishing:
- run focused tests;
- run full lint/typecheck/test requirements;
- update docs/phases/STATUS.md;
- do not mark incomplete work complete.

Report:
- behavior implemented;
- files changed;
- tests and commands run;
- any deviations from the phase spec;
- next recommended phase.
```

---

# 96. Final Instruction to Codex

When implementation detail conflicts with product intent:

1. preserve the invariants;
2. choose the simplest reversible implementation;
3. avoid speculative infrastructure;
4. leave a clear documented boundary for future extension;
5. never make the system look more complete than it is.

The objective is not maximum code volume.

The objective is a small, testable compiler pipeline whose abstractions survive real repositories.

