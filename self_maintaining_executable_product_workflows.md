# Self-Maintaining Executable Product Workflows
## Product concept, architecture, implementation plan, and integration model

> **Working concept:** a compiler that turns a living software repository into versioned, reviewable, executable business workflows — and keeps them synchronized automatically as the product changes.

---

# 1. The Core Idea

Modern software products contain a large amount of implicit product knowledge:

- which business capabilities exist;
- which user roles can use them;
- where each capability lives in the UI;
- which sequence of actions completes a task;
- which states, permissions, feature flags, and validations affect that task;
- which API calls, events, and data mutations signal success;
- how these processes have changed over time.

Today, that knowledge is fragmented across:

- source code;
- routes and UI components;
- backend APIs;
- database models;
- tests;
- commits;
- pull requests;
- issue descriptions;
- documentation;
- tutorials;
- support conversations;
- product managers' memory.

The proposed product continuously converts this fragmented evidence into a structured model of the product's **business processes**.

The graph is **not primarily a runtime retrieval mechanism**.

Its main role is to:

1. understand the software;
2. discover product capabilities;
3. infer candidate business processes;
4. connect each process to the code and evidence that supports it;
5. generate executable workflows;
6. detect when a code change affects an existing workflow;
7. propose new or updated workflows automatically.

After review, the workflows become **first-class artifacts**.

At runtime, end-user experiences retrieve a verified workflow directly rather than asking an LLM to reason through the entire graph every time.

---

# 2. One-Sentence Product Definition

> **A self-maintaining workflow compiler that reads a software repository, its tests and its development history, discovers the product's business processes, compiles them into executable workflows, and automatically keeps those workflows synchronized with every product change.**

Alternative positioning:

> **Turn your codebase into an executable, self-updating product manual.**

Or:

> **Your software already contains its product knowledge. We compile it into workflows.**

---

# 3. Why This Is Different From a Product Tour Tool

Traditional digital-adoption products typically begin after a human has already decided:

- what the workflow is;
- what the steps are;
- which buttons should be highlighted;
- when the walkthrough should stop.

They solve the last mile:

```text
Known workflow
      ↓
Tooltip / overlay / walkthrough
      ↓
User completes task
```

This product solves the larger pipeline:

```text
Code + Tests + Git History + PRs + Docs
                  ↓
          Product Understanding
                  ↓
        Business Process Discovery
                  ↓
            Human Validation
                  ↓
       Executable Workflow Compiler
                  ↓
        Versioned Workflow Index
                  ↓
 Explain / Navigate / Guide / Automate
```

The overlay or tour library is therefore only a renderer.

The differentiated asset is the system that **discovers, validates, versions and maintains the workflows**.

---

# 4. Important Architectural Principle

## The graph is an intermediate representation

Do **not** structure the runtime as:

```text
User question
    ↓
Graph traversal
    ↓
LLM reasons over graph
    ↓
LLM invents steps
```

Prefer:

```text
OFFLINE / BUILD TIME

Repository evidence
      ↓
Knowledge graph
      ↓
Workflow discovery
      ↓
Human review
      ↓
Compiled workflow artifacts
      ↓
Workflow index


RUNTIME

User question
      ↓
Intent / semantic retrieval
      ↓
Verified workflow artifact
      ↓
Deterministic runtime engine
```

This separation provides:

- lower runtime latency;
- lower model cost;
- less hallucination risk;
- deterministic behavior;
- versioning;
- easier testing;
- easier auditing;
- better product reliability.

---

# 5. The Complete Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                      SOURCE / EVIDENCE LAYER                     │
│                                                                  │
│ Source code │ Routes │ APIs │ DB │ Tests │ Docs │ Commits │ PRs │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                       REPOSITORY INGESTION                       │
│                                                                  │
│ Git provider adapter │ framework detector │ parser orchestration │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                     STATIC PRODUCT ANALYSIS                      │
│                                                                  │
│ AST │ imports │ calls │ routes │ UI actions │ API calls │ RBAC   │
│ forms │ state changes │ events │ feature flags │ tests           │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                       EVIDENCE FUSION                            │
│                                                                  │
│ code + test semantics + commit history + PR intent + docs        │
│                                                                  │
│ Every claim maintains provenance back to evidence.               │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                         PRODUCT GRAPH                            │
│                                                                  │
│ domains ↔ capabilities ↔ surfaces ↔ actions ↔ states ↔ APIs     │
│ roles ↔ permissions ↔ entities ↔ events ↔ source evidence       │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                    WORKFLOW DISCOVERY ENGINE                     │
│                                                                  │
│ candidate process generation │ branch detection │ terminal state │
│ preconditions │ postconditions │ confidence │ duplicate merging  │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                     VALIDATION / CRITIC LAYER                    │
│                                                                  │
│ static validation │ test cross-check │ browser verification      │
│ evidence coverage │ ambiguity detection │ confidence scoring      │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                         HUMAN REVIEW                             │
│                                                                  │
│ Visual process graph │ evidence │ diff │ accept │ edit │ reject   │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                         WORKFLOW IR                              │
│                                                                  │
│ Stable, framework-independent, executable workflow specification │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                         WORKFLOW COMPILER
                                │
          ┌─────────────────────┼────────────────────┐
          │                     │                    │
          ▼                     ▼                    ▼
   Search Index           Runtime Manifest      Documentation
          │                     │
          ▼                     ▼
     AI Assistant       In-app Guide Engine
                                │
                   Explain / Go There / Show Me
```

---

# 6. The Four Main Internal Representations

A single giant graph is possible, but separating levels of abstraction makes the system easier to reason about.

## 6.1 Code Graph

Represents implementation-level relationships.

### Example node types

- Repository
- Package
- File
- Function
- Class
- Component
- Hook
- Route
- API endpoint
- DB model
- Event
- Feature flag
- Permission
- Test

### Example edges

```text
IMPORTS
CALLS
RENDERS
HANDLES
READS
WRITES
NAVIGATES_TO
TRIGGERS
REQUIRES_PERMISSION
GUARDED_BY_FLAG
TESTED_BY
```

---

## 6.2 Product Surface Graph

Maps implementation details to things a user can experience.

Example:

```text
Clients Page
│
├── Create Client
│   ├── New Client Button
│   ├── Client Form
│   └── Submit Action
│
├── Search Client
├── Edit Client
└── Deactivate Client
```

This layer converts technical elements into recognizable product surfaces and actions.

---

## 6.3 Business Process Graph

Represents what users are trying to accomplish.

Example:

```text
Manage Clients
│
├── Create Client
├── Invite Client
├── Update Client
└── Deactivate Client

Manage Nutrition Plan
│
├── Create Plan
├── Import Plan
├── Change Structure
├── Change Macros
├── Add Alternative
└── Complete and Send
```

This is the semantic product map.

---

## 6.4 Execution Graph

Represents exactly how a verified workflow executes.

Example:

```text
CLIENT_LIST
     │
     │ click clients.create
     ▼
CLIENT_FORM
     │
     │ required fields valid
     ▼
READY_TO_SAVE
     │
     │ click client.submit
     ▼
CLIENT_CREATED
     │
     └── terminal
```

This graph supports:

- branching;
- retries;
- optional steps;
- multiple pages;
- permissions;
- feature flags;
- explicit completion conditions.

---

# 7. The Workflow IR

The **Workflow Intermediate Representation** should be one of the most important assets of the platform.

It should be:

- framework-independent;
- human-readable;
- machine-executable;
- versionable;
- diffable;
- testable;
- capable of storing evidence and confidence.

Example:

```yaml
schema_version: 1

id: clients.create
title: Create a client

domain: clients

intent:
  action: create
  entity: client

roles:
  - nutritionist

entrypoints:
  - route: /admin/clients

preconditions:
  - permission: clients.write

steps:
  - id: open_form
    target: clients.create
    action:
      type: click
    expected:
      state: client_form_open

  - id: complete_name
    target: client.form.name
    action:
      type: input
    instruction:
      key: workflows.clients.create.name

  - id: submit
    target: client.form.submit
    action:
      type: click
    expected:
      event: client.created

terminal:
  any:
    - event: client.created
    - route_matches: "^/admin/clients/[a-zA-Z0-9_-]+$"

provenance:
  code:
    - src/features/clients/AddClientModal.tsx
  api:
    - POST /api/clients
  tests:
    - e2e/clients/create-client.spec.ts
  commits:
    - 95a3c12
  pull_requests:
    - 431

generated_from_commit: e83c921
verified_at_commit: e83c921

confidence:
  overall: 0.96
```

---

# 8. Provenance Is Mandatory

The system must never produce business knowledge without knowing where that knowledge came from.

Every capability, relation or workflow should be traceable to evidence.

Example:

```yaml
claim:
  type: capability
  value: "Nutritionists can deactivate a client"

evidence:
  - type: ui_component
    ref: ClientActionsMenu.tsx
    confidence: 0.81

  - type: api
    ref: PATCH /clients/:id/status
    confidence: 0.91

  - type: test
    ref: deactivate-client.spec.ts
    confidence: 0.98

  - type: pull_request
    ref: PR#731
    confidence: 0.85
```

This allows a reviewer to inspect:

> Why does the system believe this workflow exists?

It also makes incremental updates much safer.

---

# 9. Why Commits and Pull Requests Matter

Source code describes **what exists now**.

Git history and PRs often explain **why it exists**.

Example code evidence:

```text
DeactivateClientDialog
        ↓
PATCH /clients/:id/status
```

The implementation suggests a capability but provides little business context.

A PR may say:

> Replace permanent archive behavior with temporary client deactivation so a nutritionist can restore a client later.

Now the system learns:

```text
Business capability:
Temporarily deactivate client

Difference from:
Delete client

Reversibility:
Reactivation supported
```

Therefore:

```text
Current source = reality
Git history / PRs = semantic evidence
Tests = behavioral evidence
Docs = intended user explanation
```

None of these should independently be considered absolute truth.

They are fused.

---

# 10. The Harness

The harness is the core analysis pipeline.

It is not one LLM prompt.

It is an orchestrated sequence of deterministic analysis and model-assisted semantic interpretation.

## Harness stages

```text
Repository Snapshot
      ↓
Framework Detection
      ↓
Static Extraction
      ↓
Git / PR Extraction
      ↓
Test Extraction
      ↓
Documentation Extraction
      ↓
Graph Update
      ↓
Semantic Capability Detection
      ↓
Workflow Discovery
      ↓
Critic / Validation
      ↓
Review Proposal
      ↓
Compile
```

Each stage should produce structured data.

This is important because the system needs to be debuggable.

---

# 11. Step-by-Step: Initial Repository Bootstrap

## Step 1 — Connect the repository

The developer installs the product's GitHub App or runs the CLI.

The system receives:

- repository identity;
- default branch;
- repository permissions;
- installation ID;
- configuration.

---

## Step 2 — Detect the project

The scanner detects:

```text
framework:
  Next.js 16

frontend:
  React

backend:
  Next route handlers

database:
  Prisma

tests:
  Vitest
  Playwright

i18n:
  next-intl
```

Adapters are selected automatically.

---

## Step 3 — Parse the repository

Use deterministic parsers whenever possible.

Examples:

### TypeScript / JavaScript

- TypeScript compiler API;
- Babel;
- tree-sitter.

### Python

- Python AST;
- tree-sitter.

### Other languages

Framework adapters can be added incrementally.

Output:

```text
files
symbols
components
routes
imports
function calls
API handlers
DB references
permissions
events
```

---

# 12. Step-by-Step: UI and Action Extraction

The system looks for interactive elements:

```tsx
<Button onClick={openCreateClient}>
  Add client
</Button>
```

It extracts:

```yaml
element:
  semantic_name: clients.create
  component: Button
  action: click

handler:
  openCreateClient

result:
  AddClientModal.open
```

For forms:

```text
field → validation → submit → API → state change
```

The goal is to infer possible action chains.

---

# 13. Stable Semantic Anchors

Runtime guidance should not depend on brittle CSS selectors.

Bad:

```css
div:nth-child(3) > div > button:nth-child(2)
```

Better:

```tsx
<Button data-workflow-id="clients.create">
```

or:

```tsx
<ProductAction id="clients.create">
```

The SDK can expose primitives such as:

```tsx
<WorkflowTarget id="clients.create">
  <Button>Add client</Button>
</WorkflowTarget>
```

This creates a stable contract between:

```text
repository understanding
        ↕
workflow specification
        ↕
runtime guide
```

The system can initially infer targets automatically and then suggest adding semantic anchors where reliability is low.

---

# 14. Step-by-Step: Test Mining

E2E tests are extremely valuable.

Example:

```ts
await page.goto("/admin/clients");
await page.getByRole("button", { name: "Add client" }).click();
await page.getByLabel("Name").fill("Maria");
await page.getByRole("button", { name: "Save" }).click();
await expect(page).toHaveURL(/clients\/.+/);
```

This already contains:

```text
start state
action sequence
selectors
inputs
terminal condition
```

The harness converts this into evidence for:

```text
WORKFLOW: clients.create
```

Tests should not automatically become user workflows; they become high-confidence behavioral evidence.

---

# 15. Step-by-Step: Git History Mining

For the initial scan:

1. inspect important recent commits;
2. map changed files to code graph nodes;
3. parse commit messages;
4. inspect related PRs;
5. map PR descriptions to product capabilities;
6. attach semantic evidence to nodes.

The system should prioritize history connected to current code.

There is no reason to semantically analyze every commit ever made in a large repository.

A useful approach:

```text
current code node
     ↓
git blame / path history
     ↓
relevant commits
     ↓
associated PRs
```

---

# 16. Step-by-Step: Capability Discovery

At this stage the system has technical evidence.

The semantic layer proposes capabilities such as:

```yaml
domain: clients

capabilities:
  - create_client
  - invite_client
  - edit_client
  - deactivate_client
  - restore_client
```

Each proposal includes:

```text
confidence
evidence
role
product surface
affected routes
```

Duplicate capabilities from different evidence sources are merged.

---

# 17. Step-by-Step: Business Workflow Synthesis

Capabilities are connected into candidate workflows.

Example evidence:

```text
Clients Page
→ Add Client Button
→ Add Client Modal
→ POST /clients
→ Client Detail Route
```

Generated workflow:

```text
Create Client

1. Open Clients
2. Select Add Client
3. Complete client information
4. Save
5. Client profile opens

terminal:
client.created
```

The model is used for semantic interpretation.

The deterministic graph constrains what the model is allowed to claim.

---

# 18. Workflow Critic and Validation

Never send generated workflows directly to production.

Every generated workflow passes through validators.

## Static validator

Checks:

- targets exist;
- routes exist;
- APIs exist;
- referenced states exist;
- permissions are valid.

## Evidence validator

Checks:

- every major step has evidence;
- contradictory evidence is flagged;
- confidence threshold is met.

## Test validator

Checks whether tests support the path.

## Optional browser validator

Runs the candidate workflow in a test/staging environment.

Example:

```text
generated:
clients.create

browser verification:
✓ clients.create target found
✓ modal appears
✓ fields appear
✓ submit executed
✓ client.created observed
```

Only verified workflows should receive high confidence.

---

# 19. Human Review

The human reviewer should not edit YAML unless they want to.

Build a visual workflow editor.

Example:

```text
┌───────────────┐
│ Clients Page  │
└───────┬───────┘
        │ click Add Client
        ▼
┌────────────────┐
│ Client Form    │
└───────┬────────┘
        │ complete fields
        ▼
┌────────────────┐
│ Save           │
└───────┬────────┘
        │ client.created
        ▼
┌────────────────┐
│ DONE           │
└────────────────┘
```

Selecting a node opens:

```text
Target
clients.create

Evidence
AddClientModal.tsx
clients.spec.ts
PR #431

Expected state
client_form_open

Confidence
97%
```

Reviewer actions:

```text
Approve
Edit
Reject
Merge with another workflow
Mark as internal-only
```

---

# 20. Workflow Compilation

After approval, the workflow becomes a first-class artifact.

The compiler can generate:

```text
.workflow/
  workflows/
    clients.create.yaml
    clients.edit.yaml
    plans.change-structure.yaml

  generated/
    search-index.json
    runtime-manifest.json
    documentation.json
```

The approved YAML should ideally live in the customer's repository.

Why?

- Git versioning;
- PR review;
- portability;
- no vendor lock-in;
- workflow and code remain connected;
- easy rollback;
- transparent changes.

The cloud service can maintain:

- graph database;
- embeddings/search index;
- historical snapshots;
- analytics;
- review metadata.

---

# 21. Runtime Retrieval

Do not query the full graph.

Use a compact workflow index.

Example:

```json
{
  "id": "plans.change_structure",
  "title": "Change plan structure",
  "aliases": [
    "change plan structure",
    "modify plan layout",
    "how do I change meals",
    "πως αλλάζω τη δομή του πλάνου"
  ],
  "entities": [
    "plan",
    "structure"
  ],
  "actions": [
    "change",
    "edit"
  ],
  "roles": [
    "nutritionist"
  ],
  "routes": [
    "/admin/plans/*"
  ]
}
```

Retrieval ranking can combine:

```text
semantic similarity
+
current route
+
user role
+
permissions
+
feature flags
+
workflow availability
```

Then the verified workflow is loaded.

---

# 22. Runtime Experience

A user asks:

> How do I change the structure of a plan?

The system returns:

```text
To change the plan structure:

1. Open the client's plan.
2. Open Structure.
3. Choose the desired structure.
4. Save the plan.

[Go there]
[Show me]
```

## Explain

Displays deterministic instructions derived from the workflow.

## Go There

Navigates directly to the workflow entry point.

## Show Me

Starts the executable workflow.

---

# 23. Runtime Guide Engine

The guide engine executes states, not slides.

Example:

```text
state: PLAN_EDITOR

required action:
click plan.structure

expected:
STRUCTURE_PANEL_OPEN
```

When the state changes:

```text
STRUCTURE_PANEL_OPEN
      ↓
next workflow step
```

A workflow stops when a terminal condition is reached.

Example:

```yaml
terminal:
  any:
    - event: plan.structure.updated
    - toast: "Structure updated"
```

The LLM does not decide when the process is finished.

The workflow definition does.

---

# 24. The Self-Maintaining Loop

This is the most important long-term feature.

Once the repository has been indexed, every new PR or commit enters the maintenance pipeline.

```text
Commit / PR
    ↓
Diff
    ↓
Changed graph nodes
    ↓
Affected capabilities
    ↓
Affected workflows
    ↓
No impact / Update / New workflow / Obsolete workflow
```

---

# 25. Incremental Update Example

Existing workflow:

```text
Create Appointment

Appointments
→ New Appointment
→ Date
→ Time
→ Save
```

New PR:

```text
"Merge appointment date and time into new scheduler"
```

Changed:

```text
AppointmentModal.tsx
Scheduler.tsx
appointment schema
```

Impact engine finds:

```text
appointments.create       HIGH
appointments.reschedule   MEDIUM
appointments.cancel       LOW
```

The system proposes:

```text
OLD

Date
 ↓
Time
 ↓
Save


NEW

Date & Time
 ↓
Confirmation
 ↓
Save
```

Reviewer receives:

> Workflow `appointments.create` may be stale.

Actions:

```text
Accept proposed update
Edit
Ignore
```

---

# 26. New Workflow Detection

A commit introduces:

```text
"Allow dietitians to duplicate an existing nutrition plan"
```

Code adds:

```text
DuplicatePlanButton
POST /plans/:id/duplicate
DuplicatePlanDialog
```

No existing workflow maps to the capability.

The system proposes:

```text
NEW CAPABILITY DETECTED

plans.duplicate

Potential workflow:
1. Open a plan
2. Select Duplicate
3. Choose destination client
4. Confirm
5. New plan is created
```

This becomes a pending workflow for review.

---

# 27. Workflow Deletion / Deprecation

A feature may disappear.

If current code no longer supports a workflow:

```text
workflow:
clients.archive

supporting targets:
0

supporting API:
removed

replacement:
clients.deactivate
```

System proposes:

```text
Deprecate clients.archive

Suggested replacement:
clients.deactivate
```

Approved removal updates the index automatically.

---

# 28. Temporal Product Graph

The graph should retain versions.

Conceptually:

```text
GRAPH @ commit A
     ↓
GRAPH @ commit B
     ↓
GRAPH @ commit C
```

Workflows record:

```yaml
created_at_commit: A
updated_at_commit: B
verified_at_commit: C
```

This allows queries such as:

```text
Which workflows changed in release 4.3?

Which workflows depend on ClientForm?

Which guides have not been verified since the last 50 commits?

Which product processes changed most frequently?

Which workflows may be stale?
```

This is valuable far beyond end-user help.

---

# 29. Product Integration Model

The product should **not depend on Claude Code, Codex, Cursor, or another coding-agent harness**.

Those systems change.

The canonical integration should be:

```text
Git provider
+
repository
+
CI events
+
runtime SDK
```

Agent integrations can be added later.

---

# 30. Recommended Packaging

Use a hybrid architecture with four components.

## A. GitHub App

Primary integration.

Responsibilities:

- repository authorization;
- repository metadata;
- pull request events;
- push events;
- commit metadata;
- PR descriptions;
- checks/status reporting;
- installation management.

The developer experience:

```text
1. Sign up
2. Install GitHub App
3. Select repositories
4. Run initial scan
5. Review generated product map
```

No manual webhook configuration should be required.

---

## B. CLI

Example:

```bash
npx productflow init
npx productflow scan
npx productflow validate
npx productflow dev
```

Responsibilities:

- initialize configuration;
- perform local scans;
- generate semantic anchors;
- validate workflows;
- inspect output;
- run entirely locally when desired.

Example generated files:

```text
.productflow/
  config.yaml
  workflows/
  glossary.yaml
```

---

## C. GitHub Action / CI Runner

For teams that do not want source code uploaded to a SaaS.

Example:

```yaml
name: Product Workflow Analysis

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  productflow:
    uses: company/productflow-action@v1
```

The action can:

```text
checkout repository
      ↓
run scanner locally
      ↓
extract sanitized graph delta
      ↓
send IR / metadata to control plane
```

This provides a privacy-preserving option.

---

## D. Runtime SDK

Examples:

```bash
npm install @productflow/react
```

or:

```bash
npm install @productflow/next
```

Responsibilities:

- semantic target registration;
- current route/context;
- feature flags;
- user role;
- guide rendering;
- navigation;
- runtime workflow execution.

Example:

```tsx
<ProductFlowProvider
  userRole={session.role}
  featureFlags={flags}
>
  <Application />
</ProductFlowProvider>
```

Target:

```tsx
<WorkflowTarget id="clients.create">
  <Button>Add Client</Button>
</WorkflowTarget>
```

---

# 31. The Best Developer Integration Experience

Ideal onboarding:

```bash
npx productflow init
```

The CLI inspects the project and creates:

```yaml
# productflow.yaml

version: 1

project:
  name: My SaaS

repository:
  default_branch: main

framework:
  auto_detect: true

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
  pull_requests: true
  docs: true

runtime:
  adapter: nextjs

workflow:
  auto_propose: true
  auto_merge: false
  minimum_confidence: 0.80

review:
  required_for:
    - new_workflow
    - breaking_workflow_change

privacy:
  mode: local-analysis
```

Then:

```bash
npx productflow scan
```

Result:

```text
Detected Next.js
Detected Prisma
Detected Playwright

147 product surfaces
63 capabilities
41 candidate workflows

32 high confidence
7 medium confidence
2 need review

Open:
https://app.productflow.dev/project/...
```

---

# 32. Product Configuration

A generic product needs a small configuration layer because business semantics cannot always be inferred.

Recommended files:

```text
productflow.yaml
.productflow/
    glossary.yaml
    domains.yaml
    workflows/
```

---

## 32.1 Product glossary

```yaml
terms:
  client:
    aliases:
      - patient
      - customer

  nutrition_plan:
    aliases:
      - meal plan
      - diet plan
```

This improves semantic consistency.

---

## 32.2 Domain overrides

```yaml
domains:
  clients:
    routes:
      - /admin/clients/**
    code:
      - src/features/clients/**
```

These are hints, not mandatory definitions.

---

## 32.3 Role configuration

```yaml
roles:
  nutritionist:
    aliases:
      - admin
      - practitioner

  client:
    aliases:
      - patient
```

---

## 32.4 Excluded processes

Some internal actions should never become user guides.

```yaml
exclude:
  workflows:
    - internal.admin.*
    - debug.*
```

---

# 33. Cloud vs Local Execution

This will matter commercially because companies are sensitive about source code.

Support three deployment modes.

## Mode 1 — Hosted

```text
GitHub App
   ↓
short-lived repository access
   ↓
cloud scanner
   ↓
cloud graph
```

Best developer experience.

---

## Mode 2 — Local Scanner + Cloud Control Plane

```text
GitHub Action / self-hosted runner
       ↓
scan code locally
       ↓
send structured IR only
       ↓
cloud review / indexing
```

Strong privacy story.

---

## Mode 3 — Fully Self-Hosted

Enterprise option.

```text
scanner
graph
models
review UI
workflow service
```

run inside customer infrastructure.

---

# 34. Why GitHub App Should Be the Primary Product Integration

A GitHub App naturally receives repository events such as pushes and pull requests.

This allows:

```text
developer merges code
       ↓
GitHub sends event
       ↓
workflow system analyzes delta
       ↓
affected workflows identified
       ↓
check appears on PR
```

The result could appear as a GitHub check:

```text
Product Workflow Check

✓ 17 workflows unaffected
⚠ 2 workflows may require updates
+ 1 new product capability detected
```

This makes maintenance part of the normal engineering lifecycle.

---

# 35. PR Review Experience

Example PR:

```text
PR #1182
"Allow user to duplicate nutrition plan"
```

Product Workflow Check:

```text
NEW CAPABILITY
plans.duplicate

Evidence:
+ DuplicatePlanButton.tsx
+ POST /plans/:id/duplicate
+ duplicate-plan.spec.ts

Suggested workflow:
Open plan
→ Duplicate
→ Select client
→ Confirm
→ Plan created

[Review workflow]
```

Another PR:

```text
IMPACTED WORKFLOW
plans.change_structure

Step 2 target changed.

OLD
plan.structure.menu

NEW
plan.editor.structure

Confidence: 95%

[Accept]
[Edit]
```

---

# 36. Should Workflow Changes Be Automatically Accepted?

Normally, no.

Recommended policy:

## Auto-accept

Only very safe changes:

```text
text copy changed
file renamed
component moved
semantic target unchanged
```

## Require review

```text
step added
step removed
new branch
terminal condition changed
permission changed
feature removed
new workflow detected
```

Enterprise teams can configure their own thresholds.

---

# 37. Repository as the Workflow Source of Truth

Strong recommendation:

**Approved workflow specifications should be committed to the repository.**

Example:

```text
.productflow/
  workflows/
    clients.create.yaml
    plans.create.yaml
    plans.change-structure.yaml
```

The platform database stores:

```text
graph
historical snapshots
review activity
analytics
derived search indexes
```

But the executable workflow specification remains portable.

Benefits:

- workflow changes appear in PRs;
- developers can inspect them;
- workflows version with code;
- easy rollback;
- no hidden SaaS-only truth;
- better trust.

---

# 38. Framework Adapters

Do not try to support every framework on day one.

Build an adapter interface.

Example:

```ts
interface FrameworkAdapter {
  detect(): DetectionResult
  extractRoutes(): Route[]
  extractUIActions(): UIAction[]
  extractStateTransitions(): Transition[]
  extractApiCalls(): ApiCall[]
  extractPermissions(): Permission[]
}
```

First target:

```text
Next.js + React + TypeScript
```

Then:

```text
React SPA
Vue / Nuxt
Django
Rails
Laravel
```

---

# 39. Git Provider Adapters

Similarly:

```ts
interface GitProvider {
  getRepository()
  getCommit()
  getDiff()
  getPullRequest()
  getPullRequestComments()
  createCheck()
}
```

Start:

```text
GitHub
```

Later:

```text
GitLab
Bitbucket
Azure DevOps
```

---

# 40. Agent / Harness Integration

Agent integration should be optional.

Expose the platform as:

```text
CLI
REST API
SDK
MCP server
```

Possible MCP tools:

```text
productflow.list_workflows
productflow.get_workflow
productflow.get_impacted_workflows
productflow.explain_capability
productflow.validate_change
productflow.propose_workflow
```

Then Claude Code, Codex, Cursor or another agent can consume the same platform.

But this is **not the core repository integration**.

The repository and Git events remain the source.

---

# 41. Potential Repository Structure for the Product

```text
productflow/
│
├── packages/
│   ├── graph-core/
│   ├── workflow-ir/
│   ├── workflow-compiler/
│   ├── workflow-runtime/
│   ├── semantic-engine/
│   │
│   ├── adapter-nextjs/
│   ├── adapter-react/
│   ├── adapter-github/
│   │
│   ├── sdk-react/
│   ├── sdk-next/
│   └── cli/
│
├── services/
│   ├── control-plane/
│   ├── ingestion-worker/
│   ├── semantic-worker/
│   ├── webhook-service/
│   └── index-service/
│
├── apps/
│   └── dashboard/
│
├── action/
│   └── github-action/
│
└── docs/
```

A monorepo is a reasonable starting structure.

---

# 42. Control Plane

The SaaS dashboard is the control plane.

It should show:

```text
PRODUCT MAP
WORKFLOWS
PENDING CHANGES
REPOSITORY HISTORY
VALIDATION
ANALYTICS
SETTINGS
```

---

## Product Map

Visual graph of:

```text
domains
capabilities
workflows
product surfaces
```

---

## Pending Changes

```text
2 workflows impacted by PR #331
1 possible new capability
3 low-confidence mappings
```

---

## Workflow Editor

State-machine style editing.

---

## Evidence View

For each step:

```text
Code
Tests
PR
Commit
Runtime target
```

---

# 43. The Runtime Is a Separate Product Surface

The compiler should be useful even if the customer never installs the in-app guide.

Possible outputs:

```text
Workflow documentation
Support-agent answers
Onboarding checklists
Help center
QA test generation
Process analytics
Agent actions
```

Therefore separate:

```text
Product Knowledge Platform
```

from:

```text
In-App Guidance SDK
```

The SDK is one consumer of the workflow artifacts.

This makes the platform more general.

---

# 44. Feedback Loop From Real Users

Later, add a runtime feedback source.

Example unmatched queries:

```text
"How do I ..."
```

If no workflow is found:

```text
log unmatched intent
cluster questions
map to product graph
```

Dashboard:

```text
Users asked 47 times:
"How do I bulk import clients?"

No workflow exists.

Possible code capability detected:
clients.import_csv

[Generate workflow]
```

Now support demand helps prioritize workflow generation.

---

# 45. Workflow Analytics

Because the guide engine knows steps and states, the platform can measure:

```text
workflow started
step reached
step failed
workflow abandoned
workflow completed
```

Example:

```text
Create Client

Started        1,392
Completed      1,221
Completion     87.7%

Highest failure:
Step 3 - Select client language
```

This turns guidance into product UX intelligence.

---

# 46. Long-Term Evolution Toward Agents

The same workflow specification can power increasing levels of assistance.

## Level 1 — Explain

```text
Here are the steps.
```

## Level 2 — Navigate

```text
Take me to the correct page.
```

## Level 3 — Guide

```text
Show me what to click.
```

## Level 4 — Assist

```text
Pre-fill safe fields while the user remains in control.
```

## Level 5 — Execute

```text
Do the workflow for me.
```

Consequential operations should require explicit user confirmation.

This means the workflow compiler can eventually become an execution substrate for product agents.

---

# 47. MVP Strategy

Do not begin by building a universal repository-understanding platform.

Use one real application as the proving ground.

Recommended first scope:

```text
Framework:
Next.js + React + TypeScript

Git provider:
GitHub

Tests:
Playwright

Runtime:
React SDK

Graph:
one graph implementation

Workflow IR:
YAML

Review:
simple web editor
```

---

# 48. MVP Phase 0 — Manual Runtime Validation

Before automation, validate that executable guided workflows are useful.

Build:

```text
20–30 manually curated workflows
workflow selector
runtime guide engine
semantic targets
```

Measure:

```text
support question reduction
guide starts
completion rate
failed steps
unmatched questions
```

This validates the user-facing value.

---

# 49. MVP Phase 1 — Automatic Repository Understanding

Build:

```text
Next.js parser
route extraction
component graph
action extraction
API mapping
test mining
```

Generate:

```text
Product Surface Graph
```

No automatic workflows yet.

Validate graph quality manually.

---

# 50. MVP Phase 2 — Workflow Discovery

Generate candidate workflows from:

```text
product graph
+
Playwright
+
PRs
+
commit history
```

Human approves all generated workflows.

Target:

```text
70–80% of common workflows correctly discovered
```

before trying to reduce review.

---

# 51. MVP Phase 3 — Incremental Maintenance

This is where the product becomes special.

Implement:

```text
GitHub webhook
diff analysis
affected graph nodes
affected workflows
workflow update proposals
GitHub Check
```

Target:

> A team should no longer manually audit its support guides after every release.

---

# 52. MVP Phase 4 — Generic SDK + CLI

Extract application-specific code into:

```text
@productflow/runtime
@productflow/next
productflow CLI
```

Create a second test application.

If the architecture works for two unrelated products, abstraction is becoming real.

---

# 53. MVP Phase 5 — SaaS Product

Build:

```text
GitHub App
Dashboard
Workflow review UI
Team accounts
Analytics
Hosted index
Billing
```

---

# 54. Technical Moat

The moat is not:

```text
knowledge graph
LLM
tooltips
driver.js
chatbot
embeddings
```

All of those are replaceable primitives.

Potential moat:

### 1. Multi-source workflow inference

Correctly understanding:

```text
code + tests + commits + PRs + docs
```

as product semantics.

### 2. Workflow provenance

Knowing why every process step exists.

### 3. Incremental impact engine

Determining which workflows changed after every code change.

### 4. Workflow IR

A strong framework-independent representation.

### 5. Validation system

Knowing whether a generated workflow actually works.

### 6. Historical product process graph

Understanding how user-facing processes evolve over time.

### 7. Dataset

Over time:

```text
code changes
→ business process changes
→ human accepted / rejected proposals
```

becomes an extremely useful proprietary training/evaluation dataset.

---

# 55. Key Product Principle

The product should optimize for:

> **Correctness and maintainability of product knowledge**

rather than:

> **maximum autonomous generation.**

A proposal that says:

```text
"I am 73% confident this commit changed workflow X"
```

and asks for review is more useful than confidently publishing a wrong guide.

---

# 56. Suggested Initial Tech Stack

This is illustrative, not mandatory.

## Parser / analysis

```text
TypeScript
tree-sitter
TypeScript Compiler API
```

## Semantic workers

```text
Python or TypeScript
LLM structured outputs
```

## Graph storage

Initial:

```text
Postgres
```

with explicit node/edge tables may be sufficient.

Later:

```text
Neo4j / Memgraph / another graph store
```

only if traversal complexity justifies it.

Do not introduce a graph database merely because the conceptual model is a graph.

---

## Workflow artifacts

```text
YAML / JSON
Git
```

## Search

Initial:

```text
Postgres full-text + embeddings
```

## Queues

```text
SQS / Redis / equivalent
```

## Dashboard

```text
Next.js / React
```

## Runtime SDK

```text
TypeScript
React
```

---

# 57. Security Requirements

A code-analysis product must treat source code as highly sensitive.

Minimum requirements:

- least-privilege GitHub App permissions;
- short-lived installation tokens;
- encrypted storage;
- repository-level isolation;
- audit logs;
- configurable retention;
- no model training on customer source code by default;
- local-analysis mode;
- ability to exclude paths;
- secret detection before sending context to models;
- self-hosted option for enterprise.

---

# 58. GitHub Event Flow

Recommended production flow:

```text
GitHub
  │
  │ webhook
  ▼
Webhook Service
  │
  │ verify signature
  │ deduplicate delivery
  ▼
Queue
  ▼
Repository Worker
  │
  ├─ fetch diff
  ├─ fetch PR metadata
  ├─ update graph
  ├─ compute impact
  └─ generate proposals
  ▼
Workflow Validator
  ▼
Control Plane
  │
  └─ GitHub Check / Dashboard Review
```

The webhook handler itself should return quickly and put work on a queue.

---

# 59. Example End-to-End Lifecycle

## Day 1

Developer installs the GitHub App.

```text
Initial scan
→ 52 candidate workflows
→ team approves 38
```

Approved workflows are committed:

```text
.productflow/workflows/
```

---

## Day 8

Developer merges:

```text
PR #442
"Move client invitation into client profile header"
```

System:

```text
changed nodes
→ InviteClientButton
→ ClientProfileHeader

affected workflow
→ clients.invite
```

Proposal:

```text
Workflow clients.invite
Step 1 target moved.

No semantic behavior change.

Confidence: 99%

Auto-update allowed.
```

Workflow updates automatically.

---

## Day 11

Developer merges:

```text
PR #451
"Add bulk client import"
```

System:

```text
new action
new route
new API
new E2E test

No existing capability mapping.
```

Proposal:

```text
NEW WORKFLOW
clients.bulk_import
```

Human reviews.

Approved.

Runtime help now answers:

> How do I import multiple clients?

without anyone manually updating the help center.

That is the core product promise.

---

# 60. Final Product Architecture

```text
                         ┌────────────────┐
                         │    GitHub      │
                         └───────┬────────┘
                                 │
                             GitHub App
                                 │
                                 ▼
                         ┌────────────────┐
                         │ Event Ingestion│
                         └───────┬────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │ Repository Analyzer    │
                    │                        │
                    │ Code                   │
                    │ Tests                  │
                    │ Commits                │
                    │ PRs                    │
                    │ Docs                   │
                    └────────────┬───────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │ Product Graph          │
                    └────────────┬───────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │ Workflow Discovery     │
                    └────────────┬───────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │ Validation / Critic    │
                    └────────────┬───────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │ Human Review           │
                    └────────────┬───────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │ Workflow Compiler      │
                    └───────┬────────┬───────┘
                            │        │
                    ┌───────┘        └──────────────┐
                    ▼                               ▼
              Workflow Index                Runtime Manifest
                    │                               │
                    ▼                               ▼
              AI Assistant                   Product SDK
                    │                               │
                    └───────────┬───────────────────┘
                                ▼
                  Explain │ Go There │ Show Me
```

---

# 61. Recommended Product Form

The strongest form of this idea is **not simply a GitHub repository that developers manually import**.

It should become a product with:

### Open / portable layer

```text
Workflow IR schema
CLI
runtime SDK
framework adapters
possibly core scanner components
```

### Hosted platform

```text
GitHub App
repository analysis workers
graph storage
semantic processing
workflow review
impact analysis
analytics
team collaboration
```

### Enterprise layer

```text
self-hosted scanner
private control plane
SSO
audit / policy
custom adapters
```

This model provides developer trust while preserving a valuable SaaS product.

---

# 62. The Simplest Possible Integration Story

For the customer:

```text
1. Install GitHub App.
2. Select repository.
3. Run initial scan.
4. Review discovered workflows.
5. Install the runtime SDK if in-app guidance is desired.
6. Merge normally.
```

From then on:

```text
Every commit / PR
       ↓
automatically checked
       ↓
workflows remain synchronized
```

The developer should **not** need to remember to update documentation or tours manually.

That is the product.

---

# 63. North-Star Promise

> **Whenever your product changes, its executable product knowledge changes with it.**

The long-term system knows:

```text
what the product can do;
how users accomplish each task;
where each step exists in the UI;
what code implements it;
why the capability exists;
when it changed;
which workflows were affected;
whether the workflow has been verified;
and how to guide or eventually assist a user through it.
```

That is much broader than an AI help widget.

It is a versioned, executable representation of how a software product works.

---

# 64. Immediate Build Order

If starting now:

1. Finalize the Workflow IR.
2. Keep the existing manually authored runtime guides as ground truth examples.
3. Add stable semantic UI targets.
4. Build the Next.js/React static analyzer.
5. Mine existing E2E tests.
6. Add Git commit/PR evidence extraction.
7. Generate the Product Surface Graph.
8. Generate candidate capabilities.
9. Generate candidate workflows.
10. Build the evidence-aware reviewer.
11. Validate workflows in browser tests.
12. Compile approved workflows into the current guide catalog.
13. Add GitHub webhook processing.
14. Add incremental graph updates.
15. Add impacted-workflow detection.
16. Add GitHub Checks.
17. Extract generic CLI/SDK packages.
18. Test on a second unrelated application.
19. Build the hosted control plane.
20. Add additional framework adapters only after the abstraction survives real use.

---

# 65. Final Principle

The product is not:

> "AI that reads your code and writes documentation."

It is:

> **A continuously synchronized, evidence-backed compiler from software implementation to executable business processes.**

And the workflow artifacts, not the graph itself, are the stable contract between:

```text
engineering
product
support
documentation
onboarding
AI assistants
in-app guidance
QA
and future software agents.
```


---

# 66. The Final Product Output: A Headless Product Workflow Layer

The final output of the platform should **not** be:

- a graph;
- a Markdown document;
- a chatbot UI;
- HTML;
- a single opinionated walkthrough component.

Those are possible consumers or renderers.

The actual final product should be a **headless, executable product workflow layer** that exposes verified product knowledge through stable machine-readable contracts.

The platform should compile repository knowledge into:

```text
Repository
   ↓
Harness
   ↓
Product Graph
   ↓
Business Processes
   ↓
Workflow IR
   ↓
Workflow Registry
   ↓
Runtime APIs / SDK / MCP
   ↓
Developer-owned rendering
```

The key principle is:

> **We own the product knowledge and workflow semantics. The developer owns how that knowledge is rendered and experienced.**

This makes the platform usable across:

- AI assistants;
- support agents;
- command palettes;
- help centers;
- onboarding flows;
- sidebars;
- in-app walkthroughs;
- developer tools;
- autonomous agents;
- internal operations software.

---

# 67. The Product Should Be Headless-First

The platform should behave similarly to other successful developer infrastructure products:

```text
Structured capability
        ↓
API / SDK contract
        ↓
Developer chooses presentation
```

The platform should not force:

```text
our chat widget
our card style
our design system
our LLM
our agent framework
```

Instead, the developer should be able to consume the same verified workflow artifact from any environment.

Conceptually:

```text
                     PRODUCT WORKFLOW PLATFORM
                              │
               ┌──────────────┼──────────────┐
               │              │              │
              REST           SDK            MCP
               │              │              │
               ▼              ▼              ▼
         Custom Backend   Product UI      AI Agent
               │              │              │
               └──────────────┼──────────────┘
                              ▼
                  Developer-controlled UX
```

---

# 68. The Canonical Runtime Result

The runtime resolver should return a structured result rather than pre-rendered UI.

Example:

```json
{
  "type": "workflow_help",
  "workflow_id": "clients.create",
  "version": "7",
  "confidence": 0.97,

  "intent": {
    "action": "create",
    "entity": "client"
  },

  "content": {
    "title": "Create a client",
    "summary": "Create a new client from the Clients area.",
    "steps": [
      {
        "id": "open_clients",
        "text": "Open Clients."
      },
      {
        "id": "start_create",
        "text": "Select Add Client."
      },
      {
        "id": "complete_form",
        "text": "Complete the client information."
      },
      {
        "id": "save",
        "text": "Save the client."
      }
    ]
  },

  "entrypoint": {
    "route": "/admin/clients"
  },

  "capabilities": {
    "explain": true,
    "navigate": true,
    "guide": true,
    "checklist": true,
    "execute": false
  },

  "workflow_ref": {
    "id": "clients.create",
    "runtime_manifest": "/runtime/workflows/clients.create@7"
  }
}
```

This becomes the universal contract between:

```text
Product knowledge
      ↕
Developer application
```

The response should describe **what is possible**, not dictate exactly which button the developer must render.

---

# 69. Capabilities Instead of UI Assumptions

Avoid returning UI-specific assumptions such as:

```json
{
  "button": "Show me"
}
```

Prefer:

```json
{
  "capabilities": {
    "explain": true,
    "navigate": true,
    "guide": true,
    "execute": false
  }
}
```

A renderer can decide:

```text
guide = true
      ↓
render "Show me"
```

or:

```text
guide = true
      ↓
show icon
```

or:

```text
guide = true
      ↓
start walkthrough automatically
```

The core system should not care.

---

# 70. The Rendering Contract

The platform should explicitly separate:

```text
Workflow semantics
        ↓
Presentation contract
        ↓
Renderer
```

Example:

```json
{
  "workflow_id": "clients.create",

  "presentation": {
    "supported_modes": [
      "text",
      "card",
      "navigate",
      "walkthrough",
      "checklist"
    ]
  }
}
```

The developer can use:

```text
text only
custom React components
our React components
mobile UI
CLI rendering
voice
Slack
support dashboard
```

without changing the underlying workflow.

---

# 71. Rendering Mode 1 — Plain Explanation

The simplest integration:

```ts
const result = await productFlow.resolve({
  query: "How do I create a client?"
});

console.log(result.content.steps);
```

Possible UI:

```text
To create a client:

1. Open Clients.
2. Select Add Client.
3. Complete the client information.
4. Save.
```

No runtime guide engine is required.

This mode is ideal for:

- help centers;
- plain chat assistants;
- support tools;
- mobile apps where overlays are not available.

---

# 72. Rendering Mode 2 — Custom Help Card

Example React integration:

```tsx
const help = await productFlow.resolve({
  query,
  context: {
    route: pathname,
    role: session.role
  }
});

return (
  <MyHelpCard>
    <h3>{help.content.title}</h3>

    {help.content.steps.map(step => (
      <p key={step.id}>{step.text}</p>
    ))}

    {help.capabilities.navigate && (
      <MyButton onClick={() => navigate(help.entrypoint.route)}>
        Take me there
      </MyButton>
    )}

    {help.capabilities.guide && (
      <MyButton onClick={() => startGuide(help.workflow_id)}>
        Show me
      </MyButton>
    )}
  </MyHelpCard>
);
```

The developer owns:

```text
layout
colors
copy treatment
buttons
design system
placement
```

The platform owns:

```text
workflow correctness
workflow identity
workflow availability
runtime targets
completion rules
```

---

# 73. Rendering Mode 3 — Interactive Walkthrough

For applications that install the runtime SDK:

```ts
productFlow.guides.start("clients.create");
```

The runtime loads the compiled workflow manifest:

```json
{
  "id": "clients.create",
  "steps": [
    {
      "target": "clients.create",
      "action": "click",
      "advance": {
        "on": "state",
        "state": "client_form_open"
      }
    },
    {
      "target": "client.form.name",
      "action": "input"
    },
    {
      "target": "client.form.submit",
      "action": "click",
      "advance": {
        "on": "event",
        "event": "client.created"
      }
    }
  ]
}
```

The SDK is responsible for:

- locating semantic targets;
- highlighting targets;
- routing between pages;
- waiting for state transitions;
- handling pauses;
- detecting completion;
- falling back when the target cannot be found.

The runtime should execute a **state-aware workflow**, not a simple tooltip slideshow.

---

# 74. Rendering Mode 4 — Checklist / Onboarding

The same workflow can be rendered as:

```text
Create a client

✓ Open Clients
● Complete client information
○ Save
```

Or multiple workflows can be combined into an onboarding sequence:

```text
Getting Started

✓ Create first client
✓ Create first plan
○ Send first questionnaire
○ Connect calendar
```

The product can expose progress through a headless hook:

```ts
const progress = useWorkflowProgress("clients.create");
```

The customer decides how progress is displayed.

---

# 75. Rendering Mode 5 — AI Assistant Integration

The platform should integrate cleanly with an existing assistant.

The customer's assistant does not need the workflow catalog inside its prompt.

Instead, it receives a tool:

```text
resolve_product_help
```

Possible schema:

```json
{
  "name": "resolve_product_help",
  "description": "Find the verified workflow for a user asking how to perform a task in the product.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string"
      },
      "current_route": {
        "type": "string"
      },
      "user_role": {
        "type": "string"
      },
      "locale": {
        "type": "string"
      }
    },
    "required": [
      "query"
    ]
  }
}
```

The AI assistant can then call:

```text
resolve_product_help(
  query="How do I invite a client?",
  current_route="/admin/clients/123",
  user_role="nutritionist",
  locale="en"
)
```

And receive:

```json
{
  "workflow_id": "clients.invite",
  "confidence": 0.98,
  "content": {
    "title": "Invite client",
    "steps": [
      "Open the client profile.",
      "Select Invite Client.",
      "Confirm the invitation."
    ]
  },
  "capabilities": {
    "navigate": true,
    "guide": true,
    "execute": false
  }
}
```

The assistant can produce a natural-language answer while the frontend separately renders actions.

This means the platform works with:

- OpenAI;
- Anthropic;
- custom agent stacks;
- LangChain;
- LlamaIndex;
- internal orchestration systems;
- any future LLM provider.

---

# 76. Tool Calling Should Be Provider-Agnostic

Do not build the product around one provider's tool format.

Internally define a provider-neutral operation:

```ts
type ProductHelpRequest = {
  query: string;
  currentRoute?: string;
  userRole?: string;
  locale?: string;
  featureFlags?: Record<string, boolean>;
};
```

Then provide adapters:

```text
OpenAI tool schema
Anthropic tool schema
LangChain Tool
Python function
REST endpoint
MCP tool
```

The core resolver remains the same.

---

# 77. MCP Integration

MCP is a natural integration surface for agentic applications.

Expose a Product Workflow MCP server.

Suggested tools:

```text
productflow.resolve_help
productflow.search_workflows
productflow.get_workflow
productflow.get_related_workflows
productflow.get_workflow_status
productflow.get_entrypoint
productflow.get_supported_actions
```

Development/admin tools may additionally expose:

```text
productflow.get_impacted_workflows
productflow.get_change_evidence
productflow.validate_workflow
productflow.propose_workflow
```

Possible MCP interaction:

```text
AI Agent
   │
   │ MCP
   ▼
Product Workflow Server
   │
   ├── workflow search
   ├── workflow retrieval
   └── current product context
```

This makes the platform easy to use with any assistant or agent ecosystem that supports MCP.

---

# 78. MCP Should Not Replace the Core API

MCP is an adapter, not the internal architecture.

Use:

```text
Core Runtime Service
       │
       ├── REST
       ├── SDK
       ├── MCP
       ├── Tool adapters
       └── Webhooks
```

This prevents the platform from becoming dependent on the evolution of MCP itself.

---

# 79. REST API

A generic REST interface should always exist.

Example:

```http
POST /v1/help/resolve
```

Request:

```json
{
  "query": "How do I change the structure of a plan?",
  "context": {
    "route": "/admin/client/42/plans/8",
    "role": "nutritionist",
    "locale": "en",
    "feature_flags": {
      "new_plan_editor": true
    }
  }
}
```

Response:

```json
{
  "workflow_id": "plans.change_structure",
  "confidence": 0.96,
  "version": 12,
  "content": {
    "title": "Change plan structure",
    "steps": []
  },
  "capabilities": {
    "explain": true,
    "navigate": true,
    "guide": true,
    "checklist": true,
    "execute": false
  }
}
```

Additional endpoints:

```text
GET /v1/workflows/:id
POST /v1/workflows/search
GET /v1/workflows/:id/runtime
GET /v1/workflows/:id/related
GET /v1/project/capabilities
```

---

# 80. JavaScript / TypeScript SDK

Recommended developer experience:

```bash
npm install @productflow/sdk
```

Example:

```ts
import { ProductFlow } from "@productflow/sdk";

const productFlow = new ProductFlow({
  projectId: "proj_xxx",
  publicKey: process.env.NEXT_PUBLIC_PRODUCTFLOW_KEY
});
```

Resolve:

```ts
const result = await productFlow.resolve({
  query: "How do I change a plan structure?",
  context: {
    route: pathname,
    role: session.role
  }
});
```

Search:

```ts
const workflows = await productFlow.workflows.search(
  "change structure"
);
```

Retrieve:

```ts
const workflow = await productFlow.workflows.get(
  "plans.change_structure"
);
```

Navigate:

```ts
productFlow.navigate("plans.change_structure");
```

Guide:

```ts
productFlow.guides.start("plans.change_structure");
```

Progress:

```ts
productFlow.guides.getProgress("plans.change_structure");
```

---

# 81. Python SDK

Backend-heavy products may prefer:

```bash
pip install productflow
```

Example:

```python
from productflow import ProductFlow

pf = ProductFlow(
    project_id="proj_xxx",
    api_key=os.environ["PRODUCTFLOW_API_KEY"]
)

result = pf.resolve(
    query="How do I create a client?",
    context={
        "role": "nutritionist",
        "locale": "en"
    }
)
```

This is useful for:

- Python assistants;
- FastAPI applications;
- support services;
- internal AI agents;
- backend orchestration.

---

# 82. React Runtime SDK

Separate runtime concerns from the general SDK.

Package:

```bash
npm install @productflow/react
```

Provider:

```tsx
<ProductFlowProvider
  projectId="proj_xxx"
  user={{
    role: session.role,
    id: session.user.id
  }}
  context={{
    featureFlags
  }}
>
  <Application />
</ProductFlowProvider>
```

Headless hooks:

```ts
useProductFlow()
useProductHelp()
useWorkflow()
useWorkflowProgress()
useGuideRuntime()
```

These hooks should return data and actions rather than forcing components.

Example:

```tsx
const {
  result,
  startGuide,
  navigate
} = useProductHelp(question);
```

---

# 83. Optional UI Package

Provide optional components for teams that want a fast integration.

Package:

```bash
npm install @productflow/ui
```

Possible components:

```tsx
<ProductHelpCard />
<ProductHelpPanel />
<ProductHelpChat />
<ProductChecklist />
<ProductGuideOverlay />
<ProductWorkflowSearch />
```

These should be:

- optional;
- themeable;
- accessible;
- unopinionated;
- replaceable.

A startup can use them immediately.

An enterprise can ignore them entirely.

---

# 84. Headless Components / Render Props

For flexibility, support render props or slot APIs.

Example:

```tsx
<ProductHelp
  query={question}
  render={({ result, startGuide, navigate }) => (
    <CompanyDesignSystemCard>
      <CompanyHeading>
        {result.content.title}
      </CompanyHeading>

      <CompanyButton
        onClick={() => startGuide(result.workflow_id)}
      >
        Show me
      </CompanyButton>
    </CompanyDesignSystemCard>
  )}
/>
```

This provides turnkey logic without imposing presentation.

---

# 85. Web Components as an Optional Compatibility Layer

For applications that are not React-based, the platform may eventually provide Web Components:

```html
<productflow-help-card
  workflow="clients.create">
</productflow-help-card>
```

or:

```html
<productflow-guide-runtime></productflow-guide-runtime>
```

This is useful for:

- Vue;
- Angular;
- legacy applications;
- server-rendered applications.

However, the core REST/SDK interface should remain the universal solution.

---

# 86. No-UI Integration

Some customers may want only product knowledge.

They should be able to use:

```text
REST
SDK
MCP
exports
```

without installing any frontend package.

Use cases:

```text
support agent
help center generation
internal documentation
QA
search
training
customer success
```

This broadens the market substantially.

---

# 87. Workflow Export Formats

Allow customers to export approved workflows.

Recommended formats:

```text
JSON
YAML
Markdown
OpenAPI-style schema
Mermaid
state-machine representation
```

Potential export:

```bash
productflow export \
  --format=json \
  --output=./generated/product-workflows.json
```

Or:

```bash
productflow export \
  --format=markdown \
  --output=./docs/product-help
```

Exports make the platform more trustworthy and portable.

---

# 88. Static Build-Time Export

Some teams will not want a runtime dependency on the SaaS.

Support:

```bash
productflow build
```

which creates:

```text
.productflow/generated/
  workflows.json
  search-index.json
  runtime-manifest.json
```

Their application can bundle these files directly.

This provides:

- zero runtime API dependency;
- lower latency;
- offline support;
- stronger privacy;
- deterministic deployment.

The SaaS remains useful for generation and maintenance.

---

# 89. Hosted Runtime vs Bundled Runtime

Support both.

## Hosted Runtime

```text
Application
   ↓
ProductFlow API
   ↓
latest approved workflow
```

Advantages:

- immediate updates;
- analytics;
- central configuration.

## Bundled Runtime

```text
CI
 ↓
productflow build
 ↓
workflow manifest bundled with app
```

Advantages:

- no external runtime dependency;
- strict release versioning.

Enterprise customers may strongly prefer bundled runtime.

---

# 90. Version Pinning

Developers must be able to pin workflows to product releases.

Example:

```ts
const pf = new ProductFlow({
  projectId: "proj_xxx",
  release: "2027.4.1"
});
```

or:

```yaml
runtime:
  workflow_version: git
```

This prevents:

```text
new workflow
+
old frontend deployment
=
broken guide
```

Workflow versions should be associated with:

```text
Git commit
release
deployment
```

---

# 91. Context Injection

Workflow resolution should support application context.

Example:

```json
{
  "route": "/admin/client/42",
  "role": "nutritionist",
  "permissions": [
    "clients.write"
  ],
  "feature_flags": {
    "new_client_flow": true
  },
  "locale": "el",
  "platform": "web"
}
```

This allows the same query to resolve differently depending on state.

Example:

```text
"How do I add a client?"
```

could map to different workflow versions if:

```text
new_client_flow = true
```

versus:

```text
new_client_flow = false
```

---

# 92. Runtime Adapter Interface

To make execution portable, define a runtime adapter interface.

Example:

```ts
interface ProductFlowRuntimeAdapter {
  getCurrentRoute(): string;

  navigate(route: string): Promise<void>;

  resolveTarget(
    semanticTarget: string
  ): Promise<HTMLElement | null>;

  getFeatureFlags(): Record<string, boolean>;

  getCurrentUserContext(): UserContext;

  subscribeToEvent(
    eventName: string,
    callback: () => void
  ): () => void;
}
```

Framework-specific packages implement this interface.

Examples:

```text
@productflow/next
@productflow/react-router
@productflow/vue
@productflow/angular
```

This keeps the workflow engine framework-independent.

---

# 93. Semantic Target API

Provide multiple ways to register targets.

## Attribute

```tsx
<Button data-productflow="clients.create">
  Add client
</Button>
```

## Wrapper

```tsx
<WorkflowTarget id="clients.create">
  <Button>Add client</Button>
</WorkflowTarget>
```

## Hook

```tsx
const target = useWorkflowTarget("clients.create");

<Button ref={target.ref}>
  Add client
</Button>
```

## Programmatic registration

```ts
productFlow.targets.register(
  "clients.create",
  element
);
```

Different codebases can choose the style that fits them.

---

# 94. Automatic Semantic Target Suggestions

Developers should not need to manually annotate every element.

During analysis, the system can infer:

```text
Button text
handler
component identity
test selector
route
API effect
```

and propose:

```text
Suggested semantic target:

clients.create

File:
src/features/clients/AddClientButton.tsx

[Apply patch]
```

The CLI can optionally write:

```tsx
data-productflow="clients.create"
```

into the repository.

This can be submitted as a PR.

---

# 95. Assistant Integration Patterns

Support several common patterns.

## Pattern A — Existing chatbot

```text
User
 ↓
Customer Assistant
 ↓ tool call
ProductFlow Resolve
 ↓
Structured workflow result
 ↓
Customer UI
```

## Pattern B — Existing agent

```text
Agent
 ↓ MCP
ProductFlow
 ↓
workflow knowledge
```

## Pattern C — No assistant

```text
Help button
 ↓
ProductFlow Search
 ↓
Custom help panel
```

## Pattern D — Search bar

```text
"What do you want to do?"
 ↓
Workflow Search
 ↓
Workflow result
```

## Pattern E — Command palette

```text
CMD+K
 ↓
Search product workflows
 ↓
Navigate / Guide
```

## Pattern F — Customer support dashboard

```text
Support ticket
 ↓
Search relevant workflow
 ↓
Agent sees verified resolution
```

---

# 96. AI Assistant Frontend Contract

For assistants, separate natural-language generation from executable UI actions.

Example backend result:

```json
{
  "assistant_content": {
    "title": "Create a client",
    "summary": "You can create a client from the Clients page."
  },

  "workflow": {
    "id": "clients.create",
    "version": 7
  },

  "available_actions": [
    {
      "type": "navigate",
      "entrypoint": "/admin/clients"
    },
    {
      "type": "guide",
      "workflow_id": "clients.create"
    }
  ]
}
```

The frontend might render:

```text
You can create a client from the Clients page.

[Take me there] [Show me]
```

But another application might render:

```text
Create client →
```

Both are valid.

---

# 97. Typed Action Model

Define a generic action schema.

Example:

```ts
type WorkflowAction =
  | {
      type: "navigate";
      route: string;
    }
  | {
      type: "guide";
      workflowId: string;
    }
  | {
      type: "checklist";
      workflowId: string;
    }
  | {
      type: "execute";
      workflowId: string;
      confirmationRequired: boolean;
    };
```

This enables developer-owned rendering while preserving behavior.

---

# 98. Future Agent Execution

Eventually the same workflow can expose execution capability.

Example:

```json
{
  "workflow_id": "appointments.create",

  "capabilities": {
    "explain": true,
    "navigate": true,
    "guide": true,
    "execute": true
  },

  "execution": {
    "confirmation_required": true,
    "required_inputs": [
      "client_id",
      "date",
      "time"
    ]
  }
}
```

The AI assistant can then say:

> I can also create the appointment for you.

Execution should be separated from guidance and governed by:

- authorization;
- permissions;
- confirmations;
- audit logs;
- policy rules.

---

# 99. Product APIs by Responsibility

A clean API model could expose four surfaces.

## Knowledge API

```text
search workflows
resolve question
get workflow
get related workflows
```

## Runtime API

```text
start workflow
get workflow manifest
progress
state
```

## Build API

```text
scan repository
propose workflows
validate workflows
compile workflows
```

## Change Intelligence API

```text
get impacted workflows
get changed capabilities
get evidence
get stale workflows
```

This separation makes the platform understandable.

---

# 100. Recommended Package Architecture

A clean package layout:

```text
packages/
│
├── core/
│   ├── workflow-types
│   ├── resolver
│   ├── context
│   └── capability-model
│
├── workflow-ir/
│
├── runtime-core/
│   ├── state-machine
│   ├── target-resolution
│   └── execution
│
├── sdk-js/
├── sdk-python/
│
├── react/
├── next/
├── vue/
│
├── ui/
│
├── mcp-server/
│
├── cli/
│
└── adapters/
```

The API boundaries should prevent framework-specific concerns from leaking into the workflow model.

---

# 101. Core Product Boundaries

The platform is responsible for:

```text
What task does the user mean?

Which verified workflow corresponds to it?

Which version applies to this product state?

Which roles and permissions can use it?

Where does it begin?

Which semantic targets are involved?

What state transitions prove progress?

When is it complete?

Which rendering / execution capabilities are available?
```

The customer is responsible for:

```text
Where should help appear?

How should it look?

Which design system should it use?

Should a button say "Show me" or something else?

Should the workflow appear in chat, sidebar, command palette or help center?
```

This is the key separation that makes the framework generic.

---

# 102. Recommended Integration Tiers

Offer clear tiers of integration complexity.

## Tier 1 — Knowledge Only

Customer uses:

```text
REST / SDK / MCP
```

They receive:

```text
workflow answers
steps
entrypoints
related workflows
```

No frontend integration required.

---

## Tier 2 — Navigation

Customer additionally installs routing integration.

They can use:

```text
Take me there
```

---

## Tier 3 — Guided UI

Customer registers semantic targets and installs runtime SDK.

They can use:

```text
Show me
```

---

## Tier 4 — Full Runtime

Customer adds:

```text
workflow progress
analytics
checklists
context
feature flags
```

---

## Tier 5 — Agent Execution

Customer explicitly enables executable actions.

The same workflow registry powers automation.

This tiering makes adoption gradual rather than all-or-nothing.

---

# 103. One-Line Integration for Simple Customers

For customers who do not care about customization, provide an opinionated integration:

```tsx
<ProductFlowAssistant />
```

Configuration:

```tsx
<ProductFlowAssistant
  projectId="proj_xxx"
/>
```

This can provide:

```text
search
AI help
cards
navigation
walkthrough
```

out of the box.

This should be a convenience layer built on the same headless APIs.

---

# 104. Deep Integration for Advanced Customers

Advanced companies can instead use:

```text
Core API
+
their own LLM
+
their own frontend
+
their own analytics
+
their own authorization
```

They might use only:

```ts
const result = await pf.resolve(...);
```

Everything after that belongs to them.

This should be a first-class supported path, not an escape hatch.

---

# 105. The Final Developer Experience

Ideal simple path:

```text
1. Install GitHub App.
2. Select repository.
3. Review discovered workflows.
4. Install SDK.
5. Connect existing assistant.
```

Assistant integration:

```ts
const help = await productFlow.resolve({
  query: userMessage,
  context: {
    route,
    role
  }
});
```

Rendering:

```tsx
<MyAssistantMessage>
  {help.content.summary}

  {help.capabilities.navigate && (
    <MyButton>Take me there</MyButton>
  )}

  {help.capabilities.guide && (
    <MyButton>Show me</MyButton>
  )}
</MyAssistantMessage>
```

That should be enough for a basic integration.

---

# 106. Example: Generic Assistant Integration

Assume a SaaS already has:

```text
User
 ↓
Assistant Backend
 ↓
LLM
 ↓
Frontend
```

Integration changes:

```text
User
 ↓
Assistant Backend
 ↓
LLM
 ├── normal tools
 └── ProductFlow tool
          ↓
       resolve()
          ↓
    workflow result
          ↓
LLM + frontend
```

No architectural rewrite is required.

---

# 107. Example: Agent With MCP

Existing architecture:

```text
Claude / OpenAI / internal agent
             ↓
            MCP
```

Add:

```text
ProductFlow MCP Server
```

Now the agent can ask:

```text
productflow.resolve_help
```

without any custom tool wrapper.

If the product also wants walkthroughs, the frontend separately installs the runtime SDK.

This cleanly separates:

```text
agent knowledge
```

from:

```text
browser interaction
```

---

# 108. Example: No AI at All

A company may not want an LLM.

They can implement:

```text
Help Search
    ↓
workflow search endpoint
    ↓
results
```

Example:

```text
Search:
"create client"

Results:
Create Client
Invite Client
Bulk Import Clients
```

Selecting a workflow provides:

```text
instructions
navigation
walkthrough
```

The product therefore remains useful without AI.

---

# 109. Example: Help Center Generation

A documentation system can call:

```text
GET approved workflows
```

and generate:

```text
Clients
 ├── Create Client
 ├── Invite Client
 └── Deactivate Client
```

Each workflow can produce Markdown.

After a product change:

```text
workflow changes
      ↓
docs build changes
```

No separate manual help center maintenance is required.

---

# 110. Example: Customer Support Agent

A support system can use:

```text
ticket text
   ↓
resolve_product_help
   ↓
verified workflow
```

The support agent sees:

```text
Likely workflow:
plans.change_structure

Confidence:
96%

Verified against:
release 4.7.1
```

This provides more trustworthy support than generic RAG over outdated documentation.

---

# 111. Example: Command Palette

A product can integrate:

```text
CMD + K
```

Search workflows:

```text
Create client
Change plan structure
Connect calendar
Export report
```

Actions:

```text
Enter = Navigate
Shift+Enter = Guide
```

The exact UX belongs to the customer.

---

# 112. Integration Configuration

The developer config should specify available integration surfaces.

Example:

```yaml
runtime:
  modes:
    - explain
    - navigate
    - guide

  renderer:
    mode: headless

  assistant:
    enabled: true

  mcp:
    enabled: true

  export:
    enabled: true

context:
  role_provider: custom
  feature_flags_provider: custom
```

The platform should have sensible defaults but never require unnecessary configuration.

---

# 113. Authentication Model

Separate server and browser credentials.

## Server

```text
secret API key
```

Can access:

```text
workflow search
private metadata
change intelligence
admin operations
```

## Browser

```text
public project key
+
signed user context
```

Can access only:

```text
approved runtime manifests
guide state
safe workflow metadata
```

Never expose repository or private analysis data in the browser.

---

# 114. Signed User Context

To prevent users from spoofing roles:

Server generates:

```json
{
  "user_id": "123",
  "role": "nutritionist",
  "permissions": [
    "clients.write"
  ],
  "exp": 123456789
}
```

and signs it.

The browser SDK sends this signed context to the runtime service.

This ensures workflow availability respects product permissions.

---

# 115. Multi-Tenant Applications

For SaaS products with organizations:

```json
{
  "tenant_id": "clinic_42",
  "role": "nutritionist",
  "plan": "pro",
  "feature_flags": {
    "stripe": true
  }
}
```

Workflow resolution may differ by tenant.

Example:

```text
Connect Stripe
```

should not appear if:

```text
feature not enabled
```

or:

```text
user lacks billing permission
```

---

# 116. Custom Renderers

Allow developers to register renderer mappings.

Example:

```ts
productFlow.renderers.register(
  "guide",
  ({ workflow }) => {
    return MyCompanyGuide(workflow);
  }
);
```

Or:

```ts
productFlow.actions.on("navigate", action => {
  customRouter.push(action.route);
});
```

The core should emit semantic actions, not own every execution detail.

---

# 117. Events and Hooks

Expose lifecycle events.

Example:

```ts
productFlow.on("workflow.resolved", ...)
productFlow.on("workflow.started", ...)
productFlow.on("step.completed", ...)
productFlow.on("workflow.completed", ...)
productFlow.on("workflow.failed", ...)
```

Customers can connect:

```text
Segment
Amplitude
Mixpanel
Datadog
custom analytics
```

without depending on our analytics UI.

---

# 118. Event Payload Example

```json
{
  "event": "workflow.completed",
  "workflow_id": "clients.create",
  "workflow_version": 7,
  "duration_ms": 18200,
  "context": {
    "route": "/admin/clients/92"
  }
}
```

This allows product teams to measure the value independently.

---

# 119. Plugin Architecture

Eventually support customer-defined integrations.

Example:

```ts
interface ProductFlowPlugin {
  name: string;

  onWorkflowResolved?(
    workflow: WorkflowResolution
  ): Promise<void>;

  onWorkflowUpdated?(
    workflow: Workflow
  ): Promise<void>;
}
```

Potential plugins:

```text
Zendesk
Intercom
Slack
Notion
Confluence
Linear
Jira
Segment
```

The core product should remain independent of them.

---

# 120. Renderer Marketplace / Ecosystem

Long-term, third parties could build:

```text
mobile renderer
voice renderer
Slack renderer
VS Code renderer
Salesforce renderer
terminal renderer
```

because the workflow contract is stable.

This is another reason to treat the Workflow IR and Runtime Contract as public platform primitives.

---

# 121. Public Workflow Schema

Consider publishing the Workflow IR schema.

Example:

```text
productflow.dev/schema/workflow/v1
```

Benefits:

- ecosystem development;
- transparency;
- easier self-hosting;
- custom tooling;
- customer trust.

The hosted intelligence and maintenance engine can remain proprietary.

---

# 122. Open-Core Possibility

A strong product model may be:

## Open

```text
Workflow IR
CLI
runtime SDK
basic renderers
MCP server
framework interfaces
```

## Proprietary / Hosted

```text
repository understanding
multi-source inference
workflow generation
change intelligence
historical graph
review platform
team collaboration
analytics
enterprise controls
```

This can make developer adoption easier while preserving the highest-value capabilities.

---

# 123. The Universal Output Philosophy

The platform should have one central philosophy:

> **Generate once, consume anywhere.**

A single approved workflow should be usable as:

```text
AI answer
walkthrough
navigation
checklist
help article
support response
command palette action
QA specification
agent execution plan
```

No business process should need to be rewritten separately for each surface.

---

# 124. What the Platform Must Never Couple Together

Avoid hard coupling between:

```text
workflow generation
and
chat UI
```

Avoid hard coupling between:

```text
workflow retrieval
and
LLM provider
```

Avoid hard coupling between:

```text
workflow execution
and
React
```

Avoid hard coupling between:

```text
repository analysis
and
GitHub only
```

Avoid hard coupling between:

```text
workflow storage
and
hosted SaaS runtime
```

Each should communicate through stable contracts.

---

# 125. Recommended Internal Boundaries

```text
Repository Intelligence
        ↓
Product Model
        ↓
Workflow Compiler
        ↓
Workflow Registry
        ↓
Runtime Resolution
        ↓
Integration Adapters
        ↓
Customer Rendering
```

Each layer should be replaceable independently.

---

# 126. The Runtime Registry

Approved workflows should be published into a runtime registry.

Example:

```text
Project:
proj_abc

Release:
2027.4.1

Workflows:
clients.create@7
clients.invite@4
plans.create@11
plans.change_structure@12
```

Consumers access the registry through:

```text
REST
SDK
MCP
static export
```

The graph does not need to be exposed.

---

# 127. Runtime Manifest

For guide-capable workflows, compile a minimal browser-safe manifest.

Example:

```json
{
  "id": "clients.create",
  "version": 7,
  "entrypoint": "/admin/clients",
  "steps": [
    {
      "target": "clients.create",
      "instruction_key": "clients.create.open",
      "advance": {
        "type": "state",
        "value": "client_form_open"
      }
    }
  ],
  "terminal": {
    "event": "client.created"
  }
}
```

Do not ship:

```text
repository paths
commit messages
private PR details
internal confidence analysis
```

to the browser unless needed.

---

# 128. Integration Flexibility Matrix

| Customer Need | Required Integration |
|---|---|
| AI answers only | REST / SDK / MCP |
| Searchable help | REST / SDK |
| Take me there | SDK + routing adapter |
| Show me | Runtime SDK + semantic targets |
| Checklist | Runtime SDK |
| Help center generation | Export API / CLI |
| Existing AI Copilot | Tool adapter or MCP |
| Custom agent | MCP / SDK |
| Offline / strict privacy | Static build export |
| Full autonomous execution | Runtime + execution adapter + authorization |

This matrix should become part of the product documentation.

---

# 129. Recommended Default Product Experience

The default experience should be easy:

```text
Install GitHub App
      ↓
Review workflows
      ↓
npm install @productflow/react
      ↓
<ProductFlowProvider />
      ↓
useProductHelp()
```

But the architecture should allow teams to stop at any layer.

A customer should not need to install the UI SDK just to use workflow knowledge in an assistant.

---

# 130. Integration Philosophy for AI Assistants

The ideal integration pattern is:

```text
Assistant owns conversation
ProductFlow owns verified product knowledge
Frontend owns rendering
```

The assistant should not memorize the workflows.

The system prompt should contain only something like:

> When the user asks how to perform an action in the product, call the product workflow tool rather than guessing.

Everything else should remain outside the prompt.

This keeps prompts small and product knowledge current.

---

# 131. Retrieval Flow for an AI Assistant

```text
User:
"How can I change the plan structure?"
        ↓
Assistant detects product-help intent
        ↓
resolve_product_help()
        ↓
Workflow Resolver
        ↓
plans.change_structure@12
        ↓
structured runtime result
        ↓
Assistant generates concise explanation
        +
Frontend renders supported actions
```

No graph traversal is required at runtime.

---

# 132. Why This Is Better Than Documentation RAG

Traditional RAG:

```text
question
 ↓
retrieve text chunks
 ↓
LLM synthesizes answer
```

Problems:

```text
outdated docs
ambiguous text
no executable state
no terminal condition
no UI target
no version binding
```

Workflow runtime:

```text
question
 ↓
retrieve verified workflow
 ↓
known steps
known state
known version
known entrypoint
known completion
```

This is much more appropriate for "How do I do X?" questions.

Documentation can still be a supporting source during workflow generation.

---

# 133. Fallback to Documentation

Not every question maps to an executable workflow.

The resolver can return:

```json
{
  "type": "documentation_help",
  "content": {
    "title": "...",
    "body": "..."
  },
  "capabilities": {
    "explain": true,
    "guide": false
  }
}
```

Therefore the runtime result supports multiple knowledge types.

Possible types:

```text
workflow_help
documentation_help
feature_explanation
unsupported
```

This makes the API more general.

---

# 134. Result Union Type

Example:

```ts
type ProductHelpResult =
  | WorkflowHelpResult
  | DocumentationHelpResult
  | FeatureExplanationResult
  | UnsupportedResult;
```

This lets customer assistants handle each case cleanly.

---

# 135. Confidence and Ambiguity

The system must represent uncertainty.

Example:

```json
{
  "status": "ambiguous",
  "candidates": [
    {
      "workflow_id": "plans.change_total_macros",
      "confidence": 0.77
    },
    {
      "workflow_id": "meals.change_macros",
      "confidence": 0.73
    }
  ]
}
```

The customer can render:

> Do you mean the macros for the whole plan or for a single meal?

Again, the platform supplies semantics; the customer controls rendering.

---

# 136. Localization

Workflow content should be locale-independent internally.

Example:

```yaml
instruction:
  key: workflows.clients.create.open_clients
```

Compiled content may return localized strings:

```json
{
  "locale": "el",
  "text": "Άνοιξε τους Πελάτες."
}
```

Customers may choose:

```text
our translation
their translation system
raw translation keys
```

Support all three over time.

---

# 137. Developer-Owned Copy Option

Some enterprise products will want full copy control.

Allow:

```ts
productFlow.resolve({
  query,
  contentMode: "keys"
});
```

Response:

```json
{
  "title_key": "workflow.clients.create.title",
  "steps": [
    {
      "text_key": "workflow.clients.create.open"
    }
  ]
}
```

Their i18n system handles presentation.

---

# 138. Product-Owned Copy Option

Simpler customers use:

```ts
contentMode: "resolved"
```

and receive ready-to-render localized content.

Default should probably be resolved content.

---

# 139. Raw Workflow Option

Advanced customers can request:

```ts
contentMode: "workflow"
```

and receive the underlying approved workflow representation.

This is useful for:

```text
custom agents
custom renderers
QA tooling
internal orchestration
```

---

# 140. Product Flexibility Goal

A useful test for every architecture decision:

> Can a developer use the product without using our UI?

If the answer is no, the architecture is too coupled.

Another test:

> Can a developer replace their LLM provider without changing their ProductFlow integration?

If no, the architecture is too coupled.

Another:

> Can a developer use workflows outside chat?

If no, the product is too narrow.

---

# 141. The Product as Infrastructure

The strongest long-term position is:

```text
Application infrastructure for product knowledge
```

rather than:

```text
support widget
```

The platform creates a reusable layer:

```text
Product Knowledge Runtime
```

above the application and below every user-facing assistant or guidance experience.

---

# 142. Revised Final Architecture

```text
                            BUILD / MAINTENANCE

                            Git Repository
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                  Code          Tests       Git / PRs
                    │             │             │
                    └─────────────┼─────────────┘
                                  ▼
                           Analysis Harness
                                  ▼
                            Product Graph
                                  ▼
                        Workflow Discovery
                                  ▼
                         Human Validation
                                  ▼
                           Workflow IR
                                  ▼
                       Workflow Compiler
                                  ▼
                       Workflow Registry
                                  │
──────────────────────────────────┼──────────────────────────────────
                                  │
                               RUNTIME
                                  │
                 ┌────────────────┼─────────────────┐
                 │                │                 │
                REST             SDK               MCP
                 │                │                 │
                 ▼                ▼                 ▼
             Backend          Product UI        AI Agent
                 │                │                 │
                 └────────────────┼─────────────────┘
                                  ▼
                       Structured Result Contract
                                  │
                 ┌────────────────┼─────────────────┐
                 │                │                 │
              Explain          Navigate           Guide
                 │                │                 │
                 ├──────────┬─────┴─────┬──────────┤
                 ▼          ▼           ▼          ▼
              Chat       Sidebar    Help Center  Checklist

                         FUTURE:
                           Execute
```

---

# 143. Final Product Definition — Revised

> **A self-maintaining Product Workflow Platform that continuously compiles source code, tests, Git history, pull requests and product evidence into verified executable workflows, then exposes those workflows through headless APIs, SDKs, MCP and optional renderers so any application, AI assistant or agent can use them in whatever interface it chooses.**

This definition captures both halves of the product:

```text
software → workflows
```

and:

```text
workflows → any product experience
```

---

# 144. Final Developer Promise

For the developer:

> Connect your repository once. We maintain an executable understanding of how your product works. Use that knowledge anywhere — your AI assistant, onboarding, support, help center, command palette, walkthroughs, or future agents — through a stable API, SDK or MCP interface.

The developer should never have to maintain a separate product-help truth for every surface.

---

# 145. Revised Product North Star

> **One continuously maintained workflow truth, rendered anywhere.**

The full loop becomes:

```text
Product changes
      ↓
Workflow knowledge updates
      ↓
All connected surfaces update
```

A single repository change can therefore automatically propagate into:

```text
AI assistant knowledge
interactive guidance
help center
onboarding
support
QA
agent capabilities
```

after validation.

That is the platform-level value of the idea.
