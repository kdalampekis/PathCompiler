# ADR 0096 — Harness runner with approval and automatic modes (BX9)

## Context

`HARNESS_ENGINEERING_HANDOFF.md` is written for the engineer of an external
coding harness: take a `HarnessTaskSpec`, work in isolation at the base
commit, run checks, commit a candidate, return a `MutationResult`, never merge
or deploy. PathCompiler's side of that boundary (the contracts, `harness task`,
`harness import`, the independent evaluation) exists since I2/I9, but nothing
ran a harness. The request: implement the handoff, in two versions — one where
people approve the harness's changes and pull request, one that goes on by
itself — with the choice under the user's control, and with the features that
have both a deterministic and a harness path using both and merging them.

## Decision

- **New `@pathcompiler/harness-runner`.**
  - **Harness V0 (`executeHarness`).** Validates the task before touching
    anything (supported contract version, base commit present, run ID unused);
    creates an isolated git worktree at the base commit on a new branch
    `pathcompiler/<run id>`; runs the *agent*; diffs against the base; applies
    the safety rules; runs the project checks (`harness.checks`); commits the
    candidate itself; emits a valid `MutationResult` with run ID, harness
    identity, timestamps and the optional previous run. It verifies that the
    developer's own working tree and HEAD are unchanged. Exit codes are the
    handoff's: 0 completed, 2 partial, 3 blocked, 4 failed.
  - **The agent is your harness**, a process: `commandAgent` runs the command
    in the worktree with `PATHCOMPILER_TASK`, `_WORKTREE`, `_NOTES`, `_RUN_ID`,
    `_BASE_COMMIT`, reads its exit code and an optional notes file (summary,
    assumptions, open questions, claimed semantic changes, tests changed). A
    `scriptedAgent` serves tests and in-process harnesses. PathCompiler writes
    no code changes itself.
  - **Safety (handoff §47), mechanically.** A candidate that touches a
    protected path (secrets and keys, `pathcompiler.yaml`, `.pathcompiler/`,
    CI workflows, approved-rules files, plus `harness.protected_paths`) or adds
    a secret is *discarded*, not committed, and reported blocked. Deleted
    tests are flagged for review. What a diff cannot show (a billing rule
    changed, a security check weakened) is covered by the assessment below.
  - **Independent assessment, merged.** The harness's own report is one input.
    `mergeAssessment` combines: the harness (status, open questions), safety,
    the project checks, the product-model evaluation (reachability, permission
    boundaries, protected properties, claimed against observed semantic change,
    where the repository is one PathCompiler can model) and the behavior check
    (the PR guard: approved and extracted rules at the base against the
    candidate). Any failing source fails the candidate; any flag makes it
    `review`; if no independent source could run, the verdict is `review`,
    never `pass`.
  - **Two modes (`harness.mode`).** `approval`: the pipeline stops for a person
    — optionally before the harness starts (`approvals.before_run`) and always
    before anything leaves the machine. `automatic`: the pipeline publishes by
    itself when the candidate is `pass` (or `review` if `automatic.allow_verdict`
    says so), the harness reported `completed`, it is within `max_files` and
    `max_changed_lines`, touches none of `require_approval_paths`, and the
    number of automatic publications in the last day is under
    `improvement_policy.max_autonomous_mutations`; otherwise it waits for a
    person and says which condition held it. In both modes a candidate whose
    assessment fails is rejected and never published. `--mode` overrides the
    configured mode for one run.
  - **Double opt-in.** Running needs `modes.self_improvement: true`; automatic
    mode additionally needs `improvement_policy.autonomous_mutation: true`
    (validated when the configuration loads), and publishes only up to
    `max_autonomous_mutations` per day (default 0). `harness.limits` caps runs
    per day.
  - **Publishing** is a separate interface: push the branch (never a force
    push, never the base branch) and, for `pull_request`, open a draft pull
    request with the `gh` the person already has. PathCompiler stores no token.
    The pull request body states who approved or that policy cleared it, the
    assessment, the open questions and that nothing is merged. **PathCompiler
    never merges and never deploys**, in either mode.
  - **Runs are records.** Each run is `harness/runs/<id>/run.json` with its
    state, assessment, decision and an event history that names who decided;
    plus the task copy, `agent.log` (secrets redacted, no reasoning) and a
    review `report.md`. `harness runs | status | approve | reject` manage them.
- **The command is never read from the repository.** `--harness-command` or the
  environment variable named by `harness.command_env` (default
  `PATHCOMPILER_HARNESS_COMMAND`). A checked-out repository's configuration is
  untrusted input and must not choose what to execute.
- **One JSON-command protocol for every structured task.** The same command
  contract (`pathcompiler-command/1`: a JSON document on stdin, a JSON document
  on stdout, no shell) makes a harness usable as `model_provider.provider:
  command` for the analysis tasks, as `rules discover --harness-command`, and
  as `repair propose --harness-command`. This is the ADR 0034 "external
  harness as analysis backend", in the narrow, validated form that already
  exists for models.
- **Deterministic and harness paths, merged by feature:**

  | Feature | Deterministic | Harness | How they merge |
  | --- | --- | --- | --- |
  | Understand the product | analyzers, evidence | hypotheses via the command provider | harness output is a hypothesis, validated against deterministic evidence before it counts (ADR 0034) |
  | Find business rules | extractors (schema, Zod, OpenAPI, tests, guards) | `rules task/import`, `rules discover` | one specification: corroborating sources are kept once with all provenance; harness rules are candidates until approved |
  | Make a change | none | `harness run` | the harness proposes; deterministic checks decide |
  | Repair a violation | verification, regression eval | `repair propose --harness-command` | the harness proposes; the deterministic loop accepts or rejects |
  | Judge a candidate | product-model evaluation, behavior check, checks, safety | the harness's claims and questions | `mergeAssessment`: worst verdict wins; nothing independent → review |

## Alternatives

- **Build a coding agent inside PathCompiler.** Re-creates what harnesses are,
  needs a vendor, and blurs the boundary the handoff is built on (the harness
  does not grade itself).
- **Let automatic mode merge.** The handoff forbids it for the first version and
  nothing here has been measured on real repositories.
- **Read the harness command from `pathcompiler.yaml`.** Convenient and a
  remote-code-execution path for anyone who can edit a branch's configuration.

## Consequences

- A team can run a coding harness under policy: read-only review, or hands-off
  within limits, with every decision on record.
- The assessment is only as strong as the checks that apply. On a repository
  with no Next.js model and no behavior specification the verdict is `review`
  by construction, and automatic mode will not publish it.
- `harness.checks` run commands from the repository's configuration inside the
  worktree. They run the candidate's own code, as any test command does; do not
  run `harness run` in CI on branches you do not trust.
- Nothing here has been run against a real harness, a real GitHub remote or a
  real pull request: the tests use node scripts as the harness, a local bare
  repository as the remote and a stub for `gh`.
