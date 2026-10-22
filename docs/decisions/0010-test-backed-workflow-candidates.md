# ADR 0010 — Test-backed workflow candidate envelopes

## Context

Phase 8 must produce reviewable workflows with ordered steps, provenance and
completion conditions. Fixture tests also contain failed submissions, cancellations,
setup, repeated rows and multiple business operations. Copying an entire test would
produce a misleading workflow. Static target annotations do not constitute approval.

## Decision

Compile bounded test-body segments beginning at a capability action and ending at
a positive, resolved observation assertion. Source/route evidence supplies stable
semantic identities; test events supply order and observed transitions. The current
supported actions are click, fill and selectOption with a single unscoped locator.
Unsupported, conditional, scoped, cross-page, cancellation or subsequent capability
actions terminate extraction. Missing completion yields a skipped capability.

Recognize a failed native-form submit only when an error assertion, corrected input
and retry of that same submit provide evidence; record its omission. Text success
signals outrank shared-container disappearance, which remains explicitly weak.
Keep alternative observed paths separate instead of inventing branch predicates.
Input values and observed roles do not become execution defaults or access policy.

Add `element_text` (exact/contains) and `element_count` to Workflow V1 conditions.
This additive IR extension is necessary to preserve fixture assertions honestly;
using invented events or mere target visibility would lose their meaning. Consumers
must handle the new discriminants. Existing workflows remain valid.

Use a candidate envelope around Workflow V1 for ambiguities, trace observations and
per-validator statuses. Schema validation is explicit; all subsequent checks are
not-run. Candidate/report schemas enforce snapshot agreement. Preserve event and
source citations, clone the graph and add candidate support edges. No model runs.

Use the maintained `yaml` package for YAML 1.2 serialization/parsing instead of a
partial parser. Reject duplicate keys, aliases, multiple documents, nonstandard tags
and oversized input. CLI preflights replacement targets and refuses approved or
invalid artifacts. It does not prune previous candidates or overwrite approved paths.

## Alternatives

- Copy complete tests: includes setup, negative probes and unrelated capabilities.
- Infer ordering solely from API/component adjacency: does not prove UI sequence.
- Infer event names from prose: fabricates completion evidence.
- Implement YAML internally: adds avoidable format/security complexity.
- Infer branches or row bindings now: exceeds evidence and the current runtime IR.

## Consequences

The fixture yields three workflows, including structurally valid `clients.create`.
Edit/deactivate need better observation targets before discovery can complete them.
Candidate confidence measures deterministic rule strength, not passing execution.
Input bindings, prior state, weak completion and partial traces require review.
The later validator/runner must not trust candidate validation labels as proof.
Approved-target priority becomes applicable when the approval registry exists.
Historical/API evidence remains supporting context, never invented executable steps.
