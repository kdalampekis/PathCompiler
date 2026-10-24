# ADR 0053 — Configuration file and capability flags

## Context

Phase C2 adds `pathcompiler.yaml` (CODEX spec §44), the reasoning and
analytics development flags (reasoning spec §116, §139), the operating modes
(ADR 0033), model-provider selection without keys (ADR 0034), and the
improvement policy (ADR 0033: `autonomous_mutation: false`). Until now,
opt-in capabilities were switched on only by CLI flags. The acceptance
criterion is that a repository without the file behaves exactly as before.

## Decision

- **New `@pathcompiler/config`.** `PathCompilerConfigSchema` is a strict Zod
  schema over the snake_case YAML of spec §44. It covers:
  - `version: 1`, `project`, `repository`, `framework`;
  - `modes`: understand, guide and evaluate on; observe, recommend and
    self-improvement off;
  - `reasoning`: a master `enabled` switch plus reachability, planning,
    unsat explanations, property checking, semantic diff, impact, enumeration
    and optimization, all off;
  - `probabilistic`: off;
  - `analytics`: disabled, no PII, hashed user IDs, no context keys, no
    ingestion;
  - `model_provider`: `none`, with an optional model name and
    `api_key_env`, an environment variable name;
  - `improvement_policy`: thresholds, budgets, `autonomous_mutation: false`
    and `max_autonomous_mutations: 0`;
  - `privacy.source_upload`, which can only be `false`.
- **Exported functions.** `loadConfig(directory)` returns `null` when there is
  no file. `parseConfig` lists issues by key path, and `featureFlags`,
  `reasoningEnabled` (master switch and capability flag),
  `analyticsPolicy` (the O0 privacy policy) and `defaultConfigYaml` complete
  the API.
- **Keys never live in the file.** Text that looks like a provider key
  (`sk-…`) is rejected with instructions to use `api_key_env`.
  `max_autonomous_mutations` must be 0 while autonomous mutation is off.
- **CLI.** The working directory's `pathcompiler.yaml` is loaded once per
  invocation. Without it, nothing is gated: the output is the same as before
  this phase. With it:
  - `reason reachable|plan|why-not|verify|diff` each need `reasoning.enabled`
    plus their own flag;
  - `observe` needs `modes.observe`, and `observe reconcile` also needs
    `reasoning.reachability`;
  - `evaluate` needs `modes.evaluate`;
  - `reasoning.impact` turns on `--reasoning` for `impact` and
    `proposals generate`, and an explicit `--reasoning` is refused when that
    flag is off;
  - `analytics.ingest` turns on `serve` ingestion, which then applies the
    analytics privacy policy.

  Every refusal names the file and the keys to set.
- **New commands:** `init` (writes the file with every default spelled out
  and refuses to overwrite), `config show [--json]`, `graph inspect` and
  `capabilities list` (spec §43).

## Alternatives

- **Treating a missing file as "all flags off".** That would break every
  existing workflow, which C2's acceptance criterion forbids.
- **Accepting API keys in the file with a warning.** Keys would end up in Git.
  Rejected outright.
- **Including spec §44 fields that nothing reads yet** (analysis include
  globs, sources, runtime modes, auto-propose). That would be configuration
  without behavior. They are left out, so the strict schema reports them,
  until a phase gives them meaning.

## Consequences

R-WI, C9 and IG can rely on reviewed flags. The GitHub App's own JSON config
(`"reasoning": true`) is not yet derived from the repository's
`pathcompiler.yaml` (ISSUES_LOG #16). Library callers can read the flags
directly.
