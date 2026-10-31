# Harness handoff: status

`HARNESS_ENGINEERING_HANDOFF.md` (83 sections) is addressed to the engineer of
an external coding harness. This table says, section by section, what is now
implemented in this repository (`pathcompiler harness run`, ADR 0096), what is
the external harness's own job, and what is not built. "Implemented" means
tested with scripted harnesses; no real coding agent has been run (ISSUES_LOG
#66). Later phases (BX10–BX15) changed how a harness meets PathCompiler; see
"Since the handoff was implemented" below.

| Handoff section | What it asks | Status |
| --- | --- | --- |
| §4 Responsibility (1–10) | Accept a task; inspect at the base commit; edit; run checks; create a candidate; return a `MutationResult` with assumptions and blockers | **Implemented** by `executeHarness`; the editing itself is done by your harness (`commandAgent`) |
| §5 Not the harness's job | Graph extraction, formal modeling, recommendations, measurement | PathCompiler's, unchanged |
| §6, §19 The harness does not grade itself | Independent evaluation; criteria not weakened | **Implemented** for any stack: `mergeAssessment` over the project's own checks (compared with the base), the behavior check, risk signals from the diff, an independent reviewer, safety and, where the repository is a Next.js app, the product-model evaluation (ADR 0097) |
| §7–§11, §29 Task contract, interpretation | Schema-validated `HarnessTaskSpec`, protected properties over suggested files | **Implemented** (I2); the task is validated before any mutation |
| §12–§13 Reject, blocked, partial | A harness may refuse; blocked and partial are valid | **Implemented**: statuses, open questions, no-candidate runs |
| §14–§18 `MutationResult`, claimed changes | Valid result; claims compared with observation | **Implemented** (I2/I9, validated against the task by `parseMutationResult`) |
| §20–§23 Good/bad behavior, exploration and strategy | The harness's domain | External |
| §24–§25 First integration, CLI contract, exit codes | A local CLI: task in, repository mutation, result out; exit 0/2/3/4 | **Implemented** as `pathcompiler harness run`; a command harness uses the same exit codes |
| §26 Worktree / isolation | Never mutate the developer's tree | **Implemented**: git worktree on a new branch; HEAD and status verified unchanged |
| §27 Reproducibility metadata | Harness version, run ID, base and candidate commit, timestamp | **Implemented** in `harnessMetadata` and the run record |
| §28, §30–§34 Bounded context, task types | Bounded task; FIX/IMPROVE/PROMOTE/BUILD guidance | The task is bounded by construction (I2); the guidance is for the harness |
| §35 Scope | Source/UI/config changes only | **Implemented**: no deployment, flags or A/B orchestration |
| §36–§39, §70–§73 CI/CD, deployment, preview | Deferred | **Not built**, by design. `pathcompiler ci` (BX13) checks a pull request; it deploys nothing |
| §40–§44 Browser, tests, minimal candidates | Candidates that run, with tests | Project checks are run (`harness.checks`); browser verification is the existing `evaluate --browser` |
| §45–§46 Assumptions, unresolved questions first-class | Reported | **Implemented**: notes file → result; open questions make the verdict `review` |
| §47 Safety rules | No merge, no deploy, no secrets, no billing change, no relaxed permissions, no removed checks, no altered evaluation contracts | **Partly**: never merges or deploys; protected paths and secret scan are enforced on the diff; permission and check changes are caught by the evaluation and behavior check **where they apply**; a billing rule changed without a task is not detectable unless an approved rule covers it |
| §48 Human review | Early lifecycle ends in human review | **Implemented** (approval mode); automatic mode is an explicit, double opt-in extension |
| §49–§52 First milestone, fixture tasks | A proof of concept and three tasks | The milestone is implemented; the refund fixture and `examples/harness-contract` provide tasks; the third (blocked requirement) is covered by blocked-result tests |
| §53–§56 Quality metrics | Unexpected-change rate, human edit distance, constraint violation rate | **Not computed** (ISSUES_LOG #69); the run records hold the inputs (assessments, decisions), and with `--record` (BX14) human approvals and rejections of runs are also recorded as events |
| §57–§58 Versioning, validation | Fail on unsupported major versions; validate before mutation | **Implemented** |
| §59 Run IDs | Unique, retries linked | **Implemented** (`--previous`) |
| §60 Logging | Operational log, no reasoning | **Implemented**: run history, `agent.log` (redacted) |
| §61–§62 Secrets, network | No secrets in results, commits, logs; network is the harness's | **Implemented** for results, logs and commits (scan and redaction); network is the harness's |
| §63–§64, §66–§69 Multiple candidates, search, feedback, feasibility, cost, specialized harnesses | Later | **Not built**, by design |
| §74–§77 Collaboration, shared fixtures and contract tests | Shared fixture repository and contract fixtures | `examples/harness-contract/` and the refund fixture; contract tests exist |
| §78 Definition of done, Harness V0 | Consumes a task; base commit; isolated; makes a change; runs checks; commits; valid result; blockers; never merges; passes fixture scenarios | **All met** with scripted harnesses |
| §79 Definition of done, Integration V0 | Recommendation → task → candidate → result → evaluation without manual conversion | **Met** (I9) and now runnable end to end with `harness run` |
| §80–§83 Boundary and mission | One-sentence mission | Unchanged |

## Since the handoff was implemented

The handoff describes PathCompiler *driving* a harness. Later phases added the
other directions, all following the same rule that a harness never grades itself:

| Direction | What exists | Phase |
| --- | --- | --- |
| Harness as implementer | `harness run` with approval and automatic modes | BX9 |
| Harness as reader of code, history and documents | `rules task` / `rules import` / `--harness-command`; the task lists the repository's documents and agent prompts | BX8, BX13, BX15 |
| Harness as describer of code in a language no extractor reads | `contract task` / `contract import`; validated, anchored, inferred until a person approves | BX12 |
| Harness as independent reviewer | `--review-command`; concerns must cite evidence found in the candidate | BX10 |
| Harness as client of PathCompiler's checks | `mcp-agent`, function-calling schemas, `tools call`: `check_change` on uncommitted work, `check_action`, `check_output`, `readiness` | BX11, BX13, BX15 |
| Harness feedback as data | `--record`, `pathcompiler_record_feedback`, `dataset export` | BX14 |

Trust rules that apply to all of them: facts a harness or model wrote are
inferred until a person approves them; in a pull request approval is taken only
from the base branch; a violation found through unapproved facts is capped at
`review`; the harness and reviewer commands come only from flags or environment
variables, never from repository files. None of it has been run against a real
harness yet (ISSUES_LOG #63, #66).

## Using it

```yaml
# pathcompiler.yaml
modes:
  self_improvement: true
improvement_policy:           # only for automatic mode
  autonomous_mutation: true
  max_autonomous_mutations: 2 # automatic publications per day
harness:
  mode: approval              # or automatic
  checks: ["pnpm test"]        # `pathcompiler harness detect` suggests them for any stack
  setup: ["pnpm install --frozen-lockfile"]   # run in each fresh worktree
  link_paths: ["node_modules"]               # or link an existing install
  baseline: true               # run the checks at the base too
  assessment:
    independent: [checks, behavior, evaluation]   # what may vouch for a change (add reviewer to let it)
    require: []                                   # what must have passed
  review:
    enabled: false             # a separate reviewer: PATHCOMPILER_REVIEW_COMMAND
  risk_paths: ["src/billing/**"]
  approvals:
    before_run: false         # approval mode: also ask before the harness starts
  publish:
    target: pull_request      # none | branch | pull_request
    draft: true
  automatic:                  # automatic mode: outside these, a person is asked
    allow_verdict: pass       # or review
    max_files: 20
    max_changed_lines: 500
    require_approval_paths: ["src/billing/**"]
  protected_paths: ["infra/**"]
```

```bash
export PATHCOMPILER_HARNESS_COMMAND='my-harness --task "{task}" --repo "{worktree}"'
pathcompiler harness task <recommendation-id> <base-commit>      # or write a HarnessTaskSpec yourself
pathcompiler harness run <task-id|task.json> <repo> --bind payment=payments
pathcompiler harness runs
pathcompiler harness status <run-id>
pathcompiler harness approve <run-id> <repo> --by you [--publish branch|pull_request|none]
pathcompiler harness reject  <run-id> <repo> --by you --reason "…"
```

The harness command runs inside the isolated worktree with `PATHCOMPILER_TASK`,
`PATHCOMPILER_WORKTREE`, `PATHCOMPILER_NOTES`, `PATHCOMPILER_RUN_ID` and
`PATHCOMPILER_BASE_COMMIT` set (`{task}`, `{worktree}`, `{notes}`, `{run}` and
`{base}` in its arguments are replaced). It edits files, optionally writes the
notes file (`summary`, `assumptions`, `unresolvedQuestions`,
`claimedSemanticChanges`, `testsAddedOrChanged`, `status`), and exits 0, 2, 3
or 4. It must not merge, push or deploy.
