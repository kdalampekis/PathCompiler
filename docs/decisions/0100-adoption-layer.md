# ADR 0100 — The adoption layer: start, ci, readiness (BX13)

## Context

A product-management read of the repository (docs/ADOPTION_AUDIT.md) found that
capability was no longer the main barrier to use at a company; effort and
trust were. A newcomer faced 60+ commands, hand-written JSON in a custom
expression syntax, `--bind` flags that need knowledge of the extractor, no
guidance on what to do first, and a PR check that either fails the build or
does nothing. A team will not give a new tool the power to fail builds before
it has watched it.

## Decision

- **`pathcompiler start [directory]`** reads the repository (no tests, no model,
  no network) and reports languages, project checks found, what is known
  (operations read from code and from the contract, approved and unapproved
  rules), the **stage** the repository is at (nothing to check, describe the
  code, add rules, approve, refresh, protecting) and the next steps in order with
  the exact commands and why. It also prints the MCP config for the user's
  harness, and suggests `--bind` pairs by matching names the code and schema use
  differently.
- **`pathcompiler_readiness`** serves the same report to a harness, so a harness
  dropped into an unfamiliar repository can ask "what should I do first?".
- **`pathcompiler ci`** is `verify-pr` with CI defaults: it finds the base branch
  (`--base`, `GITHUB_BASE_REF`, `origin/main`, `origin/master`, `main`, `master`),
  compares HEAD, writes `GITHUB_STEP_SUMMARY`, and with **`--report-only`**
  says what would have failed the build without failing it. `--print-workflow`
  prints a GitHub Actions file that starts in report-only mode.
- **Documents as a rule source.** The rule-discovery task lists the repository's
  documents (md, txt, rst, adoc) so a harness reads policy text alongside code
  and cites it as `doc` evidence.

## Alternatives

- *A wizard that writes pathcompiler.yaml.* Config is optional today and a
  wizard adds state to maintain; a report with commands to run keeps the user in
  control and is idempotent.
- *A hosted service.* Out of scope; nothing leaves the machine by default and the
  product must run inside a company's own CI.

## Consequences

- A newcomer can reach a first useful report with one command, and roll out
  enforcement gradually: report-only, then enforce.
- Installation is still from source (Node 22+, no published package, no
  container), which is the largest remaining barrier for non-JavaScript
  companies: BX16 in the roadmap.
