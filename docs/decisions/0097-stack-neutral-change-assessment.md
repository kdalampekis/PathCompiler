# ADR 0097 — Stack-neutral change assessment (BX10)

## Context

ADR 0096 judged a harness candidate with a product-model evaluation (Next.js
only) and a behavior check (needs a specification the TypeScript extractors can
read). On any other repository nothing independent ran, the verdict was always
`review`, and automatic mode never published. That contradicts the product's
goal (docs/PRODUCT_NORTH_STAR.md): any business, any codebase, harness-integrated.
It was first recorded as an acceptable limit; it is a bug against the goal.

## Decision

Every source of the assessment must work, or degrade honestly, on any stack, and
what may vouch for a change is the user's configuration.

- **Project checks, compared with the base.** `harness detect` recognises the
  test, lint, type-check and build commands of JavaScript/TypeScript, Python,
  Go, Rust, the JVM, .NET, Ruby, PHP, Elixir, Swift and Makefile targets, and
  proposes them; it runs nothing. The configured checks run in the candidate
  worktree and, with `harness.baseline` (default on), at the base commit in a
  second worktree. Each check is classified: passes, **regression** (passed at
  the base, fails now: `fail`), fixed, **fails at both** (the same failure: not
  the change's doing, a note and no signal), or fails with nothing to compare
  (`review`). `harness.setup` commands and `harness.link_paths` prepare each
  fresh worktree (install dependencies, link `node_modules` or a virtualenv).
- **Risk signals from the diff, in any language.** Paths and changed lines:
  guard-like lines removed and not merely moved or reworded (`throw`, `raise`,
  `panic`, `assert`, `return err`, 401/403…), a number changed inside an
  otherwise identical line (thresholds, limits, prices), assertions removed from
  tests, and what the change touches (authorization, billing, security, data
  model, public API, infrastructure, agent prompts and tools, dependencies).
  A content signal makes the verdict `review`; where the change is is context
  for a reviewer unless the user marks paths sensitive (`harness.risk_paths`,
  `automatic.require_approval_paths`). Signals never fail and never vouch.
- **An independent reviewer.** A separate harness or model (a command,
  `--review-command` or `harness.review`) receives the task, the known rules and
  the patch, and returns concerns that must cite a file, lines and a quote.
  PathCompiler keeps only findings whose quote is in the candidate's file at
  those lines; the rest are discarded and counted. A concern makes the verdict
  `review`; it never fails a change.
- **One merge with explicit rules.** Each source reports a signal (passed,
  failed, flagged, no signal, not run). The verdict is `fail` if any definite
  failure, `review` if anything is flagged, and `pass` only if nothing is
  flagged **and** at least one source in `harness.assessment.independent`
  (default: checks, behavior, evaluation) passed. `assessment.require` lists
  sources that must have passed. A reviewer may be allowed to vouch
  (`independent: [reviewer]`); by default an opinion does not. The assessment
  also says what was not checked (business rules, when no specification
  exists).
- **Evidence a person can read.** The run record and the pull request body show
  each source's signal, who vouched, and the notes.

## Alternatives

- **Treat passing tests as proof.** They are the best universal signal, so they
  may vouch, but the assessment says plainly when business rules were not
  checked, and the user can require the behavior check.
- **Let the reviewer decide.** An LLM's opinion would make the verdict as
  unreliable as the implementer's. It raises concerns; evidence-checking keeps
  it honest.
- **Per-language analyzers first.** Needed for rule *extraction* (the behavior contract, BX12, is the language-neutral answer) but not
  for judging a change: paths, lines and the project's own checks are enough to
  be useful everywhere today.

## Consequences

- `harness run` and automatic mode work on a Python repository (tested with a
  real `unittest` project) with no TypeScript and no Next.js: a harmless change
  passes on the strength of the tests, a change that breaks a test is rejected,
  a raised limit or a dropped guard goes to review.
- The default can vouch with tests alone, which cannot see a business rule no
  one encoded (the support-agent fast path passes the Python tests). Closing that
  needs the rules: the behavior contract (BX12, ADR 0099) lets a harness describe
  operations in any language so the approved rules apply, and the reviewer
  already catches it when it reads the diff.
- Running the checks twice roughly doubles the time; `harness.baseline: false`
  trades attribution for speed.
- The risk heuristics are crude by nature and will have false positives and
  negatives; they are bounded to `review`, never `fail`.
