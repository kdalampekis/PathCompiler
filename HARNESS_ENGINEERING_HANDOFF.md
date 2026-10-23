# PathCompiler — Harness Engineering Handoff
## What we need from the external coding harness, how the handoff works, and what is deliberately out of scope for now

> **Audience:** Harness engineer / coding-agent engineer collaborating with the PathCompiler project.
>
> **Purpose:** Define the exact boundary between PathCompiler and the external code-mutation harness.
>
> **Important:** We are **not** asking the harness engineer to build PathCompiler's product reasoning, analytics, formal verification, recommendation engine, experimentation system, or CI/CD platform. We are asking for a robust way to consume a machine-readable product-improvement task and turn it into a candidate repository mutation that PathCompiler can independently evaluate.

---

# 1. Short Version

PathCompiler will eventually handle this loop:

```text
Understand product
↓
Observe users
↓
Detect problems/opportunities
↓
Diagnose likely causes
↓
Generate improvement recommendation
↓
Produce machine-readable HarnessTaskSpec
↓
─────────────────────────────────────
YOUR HARNESS
↓
Explore repo
Decide implementation strategy
Modify code/config/UI
Run implementation-level checks
Create candidate commit/PR
Return MutationResult
─────────────────────────────────────
↓
PathCompiler independently evaluates candidate
↓
Formal verification
Semantic diff
Tests
Browser validation
↓
Human approval
↓
Experiment / deployment coordination
↓
Measure real-world outcome
↓
Adopt / reject / rollback / iterate
```

Your main responsibility is the middle box:

> **Given a precise product-improvement specification, produce a candidate implementation and a structured report of what you changed.**

---

# 2. What PathCompiler Is Building

PathCompiler is intended to become the reasoning and feedback infrastructure around self-improving software.

Its core system will understand software at several levels:

```text
STATIC
What is implemented?

FORMAL
What can users do?

OBSERVED
What do users actually do?

PROBABILISTIC
What is likely to happen?

IMPROVEMENT
What should we investigate/change?
```

Examples of PathCompiler outputs:

```text
Create Client takes users 2.4x the minimum feasible path cost.

The latest PR made reports.export reachable by ASSISTANT.

Bulk Import is available to 8,000 eligible users but only 4% use it.

A formally valid path exists but has never been observed.

A workflow became unreachable after a permission change.
```

PathCompiler then turns these findings into evidence-backed improvement recommendations.

The harness receives the recommendation in a structured format and implements the change.

---

# 3. Why We Are Separating the Harness Layer

We deliberately do not want PathCompiler to own coding-agent implementation strategy.

The problem of:

```text
how an AI agent navigates a repository
how it chooses files
how it calls tools
how it edits code
how it manages context
how it recovers from failed edits
how it uses browser/devtools
how it plans patches
```

is a large engineering problem by itself.

There are already multiple possible implementations:

```text
Codex
Claude Code
Cursor
Devin
custom internal agents
human engineer
```

PathCompiler should remain **harness-agnostic**.

This gives us a clean architecture:

```text
PathCompiler knows WHAT should change and WHY.

Harness knows HOW to implement it.

PathCompiler independently checks whether the implementation achieved the intended product effect safely.
```

---

# 4. Your Responsibility

The harness should be able to:

1. accept a `HarnessTaskSpec`;
2. inspect the repository at the specified base commit;
3. understand the requested product-level objective;
4. understand protected behaviors and constraints;
5. choose an implementation strategy;
6. edit code/config/UI as appropriate;
7. run implementation-level validation available to it;
8. create a candidate commit/branch/PR or equivalent artifact;
9. return a structured `MutationResult`;
10. clearly report assumptions, blockers, and unresolved questions.

That is the contract.

---

# 5. What You Do NOT Need to Build

You are **not** responsible for:

```text
Product Graph extraction
workflow discovery
formal product modeling
SMT solving
planning
model checking
unsat cores / MUS / MCS
analytics collection
behavioral analysis
probabilistic reasoning
finding generation
recommendation generation
business-level experiment design
production outcome measurement
recommendation memory
product dashboards
```

Those are PathCompiler responsibilities.

---

# 6. Important Boundary: The Harness Does Not Grade Itself

The harness may run tests to help produce a good implementation.

But its output is not trusted merely because it says:

```text
All tests passed.
The requested behavior is implemented.
```

PathCompiler will independently rebuild the candidate product model and verify:

```text
Did the intended semantic change actually occur?
Did unrelated workflows change?
Did any permission boundary change?
Do protected formal properties still hold?
Did business-level test coverage regress?
Does the workflow work in a browser?
```

This is intentional.

The implementation agent and evaluation system should be separate.

---

# 7. Input Contract: HarnessTaskSpec

The harness receives a stable machine-readable specification.

Conceptually:

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

The exact schema may evolve, but the conceptual boundary should remain stable.

---

# 8. Example HarnessTaskSpec

```yaml
schema_version: 1
id: task_4472
recommendation_id: imp_9281

repository:
  project_id: demo_saas
  base_commit: abc123
  target_branch: pathcompiler/imp-9281

objective:
  summary: >
    Reduce friction in the Create Client workflow while preserving
    all existing permission, validation, and audit semantics.

  target:
    workflow: clients.create
    goal: clients.created

  desired_semantic_change:
    - kind: reduce_workflow_cost
      workflow: clients.create

rationale:
  finding_summary: >
    Eligible users complete Create Client only 51% of the time.
    The observed median interaction count is 12 while the formal
    minimum feasible path is 6.

  evidence:
    workflow_completion_rate: 0.51
    observed_median_actions: 12
    formal_minimum_actions: 6
    largest_dropoff:
      from: client.details
      to: client.confirmation
      rate: 0.38

  hypothesis:
    statement: >
      The current confirmation transition may introduce unnecessary
      friction in the workflow.
    confidence: 0.72

constraints:
  hard:
    - clients.write_permission_required
    - client_validation_required

  protected_behaviors:
    - viewer_cannot_create_client
    - audit_event_client_created_must_fire
    - existing_client_validation_semantics_preserved

  prohibited_semantic_changes:
    - clients.delete_permissions_must_not_change
    - clients.edit_permissions_must_not_change

acceptance_criteria:
  semantic:
    - clients.create formal cost should decrease if safely possible

  formal:
    - viewer_cannot_create_client must hold
    - clients.write_permission_required must hold

  tests:
    existing_tests_must_pass: true

  browser:
    goal_must_be_reachable: clients.created

relevant_context:
  workflow_ids:
    - clients.create

  capability_ids:
    - clients.create
    - clients.write

  semantic_targets:
    - clients.create
    - client.form.submit

  likely_relevant_source_refs:
    - src/features/clients/CreateClientFlow.tsx
    - src/features/clients/ClientForm.tsx

requested_artifacts:
  - candidate_commit
  - implementation_summary
  - changed_files
  - claimed_semantic_changes
  - tests_added_or_changed
  - unresolved_questions
```

---

# 9. Important: Relevant Source References Are Hints

If PathCompiler provides:

```text
src/features/clients/CreateClientFlow.tsx
```

that does **not** mean:

> You must modify this file.

It means:

> This file is relevant evidence according to our product model.

The harness may discover a better implementation elsewhere.

---

# 10. How the Harness Should Interpret the Task

The harness should prioritize information in this order:

```text
1. hard constraints
2. protected product behaviors
3. desired semantic outcome
4. acceptance criteria
5. rationale/evidence
6. suggested source context
```

Do not optimize the local code change at the expense of the product constraints.

---

# 11. Desired Semantic Outcome vs Implementation

Example objective:

```text
Reduce Create Client workflow interaction cost.
```

Possible implementations may include:

```text
remove an intermediate page
combine two forms
change default navigation
pre-populate values
remove redundant confirmation
restructure component flow
```

PathCompiler does not prescribe which one.

The harness should choose the safest implementation consistent with the codebase and constraints.

---

# 12. The Harness May Reject the Proposed Intervention

This is important.

The recommendation engine may produce a hypothesis that turns out to be unsafe or incomplete when the harness studies the implementation.

Example:

```text
PathCompiler hypothesis:
Remove confirmation screen.

Harness discovers:
Confirmation screen is required for compliance and signed consent.
```

The harness should **not** blindly remove it.

Return:

```yaml
status: blocked

unresolved_questions:
  - >
    The confirmation screen appears to enforce a compliance requirement
    not represented in the current product model.

assumptions:
  - none
```

This becomes new evidence for PathCompiler/human review.

---

# 13. Blocked / Partial Outcomes Are Valid

Supported run statuses should include:

```text
completed
partial
blocked
failed
```

A blocked result with a useful explanation is better than an unsafe patch.

---

# 14. Output Contract: MutationResult

After implementation, return a structured report.

Conceptually:

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

---

# 15. Example MutationResult

```yaml
schema_version: 1
id: mut_4472
harness_task_id: task_4472
recommendation_id: imp_9281

status: completed

repository:
  base_commit: abc123
  candidate_commit: def456
  branch: pathcompiler/imp-9281
  pull_request: "#941"

changed_files:
  - src/features/clients/CreateClientFlow.tsx
  - src/features/clients/ClientForm.tsx
  - e2e/clients/create-client.spec.ts

implementation_summary: >
  Merged the redundant confirmation state into the final form submission
  while preserving client validation and the existing permission check.

claimed_semantic_changes:
  - workflow: clients.create
    kind: reduced_interaction_path

  - workflow: clients.create
    property: clients.write_permission_required
    claimed_status: preserved

  - workflow: clients.create
    property: client_validation_required
    claimed_status: preserved

tests_added_or_changed:
  - e2e/clients/create-client.spec.ts

assumptions:
  - >
    The removed confirmation state has no external compliance obligation;
    this was inferred from source and tests.

unresolved_questions: []

harness_metadata:
  provider: custom-harness
  version: 0.1.0
  run_id: run_xyz
```

---

# 16. Why We Need Claimed Semantic Changes

PathCompiler will independently compute the real semantic diff.

But the harness should tell us what it **intended** to change.

Then we can compare:

```text
HARNESS CLAIM
clients.create simplified

ACTUAL PATHCOMPILER DIFF
clients.create simplified
clients.delete permission also changed
```

This lets us distinguish intended from accidental behavior.

---

# 17. What Happens After MutationResult

The harness is finished for that iteration.

PathCompiler then performs:

```text
Candidate Commit
↓
Re-scan repository
↓
Rebuild Product Graph
↓
Rebuild Formal Product Model
↓
Compare before/after semantics
↓
Re-run formal properties
↓
Analyze workflow regressions
↓
Ingest tests
↓
Browser verification
↓
CandidateEvaluation
```

The harness does not need to orchestrate this.

---

# 18. What PathCompiler Will Evaluate

PathCompiler checks at least four things.

## A. Did the desired product effect occur?

Example:

```text
minimum workflow cost:
6 → 5
```

## B. Did protected behaviors remain valid?

```text
VIEWER cannot create client
clients.write is still required
```

## C. Did something else change unexpectedly?

```text
ASSISTANT gained delete permission
```

## D. Does the implementation actually work?

```text
tests
browser
runtime event
```

---

# 19. The Harness Should Not Weaken Evaluation Criteria

PathCompiler freezes relevant criteria before mutation:

```text
protected properties
hard constraints
expected semantic outcome
business acceptance criteria
```

The harness cannot change them in its result to make the patch appear successful.

It can challenge them by returning a blocker/question.

---

# 20. Good Harness Behavior

A good harness should:

```text
read the product intent carefully
inspect surrounding architecture before editing
respect protected behavior
prefer small reversible changes
update/add tests where reasonable
surface assumptions
avoid broad unrelated refactors
return a clean candidate commit
be explicit about uncertainty
```

---

# 21. Bad Harness Behavior

Avoid:

```text
optimizing only for tests passing
changing unrelated behavior silently
removing guards to simplify flow
rewriting broad architecture unnecessarily
assuming every recommendation is correct
hiding unresolved ambiguity
claiming semantic success without evidence
modifying evaluation criteria
```

---

# 22. Repository Exploration Is Your Domain

The harness may use whatever internal architecture is appropriate:

```text
repo map
AST tools
code search
language server
agent memory
subagents
browser automation
shell
unit tests
static analysis
```

PathCompiler should not dictate this.

We only require consistent external contracts.

---

# 23. Implementation Strategy Is Your Domain

You may design:

```text
planner-agent → coding-agent → test-agent
single coding loop
multi-agent architecture
retrieval-based repo understanding
AST-first mutation
LLM-first planning
hybrid approach
```

All are acceptable if the harness reliably fulfills the contract.

---

# 24. First Integration Should Be Simple

Do not begin with a distributed agent platform.

First integration can be:

```text
HarnessTaskSpec.json
↓
local harness CLI
↓
repo mutation
↓
MutationResult.json
```

Example:

```bash
harness run \
  --task .pathcompiler/tasks/task_4472.json \
  --repo . \
  --output .pathcompiler/mutations/mut_4472.json
```

This is enough to prove the boundary.

---

# 25. Suggested Harness CLI Contract

Possible interface:

```bash
pc-harness execute \
  --task /path/to/HarnessTaskSpec.json \
  --repo /path/to/repository \
  --worktree /tmp/pathcompiler-task-4472 \
  --result /path/to/MutationResult.json
```

Exit codes:

```text
0 = completed
2 = partial
3 = blocked
4 = failed
```

Exact CLI naming is flexible.

---

# 26. Worktree / Isolation

Prefer candidate changes in an isolated branch/worktree/container.

Do not mutate the developer's main working tree directly.

Candidate should be reproducible from:

```text
base commit
HarnessTaskSpec
harness version
```

where practical.

---

# 27. Reproducibility Metadata

MutationResult should include enough metadata to diagnose runs:

```text
harness version
model/provider if relevant
run ID
base commit
candidate commit
timestamp
```

Do not expose private chain-of-thought.

Implementation summary and explicit assumptions are enough.

---

# 28. Task Context Should Be Bounded

PathCompiler may provide relevant workflows/files/evidence.

The harness can explore beyond them when needed.

But avoid loading the entire repository context into one model prompt if not necessary.

Use normal harness engineering techniques for context management.

---

# 29. Protected Properties Are More Important Than Suggested Files

If task provides:

```text
likely relevant file:
ClientForm.tsx

protected property:
VIEWER cannot create client
```

and you discover the easiest implementation would violate the protected property:

**do not implement it.**

Return blocked or choose another implementation.

---

# 30. Types of Tasks You May Receive

Not every harness task will be identical.

Possible categories:

```text
UX workflow simplification
bug/regression repair
permission correction
feature discoverability change
new capability implementation
workflow restoration
configuration/default behavior change
agent/prompt change
```

The contract should be general enough to support multiple mutation types.

---

# 31. BUILD Recommendations Need Special Care

A `BUILD` recommendation means:

```text
PathCompiler believes a missing capability may be valuable.
```

This is weaker than:

```text
a bug is definitely present.
```

For BUILD tasks, the task should include stronger human approval/context before implementation.

The harness should not invent product requirements beyond the task.

---

# 32. FIX Tasks

FIX tasks are usually more constrained.

Example:

```text
Expected:
MANAGER can export report.

Current:
UNREACHABLE after commit X.

Root cause:
permission condition changed.
```

Harness goal:

```text
restore intended reachability without expanding unrelated roles.
```

These are ideal early tasks because success is easier to evaluate formally.

---

# 33. IMPROVE Tasks

IMPROVE tasks are hypothesis-driven.

Example:

```text
Create Client completion is low and observed path cost is high.
```

There may be many valid implementations.

The harness should choose a conservative candidate and explicitly state assumptions.

The final answer comes from experiment outcomes, not from the harness.

---

# 34. PROMOTE Tasks May Not Need Code

Sometimes improvement is:

```text
surface existing capability in onboarding
change assistant recommendation
change guide ordering
```

These tasks may route to a different executor.

The coding harness is not necessarily the right tool for every recommendation.

---

# 35. Harness Scope for Initial Collaboration

For the first version, focus on:

```text
source-code / UI / configuration changes inside a repository
```

Do not try to solve:

```text
production deployments
feature-flag rollout orchestration
A/B test platform integration
metric analysis
product recommendation generation
```

---

# 36. CI/CD — Current Position

**CI/CD is not part of the immediate harness task.**

We want to prove first that:

```text
PathCompiler can produce a good task spec
↓
Harness can create a candidate mutation
↓
PathCompiler can independently evaluate it
```

Only after this loop is stable do we connect deployment and experimentation infrastructure.

---

# 37. Why CI/CD Is Deferred

Deployment introduces many customer-specific concerns:

```text
cloud provider
branching strategy
preview environments
secrets
approval policies
release trains
feature flags
canary deployment
rollback
compliance
```

We do not want harness development blocked by this complexity.

---

# 38. Future CI/CD Relationship

Later, PathCompiler may emit:

```text
DeploymentIntent
ExperimentSpec
```

External adapters can translate that into:

```text
GitHub Actions
Vercel preview
ArgoCD
LaunchDarkly
Statsig
custom CI/CD
```

The harness may eventually trigger or cooperate with these systems, but this is a later integration.

---

# 39. Future Deployment Flow

Potential future architecture:

```text
CandidateEvaluation = PASS
↓
Human approval
↓
PathCompiler ExperimentSpec
↓
Deployment Adapter
↓
Preview / Canary / Treatment
↓
Runtime analytics
↓
OutcomeAssessment
```

The coding harness does not need to own this pipeline.

---

# 40. Browser/Preview Environment

Long term, PathCompiler may ask for a candidate preview URL or startup instructions so it can run browser verification.

Possible MutationResult field:

```yaml
artifacts:
  - type: preview_instructions
    command: pnpm dev
```

or later:

```yaml
preview_url: https://preview.example.com/pr-941
```

For early local integration, a runnable repo is enough.

---

# 41. Tests

The harness should run the project's normal available checks when practical:

```text
lint
typecheck
unit tests
relevant integration tests
relevant E2E tests
```

But remember:

> PathCompiler will independently evaluate product semantics.

Passing tests is necessary evidence, not the final acceptance condition.

---

# 42. Adding Tests

When the requested change introduces new behavior, the harness should add/update implementation tests where reasonable.

Especially:

```text
new capability
restored regression
new role behavior
new branch
```

PathCompiler may independently generate business-level test suggestions later.

---

# 43. Minimal Candidate Changes

Prefer minimal coherent patches over large refactors.

Why:

```text
semantic diff easier to understand
formal evaluation easier
rollback easier
attribution in experiments clearer
risk lower
```

Large refactors should require a reason.

---

# 44. Candidate Should Be Experiment-Friendly

For hypothesis-driven UX improvements, when practical prefer changes that can be isolated behind:

```text
feature flag
variant
small component boundary
```

But do not add unnecessary experimentation infrastructure if the repo does not use it.

Experiment execution is not your immediate responsibility.

---

# 45. Assumptions Are First-Class

If implementation depends on an assumption, report it.

Example:

```text
Assumption:
confirmation page is not required for regulatory consent.
```

This may cause PathCompiler/human reviewer to block experiment until verified.

Do not hide assumptions inside prose.

---

# 46. Unresolved Questions Are First-Class

Return questions such as:

```text
Does this route serve legacy enterprise tenants?
Is this audit event externally consumed?
Is this confirmation legally required?
Should this change apply to all subscription tiers?
```

These are valuable outputs.

---

# 47. Harness Safety Rules

Initial harness should not autonomously:

```text
merge to main
push production deployment
change secrets
change billing rules without explicit task
relax permissions to make a workflow pass
remove security checks
alter evaluation contracts
```

Candidate generation only.

---

# 48. Human Review

Expected early lifecycle:

```text
PathCompiler Recommendation
↓
Harness Candidate
↓
PathCompiler Evaluation
↓
Human Review
↓
merge / experiment / reject
```

The long-term system may automate more, but this is not the first goal.

---

# 49. Suggested First Harness Milestone

Build a local proof-of-concept that:

1. accepts JSON `HarnessTaskSpec`;
2. checks out a base commit in an isolated worktree;
3. invokes the chosen coding-agent architecture;
4. produces a small repository mutation;
5. runs project checks;
6. commits the candidate;
7. writes `MutationResult.json`;
8. supports completed/blocked/failed status.

No CI/CD.
No production deployment.
No experiment integration.

---

# 50. First Fixture Task

Use a reference app with a known Create Client workflow.

Task:

```text
Current flow:
Clients → Add Client → Details → Confirmation → Save

Desired outcome:
Reduce unnecessary workflow cost.

Protected:
clients.write required
validation required
audit event required
```

The harness should create one reasonable candidate implementation.

PathCompiler then evaluates it.

---

# 51. Second Fixture Task — Regression Repair

Task:

```text
Expected:
NUTRITIONIST can create client.

Current candidate model:
UNREACHABLE.

Root cause:
permission condition changed in recent commit.

Desired:
restore NUTRITIONIST reachability without granting ASSISTANT access.
```

This is a good harness test because formal success criteria are precise.

---

# 52. Third Fixture Task — Blocked Requirement

Create a task where a suggested UX simplification conflicts with a hidden fixture comment/test indicating a compliance requirement.

Expected harness behavior:

```text
status = blocked
```

with explanation.

This tests whether the harness can challenge unsafe recommendations.

---

# 53. Harness Quality Metrics

We can evaluate the harness separately from product outcomes.

Potential metrics:

```text
task completion rate
candidate formal pass rate
unexpected semantic change rate
human edit distance after harness patch
test pass rate
blocked-task precision
median implementation time
unnecessary file-change count
```

These metrics belong to harness engineering quality, not PathCompiler product success.

---

# 54. Critical Metric: Unexpected Semantic Change Rate

A strong harness should minimize:

```text
changes PathCompiler detects that were not declared in claimedSemanticChanges
```

This is more meaningful than simply measuring changed lines.

---

# 55. Critical Metric: Human Edit Distance

After PathCompiler evaluation and human review:

```text
how much did a human need to rewrite the candidate?
```

Lower is better.

This can guide harness improvements.

---

# 56. Critical Metric: Constraint Violation Rate

Count candidates that violate:

```text
hard constraints
protected behaviors
business properties
```

The harness should improve over time at respecting these task contracts.

---

# 57. Contract Versioning

Both artifacts need schema versions:

```text
HarnessTaskSpec.schemaVersion
MutationResult.schemaVersion
```

The harness should fail clearly on unsupported major versions.

Do not silently interpret unknown fields with dangerous semantics.

---

# 58. JSON Schema / Zod

PathCompiler will provide canonical schemas.

Harness should validate input before execution and output before return.

Example:

```text
invalid task
→ fail before repository mutation
```

---

# 59. Idempotency / Run IDs

Each harness run should have a unique run ID.

If retried, preserve relationship to:

```text
task ID
base commit
previous attempt
```

Useful for debugging and evaluation.

---

# 60. Logging

Harness logs should capture operational information:

```text
task loaded
repo checkout
checks run
files changed
commands failed
candidate commit created
result emitted
```

Do not require or expose private model chain-of-thought.

---

# 61. Secrets

The harness may need repository/test credentials in some environments.

Do not write secrets into:

```text
MutationResult
commits
logs
PathCompiler task artifacts
```

Secrets management remains environment-specific.

---

# 62. Network Access

Whether the harness has internet/network access is implementation-specific.

Task contracts should not assume external browsing is available unless explicitly allowed.

---

# 63. Multiple Candidate Generation — Later

Future enhancement:

```text
one HarnessTaskSpec
↓
Candidate A
Candidate B
Candidate C
↓
PathCompiler evaluates all
↓
best candidate selected for human review/experiment
```

This is interesting but not needed for the first version.

---

# 64. Candidate Search / Evolution — Later

Long-term the harness may generate variants and use PathCompiler evaluation as a fitness function.

Example:

```text
mutation A → formal pass, cost 7
mutation B → formal pass, cost 5
mutation C → property violation
```

PathCompiler can rank candidates.

But initial integration should remain one task → one candidate.

---

# 65. Why This Interface Is Powerful

It lets PathCompiler and the harness evolve independently.

PathCompiler may improve:

```text
formal reasoning
analytics
recommendations
experiments
```

without changing how code is mutated.

Harness may improve:

```text
repo navigation
agent architecture
patch quality
tool use
```

without changing PathCompiler product logic.

The stable boundary is:

```text
HarnessTaskSpec
↔
MutationResult
```

---

# 66. Future: Harness Feedback Into Recommendation Quality

If harness repeatedly reports:

```text
recommendation impossible
requirement conflicts with compliance
change scope too broad
```

PathCompiler should learn that its recommendation generation is weak in those cases.

Harness feedback therefore becomes another evidence source.

---

# 67. Future: Pre-Mutation Feasibility Check

Before full implementation, harness may return a lightweight feasibility response:

```text
feasible
likely feasible
blocked
requires product clarification
```

This could reduce expensive failed coding runs.

Not required initially.

---

# 68. Future: Cost Estimate

Harness may estimate:

```text
expected complexity
files likely affected
test burden
implementation risk
```

PathCompiler can use this in recommendation prioritization.

Again, later.

---

# 69. Future: Specialized Harnesses

Different recommendation categories may route to different executors:

```text
frontend UX harness
backend harness
prompt/agent harness
configuration harness
mobile harness
human-only task
```

The common contract remains valuable.

---

# 70. CI/CD Future Integration

When we are ready, we can add a separate layer:

```text
CandidateEvaluation PASS
↓
DeploymentIntent
↓
CI/CD Adapter
↓
Preview / Canary / Experiment
↓
Runtime measurement
```

Possible providers:

```text
GitHub Actions
GitLab CI
Vercel
ArgoCD
Kubernetes pipelines
LaunchDarkly
Statsig
customer internal systems
```

This should **not** be baked into the harness core.

---

# 71. Why CI/CD Should Stay Separate From Harness Core

The harness solves:

> **How do we implement a requested code/product change?**

CI/CD solves:

> **How do we build, release, deploy, and roll back that candidate in a particular organization?**

They are related but different concerns.

Keeping them separate avoids coupling the harness to customer infrastructure.

---

# 72. Future Preview Environment Contract

Later MutationResult may provide:

```ts
interface PreviewArtifact {
  kind: "local_command" | "url" | "container";
  value: string;
}
```

PathCompiler can use this for browser verification.

But the first harness can simply return a candidate commit.

---

# 73. Future Deployment Result

If deployment adapters are added later, they should return separate artifacts.

Do not overload `MutationResult` with deployment semantics.

Possible:

```text
DeploymentResult
ExperimentRun
```

This keeps lifecycle boundaries clear.

---

# 74. Collaboration Workflow Between Our Teams

Recommended development process:

```text
PathCompiler team defines contract version
↓
Harness engineer implements consumer/producer
↓
Both teams test against fixture repository
↓
Contract issues documented
↓
Schema evolves deliberately
```

Avoid coupling through undocumented assumptions.

---

# 75. Shared Fixture Repository

We should maintain a small reference SaaS app containing:

```text
roles
permissions
feature flags
2–5 meaningful workflows
Playwright tests
intentional bugs/regressions
```

Both PathCompiler and harness test against the same fixture.

---

# 76. Shared Contract Fixtures

Store examples:

```text
fixtures/harness/tasks/
fixtures/harness/results/
```

Cases:

```text
successful improvement
regression repair
blocked task
partial task
unexpected semantic regression
new capability
```

---

# 77. First End-to-End Contract Test

```text
PathCompiler creates task_001.json
↓
Harness validates task
↓
Harness mutates fixture repo
↓
Harness writes mut_001.json
↓
PathCompiler validates MutationResult
↓
PathCompiler rebuilds formal model
↓
CandidateEvaluation generated
```

No production environment required.

---

# 78. Definition of Done for Harness V0

Harness V0 is done when:

```text
✓ consumes validated HarnessTaskSpec
✓ operates on specified base commit
✓ works in isolated branch/worktree
✓ can make a candidate code change
✓ runs repo checks
✓ creates candidate commit
✓ emits valid MutationResult
✓ reports blockers/assumptions
✓ never auto-merges/deploys
✓ passes shared fixture scenarios
```

---

# 79. Definition of Done for Integration V0

The integration is done when:

```text
PathCompiler recommendation
→ HarnessTaskSpec
→ harness candidate
→ MutationResult
→ PathCompiler CandidateEvaluation
```

works without manual conversion between formats.

---

# 80. What We Want You to Think About

The hardest harness questions for this collaboration are:

```text
How should an agent transform product-semantic intent into a safe code change?

How should it manage repository context efficiently?

How should it preserve declared constraints while exploring implementation options?

How should it detect when the recommendation itself is incomplete or unsafe?

How should it summarize what it believes changed semantically?

How should it produce reproducible candidate artifacts?
```

Those are the problems we would like the harness engineer to own.

---

# 81. What You Do Not Need to Solve Yet

Do not spend early cycles on:

```text
production-grade CI/CD
multi-cloud deployment
A/B testing infrastructure
analytics backend
formal verification engine
recommendation engine
full self-improvement autonomy
```

We can add integration points later.

---

# 82. Final Boundary

The cleanest summary is:

> **PathCompiler decides what should be investigated or improved, why, under what product constraints, and how success will be evaluated.**

> **The harness decides how to implement the requested change in the repository.**

> **PathCompiler then independently checks the candidate and measures whether the change actually improved the product.**

That is the collaboration model.

---

# 83. One-Sentence Mission for the Harness Engineer

> **Build a reliable, provider-agnostic code-mutation harness that can consume a structured PathCompiler improvement task and return a reproducible candidate implementation plus an explicit machine-readable account of what it changed, while leaving product reasoning, evaluation, deployment, and outcome measurement to PathCompiler.**
