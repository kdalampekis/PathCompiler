# ADR 0033 — Product planes, operating modes and improvement gating

## Context

The reasoning extension describes a full self-improvement loop: observe,
diagnose, recommend, mutate, evaluate, experiment, measure, learn. Presented as
one product, it reads as five products mixed together. It also implies that
every signal should lead to a change.

Most customers will use only part of it. For example, a team may want guidance
plus analytics and recommendations, implement changes by hand, and never enable
a coding harness. Running a solver, harness, experiment and statistical analysis
for a confusing button label would be absurd.

## Decision

1. **Three planes over one foundation.** The foundational asset is the living
   Product Model plus Workflow Model.
   - **Product Intelligence plane (core):** evidence extraction, Product Graph,
     capabilities, workflows, formal reasoning, probabilistic evidence, the
     observed behavior model, reconciliation and diagnosis.
   - **Experience plane (consumer):** resolver-backed help, SDK, React and UI,
     guides, chatbots and assistants, product-help MCP, help docs, static export.
     It consumes the Workflow Registry and Product Model.
   - **Improvement plane (optional):** findings, gate, recommendations, candidate
     evaluation, experiments, outcomes, memory, harness handoff.

   Experience and Improvement both depend on Product Intelligence and never on
   each other. Chatbots and agents are Experience consumers, not part of the
   improvement loop.
2. **Six operating modes; a customer can stop at any of them.** Each mode only
   requires the ones before it, where noted:
   1. **Understand:** code → Product Model → workflows.
   2. **Guide:** Workflow Registry → SDK, UI, chatbot, assistant.
   3. **Observe:** runtime semantic events → analytics. Requires mode 1, and
      optionally mode 2.
   4. **Recommend:** formal plus observed behavior → diagnosis → human-facing
      recommendations.
   5. **Evaluate:** any candidate change, including an **ordinary human PR**, gets
      a semantic diff, formal checks, tests and browser verification. It does not
      require a recommendation, `HarnessTaskSpec` or `MutationResult`.
   6. **Self-improvement:** recommendation → external harness → evaluation →
      experiment → measurement → learning. It is opt-in and off by default.

   PathCompiler must remain fully useful if a customer never enables mode 6.
3. **Candidate evaluation is decoupled from the harness contract.**
   `CandidateEvaluation` accepts a base and candidate commit plus optional context
   (recommendation, protected behaviors, acceptance criteria, `MutationResult`).
   Phase I3 therefore no longer depends on I2.
4. **The improvement loop is selective and gated.** It has four trigger classes:
   - **Release-triggered:** PR or release → semantic diff. "No affected
     workflows" is a cheap no-op.
   - **Analytics-triggered:** fires only when declared thresholds are crossed.
   - **Scheduled:** periodic workflow health.
   - **Human-triggered:** for example "analyze checkout". This is expected to be
     the most useful first mode.

   The escalation policy runs in this order:
   1. Is the evidence sufficient? If not, collect more data.
   2. Is the impact meaningful? If not, log only.
   3. Is a recommendation actionable? If not, surface the finding.
   4. Is autonomous implementation enabled? If not, give a human recommendation;
      if so, emit a `HarnessTaskSpec`.
5. **Improvement value is explained, never opaque.** An Improvement Value
   Assessment combines impact, affected or eligible users, confidence, expected
   gain and estimated cost, and reports each component with a rationale. Any
   single ranking number is derived from visible components.
6. **Budgets and policy are explicit configuration.** An `improvement_policy` in
   `pathcompiler.yaml` sets minimum affected users, minimum confidence, minimum
   expected gain, maximum recommendations per period, maximum experiments,
   maximum autonomous mutations and a compute budget. The default is
   `autonomous_mutation: false`.
7. **"No change recommended" is a first-class outcome.** Alongside FIX, IMPROVE,
   PROMOTE, BUILD, DEPRIORITIZE and INVESTIGATE, a gate decision may be
   `no_change` with its rationale (for example, low usage consistent with a niche
   feature). This is not a failure.

## Alternatives

- Ship the loop as one product: harder to adopt and explain, and it forces
  infrastructure on customers who need only guidance or analytics.
- Recommend whenever a metric moves: produces noise and churn, and erodes trust.
- Require the harness contract for evaluation: blocks the most common case,
  human-authored PRs.

## Consequences

The roadmap groups phases by plane and labels the mode each one delivers. A new
improvement-gate phase (IG) sits between the finding model (I0) and recommendations
(I1). Mode 5 for human PRs becomes deliverable once R11, R8 and C8 exist,
independently of I2 and observability. Configuration (C2) carries modes, flags
and the improvement policy.
