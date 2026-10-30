# Can this work at every company? An adoption audit

Written from the product-management and architecture point of view, against
[PRODUCT_NORTH_STAR.md](PRODUCT_NORTH_STAR.md): *any business, any codebase,
harnesses and LLMs first-class, people set the autonomy.* It lists what stops a
company from using PathCompiler, what was done, and what is still open. It does
not claim a barrier is gone when it is only reduced.

## The user journeys that must work

1. **A team with a codebase in any language** wants to know if a pull request
   breaks a business rule, before merge, without changing how they work.
2. **A team using a coding harness** (Claude Code, Cursor, Codex, an in-house
   agent) wants the harness to check its own work and learn the rules.
3. **A team running agents in production** wants an agent's action checked
   against the business's rules before it executes.
4. **A business owner or compliance lead** wants to see which rules are enforced,
   who approved them, and what was blocked.

## Barriers, and where each stands

| # | Barrier | Who it stops | What was done | Status |
| --- | --- | --- | --- | --- |
| 1 | Only TypeScript, SQL and OpenAPI could be read | every non-TypeScript company | Behavior contract: one language-neutral format any harness, model or person fills in; anchors detect when the described code changes (ADR 0099) | **Reduced.** Works for any language; quality depends on the description |
| 2 | Nobody knows what to do first; 60+ commands | every newcomer | `pathcompiler start` and `pathcompiler_readiness`: stage, ordered next steps with commands (ADR 0100) | **Done** |
| 3 | Rules are hand-written JSON in a custom syntax | business owners | Harness proposes rules with evidence; people approve in plain language (each rule has a description); approval is a reviewed commit | **Reduced.** Approval UX is still files and a CLI |
| 4 | A new tool that can fail the build is a risk | engineering managers | `ci --report-only`, GitHub Actions template, step summary | **Done** |
| 5 | Is my code sent anywhere? | security and compliance | Nothing is sent by default; deterministic path needs no model; harness and reviewer commands come only from flags or environment, never repository files; `--explain-context` shows exactly what a model would receive | **Done**; needs a plain security note in the packaging phase |
| 6 | Business rules live in documents, tickets, heads | every business | Discovery task lists documents; harness cites them as evidence | **Reduced.** Documents in the repository only; tickets and wikis need the harness's own access |
| 7 | The rule language cannot say everything (linear integer arithmetic, booleans, enums, string equality) | finance, insurance, anything with decimals, dates, percentages, collections | Unsupported constructs are listed as limitations, never guessed; risk signals and the independent reviewer cover the gap | **Open.** The largest correctness limit (ISSUES_LOG #74) |
| 8 | Install: Node 22+, built from source, nothing published | non-JavaScript companies | None yet | **Open.** BX16: published packages, a container image, a single-command install; needs decisions on names and license |
| 9 | Unproven on real software | everyone | Tested on author-written fixtures only (TypeScript refunds, Python refunds) | **Open.** The real-software trial (ISSUES_LOG #57) |
| 10 | Large repositories and monorepos | big companies | The task lists files and the harness reads what it needs; the PR check is incremental by diff; `--exclude`. Operation IDs share one namespace, so two services with a `refund` collide | **Open** for monorepos (ISSUES_LOG #75) |
| 11 | Who is allowed to approve a rule? | regulated companies | Approvals record the person and time; rule files are ordinary files, so CODEOWNERS and review rules apply | **Reduced.** No in-product roles |
| 12 | Proof of value | the buyer | `start` shows coverage; the PR report lists findings | **Open.** No history or trend view; counterexample records exist per run |
| 13 | Agentic software: tools, prompts, policies, answers | teams building agents | Action gate and its tool exist; harness can describe an agent's tool functions through the contract | **Open.** Tool definitions and prompts as rule sources, and an answer check before rendering, are BX15 |
| 14 | Feedback does not yet become datasets | AI / alignment teams | Designed (north star), not built | **Open.** BX14 |

## What a company does on day one, now

```bash
pathcompiler start .                     # where you stand, what to do, the MCP config
pathcompiler contract task .             # if the language has no extractor: give this to your harness
pathcompiler rules task .                # the harness proposes rules with evidence
pathcompiler rules approve <id> --by me  # people decide what is true
pathcompiler ci --report-only            # watch it on pull requests before it can block
```

and in the harness's MCP settings: `pathcompiler mcp-agent .`.

## Verdict

PathCompiler can now be pointed at a repository in any language and produce a
first useful result in minutes, and can be rolled out without risk. It cannot
yet be *adopted* by an arbitrary company, for three reasons that are product
work, not engineering polish: it is not installable without a JavaScript
toolchain (8), it has never met real software (9), and the rule language cannot
express every business rule (7). The roadmap puts them in that order: run the
trial, widen the rule language where the trial shows it matters, then package.
