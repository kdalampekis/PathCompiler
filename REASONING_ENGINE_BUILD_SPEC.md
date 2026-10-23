# PathCompiler — Automated & Probabilistic Reasoning Extension
## Codex implementation specification for the Formal Product Model, Reasoning Engine, and reasoning-derived product capabilities

> **Status:** Additive architecture extension to the existing PathCompiler plan.
>
> **Read first:**
> 1. `AGENTS.md`
> 2. `PRODUCT_ARCHITECTURE.md`
> 3. `CODEX_BUILD_SPEC.md`
> 4. This file
>
> This specification does **not** replace the existing PathCompiler architecture. It extends it.
>
> The existing product goal remains:
>
> **repository → product understanding → business processes → executable workflows → headless runtime**
>
> This extension adds:
>
> **probabilistic semantic reasoning + formal product modeling + automated reasoning**
>
> so PathCompiler can reason not only about *what business workflows probably exist*, but also:
>
> - what is possible;
> - what is impossible;
> - why something is impossible;
> - which sequences satisfy a business goal;
> - which alternative sequences exist;
> - which sequence is cheapest or simplest;
> - which permissions/configurations make a process reachable;
> - what semantic behavior changed after a commit;
> - which product invariants are violated;
> - which features are unreachable;
> - which tests should exist;
> - where product knowledge is uncertain;
> - which generated workflows deserve human review first;
> - how likely users are to complete a process once runtime analytics exist.

---

# 1. Product Thesis After This Extension

PathCompiler should not remain only:

> **code → business use cases → workflows**

The stronger long-term product is:

> **a reasoning engine that continuously builds and verifies a formal, probabilistic model of how a software product can be used.**

Executable workflows are one important output of that model.

Other outputs include:

- product reachability analysis;
- workflow root-cause analysis;
- permission/configuration audits;
- semantic commit diffs;
- automated UX analysis;
- business-logic verification;
- dead-feature detection;
- test generation;
- change-risk scoring;
- product-model debugging;
- probabilistic completion analysis;
- future adaptive assistance.

---

# 2. Core Conceptual Separation

The architecture must preserve three different types of reasoning.

## 2.1 Probabilistic semantic reasoning

Answers:

> **What do we believe the software means?**

Examples:

```text
Is this button probably "Create Client" or "Invite Client"?

Does this PR describe a new business capability or a refactor?

Are "Archive Client" and "Deactivate Client" the same capability?

Which candidate workflow best matches the user's query?

Which source of evidence should we trust when docs and tests disagree?
```

The output contains:

- candidate interpretations;
- evidence;
- uncertainty;
- confidence distributions.

## 2.2 Formal / automated reasoning

Answers:

> **Given a product model, what can, cannot, or must happen?**

Examples:

```text
Is this goal reachable?

Is this workflow feasible?

Which action sequence reaches the goal?

What alternatives exist?

Why is the goal unreachable?

Which smallest set of constraints causes failure?

What minimum change would make the goal reachable?

Did this commit change reachability?

Can an unauthorized role reach this operation?
```

Formal reasoning must operate on explicit:

- state variables;
- predicates;
- actions;
- preconditions;
- effects;
- invariants;
- goals;
- permissions;
- feature flags;
- configuration constraints.

## 2.3 Runtime / browser reality

Answers:

> **Does the actual running product behave like our model predicts?**

Example:

```text
Formal model:
clients.create is reachable.

Browser:
target never appears.

Conclusion:
formal model, extraction, configuration, or product implementation is wrong.
```

Runtime verification is empirical evidence.

It feeds back into:

```text
probabilistic confidence
+
formal model correction
```

---

# 3. Closed-Loop Product Understanding

```text
RAW EVIDENCE
    │
    ├── Code
    ├── Tests
    ├── Commits
    ├── PRs
    ├── Docs
    └── Runtime
    │
    ▼
PROBABILISTIC SEMANTIC LAYER
    │
    ├── candidate entities
    ├── candidate actions
    ├── candidate goals
    ├── candidate states
    ├── candidate relations
    └── uncertainty / confidence
    │
    ▼
FORMAL PRODUCT MODEL
    │
    ├── predicates
    ├── state variables
    ├── actions
    ├── preconditions
    ├── effects
    ├── invariants
    ├── permissions
    ├── feature flags
    ├── configurations
    └── goals
    │
    ▼
AUTOMATED REASONING
    │
    ├── SAT / SMT
    ├── bounded model checking
    ├── planning
    ├── model enumeration
    ├── MaxSAT / optimization
    ├── counterexamples
    ├── unsat cores
    ├── MUS / MCS
    └── before/after reasoning
    │
    ▼
VERIFIED PRODUCT MODEL
    │
    ├── reachable capabilities
    ├── feasible traces
    ├── alternative paths
    ├── applicability conditions
    ├── invalid states
    ├── root causes
    └── product properties
    │
    ▼
WORKFLOW COMPILER
    │
    ▼
Workflow IR
    │
    ▼
Runtime / SDK / REST / MCP / Static Export
```

Browser/runtime validation then loops back to the evidence layer.

---

# 4. Architectural Rule: Do Not Encode Raw UI State

Formal reasoning must operate on a **business-relevant abstraction** of application state.

Do not model irrelevant low-level state such as:

```text
mouse_x = 431
tooltip_visible = false
sidebar_width = 276
react_component_render_count = 9
```

Prefer business predicates:

```text
authenticated
on_clients_page
client_form_open
client_form_valid
client_exists
has_clients_write
subscription_limit_reached
new_client_feature_enabled
```

The quality of the abstraction is critical.

---

# 5. Better Definition of a Business Workflow

Do **not** define a business use case as:

> all satisfying assignments of code literals.

Prefer:

> **A business use case is a semantically meaningful equivalence class of feasible execution traces that satisfies a user-level goal under the constraints encoded by the product.**

A workflow is:

> **a verified feasible trace, or a parameterized family of traces, from an admissible initial state to a business goal.**

---

# 6. Formal Product Model

Create:

```text
packages/formal-model/
```

This package must be solver-independent.

No Z3-specific data structure may appear in its public API.

---

# 7. Formal State Variables

```ts
type FormalStateVariable =
  | BooleanStateVariable
  | EnumStateVariable
  | IntegerStateVariable
  | StringStateVariable;
```

Examples:

```text
authenticated: boolean

current_area:
  DASHBOARD
  CLIENTS
  PLAN_EDITOR
  SETTINGS

role:
  OWNER
  NUTRITIONIST
  ASSISTANT

subscription:
  FREE
  PRO
  ENTERPRISE
```

---

# 8. Formal Predicates

Represent propositions with an internal expression AST.

```ts
type FormalExpr =
  | { type: "bool"; value: boolean }
  | { type: "var"; id: string }
  | { type: "not"; expr: FormalExpr }
  | { type: "and"; expressions: FormalExpr[] }
  | { type: "or"; expressions: FormalExpr[] }
  | { type: "eq"; left: FormalTerm; right: FormalTerm }
  | { type: "lt"; left: FormalTerm; right: FormalTerm }
  | { type: "lte"; left: FormalTerm; right: FormalTerm }
  | { type: "gt"; left: FormalTerm; right: FormalTerm }
  | { type: "gte"; left: FormalTerm; right: FormalTerm };
```

Do not use arbitrary strings as logic expressions.

---

# 9. Formal Actions

```ts
type FormalAction = {
  id: string;
  description?: string;
  precondition: FormalExpr;
  effects: FormalEffect[];
  cost?: number;
  semanticTarget?: string;
  evidence: EvidenceRef[];
  confidence?: number;
};
```

Example:

```yaml
id: clients.open_create_form

preconditions:
  - current_area == CLIENTS
  - can_manage_clients == true

effects:
  - client_form_open := true

semantic_target:
  clients.create
```

---

# 10. Preconditions and Effects

Example:

```text
ACTION:
SAVE_CLIENT

PRE:
client_form_open
AND client_form_valid
AND has_clients_write

EFFECT:
client_exists = true
AND client_form_open = false
```

Do not encode this merely as a graph edge.

---

# 11. Invariants

Examples:

```text
current_area cannot be CLIENTS and PLAN_EDITOR simultaneously

role = VIEWER
→ NOT has_clients_write

client_exists
→ client_id is defined
```

Security/business invariants can later be verified.

---

# 12. Goals

```ts
type FormalGoal = {
  id: string;
  condition: FormalExpr;
  businessMeaning: string;
  evidence: EvidenceRef[];
  confidence: number;
};
```

Examples:

```text
clients.created
plans.created
plans.structure_changed
appointments.created
reports.exported
stripe.connected
```

Workflow discovery should increasingly be framed as:

```text
initial conditions
+
goal
+
product constraints
→
feasible plan
```

---

# 13. Applicability Conditions

The solver can discover when a workflow is possible.

Example:

```text
clients.bulk_import reachable iff:

(subscription = PRO OR ENTERPRISE)
AND
role ∈ {OWNER, NUTRITIONIST}
AND
bulk_import_flag = true
```

Compile this into workflow metadata.

---

# 14. Evidence-to-Formal-Model Mapping

Every formal object must retain provenance.

Example:

```yaml
action:
  id: clients.submit_create

evidence:
  - type: symbol
    locator: src/features/clients/AddClientModal.tsx#submit

  - type: api
    locator: POST:/api/clients

  - type: test
    locator: e2e/create-client.spec.ts

  - type: commit
    locator: 9ac318
```

---

# 15. Reasoner Core

Create:

```text
packages/reasoner-core/
```

Minimum interface:

```ts
interface ProductReasoner {
  checkReachability(request: ReachabilityRequest): Promise<ReachabilityResult>;
  findPlan(request: PlanRequest): Promise<PlanResult>;
  enumeratePlans(request: EnumeratePlansRequest): Promise<EnumeratePlansResult>;
  explainUnreachable(request: ExplainUnreachableRequest): Promise<UnreachableExplanation>;
  optimizePlan(request: OptimizePlanRequest): Promise<OptimizedPlanResult>;
  verifyProperty(request: VerifyPropertyRequest): Promise<PropertyVerificationResult>;
  compareModels(request: ModelComparisonRequest): Promise<ModelComparisonResult>;
}
```

---

# 16. Solver Provider Boundary

Create:

```text
packages/solver-provider/
```

Interface:

```ts
interface SolverProvider {
  check(problem: SolverProblem): Promise<SolverCheckResult>;
  enumerate(
    problem: SolverProblem,
    options: EnumerationOptions
  ): AsyncIterable<SolverModel>;
  optimize(problem: OptimizationProblem): Promise<OptimizationResult>;
}
```

The first backend may use Z3.

Do not leak Z3 AST nodes outside the provider.

---

# 17. Reachability Results

```ts
type ReachabilityResult =
  | {
      status: "reachable";
      trace: ReasoningTrace;
      model?: ReasoningModel;
    }
  | {
      status: "unreachable";
      explanation?: UnreachableExplanation;
    }
  | {
      status: "unknown";
      reason: string;
    };
```

Never treat `unknown` as `unreachable`.

---

# 18. Reasoning Trace

```ts
type ReasoningTrace = {
  initialState: FormalStateSnapshot;
  actions: ReasoningTraceStep[];
  goal: string;
};
```

Each trace step must map to evidence.

---

# 19. Phase R0 — Formal Model Foundation

Begin only after Product Graph, Capability representation and Evidence model are stable.

Tasks:

1. create `packages/formal-model`;
2. implement state variables;
3. expressions;
4. actions;
5. effects;
6. invariants;
7. goals;
8. Zod validation;
9. deterministic serialization;
10. encode fixture flows:
    - Create Client
    - Change Plan Structure

No solver yet.

---

# 20. Phase R1 — Formal Abstraction Builder

Create:

```text
packages/formal-abstraction/
```

Input:

```text
Product Graph
Capabilities
Tests
Permissions
Feature flags
Routes
APIs
```

Output:

```text
Candidate Formal Product Model
```

Deterministic extraction first.

Use model assistance only for:

```text
business naming
goal inference
ambiguous state abstraction
merging equivalent actions
semantic interpretation
```

All generated objects retain confidence and evidence.

---

# 21. Phase R2 — SMT Reachability

Answer:

> **Can goal G be reached under context C?**

Examples:

```text
Can a nutritionist create a client?

Can an assistant create a client?

Can a free-plan tenant bulk import clients?

Can a viewer delete a client?
```

For MVP use bounded reachability.

Return:

```text
reachable
unreachable
unknown
```

Reachable results include witness traces.

---

# 22. Phase R3 — Planning

Generate action sequences satisfying a business goal.

Example:

```text
GOAL:
client_exists

PLAN:
NAVIGATE_CLIENTS
OPEN_CREATE_CLIENT
FILL_REQUIRED_FIELDS
SUBMIT_CLIENT
```

For MVP, planning may compile to bounded SMT.

---

# 23. Workflow Discovery Integration

Old:

```text
Product Graph
+
LLM
→ Workflow Candidate
```

Preferred:

```text
Product Graph
+
Semantic Abstraction
→ Formal Model
→ Planner / Reasoner
→ Feasible Trace
→ Workflow Candidate
```

LLM remains useful for semantics and language, not for inventing impossible transitions.

---

# 24. Phase R4 — UNSAT Explanation

Track constraints with stable IDs and provenance.

Example:

```text
C17:
role = NUTRITIONIST

C23:
CREATE_CLIENT requires clients.write

C41:
clients.write requires role = OWNER
```

Return product-semantic explanations, never opaque solver IDs.

---

# 25. Formal Traceback to Source

Map:

```text
business goal
↓
formal constraint
↓
product capability
↓
source graph
↓
file/symbol
↓
commit/PR
```

This should support:

```text
Workflow clients.create became unreachable.

Reason:
clients.create requires clients.write.

clients.write now requires OWNER.

Changed at:
src/auth/permissions.ts:84

Introduced by:
commit 8f73ab
```

---

# 26. Phase R5 — MUS and MCS

## MUS

Smallest sufficient set of constraints making the goal impossible.

## MCS

Smallest set of constraints that would need to change to make the goal feasible.

Product questions:

```text
Why can't role X perform task Y?

What minimum configuration/permission change would enable it?
```

Diagnostic only. Never auto-change permissions.

---

# 27. Phase R6 — Plan Enumeration

Find alternative feasible ways to satisfy the same goal.

Example:

```text
GOAL:
plan_created

A:
Create Blank → Fill → Save

B:
Use Template → Customize → Save

C:
Import PDF → Review → Save

D:
AI Generate → Review → Save
```

Use bounded enumeration with blocking constraints.

---

# 28. Semantic Trace Deduplication

Create:

```text
packages/trace-clustering/
```

Group solver traces into semantically meaningful equivalence classes based on:

```text
goal
major actions
entry capability
route family
API effects
business entities
```

Example:

```text
127 traces
↓
semantic grouping
↓
4 business workflow variants
```

---

# 29. Phase R7 — Optimization / OMT / MaxSAT

Rank valid plans with explicit costs.

Possible dimensions:

```text
clicks
page transitions
form fields
modal interactions
external integrations
permissions
estimated effort
```

Example objective:

```text
minimize total user effort
subject to goal reached
```

Return:

```text
recommended path
+
alternatives
```

---

# 30. Automated UX Analysis

Derive per workflow:

```text
minimum actions
minimum page transitions
decision count
branch count
required integrations
required permissions
estimated minimum effort
```

This supports automated UX auditing.

Treat findings as hypotheses, not automatic redesign prescriptions.

---

# 31. Phase R8 — Model Checking

Verify business/security properties.

Examples:

```text
A viewer can never delete a client.

A successfully submitted client form eventually reaches client_created.

A free-plan tenant cannot use a paid export workflow.

Every plan-send workflow passes through confirmation.
```

Start with a small internal property language and bounded checking.

---

# 32. Counterexample Generation

When a property fails, return a counterexample trace.

Example:

```text
VIEWER
→ Clients
→ Client Menu
→ Archive
→ Delete
```

This can reveal:

```text
authorization bugs
business-rule violations
formal extraction errors
```

---

# 33. Product Logic / Permission Audit

Reasoning can power:

```text
permission audit
role escalation path analysis
feature access violations
business invariant violations
```

Do not market it as a complete security scanner.

---

# 34. Phase R9 — Dead Feature Detection

For every user-facing capability ask whether a valid state/trace can reach it.

If no:

```text
UNREACHABLE CAPABILITY
```

Possible causes:

```text
dead code
broken routing
impossible permission combination
stale feature flag
orphaned UI
incomplete model extraction
```

---

# 35. Missing Transition Detection

If:

```text
button exists
API exists
goal exists
```

but no formal trace connects them, flag:

```text
POTENTIAL MODEL OR PRODUCT GAP
```

Possible causes:

```text
analysis missing edge
product wiring bug
```

---

# 36. Phase R10 — Automated Test Generation

Formal traces can generate test candidates.

Positive:

```text
valid trace
→ successful E2E test
```

Negative:

```text
ASSISTANT
AND NOT clients.write
→ create_client must be unreachable
```

Output candidate tests under:

```text
.pathcompiler/generated-tests/
```

Human review required.

---

# 37. Model/Browser Consistency

Use browser validation as a consistency oracle.

```text
solver says reachable
browser fails
→ discrepancy

solver says unreachable
browser succeeds
→ severe discrepancy
```

Discrepancies become first-class findings.

---

# 38. Phase R11 — Commit Semantic Reasoning

Compare:

```text
FormalModel_before
vs
FormalModel_after
```

Ask:

```text
Which goals became reachable?

Which goals became unreachable?

Which roles gained capabilities?

Which roles lost capabilities?

Which workflow variants appeared/disappeared?

Which invariants changed?

Which properties now fail?

Which applicability conditions changed?
```

This creates semantic product diffs.

---

# 39. Example: New Reachability

Before:

```text
ASSISTANT → report_exported
UNREACHABLE
```

After:

```text
ASSISTANT → report_exported
REACHABLE
```

Report:

```text
Commit 861fae introduced new business reachability:

Capability:
reports.export

Newly available to:
ASSISTANT
```

---

# 40. Example: Workflow Removed

Before:

```text
plan_exported
REACHABLE
```

After:

```text
plan_exported
UNREACHABLE
```

Then run UNSAT/root-cause analysis.

---

# 41. Semantic Change Report

```ts
type SemanticChangeReport = {
  commitRange: {
    base: string;
    head: string;
  };

  newReachability: ReachabilityChange[];
  removedReachability: ReachabilityChange[];
  changedApplicability: ApplicabilityChange[];
  changedProperties: PropertyChange[];
  affectedWorkflows: WorkflowImpact[];
  uncertainty: SemanticUncertainty[];
};
```

---

# 42. GitHub Product Logic Check

Possible PR check:

```text
PathCompiler Product Logic

NEW REACHABILITY
+ reports.export now reachable for ASSISTANT

REMOVED REACHABILITY
- plans.export_pdf no longer reachable for NUTRITIONIST

PROPERTY FAILURE
! VIEWER can reach clients.delete

WORKFLOW IMPACT
2 workflows require review
```

---

# 43. Phase P0 — Probabilistic Evidence Model

Create:

```text
packages/probabilistic-evidence/
```

Start simple.

Do not begin with a complex probabilistic programming framework.

Represent supporting, contradicting evidence and confidence.

---

# 44. Confidence Discipline

Do not call arbitrary heuristic scores probabilities unless calibrated.

Initially distinguish:

```text
confidence score
```

from:

```text
calibrated probability
```

This distinction is mandatory.

---

# 45. Evidence Reliability

Consider:

```text
runtime verification
current E2E tests
current source code
current API behavior
recent PR intent
recent commit message
current docs
old docs
historical prose
LLM hypothesis
```

Reliability may depend on claim type.

---

# 46. Evidence Fusion

Example claim:

```text
Users can deactivate clients.
```

Evidence:

```text
Deactivate button exists
PATCH status API exists
Playwright verifies behavior
PR says "Deactivate Client"
old docs say "Archive Client"
```

Output:

```text
canonical candidate:
clients.deactivate

confidence:
high

possible stale artifact:
old docs
```

Do not naively average evidence scores.

---

# 47. Evidence Conflicts

Create first-class conflict objects.

Example:

```text
Current code:
Delete enabled

Docs:
Clients cannot be deleted

Runtime:
Delete succeeds
```

Possible result:

```text
likely stale documentation
```

Retain uncertainty.

---

# 48. Phase P1 — Probabilistic Semantic Interpretation

Semantic layer can produce multiple candidates.

Example:

```text
create_client      0.72
update_client      0.21
invite_client      0.07
```

Then formal consistency removes impossible interpretations.

Pipeline:

```text
candidate interpretations
↓
formal consistency
↓
remove impossible candidates
↓
re-score
↓
best formal product model candidates
```

---

# 49. Hard vs Soft Constraints

Hard:

```text
button calls POST /invite
route cannot be two values simultaneously
```

Soft:

```text
PR suggests "Invite Client"
docs call this "Activation"
LLM believes action belongs to onboarding
```

Hard constraints must hold.

Soft evidence selects among coherent interpretations.

---

# 50. Phase P2 — Weighted MaxSAT / Soft Constraint Optimization

Represent:

```text
hard constraints
+
weighted semantic hypotheses
```

Objective:

```text
satisfy hard constraints
maximize supported soft constraints
```

This bridges formal and uncertain reasoning.

---

# 51. Query Resolution as Probabilistic Reasoning

Example:

```text
"How do I change the macros?"
```

Candidates:

```text
plan.change_macros
meal.change_macros
client.macro_targets
```

Context changes ranking.

If uncertainty is high:

```text
return ambiguous
```

Do not force a match.

---

# 52. Human Review Prioritization

Rank review priority using:

```text
uncertainty
×
business impact
×
usage
×
change severity
```

High-usage uncertain workflows get reviewed first.

---

# 53. Human Review Feedback

Store:

```text
accepted
edited
rejected
merged
renamed
```

This creates future evaluation/calibration data.

---

# 54. Phase P3 — Browser Failure Diagnosis

When expected behavior fails, rank causes:

```text
stale target
permission mismatch
feature flag mismatch
backend behavior changed
formal model wrong
network issue
```

This becomes automated diagnosis.

---

# 55. Information-Gain Diagnostics

Later choose the next diagnostic test that best distinguishes competing hypotheses.

Defer until basic diagnosis works.

---

# 56. Phase P4 — Commit Risk Scoring

Combine:

```text
definite formal impacts
+
probable semantic impacts
+
uncertain dependencies
```

Example:

```text
Change risk: HIGH

Definite impacts: 3
Probable impacts: 2
Uncertain: 1
```

Do not present an uncalibrated score as incident probability.

---

# 57. Runtime Analytics

Later collect:

```text
workflow started
step reached
branch taken
abandoned
completed
duration
```

---

# 58. Phase P5 — Probabilistic Model Checking

Only after meaningful telemetry exists.

Questions:

```text
What is probability of completion?

Expected actions to completion?

Probability of abandonment?

Did redesign increase completion probability?
```

---

# 59. Markov Models

Example:

```text
Plan Editor

0.70 → Structure
0.20 → Navigate Away
0.10 → Cancel
```

Useful for probabilistic workflow behavior.

---

# 60. MDP Extension for Guided Assistance

Long-term research/product extension.

Assistance actions:

```text
show tooltip
navigate
explain
offer automation
do nothing
```

Reward:

```text
completion
low interruption
low abandonment
low extra effort
```

Not MVP.

---

# 61. New Product Modules Enabled

Potential modules:

```text
Workflow Compiler
Workflow Health
Product Logic Audit
Permissions Audit
Semantic Change Intelligence
UX Complexity Analysis
Automated Test Suggestions
Dead Feature Detection
Product Model Explorer
```

All share the same product model.

---

# 62. Workflow Health

Show per workflow:

```text
reachable?
verified?
last verified commit
semantic confidence
formal status
browser status
affected by latest release?
```

---

# 63. Why Is This Broken?

Input:

```text
workflow
role/context
release
```

Output:

```text
reachability
unsat explanation
blocking constraints
source traceback
introducing commit
possible correction set
```

---

# 64. Who Can Do What?

Generate permission/reachability matrix:

```text
                     OWNER   NUTRITIONIST   ASSISTANT   VIEWER

Create Client          ✓          ✓             ✕          ✕

Export Report          ✓          ✓             ✓          ✕

Delete Client          ✓          ✕             ✕          ✕
```

---

# 65. Configuration Reachability

Question:

> In which configurations is workflow X reachable?

Reason over:

```text
roles
plans
feature flags
tenant settings
country
release
```

---

# 66. Semantic Release Diff

For release A vs B report:

```text
new capabilities
removed capabilities
newly reachable workflows
lost workflows
role changes
permission changes
property violations
```

---

# 67. Automated UX Audit

Per workflow expose:

```text
minimum steps
branch count
page changes
required fields
required integrations
alternative paths
minimum-cost path
```

---

# 68. Business Logic Verification

Allow user-defined properties.

Example:

```yaml
id: security.viewer_cannot_delete_client

context:
  role: VIEWER

forbidden_goal:
  client_deleted
```

Keep developer-facing property syntax simple.

---

# 69. Test Coverage by Business Reachability

For every reachable business goal ask:

```text
Is there an E2E test covering at least one valid trace?
```

This is business-level test coverage.

---

# 70. Alternative Path Detection

For each goal report semantically distinct ways to achieve it.

Useful for:

```text
support
help
onboarding
testing
UX
```

---

# 71. Product Dead Ends

Detect reachable states from which expected goals cannot be reached.

Possible causes:

```text
missing action
permission mismatch
flag mismatch
UX dead end
model error
```

---

# 72. Minimal Enablement

Use MCS/optimization to answer:

> What minimum change enables workflow X?

Examples:

```text
grant permission
enable feature flag
upgrade plan
connect integration
```

Diagnostic only.

---

# 73. Reasoning API

Potential endpoints:

```text
POST /v1/reason/reachability
POST /v1/reason/why-unreachable
POST /v1/reason/plan
POST /v1/reason/alternatives
POST /v1/reason/verify-property
POST /v1/reason/compare-releases
```

Expose product-semantic results, not solver internals.

---

# 74. MCP Reasoning Tools

Later:

```text
pathcompiler.check_reachability
pathcompiler.explain_unreachable
pathcompiler.find_plan
pathcompiler.list_alternative_paths
pathcompiler.compare_product_semantics
pathcompiler.verify_product_property
```

---

# 75. Developer-Agent Use Case

A coding agent can ask:

```text
Which workflows depend on ClientPermissions?

What business reachability changes if I remove this condition?

Which product properties could this change violate?
```

This makes PathCompiler useful inside developer harnesses too.

---

# 76. Pre-Change Reasoning

Long-term, simulate proposed changes before merge:

```text
candidate model change
↓
new reachable workflows
new violated invariants
affected tests
affected docs
```

---

# 77. Decomposition / Localized Reasoning

Large product models must be sliced.

For a goal:

```text
goal
↓
relevant actions
↓
relevant predicates
↓
permissions
↓
configuration
```

Reason only over the slice.

---

# 78. Goal-Directed Model Slicing

Example query:

```text
Can ASSISTANT create a client?
```

Exclude unrelated:

```text
Stripe
calendar
branding
reports
```

Implement:

```ts
sliceFormalModel({
  goal,
  context,
  dependencyDepth
})
```

---

# 79. Constraint Provenance

Every solver assertion must map to:

```text
constraint ID
formal source
product semantic source
code/test/PR evidence
```

Never expose only opaque solver labels.

---

# 80. Reasoning Artifact Storage

Derived artifacts can live under:

```text
.pathcompiler/reasoning/
  reachability/
  properties/
  semantic-diffs/
```

These are not canonical workflow truth.

---

# 81. Reasoning Cache

Cache by:

```text
formal model hash
query hash
reasoner version
solver version
```

Never reuse across product commits without proven equivalence.

---

# 82. Formal Model Versioning

Track:

```text
formal_model_schema_version
repository_commit
extractor_version
semantic_model_version
reasoner_version
```

---

# 83. UNKNOWN Is Valid

Solver can return:

```text
SAT
UNSAT
UNKNOWN
```

Unknown reasons:

```text
bound insufficient
unsupported expression
timeout
incomplete abstraction
```

Preserve unknown.

---

# 84. Soundness and Completeness

An incomplete extracted model means:

```text
UNREACHABLE in model
```

does not always prove:

```text
impossible in real software
```

Always pair formal result with:

```text
model coverage
confidence
runtime verification
```

---

# 85. Model Coverage

Track percentage/quality of transitions supported by:

```text
deterministic code evidence
tests
runtime
semantic inference only
```

Use this when presenting conclusions.

---

# 86. Confidence-Aware Conclusions

Example:

```text
formal:
UNREACHABLE

model confidence:
0.58

browser:
not run
```

Present:

```text
Likely unreachable in current model; verification recommended.
```

Versus high-confidence + browser confirmation:

```text
Verified unreachable.
```

---

# 87. Runtime Feedback Loop

Contradictions become first-class findings.

```ts
type ModelDiscrepancy = {
  expected: FormalOutcome;
  observed: RuntimeOutcome;
  candidateCauses: DiagnosisCandidate[];
  affectedModelElements: string[];
};
```

---

# 88. Reasoning Evaluation Fixtures

Create:

```text
fixtures/reasoning/
```

Cases:

```text
reachable/
unreachable/
permissions/
feature-flags/
alternative-plans/
counterexamples/
commit-diffs/
```

---

# 89. Metrics

## Reachability

```text
SAT/UNSAT correctness
unknown rate
```

## Planning

```text
goal reached
invalid action count
major-step correctness
cost optimality
```

## Explanations

```text
root-cause precision
provenance correctness
```

## Enumeration

```text
business path recall
duplicate rate
```

## Semantic diff

```text
true change recall
false-positive rate
```

## Probabilistic layer

```text
calibration
ranking accuracy
review-priority usefulness
```

---

# 90. Solver Timeouts

Every solver call needs:

```text
timeout
max depth
resource budget
```

Timeout returns:

```text
unknown
```

Expose:

```text
constraint count
bound
duration
slice size
```

---

# 91. State Explosion Controls

Use:

```text
goal-directed slicing
bounded reasoning
business-state abstraction
trace deduplication
incremental solving where useful
caching
```

Never exhaustively enumerate the whole product.

---

# 92. Existing Build Spec Integration

Extended pipeline:

```text
Source Analysis
→ Product Surface Graph
→ Capability Discovery
→ Probabilistic Semantic Layer
→ Formal Abstraction
→ Reachability / Planning
→ Feasible Trace Discovery
→ Workflow Discovery
→ Formal Validation
→ Browser Validation
→ Compiler
```

Commit maintenance:

```text
Graph Diff
→ Formal Model Diff
→ Reachability Diff
→ Workflow Impact
→ Update Proposal
```

---

# 93. Recommended Build Order

## Stage A — Core Formal Reasoning

```text
R0 Formal Model
R1 Formal Abstraction
R2 SMT Reachability
R3 Planning
R4 UNSAT explanation
```

## Stage B — Workflow Breadth

```text
R5 MUS/MCS
R6 Plan Enumeration
R7 Optimization
```

## Stage C — Product Logic

```text
R8 Model Checking
R9 Dead Features
R10 Test Generation
R11 Commit Semantic Reasoning
```

## Stage D — Uncertainty

```text
P0 Evidence Model
P1 Semantic Interpretation
P2 Weighted Soft Constraints
P3 Diagnosis
P4 Commit Risk
```

## Stage E — Runtime Probability

Only after telemetry:

```text
P5 Probabilistic Model Checking
MDP experiments
```

---

# 94. First Reasoning MVP

The first reasoning MVP is complete when:

```text
1. Build formal model from fixture.

2. Ask:
   Can NUTRITIONIST create a client?
   → REACHABLE

3. Ask:
   Can VIEWER create a client?
   → UNREACHABLE

4. Explain why:
   missing clients.write

5. Produce valid plan:
   Clients
   → Add Client
   → Fill Form
   → Submit

6. Change permission code in a commit.

7. Compare before/after formal models.

8. Report:
   clients.create no longer reachable for NUTRITIONIST

9. Trace reason to:
   permission rule
   source file
   commit

10. Generate/update affected workflow proposal.
```

---

# 95. Second Demo — Alternative Paths

Goal:

```text
plan_created
```

Discover:

```text
Blank
Template
Import
AI Generate
```

without flooding output with equivalent traces.

---

# 96. Third Demo — Business Property

Property:

```text
VIEWER cannot delete clients
```

Introduce a fixture bug.

Expected:

```text
PROPERTY FAILED

Counterexample:
VIEWER
→ Clients
→ Client Menu
→ Delete
```

---

# 97. Fourth Demo — UX Optimization

Two paths:

```text
A = 8 actions
B = 5 actions
```

Under explicit cost function, identify B as lower cost.

---

# 98. Fifth Demo — Evidence Conflict

Example:

```text
code says delete exists
test succeeds
docs say delete impossible
```

Flag:

```text
evidence conflict
likely stale documentation
```

---

# 99. Public API Principle

Bad:

```text
POST /solve-smt
```

Good:

```text
POST /v1/reason/reachability
POST /v1/reason/explain
POST /v1/reason/alternatives
POST /v1/reason/property
POST /v1/reason/compare
```

Developers ask product questions, not solver questions.

---

# 100. Example Reachability Result

```json
{
  "type": "reachability_result",
  "goal": "clients.created",
  "context": {
    "role": "nutritionist"
  },
  "status": "reachable",
  "trace": [
    "navigate.clients",
    "clients.open_create",
    "clients.fill_required",
    "clients.submit_create"
  ],
  "model_confidence": 0.94,
  "verified_in_browser": true
}
```

---

# 101. Example Unreachable Result

```json
{
  "type": "reachability_result",
  "goal": "clients.created",
  "context": {
    "role": "viewer"
  },
  "status": "unreachable",
  "reason": {
    "kind": "unsat_core",
    "constraints": [
      "viewer does not have clients.write",
      "clients.create requires clients.write"
    ]
  },
  "model_confidence": 0.96
}
```

---

# 102. Example Semantic Change Result

```json
{
  "type": "semantic_change",
  "base_commit": "abc",
  "head_commit": "def",
  "changes": [
    {
      "kind": "reachability_removed",
      "goal": "clients.created",
      "context": {
        "role": "nutritionist"
      }
    }
  ]
}
```

---

# 103. Dashboard Reasoning Section

Later views:

```text
Reachability Explorer
Workflow Health
Product Properties
Semantic Diffs
Evidence Conflicts
Dead Features
UX Complexity
```

Build only after the underlying analysis is useful.

---

# 104. Reachability Explorer

UI query:

```text
Can <ROLE> do <GOAL> under <CONFIGURATION>?
```

Example:

```text
Can ASSISTANT create a client on FREE plan?
```

Return answer, reason, and minimal enablement if useful.

---

# 105. Workflow Health Page

Example:

```text
clients.create

Reachable: YES

Roles:
OWNER
NUTRITIONIST

Unavailable:
ASSISTANT
VIEWER

Formal validation: PASS
Browser validation: PASS

Alternatives: 1
Minimum actions: 4
Last semantic change: commit def123
```

---

# 106. Runtime vs Build-Time Reasoning

Formal reasoning is primarily build-time/developer-time.

Do not run expensive SMT planning for normal end-user queries if an approved compiled workflow already exists.

Normal runtime:

```text
query
→ compiled workflow index
→ approved workflow
```

Reasoning is for:

```text
generation
validation
maintenance
explanation
audit
developer queries
```

---

# 107. Two MCP Surfaces

## Product-help MCP

```text
resolve_help
get_workflow
```

Uses approved compiled workflows.

## Developer reasoning MCP

```text
check_reachability
explain_unreachable
compare_semantics
verify_property
```

Uses formal model/reasoner.

Keep permissions separate.

---

# 108. Security Boundary

Reasoning models may expose:

```text
hidden capabilities
permissions
feature flags
admin flows
source files
PR intent
```

Do not expose developer reasoning APIs to normal end users.

Browser runtime gets only safe workflow manifests.

---

# 109. Solver Choice

Keep architecture solver-independent.

Recommended first backend:

```text
Z3-compatible SMT provider
```

because initial needs include:

```text
booleans
enums
integers
constraints
optimization
unsat explanations
bounded transitions
```

But domain packages must not depend on Z3 APIs.

---

# 110. Planning Choice

For MVP:

```text
planning → bounded SMT encoding
```

is acceptable.

Do not add PDDL tooling until needed.

---

# 111. Model Checking Choice

Start with:

```text
bounded model checking
```

over the same transition model.

Do not introduce a second large verification stack prematurely.

---

# 112. Probabilistic Backend Choice

Initially use:

```text
explicit evidence scores
evaluation
calibration
documented fusion rules
```

Do not add a probabilistic programming framework until justified.

---

# 113. Scientific Discipline

Always distinguish:

```text
FORMALLY VERIFIED
```

from:

```text
HIGH-CONFIDENCE INFERENCE
```

from:

```text
BROWSER VERIFIED
```

These are different claims.

---

# 114. Finding Status Model

Potential representation:

```yaml
semantic_confidence: 0.92

formal_status:
  result: reachable
  bound: 8

runtime_status:
  result: verified
```

---

# 115. Codex Integration Rule

When implementing this extension:

1. do not rewrite the working workflow compiler;
2. add reasoning through interfaces;
3. prove behavior on fixtures;
4. integrate gradually;
5. keep baseline and reasoning-assisted discovery comparable;
6. make reasoning default only after evaluation shows value.

---

# 116. Development Feature Flags

```yaml
reasoning:
  enabled: false
  reachability: false
  planning: false
  unsat_explanations: false
  enumeration: false
  optimization: false
  property_checking: false

probabilistic:
  evidence_fusion: false
```

Enable phase by phase.

---

# 117. Comparison Harness

Command:

```bash
pathcompiler eval workflow-discovery
```

Compare:

```text
baseline graph/semantic discovery
vs
reasoning-assisted discovery
```

Measure:

```text
valid workflow precision
invented-step reduction
workflow recall
applicability accuracy
human edit distance
```

The reasoning system must earn its complexity.

---

# 118. Reasoning CLI

Potential commands:

```bash
pathcompiler reason reachable   --goal clients.created   --role nutritionist

pathcompiler reason why-not   --goal clients.created   --role viewer

pathcompiler reason plan   --goal plans.created

pathcompiler reason alternatives   --goal plans.created

pathcompiler reason verify   --property security.viewer_cannot_delete

pathcompiler reason compare   <base-commit> <head-commit>
```

---

# 119. Example CLI Output

```text
$ pathcompiler reason why-not     --goal clients.created     --role assistant

UNREACHABLE

Goal:
clients.created

Blocking constraints:
1. clients.create requires clients.write
2. role ASSISTANT does not have clients.write

Source:
src/auth/permissions.ts:84

Last changed:
commit 8f73ab

Possible minimal enablement:
grant clients.write to ASSISTANT
```

---

# 120. Codex Prompt — R0

```text
Read AGENTS.md, PRODUCT_ARCHITECTURE.md, CODEX_BUILD_SPEC.md,
and REASONING_ENGINE_BUILD_SPEC.md.

Implement Phase R0 — Formal Model Foundation only.

Do not add a solver yet.

Requirements:
- create packages/formal-model;
- implement solver-independent state variables, expressions, actions,
  effects, invariants and goals;
- preserve EvidenceRef provenance;
- add Zod validation;
- add deterministic serialization;
- encode Create Client and Change Plan Structure for the fixture app;
- add focused unit tests;
- do not change current workflow runtime behavior;
- update docs/phases/STATUS.md.

Run lint, typecheck and tests before finishing.
```

---

# 121. Codex Prompt — R1

```text
Implement Phase R1 — Formal Abstraction Builder only.

Convert existing Product Graph / Capability / Evidence structures into
candidate Formal Product Model objects.

Requirements:
- deterministic extraction before semantic inference;
- no direct solver dependency;
- all generated actions/goals retain provenance;
- represent uncertainty explicitly;
- prove behavior on fixture workflows;
- preserve existing workflow discovery unchanged for now.
```

---

# 122. Codex Prompt — R2

```text
Implement Phase R2 — SMT Reachability.

Add solver-provider abstraction and one initial SMT backend.

Requirements:
- solver APIs must not leak into formal-model public types;
- support bounded reachability;
- support reachable/unreachable/unknown;
- produce a witness trace when reachable;
- enforce timeouts and bounds;
- verify fixture role/permission reachability cases;
- do not implement planning/enumeration yet.
```

---

# 123. Codex Prompt — R3

```text
Implement Phase R3 — Planning.

Use the existing formal transition model and reasoner interfaces to find
a feasible action sequence from an admissible initial state to a business goal.

Use bounded SMT planning for the first implementation unless the current
architecture provides a clearly simpler correct alternative.

Output product-semantic action traces with provenance.
Do not yet replace the default workflow-discovery path.
```

---

# 124. Codex Prompt — R4

```text
Implement Phase R4 — UNSAT Explanation.

Track formal constraints with stable semantic IDs and EvidenceRef provenance.

When a reachability query is unreachable and the backend supports it,
return a product-semantic unsat explanation.

The result must map:
goal → blocking constraint → capability/rule → source evidence.

Do not expose raw solver constraint names to users.
```

---

# 125. Codex Prompt — Workflow Integration

After R0–R4 evaluation:

```text
Integrate reasoning-assisted workflow discovery behind a feature flag.

Pipeline:
Product Graph
→ Formal Abstraction
→ Reachability/Planning
→ Feasible Trace
→ Workflow Candidate

Keep the current discovery implementation available for comparison.

Add evaluation measuring:
- invalid/invented step rate;
- workflow recall;
- applicability accuracy;
- human edit distance.
```

---

# 126. Final Architecture Summary

The project evolves from:

```text
Code
→ Graph
→ Business Use Cases
→ Workflows
```

to:

```text
Code + Tests + Git + PRs + Docs + Runtime
                  ↓
         Evidence & Semantics
                  ↓
       Probabilistic Interpretation
                  ↓
         Formal Product Model
                  ↓
      Automated Reasoning Engine
                  ↓
  Verified Product Behavior & Traces
                  ↓
       Workflow / Product Insights
                  ↓
      Compiler / Runtime / MCP / API
```

---

# 127. Final Product Vision

PathCompiler should understand software at three levels:

## What probably exists?

Probabilistic semantic reasoning:

```text
capabilities
actions
goals
meaning
```

## What is logically possible?

Automated reasoning:

```text
reachability
plans
alternatives
constraints
properties
counterexamples
```

## What actually happens?

Runtime evidence:

```text
browser validation
completion
abandonment
real transitions
```

The feedback loop between the three creates a continuously improving executable model of the product.

---

# 128. North-Star Technical Principle

> **Use probabilistic reasoning to model uncertainty about meaning. Use formal reasoning to establish consequences of the model. Use runtime evidence to test whether the model matches reality.**

Do not ask an LLM to perform all three jobs.

---

# 129. North-Star Product Principle

PathCompiler should eventually answer:

```text
What can this product do?

How can a user accomplish this goal?

What other valid ways exist?

Who can perform this workflow?

Under which configuration?

Why is this workflow unavailable?

What minimum change would enable it?

What broke after this commit?

What new business capability did this PR introduce?

Which product property did this change violate?

Which UI exists but can never be reached?

Which business workflows lack tests?

Which workflow is unnecessarily complex?

Which generated workflow is uncertain and needs review?

What is the probability users actually complete it?

What assistance should we provide?
```

These are different views over the same continuously maintained product model.


---

# 130. Observability & Product Analytics Extension

This specification now adds a third major intelligence layer to PathCompiler:

```text
1. STATIC UNDERSTANDING
   "What does the product contain?"

2. FORMAL REASONING
   "What can users do?"

3. OBSERVABILITY
   "What do users actually do?"
```

The strategic advantage comes from comparing all three rather than treating analytics as a separate product.

---

# 131. Possible vs Observed

PathCompiler must maintain two distinct behavioral models:

```text
FORMAL MODEL
"What is possible?"

OBSERVED MODEL
"What actually happened?"
```

Example:

```text
Formal reasoning:
Goal = client_created

Valid paths:
A
B
C
D

Observed usage:
A → 74%
B → 21%
C → 5%
D → 0%
```

The system may report:

```text
Path D is formally reachable but has not been observed.
```

Possible explanations:

```text
undiscoverable feature
rare eligible cohort
new functionality
dead-looking UX
instrumentation gap
formal-model over-approximation
```

Never automatically claim which explanation is true.

---

# 132. Formal Minimum vs Observed User Effort

The planner may find:

```text
minimum feasible workflow = 5 interactions
```

while analytics show:

```text
median observed workflow = 13 interactions
```

Derived metric:

```text
Path Efficiency Ratio = observed path cost / minimum valid formal path cost
```

Example:

```text
13 / 5 = 2.6x
```

This means users take roughly 2.6 times the minimum formal effort.

This is a UX-friction signal, not proof that the formally shortest path is always the best experience.

---

# 133. Reachability-Adjusted Adoption

Traditional analytics often measures:

```text
feature users / all users
```

PathCompiler can instead measure:

```text
feature users / users for whom the feature was actually reachable
```

Example:

```text
Bulk Import

all active users: 10,000
formally eligible users: 800
observed users: 240
```

Traditional adoption:

```text
2.4%
```

Reachability-adjusted adoption:

```text
30%
```

This is much more meaningful for products with:

```text
roles
permissions
plans
feature flags
regions
tenant-specific configuration
```

Also support:

```text
Reachability-Adjusted Completion = completed eligible sessions / eligible sessions
```

---

# 134. Runtime Observability SDK

Create optional packages:

```text
packages/observability-core/
packages/analytics-sdk/
packages/analytics-react/
```

Core analytics must remain framework-independent.

React may expose an optional convenience provider:

```tsx
<PathCompilerProvider>
  <App />
</PathCompilerProvider>
```

but PathCompiler must also work without React.

---

# 135. Semantic Events, Not Raw Session Replay

Prefer semantic product events:

```text
workflow.started
workflow.step_reached
workflow.completed
workflow.abandoned
semantic_target.activated
goal.reached
route.changed
action.blocked
```

Avoid making PathCompiler a generic session-replay platform.

Do not collect by default:

```text
raw keystrokes
passwords
arbitrary form contents
payment data
health data
full DOM snapshots
mouse coordinates
```

The key unit of observation is the semantic product state/action.

---

# 136. Runtime Event Contract

Create a typed event union.

```ts
type ProductRuntimeEvent =
  | WorkflowStartedEvent
  | WorkflowStepReachedEvent
  | WorkflowCompletedEvent
  | WorkflowAbandonedEvent
  | SemanticTargetActivatedEvent
  | GoalReachedEvent
  | RouteChangedEvent
  | ActionBlockedEvent;
```

Common metadata:

```ts
type RuntimeEventBase = {
  eventId: string;
  timestamp: string;
  projectId: string;
  release?: string;
  workflowId?: string;
  workflowVersion?: number;
  semanticTarget?: string;
  sessionId: string;
  anonymousUserId?: string;
  route?: string;
  role?: string;
  context?: Record<string, string | number | boolean>;
};
```

Runtime events should be bound to application release whenever possible.

---

# 137. Semantic Targets as Observability Anchors

Existing semantic targets become analytics anchors.

Example:

```tsx
<button data-pathcompiler="clients.create">
  Add Client
</button>
```

The SDK may emit:

```json
{
  "type": "semantic_target.activated",
  "semantic_target": "clients.create",
  "route": "/clients"
}
```

This is substantially more useful than a generic button-click event.

---

# 138. Explicit Domain Events

Applications may emit high-confidence business events:

```ts
pathCompiler.track("client.created");
pathCompiler.goalReached("clients.created");
```

These events can confirm formal goals and workflow terminal states.

---

# 139. Privacy-First Defaults

Default configuration:

```yaml
analytics:
  enabled: false
  collect_pii: false
  hash_user_ids: true
```

Prefer:

```text
anonymous or pseudonymous IDs
semantic IDs
product context
release metadata
```

Avoid collecting user content unless explicitly configured and justified.

---

# 140. Analytics Transport Abstraction

Define:

```ts
interface AnalyticsTransport {
  send(events: ProductRuntimeEvent[]): Promise<void>;
}
```

Initial transports:

```text
ConsoleTransport
InMemoryTransport
HostedPathCompilerTransport
CustomTransport
```

Later adapters may include:

```text
Segment
Amplitude
Mixpanel
PostHog
Snowplow
Pendo
Customer warehouse
```

Customers must not be required to replace their existing analytics stack.

---

# 141. Observed Transition Graph

Runtime events produce an observed transition graph.

Example:

```text
CLIENTS_PAGE
   ├── 0.72 → OPEN_CREATE
   ├── 0.18 → SEARCH
   ├── 0.07 → LEAVE
   └── 0.03 → SETTINGS
```

Each observed edge may store:

```text
transition count
unique sessions
empirical frequency
median transition time
role segmentation
release segmentation
```

---

# 142. Formal vs Probabilistic Transition Model

Keep both representations.

Formal:

```text
CLIENTS_PAGE → OPEN_CREATE
allowed = true
```

Observed:

```text
CLIENTS_PAGE → OPEN_CREATE
frequency = 0.72
```

This enables four important classes:

```text
A. possible + observed
B. possible + not observed
C. not formally possible + observed
D. not possible + not observed
```

Class C is a high-priority discrepancy.

---

# 143. Behavior Reconciliation Engine

Create:

```text
packages/behavior-reconciliation/
```

Input:

```text
Formal Product Model
Observed Transition Graph
Runtime context
```

Output:

```ts
type BehaviorDiscrepancy =
  | UnexpectedObservedTransition
  | UnobservedReachablePath
  | CompletionMismatch
  | RuntimeConfigurationMismatch
  | WorkflowEfficiencyGap;
```

---

# 144. Unexpected Observed Behavior

Example:

```text
FORMAL:
VIEWER → DELETE_CLIENT = unreachable

OBSERVED:
VIEWER → DELETE_CLIENT seen 3 times
```

Report:

```text
HIGH-PRIORITY PRODUCT MODEL DISCREPANCY
```

Possible causes:

```text
authorization bug
formal-model extraction error
role context error
event-mapping error
```

Do not automatically label this a security vulnerability.

---

# 145. Workflow Analytics

For each workflow compute:

```text
starts
completions
abandonments
completion rate
median duration
median observed action count
p95 duration
```

Segment when privacy-safe by:

```text
role
release
plan
feature flag
```

---

# 146. Drop-Off Analysis + Formal Alternatives

Observed flow:

```text
A: 100%
B: 92%
C: 61%
Goal: 58%
```

Largest drop:

```text
B → C
```

Ask the formal planner:

```text
Are there valid alternative transitions from B?
```

If a lower-cost valid path exists:

```text
B → D → Goal
```

PathCompiler may report:

```text
High-friction transition detected.
A valid alternative route exists.
Product review recommended.
```

This is an automated UX hypothesis, not an automatic redesign recommendation.

---

# 147. Runtime-Assisted Workflow Discovery

Combine:

```text
formal feasible traces
+
observed successful traces
```

High-confidence workflow candidate:

```text
formally feasible
AND
observed repeatedly
AND
goal confirmed
```

Observed successful paths not represented in the workflow catalog should become new candidate workflows.

---

# 148. Model Repair From Runtime Contradictions

If repeated runtime evidence contradicts the formal model:

```text
observed transition
not represented in formal model
```

create a formal-model repair investigation.

Possible actions:

```text
inspect missing action
inspect permission extraction
inspect feature flag
inspect semantic mapping
inspect runtime context
```

Runtime evidence is not allowed to silently mutate canonical formal truth.

---

# 149. Release-Level Product Behavior Comparison

For release A vs release B compare:

```text
formal path changes
reachability changes
observed path changes
completion changes
time-to-goal changes
new drop-offs
role/configuration changes
```

Example:

```text
Formal minimum:
8 → 5 interactions

Observed median:
12 → 7 interactions

Completion:
64% → 81%
```

This connects code changes to actual user outcomes.

---

# 150. Product Friction Signals

Potential classifications:

```text
discoverability friction
navigation friction
permission friction
configuration friction
form friction
branch complexity
unnecessary repetition
dead-end state
```

Classification must remain evidence-backed.

---

# 151. Product Opportunity Detection

Examples of useful combined signals:

```text
formally reachable
+
high eligibility
+
low observed usage
+
low formal complexity
→ possible discoverability problem
```

```text
formally reachable
+
high usage
+
high observed inefficiency
→ possible UX friction
```

```text
formally unreachable
+
repeated blocked attempts
→ possible permission confusion or unmet demand
```

These are hypotheses requiring product review.

---

# 152. Attempted-but-Blocked Events

Optional runtime event:

```json
{
  "type": "action.blocked",
  "semantic_target": "reports.export",
  "reason": "permission"
}
```

This helps measure demand for inaccessible capabilities.

---

# 153. Probabilistic Transition Reasoning

Runtime analytics can estimate:

```text
P(next_state | current_state, context)
```

Example:

```text
P(OPEN_CREATE | CLIENTS_PAGE, role=NUTRITIONIST) = 0.72
```

Initially use empirical frequencies with minimum sample thresholds.

Later evaluate:

```text
Bayesian transition estimates
uncertainty intervals
probabilistic model checking
MDP assistance policies
```

Do not start with MDPs.

---

# 154. Recommended Path vs Shortest Path

Formal planner may say:

```text
Path A = minimum cost
```

Observed analytics may show:

```text
Path B = highest completion rate
```

Keep separate:

```text
minimum-cost path
most-successful observed path
recommended path
```

Future recommendation may combine:

```text
formal efficiency
behavioral success
context fit
observed time
```

Do not hardcode weights before evaluation.

---

# 155. Observability Must Not Mutate Workflow IR

Do not place volatile metrics directly in canonical Workflow IR.

Use:

```text
Workflow Registry
      ↓ workflow ID/version
Analytics Store
```

This keeps workflows stable while analytics evolve continuously.

---

# 156. Release Binding

Each runtime event should include:

```text
application release
workflow version
```

Possible initialization:

```ts
PathCompiler.init({
  release: process.env.APP_RELEASE
});
```

Without release binding, before/after analysis is unreliable.

---

# 157. Eligibility-Aware Analytics

Formal applicability should improve denominators.

Instead of:

```text
0.2% of all users used feature X
```

compute:

```text
31% of users for whom feature X was formally available used it
```

This is one of the strongest synergies between formal reasoning and observability.

---

# 158. Observability Phases

## Phase O0 — Event Model

Create `packages/observability-core`.

Implement:

```text
typed semantic runtime events
workflow lifecycle events
runtime context
release binding
privacy metadata
Zod validation
deterministic serialization
```

No network transport yet.

## Phase O1 — Lightweight Analytics SDK

Create `packages/analytics-sdk`.

Implement:

```text
track()
workflowStarted()
workflowCompleted()
goalReached()
batching
transport abstraction
ConsoleTransport
InMemoryTransport
```

## Phase O2 — React Integration

Create `packages/analytics-react`.

Integrate semantic targets and optional provider.

## Phase O3 — Workflow Runtime Telemetry

Automatically emit:

```text
workflow.started
workflow.step_reached
workflow.completed
workflow.abandoned
```

## Phase O4 — Domain Events

Support explicit product events and goal events.

## Phase O5 — Event Ingestion

Add:

```text
POST /v1/events/batch
```

with:

```text
schema validation
rate limiting
project isolation
privacy filtering
release metadata
```

## Phase O6 — Observed Transition Graph

Build transition counts and session-level paths.

## Phase O7 — Workflow Analytics

Compute completion, abandonment, duration and observed action counts.

## Phase O8 — Possible-vs-Observed Reconciliation

Compare formal model with observed graph.

## Phase O9 — Path Efficiency

Compare minimum formal cost with observed cost.

## Phase O10 — Drop-Off + Alternative Paths

Use planner to suggest valid alternative routes around high-friction transitions.

## Phase O11 — Probabilistic Transition Model

Estimate empirical transition probabilities with sample thresholds.

## Phase O12 — Release Behavior Diff

Compare formal and observed behavior across releases.

## Phase O13 — Existing Analytics Adapters

Only after the native event model is stable, add adapters for external analytics sources.

---

# 159. Observability MVP

The observability MVP is complete when the fixture app demonstrates:

```text
1. Formal model discovers at least two valid workflows.
2. Runtime SDK records semantic events.
3. Simulated sessions follow different paths.
4. Observed transition graph is built.
5. Workflow completion rate is computed.
6. Most common path is identified.
7. One formally valid but unobserved path is detected.
8. Planner produces minimum formal path.
9. Path Efficiency Ratio is computed.
10. An unexpected observed transition is injected.
11. Reconciliation engine flags the contradiction.
```

---

# 160. Combined Reference Demo

Ideal end-to-end demo:

```text
CODE
↓
Product Graph
↓
Formal Product Model
↓
Planner discovers:
Create Client path A
Create Client path B
↓
Runtime analytics:
80% use A
20% use B
↓
New PR changes UI
↓
Formal minimum:
6 → 4 steps
↓
After release:
Observed median:
9 → 5 actions
Completion:
68% → 84%
↓
PathCompiler reports:
The release reduced formal complexity
and observed user friction.
```

---

# 161. Existing Analytics Integration

PathCompiler must support both:

```text
PathCompiler-native instrumentation
```

and:

```text
existing analytics ingestion
```

Future adapters may map existing events into semantic PathCompiler events.

Do not require customers to replace:

```text
Segment
Amplitude
Mixpanel
Pendo
PostHog
Snowplow
custom warehouse
```

---

# 162. Self-Hosted / Warehouse-First Analytics

Long-term enterprise mode:

```text
PathCompiler SDK
↓
customer warehouse
↓
PathCompiler analysis worker
```

The architecture must not require all raw analytics to live in PathCompiler cloud.

---

# 163. Observability Is Optional

Core PathCompiler must still work from:

```text
code
tests
Git
formal reasoning
```

Observability adds:

```text
actual usage
transition frequency
friction
adoption
probabilistic behavior
```

---

# 164. Revised Global Build Order

Recommended order:

```text
1. Static analyzer
2. Product graph
3. Capability discovery
4. Formal product model
5. SMT reachability
6. Planning
7. Workflow compiler
8. Runtime workflow SDK
9. Observability event model
10. Analytics SDK
11. Observed transition graph
12. Formal-vs-observed reconciliation
13. UX/friction metrics
14. Probabilistic transition modeling
15. Existing analytics adapters
16. Advanced probabilistic model checking
17. MDP assistance experiments
```

Semantic identity and workflow IDs should stabilize before large analytics infrastructure is built.

---

# 165. Observability Codex Prompt — O0

```text
Read AGENTS.md, PRODUCT_ARCHITECTURE.md, CODEX_BUILD_SPEC.md,
and REASONING_ENGINE_BUILD_SPEC.md.

Implement Phase O0 — Observability Event Model only.

Requirements:
- create packages/observability-core;
- define typed semantic runtime events;
- define workflow lifecycle events;
- define runtime context and release binding;
- preserve privacy-first defaults;
- do not add network transport;
- do not collect raw DOM/input content;
- add Zod validation and unit tests;
- update docs/phases/STATUS.md.
```

---

# 166. Observability Codex Prompt — O1

```text
Implement Phase O1 — Lightweight Analytics SDK.

Requirements:
- create packages/analytics-sdk;
- support batching;
- add transport abstraction;
- support semantic/domain events;
- support workflow lifecycle helpers;
- preserve no-PII defaults;
- add ConsoleTransport and InMemoryTransport;
- do not add hosted ingestion yet.
```

---

# 167. Observability Codex Prompt — O8

```text
Implement Possible-vs-Observed Reconciliation.

Compare the current Formal Product Model with the Observed Transition Graph.

Classify:
- possible + observed;
- possible + not observed;
- observed + formally unexpected.

Return product-semantic discrepancies with evidence.
Respect minimum sample-size rules.
Do not label discrepancies as bugs automatically.
```

---

# 168. Revised Full Architecture

```text
RAW SOFTWARE EVIDENCE
Code / Tests / Git / PRs / Docs / Permissions / Flags
                    ↓
STATIC PRODUCT UNDERSTANDING
                    ↓
PROBABILISTIC SEMANTIC INTERPRETATION
                    ↓
FORMAL PRODUCT MODEL
                    ↓
AUTOMATED REASONING
SMT / Planning / Model Checking / Optimization
                    ↓
VERIFIED POSSIBLE BEHAVIOR
                    ↓
WORKFLOW IR / REGISTRY
                    ↓
SDK / REST / MCP / Guides

ACTUAL PRODUCT RUNTIME
Users
  ↓
Semantic Runtime Events
  ↓
OBSERVED BEHAVIOR MODEL
  ↓
BEHAVIOR RECONCILIATION
  ↓
Product Intelligence
```

---

# 169. Revised Strategic Product Thesis

PathCompiler should not merely say:

> "We tell software companies what their product does."

The stronger thesis is:

> **PathCompiler continuously maps what a software product allows users to do, observes what users actually do, and detects when code changes alter either.**

This connects:

```text
code
formal behavior
actual user behavior
```

---

# 170. New Product Outputs

The combined system can produce:

```text
Unexpected reachability
Broken workflows
Unused valid paths
High-friction paths
Permission regressions
Workflow coverage gaps
Behavior changes after releases
Stale AI/support knowledge
Dead features
Business-logic violations
Reachability-adjusted adoption
Business-level E2E gaps
Alternative user paths
Semantic release intelligence
```

---

# 171. Final Technical Principle

> **Static analysis tells us what is implemented. Formal reasoning tells us what is possible. Observability tells us what actually happens. Probabilistic reasoning tells us what is likely.**

The system must preserve these as distinct evidence layers rather than collapsing them into one opaque AI score.

---

# 172. Self-Improvement Loop Extension

PathCompiler should be designed as the **reasoning, evaluation, experimentation, and feedback infrastructure for self-improving software**.

The platform is responsible for nearly the entire improvement loop, with one explicit architectural boundary:

> **PathCompiler does not own the implementation strategy used to mutate the codebase.**

That implementation step is delegated to an external coding harness or human engineer.

Everything before and after code mutation belongs to PathCompiler.

The complete target loop is:

```text
SOFTWARE
   ↓
Code + Tests + Git
   ↓
Product Model
   ↓
Formal Reasoning
   ↓
Runtime
   ↓
Observability / Analytics
   ↓
Diagnosis
   ↓
Improvement Opportunity
   ↓
Improvement Recommendation
   ↓
Harness Task Specification
   ↓
────────────────────────────────────
EXTERNAL CODING HARNESS BOUNDARY
   ↓
Code / Config / UX Mutation
   ↓
Candidate Commit / PR
   ↓
Mutation Result Contract
────────────────────────────────────
   ↓
PathCompiler Candidate Evaluation
   ↓
Formal Checks + Tests + Browser Verification
   ↓
Human Approval
   ↓
Experiment / Deployment Coordination
   ↓
Runtime Observation
   ↓
Impact Measurement
   ↓
Adopt / Reject / Rollback / Iterate
   ↓
Improvement Memory / Learning Ledger
   └──────────────────────────────↺
```

The goal is not to compete with coding-agent harnesses.

The goal is to provide the **intelligence, specification, verification, and learning loop** around them.

---

# 173. Explicit System Boundary

PathCompiler owns:

```text
Understand
Observe
Reason
Diagnose
Prioritize
Recommend
Specify desired product change
Specify invariants and protected behavior
Specify evaluation criteria
Specify experiment success criteria
Evaluate candidate implementation
Verify semantics
Verify formal properties
Verify browser behavior
Measure production outcome
Recommend adoption / rejection / rollback
Persist learning
```

The external harness owns:

```text
Read HarnessTaskSpec
Explore repository
Choose implementation strategy
Choose files to modify
Use editor/tool/browser/shell as needed
Generate code/config/UI changes
Add or update implementation-level tests
Create candidate commit/branch/PR
Return MutationResult
```

PathCompiler must not depend on how the harness performs those actions.

---

# 174. Harness-Agnostic Architecture

The same PathCompiler recommendation should be consumable by:

```text
Codex
Claude Code
Cursor
Devin
custom internal coding agent
company-specific harness
human engineer
```

Therefore the handoff contract must contain product intent and constraints, not tool-specific instructions.

Bad handoff:

```text
Open file X.
Replace line 34.
Run command Y.
Click button Z.
```

Good handoff:

```text
Target workflow:
clients.create

Observed problem:
high abandonment at confirmation

Desired product effect:
reduce unnecessary interaction cost while preserving validation and permissions

Protected behavior:
clients.write remains mandatory
client validation remains mandatory
audit event remains mandatory

Success criteria:
formal path cost decreases
existing workflows remain valid
business properties continue to hold
```

The harness decides how to implement this.

---

# 175. Improvement Lifecycle Objects

The self-improvement loop should be represented as linked first-class artifacts.

Minimum chain:

```text
Finding
  ↓
ImprovementRecommendation
  ↓
HarnessTaskSpec
  ↓
MutationResult
  ↓
CandidateEvaluation
  ↓
ExperimentSpec
  ↓
ExperimentRun
  ↓
OutcomeAssessment
  ↓
AdoptionDecision
  ↓
ImprovementMemoryRecord
```

Use stable IDs:

```text
finding_id
recommendation_id
harness_task_id
mutation_id
evaluation_id
experiment_id
outcome_id
decision_id
```

Every artifact must retain links to its predecessors.

---

# 176. Product Finding

A `ProductFinding` is an evidence-backed statement about the product.

Examples:

```text
workflow has high abandonment
workflow takes much longer than formal minimum
feature is broadly reachable but rarely used
users repeatedly attempt an unavailable capability
runtime behavior contradicts formal permissions
release caused completion regression
business workflow lacks E2E coverage
```

Suggested type:

```ts
interface ProductFinding {
  id: string;
  kind:
    | "workflow_friction"
    | "low_adoption"
    | "unexpected_reachability"
    | "unexpected_unreachability"
    | "runtime_formal_discrepancy"
    | "test_coverage_gap"
    | "release_regression"
    | "product_dead_end"
    | "unused_reachable_path"
    | "behavioral_workaround"
    | "other";

  target: ProductTarget;
  summary: string;
  evidence: EvidenceBundle;
  severity: "info" | "low" | "medium" | "high" | "critical";
  confidence: ConfidenceAssessment;
  detectedAt: string;
  modelVersion: string;
  release?: string;
}
```

A finding is not yet a recommendation.

---

# 177. Improvement Opportunity

An `ImprovementOpportunity` groups one or more findings into a product-level opportunity.

Examples:

```text
Improve Create Client workflow
Improve discoverability of Bulk Import
Investigate unexpected Assistant export access
Add support for repeated manual plan-copy behavior
Restore workflow removed by recent release
```

The opportunity layer prevents recommendation generation from reacting to every noisy metric independently.

---

# 178. Improvement Recommendation Categories

Recommendations should be classified into a small set of product actions.

Initial categories:

```text
FIX
IMPROVE
PROMOTE
BUILD
DEPRIORITIZE
INVESTIGATE
```

Definitions:

## FIX

Something appears broken, inconsistent, or regressed.

Examples:

```text
permission regression
runtime/formal discrepancy
workflow no longer reachable
unexpected error after release
```

## IMPROVE

Capability is valuable/used but experience is inefficient.

Examples:

```text
high drop-off
high path efficiency ratio
excessive time-to-goal
confusing branching
```

## PROMOTE

Capability works well but eligible users do not discover/use it.

Typical evidence:

```text
broad formal eligibility
low reachability-adjusted adoption
high success when discovered
low friction once started
```

## BUILD

Potential missing capability.

Strong evidence may include:

```text
repeated behavioral workaround
explicit user feedback if available
no equivalent formal capability exists
high recurring effort
```

Without explicit feedback, classify as a product hypothesis requiring validation.

## DEPRIORITIZE

Existing feature has sustained low usage/demand despite broad eligibility.

Never automatically remove the feature.

## INVESTIGATE

Evidence is insufficient or contradictory.

Use this instead of forcing a product recommendation.

---

# 179. Improvement Hypothesis

Every recommendation should have an explicit hypothesis.

Example:

```text
Finding:
38% of users abandon between client.details and client.confirmation.

Hypothesis:
The confirmation step adds unnecessary interaction cost and contributes to abandonment.

Proposed direction:
Simplify or eliminate the redundant transition while preserving validation and audit requirements.
```

Suggested type:

```ts
interface ImprovementHypothesis {
  statement: string;
  mechanism?: string;
  expectedEffect: MetricEffect[];
  confidence: ConfidenceAssessment;
  falsifiable: boolean;
}
```

A hypothesis must be falsifiable whenever possible.

---

# 180. ImprovementRecommendation as a Core API Object

The `ImprovementRecommendation` is one of the most important interfaces in the platform.

Suggested shape:

```ts
interface ImprovementRecommendation {
  id: string;
  findingIds: string[];
  opportunityId?: string;

  category:
    | "fix"
    | "improve"
    | "promote"
    | "build"
    | "deprioritize"
    | "investigate";

  target: ProductTarget;

  problem: {
    summary: string;
    classification: string;
    evidence: EvidenceBundle;
  };

  hypothesis: ImprovementHypothesis;

  desiredOutcomes: MetricGoal[];

  protectedBehaviors: ProductPropertyRef[];
  hardConstraints: ProductConstraintRef[];

  allowedChangeScope?: ChangeScope[];
  prohibitedChangeScope?: ChangeScope[];

  acceptanceCriteria: AcceptanceCriteria;

  experimentProposal?: ExperimentSpecDraft;

  priority: PriorityAssessment;
  confidence: ConfidenceAssessment;

  generatedAt: string;
  sourceModelVersion: string;
  sourceRelease?: string;
}
```

---

# 181. Recommendation Must Contain Evidence, Not Only Advice

A harness or engineer must be able to answer:

```text
Why are we changing this?
What exactly is wrong?
What metric indicates the problem?
Which users are affected?
What evidence supports the hypothesis?
What must not be broken?
How will we know the candidate is successful?
```

Example:

```yaml
recommendation_id: imp_9281
category: improve

target:
  workflow: clients.create
  goal: clients.created

problem:
  classification: workflow_friction
  evidence:
    formal_minimum_actions: 5
    observed_median_actions: 12
    completion_rate: 0.51
    largest_dropoff:
      from: client.details
      to: client.confirmation
      rate: 0.38

hypothesis:
  statement: >
    The confirmation transition may be causing unnecessary friction.
  confidence: 0.78

desired_outcomes:
  - metric: workflow_completion_rate
    direction: increase
  - metric: median_action_count
    direction: decrease

protected_behaviors:
  - viewer_must_not_create_client
  - clients_write_permission_required
  - client_validation_required
  - audit_event_client_created_required
```

---

# 182. Recommendation Confidence

Do not confuse:

```text
confidence that the finding is real
```

with:

```text
confidence that the proposed intervention will improve the outcome
```

Track both.

Example:

```yaml
finding_confidence: 0.96
hypothesis_confidence: 0.62
```

This is important because the product may correctly identify friction while still being uncertain about the best solution.

---

# 183. Recommendation Priority

Priority should combine evidence such as:

```text
severity
number of eligible users
number of affected users
business importance of workflow
completion loss
revenue relevance if supplied by customer
frequency
confidence
recent regression status
```

Do not create one opaque AI priority number without an explanation.

Return components and rationale.

---

# 184. HarnessTaskSpec

`HarnessTaskSpec` is the machine-readable handoff from PathCompiler to the external coding harness.

It must contain enough context to implement the desired product change without prescribing the harness's internal tool strategy.

Suggested shape:

```ts
interface HarnessTaskSpec {
  schemaVersion: string;
  id: string;
  recommendationId: string;

  repository: {
    projectId: string;
    baseCommit: string;
    targetBranch?: string;
  };

  objective: {
    summary: string;
    target: ProductTarget;
    desiredSemanticChange: SemanticChangeIntent[];
  };

  rationale: {
    findingSummary: string;
    evidence: EvidenceBundle;
    hypothesis: ImprovementHypothesis;
  };

  constraints: {
    hard: ProductConstraintRef[];
    protectedBehaviors: ProductPropertyRef[];
    prohibitedSemanticChanges?: SemanticChangeIntent[];
  };

  acceptanceCriteria: AcceptanceCriteria;

  relevantContext: {
    workflowIds: string[];
    capabilityIds: string[];
    semanticTargets?: string[];
    evidenceRefs?: EvidenceRef[];
    likelyRelevantSourceRefs?: EvidenceRef[];
  };

  requestedArtifacts: HarnessArtifactRequest[];

  outputContract: MutationResultContract;
}
```

---

# 185. HarnessTaskSpec Is Not a Patch Plan

PathCompiler should not tell the harness:

```text
which exact files must be modified
which function must be rewritten
which tool calls to execute
which editor command to run
how to structure agent memory
how to browse the repository
```

It may provide **relevant evidence/source references** because they are useful context.

The harness is free to discover a better implementation path.

---

# 186. Desired Semantic Change

The task specification should describe the desired change in product semantics.

Examples:

```text
reduce clients.create minimum interaction cost
remove unnecessary intermediate transition
preserve all current eligible roles
preserve validation invariant
preserve client.created audit event
make bulk_import discoverable from Clients page
restore reports.export reachability for MANAGER
```

This gives the harness an outcome, not an implementation recipe.

---

# 187. Protected Behavior

Every mutation task should explicitly list behavior that must remain unchanged when known.

Examples:

```text
permissions
billing constraints
validation
security boundaries
audit events
compliance confirmation
existing workflows
API backward compatibility
```

This becomes input to evaluation.

---

# 188. Acceptance Criteria

Acceptance criteria should contain multiple layers.

Example:

```yaml
acceptance_criteria:
  semantic:
    workflow: clients.create
    expected_change:
      minimum_action_cost:
        direction: decrease

  formal:
    properties_must_hold:
      - viewer_cannot_create_client
      - clients_write_required

  regression:
    unrelated_workflows_must_remain_reachable: true

  tests:
    existing_tests_must_pass: true

  browser:
    goal_must_be_reached: clients.created
```

Do not require production metrics at candidate-evaluation time.

Those belong to experiments/outcome measurement.

---

# 189. External Harness Response: MutationResult

The harness must return a structured `MutationResult`.

Suggested shape:

```ts
interface MutationResult {
  schemaVersion: string;
  id: string;
  harnessTaskId: string;
  recommendationId: string;

  repository: {
    baseCommit: string;
    candidateCommit: string;
    branch?: string;
    pullRequest?: string;
  };

  status: "completed" | "partial" | "blocked" | "failed";

  changedFiles?: string[];

  implementationSummary: string;

  claimedSemanticChanges: SemanticChangeClaim[];

  testsAddedOrChanged?: TestArtifactRef[];

  assumptions: string[];
  unresolvedQuestions: string[];

  artifacts?: HarnessProducedArtifact[];

  harnessMetadata?: {
    provider?: string;
    version?: string;
    runId?: string;
  };
}
```

The harness's claims are not trusted automatically.

They are hypotheses that PathCompiler evaluates.

---

# 190. Candidate Evaluation Pipeline

Once `MutationResult` is received, PathCompiler should reconstruct the product model from the candidate commit.

```text
Candidate Commit
   ↓
Static Analysis
   ↓
Product Graph Candidate
   ↓
Formal Product Model Candidate
   ↓
Semantic Diff
   ↓
Formal Verification
   ↓
Tests
   ↓
Browser Verification
   ↓
Candidate Evaluation
```

---

# 191. Evaluation Question 1 — Did the Intended Semantic Change Occur?

Example recommendation:

```text
reduce formal path cost for clients.create
```

Harness claim:

```text
minimum actions reduced 6 → 5
```

PathCompiler must independently calculate:

```text
before = 6
after = 5
```

Only then mark:

```text
intended_semantic_change = achieved
```

---

# 192. Evaluation Question 2 — What Else Changed?

Use semantic diff to detect unintended consequences.

Expected:

```text
clients.create changed
```

Candidate may also produce:

```text
clients.delete applicability changed
reports.export lost reachability
ASSISTANT gained write permission
```

These must be surfaced even if tests pass.

---

# 193. Expected vs Actual Semantic Diff

Represent:

```ts
interface SemanticChangeEvaluation {
  expected: SemanticChangeIntent[];
  observed: SemanticChange[];
  matched: SemanticChange[];
  missingExpected: SemanticChangeIntent[];
  unexpectedObserved: SemanticChange[];
}
```

This is a core candidate-evaluation artifact.

---

# 194. Formal Candidate Verification

Re-run all relevant formal properties.

Examples:

```text
VIEWER cannot create client
VIEWER cannot delete client
client creation requires clients.write
client.created requires valid form
required audit event remains reachable
```

Use model slicing to avoid checking unrelated product areas when possible.

Critical global properties may always run.

---

# 195. Workflow Regression Evaluation

For candidate commit:

```text
all previously approved workflows
```

should be classified:

```text
unchanged
intentionally changed
unexpectedly changed
unreachable
needs re-verification
```

This should feed the Candidate Evaluation report.

---

# 196. Test Evaluation

PathCompiler should ingest test results but reason at business level.

Do not stop at:

```text
247 tests passed
```

Also report:

```text
which workflows are covered
which changed workflows have tests
whether business-level coverage decreased
whether a new path lacks E2E coverage
```

---

# 197. Browser Candidate Verification

Run relevant workflows in a candidate environment where available.

Verify:

```text
semantic target exists
expected step is reachable
goal occurs
runtime event occurs
route/state matches expected result
protected workflow still succeeds
forbidden workflow remains unavailable
```

Browser verification is empirical candidate evidence.

---

# 198. CandidateEvaluation Artifact

Suggested shape:

```ts
interface CandidateEvaluation {
  id: string;
  mutationId: string;
  recommendationId: string;

  status:
    | "pass"
    | "pass_with_warnings"
    | "fail"
    | "inconclusive";

  intendedChange: SemanticChangeEvaluation;
  formalResults: PropertyVerificationSummary;
  workflowRegression: WorkflowRegressionSummary;
  testResults: BusinessTestSummary;
  browserResults?: BrowserVerificationSummary;

  risks: EvaluationRisk[];
  warnings: EvaluationWarning[];

  eligibleForExperiment: boolean;
  recommendedNextStep:
    | "human_review"
    | "experiment"
    | "revise_candidate"
    | "reject";
}
```

---

# 199. Technical Validity vs Product Improvement

A candidate can be technically valid but still not improve the product.

Example:

```text
Formal properties: PASS
Tests: PASS
Browser: PASS
Minimum path cost: 7 → 5
```

This proves:

```text
candidate is technically coherent
```

It does **not** prove:

```text
users will be better off
```

Production/experiment measurement is required.

---

# 200. Experiment Specification

PathCompiler should produce an `ExperimentSpec` when the recommendation is best validated behaviorally.

Example:

```yaml
experiment_id: exp_722
recommendation_id: imp_9281
mutation_id: mut_4472

hypothesis:
  reducing the confirmation transition will increase completion

control:
  release: current

treatment:
  release: candidate

population:
  workflow: clients.create
  roles:
    - nutritionist

allocation:
  control: 0.50
  treatment: 0.50

primary_metric:
  workflow_completion_rate

secondary_metrics:
  - median_action_count
  - median_completion_time

guardrails:
  - error_rate
  - permission_violation_rate
  - downstream_workflow_completion

success_criteria:
  workflow_completion_rate:
    minimum_relative_improvement: 0.15
```

---

# 201. Experiment Goals Must Be Defined Before Measurement

Do not examine post-release metrics first and then choose success criteria.

Define before experiment:

```text
primary metric
secondary metrics
guardrails
minimum detectable/meaningful effect
observation window
eligible population
stop conditions
```

This reduces evaluation bias.

---

# 202. Deployment Coordination Boundary

PathCompiler should understand **what needs to be deployed/experimented**, but does not need to own deployment infrastructure initially.

PathCompiler responsibilities:

```text
produce experiment/deployment intent
identify treatment artifact
identify target population
identify required feature flag/variant if available
track release binding
observe metrics after activation
```

External systems may perform the actual rollout:

```text
GitHub Actions
Vercel
ArgoCD
LaunchDarkly
Statsig
custom CI/CD
customer deployment platform
```

---

# 203. CI/CD Is Explicitly Deferred From the Core MVP

Do not build a complete CI/CD platform.

Initial integration should stop at:

```text
candidate commit / PR
candidate evaluation result
experiment specification
release metadata
```

Later adapters may trigger or observe deployment workflows.

The product should be compatible with CI/CD without becoming CI/CD.

---

# 204. Deployment Adapter Interface — Future

Future abstraction:

```ts
interface DeploymentAdapter {
  prepare(request: DeploymentRequest): Promise<DeploymentPlan>;
  deploy?(request: DeploymentExecutionRequest): Promise<DeploymentResult>;
  getStatus(ref: DeploymentRef): Promise<DeploymentStatus>;
}
```

For early phases, only read/coordinate deployment metadata.

Do not implement deployment execution unless separately prioritized.

---

# 205. Experiment Provider Adapters — Future

Potential adapters:

```text
LaunchDarkly
Statsig
Optimizely
GrowthBook
custom internal experimentation platform
```

Initial PathCompiler architecture should define contracts without requiring any provider.

---

# 206. Runtime Measurement After Candidate Release

Once treatment is live, PathCompiler observability tracks:

```text
workflow starts
workflow completion
abandonment
observed path cost
time-to-goal
error events
formal/runtime discrepancies
downstream workflow impact
```

Segment by experiment arm and eligibility.

---

# 207. Before / After Measurement

Example:

```text
CONTROL
completion: 51%
median actions: 12
median duration: 94 s

TREATMENT
completion: 69%
median actions: 7
median duration: 52 s
```

This provides empirical evidence that the candidate improved behavior.

---

# 208. Guardrail Metrics

Every improvement can degrade another area.

Track guardrails such as:

```text
error rate
permission violations
support escalation
conversion loss
downstream workflow completion
latency
user abandonment
```

Guardrails depend on product context.

---

# 209. Outcome Assessment

Suggested type:

```ts
interface OutcomeAssessment {
  id: string;
  experimentId: string;
  recommendationId: string;
  mutationId: string;

  primaryMetric: MetricComparison;
  secondaryMetrics: MetricComparison[];
  guardrails: GuardrailAssessment[];

  statisticalAssessment?: StatisticalAssessment;
  practicalSignificance?: PracticalSignificanceAssessment;

  outcome:
    | "improved"
    | "neutral"
    | "worse"
    | "inconclusive";

  evidence: EvidenceBundle;
}
```

---

# 210. Formal Improvement vs Behavioral Improvement

Keep both separately.

Example:

```text
Formal path complexity:
7 → 5

Observed completion:
51% → 43%
```

Conclusion:

```text
formal simplification succeeded
behavioral outcome worsened
```

Do not call this a successful improvement.

---

# 211. Adoption Decision

After evaluation and measurement, PathCompiler should recommend one of:

```text
ADOPT
REJECT
ROLLBACK
ITERATE
EXTEND_EXPERIMENT
INCONCLUSIVE
```

Human remains final authority initially.

---

# 212. AdoptionDecision Artifact

Example:

```yaml
decision_id: dec_81
recommendation_id: imp_9281
mutation_id: mut_4472
experiment_id: exp_722

recommendation: adopt

reason:
  primary metric improved above threshold
  guardrails remained healthy
  formal properties passed
  no unrelated semantic regression detected

human_approval_required: true
```

---

# 213. Human Approval Boundary

Initial system must require human approval before:

```text
merging code
production deployment
permission changes
billing changes
security-sensitive behavior
wide experiment rollout
rollback affecting active users
```

Automation level may increase only for narrowly scoped, low-risk changes after proven reliability.

---

# 214. Improvement Memory Ledger

Persist the complete history:

```text
Problem
↓
Finding
↓
Hypothesis
↓
Recommendation
↓
Harness implementation
↓
Candidate evaluation
↓
Experiment
↓
Outcome
↓
Decision
```

This prevents the platform from repeating failed hypotheses and creates a learning dataset.

---

# 215. ImprovementMemoryRecord

Suggested shape:

```ts
interface ImprovementMemoryRecord {
  id: string;
  target: ProductTarget;

  findingIds: string[];
  recommendationId: string;
  mutationId?: string;
  evaluationId?: string;
  experimentId?: string;
  outcomeId?: string;
  decisionId?: string;

  hypothesisSummary: string;
  interventionSummary?: string;
  outcomeSummary?: string;

  reusableLessons: ImprovementLesson[];

  createdAt: string;
  closedAt?: string;
}
```

---

# 216. Learning From Failed Recommendations

Example:

```text
Hypothesis:
confirmation screen causes friction

Intervention:
remove confirmation

Result:
completion -8%

Lesson:
confirmation may provide useful user confidence/context in this workflow family
```

Future recommendation ranking should consider this historical evidence.

Do not treat one failed experiment as a universal causal law.

---

# 217. Improvement Knowledge Graph

Long term, connect:

```text
workflow
finding
hypothesis
recommendation
mutation
experiment
outcome
```

This supports questions such as:

```text
Which kinds of interventions historically improved onboarding flows?
Which workflow families respond badly to removing confirmations?
Which recommendations repeatedly fail?
Which UX changes improve completion without harming downstream metrics?
```

---

# 218. Recommendation Generator Architecture

The recommendation engine should not be one opaque LLM call.

Suggested pipeline:

```text
Findings
↓
Pattern Classification
↓
Relevant Formal Context
↓
Historical Improvement Memory
↓
Candidate Hypotheses
↓
Constraint Filtering
↓
Recommendation Candidates
↓
Risk Assessment
↓
Human-readable Recommendation
↓
HarnessTaskSpec
```

---

# 219. Recommendation Evidence Sources

Possible evidence:

```text
formal workflow structure
observed transition graph
completion/drop-off analytics
reachability-adjusted adoption
semantic release changes
business properties
runtime discrepancies
test coverage
historical experiments
optional external user feedback
support evidence if integrated
```

External feedback is useful but not required for core recommendation generation.

---

# 220. Recommendation Generator Must Separate Diagnosis From Intervention

Example:

```text
Diagnosis:
users abandon at confirmation
```

Possible interventions:

```text
remove confirmation
redesign confirmation
pre-fill values
move confirmation later
explain consequences better
```

Do not pretend the diagnosis uniquely determines the implementation.

The harness and human product team may select a different intervention.

---

# 221. Harness May Return Alternative Interpretation

The external harness should be allowed to return:

```text
blocked
requires clarification
assumption invalid
recommendation cannot be implemented safely
alternative implementation suggested
```

MutationResult must support these outcomes.

The interface is a collaboration contract, not a one-way command channel.

---

# 222. Harness Clarification Protocol

If the harness identifies a material ambiguity, it may return:

```yaml
status: blocked
unresolved_questions:
  - Does the confirmation step satisfy a compliance requirement not represented in the formal model?
```

PathCompiler can:

```text
look for more evidence
ask human reviewer
update recommendation
```

Do not force implementation through unresolved high-risk ambiguity.

---

# 223. Mutation Scope

Recommendations may target more than source code.

Possible mutation types:

```text
UX structure
navigation
configuration
feature flags
default settings
prompt/agent instructions
workflow guidance
product copy
code implementation
```

The harness layer may specialize by mutation type.

---

# 224. Non-Code Improvement Paths

Some recommendations may not require code generation.

Examples:

```text
recommend a different existing workflow to users
change guide ordering
change default assistant recommendation
change feature-flag rollout
promote an existing feature
adjust onboarding
```

PathCompiler should not route every recommendation to a coding harness.

---

# 225. Routing Recommendations to Executors

Future abstraction:

```ts
interface ImprovementExecutorRouter {
  route(
    recommendation: ImprovementRecommendation
  ): Promise<ExecutorRoute>;
}
```

Possible executors:

```text
coding harness
configuration service
feature flag platform
content/guidance system
human product team
no automatic executor
```

For MVP, coding recommendations can be exported as `HarnessTaskSpec`.

---

# 226. Candidate Evaluation Must Be Independent From Mutation Agent

Important safety/reliability principle:

> **The system that proposes or implements a change must not be the sole evaluator of that change.**

The harness may submit:

```text
implementation summary
test claims
expected semantic effect
```

PathCompiler independently verifies them.

---

# 227. Locked Evaluation Criteria

Before the harness runs, freeze:

```text
protected properties
acceptance criteria
required workflows
primary experiment metrics
key guardrails
```

The harness must not be able to silently weaken evaluation criteria to make its change pass.

---

# 228. Candidate Evaluation Snapshot

Store immutable snapshot of:

```text
base commit
formal model version
workflow registry version
protected properties
acceptance criteria
recommendation
```

This allows reproducible evaluation of the candidate.

---

# 229. Rollback Reasoning

If post-deployment outcome is harmful, PathCompiler should be able to recommend rollback based on:

```text
primary metric regression
guardrail violation
runtime/formal discrepancy
unexpected reachability
severe workflow regression
```

Actual rollback execution remains external initially.

---

# 230. Post-Deployment Semantic Verification

After deployment, confirm that runtime release corresponds to the evaluated candidate.

Use:

```text
release ID
candidate commit
workflow version
formal model version
```

Do not compare experiment analytics against the wrong model version.

---

# 231. Experiment Eligibility

Not every recommendation needs an A/B experiment.

Examples:

```text
security regression fix
broken workflow restoration
permission bug
```

may require immediate verified fix rather than randomization.

Examples:

```text
UX simplification
new navigation
feature promotion
```

may benefit from controlled experimentation.

PathCompiler should classify recommendation validation strategy.

---

# 232. Validation Strategy Types

```text
FORMAL_ONLY
FORMAL_PLUS_TESTS
BROWSER_VALIDATED
SHADOW_MODE
CANARY
A_B_EXPERIMENT
BEFORE_AFTER_OBSERVATIONAL
MANUAL_REVIEW_ONLY
```

The recommendation/evaluation system should select or suggest an appropriate strategy.

---

# 233. Product Improvement Metrics

Potential metric families:

## Workflow success

```text
completion rate
abandonment rate
time-to-goal
steps-to-goal
path efficiency ratio
```

## Adoption

```text
reachability-adjusted adoption
eligible-user activation
repeat usage
```

## Reliability

```text
error rate
workflow failure rate
unexpected formal/runtime discrepancy
```

## Product complexity

```text
branch count
minimum path cost
observed path entropy
```

## Support/knowledge

```text
how-to escalation rate
assistant resolution rate
stale-workflow count
```

Only use metrics available and valid for the customer's product.

---

# 234. Improvement Scorecard

Candidate/outcome reports should present a small scorecard rather than a single opaque score.

Example:

```text
Workflow completion:       +18%
Median user actions:       -35%
Median completion time:    -22%
Error rate:                unchanged
Permission invariants:     PASS
Downstream completion:     unchanged
```

This is easier to trust than:

```text
Improvement score = 87
```

---

# 235. Self-Improvement Maturity Levels

PathCompiler should support increasing autonomy over time.

```text
LEVEL 1 — UNDERSTAND
Build product model and workflows.

LEVEL 2 — OBSERVE
Measure actual product behavior.

LEVEL 3 — DIAGNOSE
Identify friction/regressions/opportunities.

LEVEL 4 — RECOMMEND
Generate evidence-backed improvement proposals.

LEVEL 5 — SPECIFY
Produce machine-readable HarnessTaskSpec.

LEVEL 6 — EVALUATE
Independently evaluate external candidate mutations.

LEVEL 7 — EXPERIMENT
Measure candidate impact in real usage.

LEVEL 8 — HUMAN-APPROVED SELF-IMPROVEMENT
Continuously recommend/implement/evaluate with human approval.

LEVEL 9 — SELECTIVE AUTONOMY
Only for low-risk, highly validated classes of change.
```

Do not jump directly to Level 9.

---

# 236. Updated Strategic Architecture

```text
                     PATHCOMPILER

                STATIC UNDERSTANDING
Code / Tests / Git / PRs / Docs / Permissions / Flags
                         ↓
                  PRODUCT MODEL
                         ↓
                  FORMAL REASONING
                         ↓
                POSSIBLE BEHAVIOR
                         │
                         │
USERS ─────────► OBSERVABILITY / ANALYTICS
                         ↓
                 OBSERVED BEHAVIOR
                         ↓
               BEHAVIOR RECONCILIATION
                         ↓
                    DIAGNOSIS
                         ↓
              IMPROVEMENT OPPORTUNITY
                         ↓
               RECOMMENDATION ENGINE
                         ↓
                HARNESS TASK SPEC
                         │
             ────────────┼────────────
             EXTERNAL HARNESS BOUNDARY
                         │
                         ▼
                CANDIDATE MUTATION
                         │
             ────────────┼────────────
                         ↓
                 MUTATION RESULT
                         ↓
               CANDIDATE EVALUATION
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
 Formal verification   Tests      Browser verification
        └────────────────┼────────────────┘
                         ↓
                   HUMAN REVIEW
                         ↓
             EXPERIMENT / RELEASE INTENT
                         ↓
                  EXTERNAL DEPLOYMENT
                         ↓
                   OBSERVE OUTCOME
                         ↓
                  MEASURE IMPACT
                         ↓
          ADOPT / REJECT / ROLLBACK / ITERATE
                         ↓
                IMPROVEMENT MEMORY
                         └────────────────────↺
```

---

# 237. New Core Product Thesis

A stronger long-term product thesis is:

> **PathCompiler is the reasoning, evaluation, and feedback infrastructure for software that continuously improves itself.**

More concretely:

> **PathCompiler understands what a software product allows, observes what users actually do, identifies evidence-backed improvement opportunities, specifies them for coding harnesses, independently evaluates candidate changes, and measures whether those changes actually improved the product.**

---

# 238. What PathCompiler Deliberately Does Not Solve

Do not make these core responsibilities:

```text
coding-agent tool orchestration
repository editing strategy
shell/browser tool selection
agent memory architecture for code mutation
IDE interaction
patch generation mechanics
full CI/CD implementation
cloud deployment infrastructure
```

These are integrations or neighboring systems.

---

# 239. What PathCompiler Must Make Easy for Harness Engineers

Provide:

```text
stable machine-readable recommendation schema
stable HarnessTaskSpec
stable MutationResult contract
formal/product context references
protected behavior list
acceptance criteria
semantic diff API
candidate evaluation API
```

A harness engineer should not need to understand the entire PathCompiler internals.

---

# 240. Proposed Packages for the Improvement Loop

Add only when phases begin:

```text
packages/findings/
packages/recommendation-engine/
packages/improvement-spec/
packages/harness-contracts/
packages/candidate-evaluator/
packages/experiment-core/
packages/outcome-analysis/
packages/improvement-memory/
```

Do not create placeholder packages prematurely.

---

# 241. Phase I0 — Finding Model

Implement:

```text
ProductFinding
ImprovementOpportunity
EvidenceBundle
PriorityAssessment
```

Derive findings from existing reasoning + analytics outputs.

No recommendation generation yet.

---

# 242. Phase I1 — Recommendation Model

Implement:

```text
ImprovementHypothesis
ImprovementRecommendation
DesiredOutcome
ProtectedBehavior
AcceptanceCriteria
```

Start with deterministic recommendation templates for obvious classes:

```text
workflow regression
permission regression
high path efficiency ratio
low reachability-adjusted adoption
```

LLM wording may be used, but evidence and structure must remain deterministic.

---

# 243. Phase I2 — Harness Contract

Implement:

```text
HarnessTaskSpec
MutationResult
JSON Schema
Zod schemas
versioning
serialization
```

Create fixture harness that does not modify real code but returns synthetic mutation results for tests.

---

# 244. Phase I3 — Candidate Evaluation

Implement:

```text
expected vs observed semantic diff
formal property re-check
workflow regression analysis
business-level test result ingestion
candidate evaluation report
```

Browser verification may remain optional until existing browser infrastructure is ready.

---

# 245. Phase I4 — Browser Candidate Verification

Run selected candidate workflows against preview/candidate environment.

Verify goals and protected behavior.

---

# 246. Phase I5 — Experiment Specification

Implement:

```text
ExperimentSpec
primary metric
secondary metrics
guardrails
eligibility
allocation metadata
success criteria
```

Do not deploy experiments automatically.

---

# 247. Phase I6 — Outcome Measurement

Use existing observability data to compare:

```text
control
treatment
before
after
```

Return `OutcomeAssessment`.

---

# 248. Phase I7 — Adoption Decision

Generate evidence-backed recommendation:

```text
ADOPT
REJECT
ROLLBACK
ITERATE
EXTEND
INCONCLUSIVE
```

Require human approval.

---

# 249. Phase I8 — Improvement Memory

Persist complete improvement lifecycle.

Use past outcomes as evidence for future recommendation ranking.

Do not train or fine-tune automatically without explicit product decision.

---

# 250. Phase I9 — External Harness Integration

After contracts stabilize, support real external harnesses.

PathCompiler interaction:

```text
export HarnessTaskSpec
↓
external harness runs
↓
import MutationResult
↓
run candidate evaluation
```

The first integration should be file/API based and provider-neutral.

---

# 251. Phase I10 — Deployment / Experiment Adapters

Later, after the improvement loop works manually:

```text
read deployment status
bind releases to candidate commits
coordinate feature flags
read experiment arm assignment
```

Actual deployment execution remains optional and later-stage.

---

# 252. Improvement Loop MVP

The first complete improvement-loop demo should show:

```text
1. Reference app has clients.create workflow.

2. Runtime analytics show:
   completion = 51%
   median actions = 12

3. Formal planner shows:
   minimum path cost = 6

4. PathCompiler generates Finding:
   high workflow friction.

5. PathCompiler generates Recommendation:
   simplify confirmation portion while preserving permissions/validation.

6. PathCompiler exports HarnessTaskSpec.

7. Synthetic or external harness returns MutationResult with candidate commit.

8. PathCompiler rebuilds candidate Product Model.

9. Candidate evaluation shows:
   minimum path cost = 5
   protected properties PASS
   unrelated workflows unchanged
   browser workflow PASS

10. Human approves candidate for experiment.

11. Experiment metadata is registered.

12. Simulated treatment analytics show:
    completion 51% → 69%
    median actions 12 → 7
    guardrails healthy.

13. PathCompiler outputs:
    ADOPT.

14. ImprovementMemoryRecord is persisted.
```

This demo proves the architecture without requiring autonomous code generation or automated deployment.

---

# 253. Second Improvement Demo — Failed Hypothesis

Show that PathCompiler can reject its own recommendation empirically.

```text
Recommendation:
remove confirmation

Formal candidate:
valid

Tests:
pass

Browser:
pass

Treatment completion:
51% → 43%
```

Expected result:

```text
HYPOTHESIS REJECTED
recommendation = ROLLBACK / ITERATE
```

This is critical proof that PathCompiler is not just an AI recommendation generator.

---

# 254. Third Improvement Demo — Unexpected Regression

Harness implements desired UX improvement but candidate semantic diff reveals:

```text
ASSISTANT unexpectedly gains clients.delete
```

Expected:

```text
CandidateEvaluation = FAIL
eligible_for_experiment = false
```

This demonstrates independent formal evaluation.

---

# 255. Codex Prompt — I0

```text
Read AGENTS.md, PRODUCT_ARCHITECTURE.md, CODEX_BUILD_SPEC.md,
and REASONING_ENGINE_BUILD_SPEC.md.

Implement Phase I0 — Finding Model only.

Requirements:
- add typed ProductFinding and ImprovementOpportunity domain models;
- use existing reasoning/analytics evidence references;
- add deterministic classification for at least workflow_friction,
  permission_regression, release_regression and low_adoption;
- do not generate recommendations yet;
- add fixtures and tests;
- update docs/phases/STATUS.md.
```

---

# 256. Codex Prompt — I1

```text
Implement Phase I1 — Recommendation Model only.

Requirements:
- implement ImprovementHypothesis and ImprovementRecommendation;
- distinguish finding confidence from intervention confidence;
- model desired outcomes, protected behaviors and acceptance criteria;
- add deterministic recommendation templates for fixture findings;
- do not integrate any coding harness yet;
- add tests and update STATUS.md.
```

---

# 257. Codex Prompt — I2

```text
Implement Phase I2 — Harness Contract.

Requirements:
- implement HarnessTaskSpec and MutationResult;
- add JSON Schema and Zod validation;
- preserve recommendation/finding lineage IDs;
- keep the contract provider-neutral;
- do not implement code editing or agent tool orchestration;
- add round-trip serialization tests;
- provide example fixture files under examples/harness-contract/.
```

---

# 258. Codex Prompt — I3

```text
Implement Phase I3 — Candidate Evaluation.

Input:
- base commit/formal model;
- candidate commit/formal model;
- ImprovementRecommendation;
- HarnessTaskSpec;
- MutationResult.

Output:
- expected vs observed semantic change evaluation;
- protected-property verification;
- workflow regression summary;
- business-level test summary;
- candidate pass/fail/inconclusive decision.

Do not add deployment automation.
```

---

# 259. Codex Prompt — I5/I6

```text
Implement ExperimentSpec and OutcomeAssessment domain layers.

Do not deploy experiments.

PathCompiler should only:
- define experiment intent;
- bind candidate/recommendation/workflow IDs;
- define primary/secondary/guardrail metrics;
- ingest observed control/treatment metrics;
- determine improved/neutral/worse/inconclusive outcome.
```

---

# 260. Final Self-Improvement Principle

The complete platform should follow:

> **Observe → Understand → Reason → Diagnose → Recommend → Specify → External Mutation → Independently Evaluate → Experiment → Measure → Decide → Learn.**

The only intentionally external step is:

> **how the coding harness edits the repository and uses tools to implement the requested change.**

Everything else is part of PathCompiler's product intelligence and self-improvement infrastructure.
