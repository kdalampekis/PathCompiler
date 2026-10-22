# ADR 0012 — Fixture-limited browser verification

## Context

Static validation (ADR 0011) proves references, reachability and agreement with
mined tests, but not that a workflow completes in the running application. Phase 10
asks for browser verification of `clients.create` without generalizing browser
automation beyond the validator's needs.

## Decision

Add `verifyFixtureWorkflow(unknown, options)` under the separate
`@pathcompiler/workflow-validator/browser` entry point. Playwright is an optional
peer dependency, so the static validator stays browser-free.

The runner accepts only the four-step Create Client path at `/clients`: exact
targets, actions and explicit `next` order, no branches, optional steps or
preconditions, supported target conditions and a `clients.feedback` text terminal.
Anything else fails at preflight before navigation. Origins must be loopback
without credentials, path, query or fragment.

The caller owns the `Page` and therefore the test user/session. Input values are
explicit options; they are never inferred from evidence and never recorded.
Each target must resolve to exactly one `data-pathcompiler` element before acting;
zero yields `target-not-found` and several yield `ambiguous-target`. Leaving the
fixture route aborts further actions.

The output is a versioned, schema-validated report with per-step action and
expectation status, terminal status and one structured failure (code, stage,
step, target, actionable message). `valid` must agree with observed results.

## Alternatives

- Generic action interpreter for any workflow: speculative and unsafe before review
  and runtime safety models exist.
- Read input values from test traces: leaks test data and couples evidence to runtime.
- Merge the report into `validateWorkflow`: would make static validation async and
  browser-dependent.

## Consequences

`clients.create` passes end-to-end; removed, duplicated or permission-hidden targets
fail with useful errors. Other workflows report unsupported rather than silently
passing. Broader verification needs explicit safe-action and input-binding contracts.
