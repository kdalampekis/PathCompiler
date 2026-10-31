# ADR 0101 — Feedback capture and alignment datasets (BX14)

## Context

The end goal (docs/PRODUCT_NORTH_STAR.md, principle 6) is that wrappers around
agents record the answer, the verdict, the correction and the human decision, so
the datasets that alignment and post-training need exist as a by-product of
using the product. The training loop itself is out of scope. Every check already
produced the facts (a verdict, the rules behind it, a counterexample); nothing
kept them.

## Decision

`@pathcompiler/alignment-data`:

- **Events.** An append-only JSONL file (`.pathcompiler/feedback/events.jsonl`,
  git-ignored) of `feedback-event/1` records: kind (action check, output check,
  change check, human decision, outcome), verdict, agent and session, the
  subject, the checks behind the verdict (rule, status, explanation, whether the
  rule is human-backed), the counterexample, the specification hash, and
  `relatesTo` for an event that answers another.
- **Opt-in capture.** Nothing is recorded unless the server or command is started
  with `--record` (or `PATHCOMPILER_FEEDBACK=1`). Secrets are redacted in every
  string before writing. Unreadable lines are counted, never silently dropped.
- **Where it hooks in.** The toolbox records every check tool call and returns an
  `eventId`; `pathcompiler_record_feedback` lets the harness report what it did
  next (accepted, corrected with the corrected content, abandoned);
  `recordGateDecisions` plugs into `guardTool`'s `onDecision` for agents embedding
  the library; human decisions (`rules approve|reject`, `contract approve`,
  `harness approve|reject`) are recorded when capture is on.
- **Datasets**, from the events, deterministic and without a model:
  `preference` (a block followed by an accepted attempt for the same operation in
  the same session, or an explicit correction, with the rules that explain it),
  `sft` (accepted attempts, with the correction the agent had been given),
  `reward` (every checked attempt with a verifiable reward from the verifier or a
  person), and `eval` (labeled actions in the format `agent eval` reads; a block
  for a missing value is not labeled, because it says nothing about safety).
- **Privacy by default.** Exports contain structure only: operation, rule ids,
  verdicts. Requests, answers, summaries and explanations (which quote values)
  appear only with `--include-payloads`. A `DATASET_CARD.md` states counts, how
  labels were made, which rules were human-backed, whether content is included
  and the limits.

## Alternatives

- *Always capture.* Faster to accumulate data, but a repository would silently
  write agent traffic to disk. Opt-in keeps the consent decision explicit.
- *Model-judged labels.* Cheaper to scale but circular; verifier and human labels
  are the product's advantage.
- *A training loop.* Out of scope.

## Consequences

- Datasets are as good as the specification. A rule nobody approved yields
  labels nobody should trust; each record carries `humanBacked` so consumers can
  filter (ISSUES_LOG #76).
- Redaction covers secrets, not personal data; the card and the CLI say so.
