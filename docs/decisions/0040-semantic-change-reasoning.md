# ADR 0040 — Commit semantic reasoning

## Context

Phase R11 compares the formal models of two commits (reasoning spec §38–§42)
and completes the reasoning MVP (§94, steps 6–10): a permission change must be
reported as lost reachability, traced to the file and commit, and must lead to
a workflow proposal. The existing impact analysis and GitHub check are
deterministic graph rules (phases 19–22). Reasoning must add to them, not
replace them.

## Decision

- **`ProductReasoner.compareModels(before, after, options)`** (`reasoner-core`,
  model level).
  - **Contexts.** For each goal, the context variables in either model's slice
    are enumerated: booleans as false/true, enums as the union of both models'
    values. A value one model lacks falls back to that model's `otherValue`
    (default `unlisted`, the R1 role bucket); otherwise the comparison reports
    it as not applicable. Integer and string contexts stay free and are
    reported. At most `maxContexts` (default 64) combinations are checked per
    goal; above that the goal is reported, not checked.
  - **Comparison.** Every goal is checked in both models under every
    combination. Reachable → unreachable or absent is lost reachability. For
    lost reachability, R4's explanation runs on the after model, and its
    **root cause** is the explanation constraints the before model does not
    contain: same action and same conjunct, or the same initial fact.
    Goal-setting actions that disappeared are listed. Unreachable or absent →
    reachable is new reachability, with the witness.
  - **Other output.** Changed applicability (a different set of reachable
    contexts), a structural model diff that ignores evidence (which carries the
    commit), invariant changes (checking them is R8), and uncertainty for
    unknown answers.
- **`@pathcompiler/semantic-change`** (new) ties this to commits.
  `analyzeSemanticChange({ delta, base, head }, solver)` extracts both models
  (R1), compares them, and sets each root cause's `changedAt`: the evidence
  files that changed in the range. It groups findings into
  `affectedWorkflows`, one message per goal and change kind. Context lists are
  collapsed to the variables the change depends on, for example "role=editor"
  instead of one line per flag value. `summarizeSemanticChange` renders the
  §42 "Product Logic" format.
  - Keeping this outside `reasoner-core` keeps the reasoner independent of
    extraction and git.
  - `github-app` receives the solver as an injected factory, so it never
    imports Z3.
- **Impact and proposals (opt-in).** `analyzeWorkflowImpact(delta, approved,
  { semantic })` adds the reasons `reachability-removed` (high),
  `reachability-added` (medium) and `applicability-changed` (medium) to the
  workflows whose ID is the capability, with or without a variant hash. The
  report's method becomes `deterministic-rules+bounded-smt`. Existing
  proposal generation then works unchanged: high impact gives a proposal that
  carries the semantic reason.
- **Surfaces.**
  - `pathcompiler reason diff <base> <head>` writes
    `reports/semantic-change.json`.
  - `impact` and `proposals generate` accept `--reasoning`.
  - The GitHub App config accepts `"reasoning": true`, which adds a "Product
    logic" section to the check text. The deterministic summary is unchanged.
  - Everything is off by default, until C2 (configuration and flags) defines
    project-level settings.

## Alternatives

- **Diffing extracted models structurally only.** This flags every renamed
  conjunct but cannot say who lost access. Rejected; the structural diff is
  kept as context.
- **Comparing reachability only for contexts a user lists.** This misses
  roles nobody thought to ask about. Rejected in favor of bounded enumeration
  with a cap.
- **Running reasoning by default in impact and the GitHub check.** It adds
  solver time and a new evidence class to existing reports. Deferred until C2
  can make it a reviewed project setting.

## Consequences

For `next-demo`, changing `requireEditor` from `editor` to `owner`:
- removes reachability for editors on all five editor-guarded capabilities,
  each traced to `lib/session.ts` through
  `symbol:lib/session.ts#requireEditor`;
- adds reachability for owners;
- yields a high-severity proposal for the approved `clients.create`, through
  `proposals generate --reasoning`.

A copy-only change produces no semantic findings, so its false-positive rate is
0 on the fixture. Conclusions hold in the extracted models and are reported
with each model's coverage. The cost is two extractions plus about 6 queries
per goal for each comparison: about 10 s for the fixture.
