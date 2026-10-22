# ADR 0009 — Capability identity, evidence and evaluation

Status: Accepted for Phase 7

## Context

Phase 6 identifies surfaces, including incidental controls. Phase 7 needs meaningful
business capabilities, stable identities, merged supporting evidence and a measured
fixture result. Static source/test/history evidence cannot establish live success,
authorization or objective probabilities. An expected capability list must not
become an inference rule that hides false positives or missing capabilities.

## Decision

Extend the existing capability-engine package with `discoverCapabilities` and
validated capability/discovery/evaluation contracts. It accepts a technical graph,
discovers surfaces internally and returns a cloned graph plus a versioned report.
The existing surface implementation moves to `surfaces.ts` behind the same public
API, avoiding a circular module dependency. No new production dependency or model
provider is needed. Existing surface/capability graphs are rejected on refresh.

Seed capabilities from non-page surfaces using, in priority order:

1. Recognized `domain.verb[_qualifier]` semantic action IDs.
2. Accessible verb-and-entity names, using matching final route segments to split
   an entity from a qualifier, such as Change Plan Structure.
3. Business-action component names ending in Button/Action for controls or
   Modal/Dialog/Form/Panel for containers.

Supported verbs are create, edit, change, deactivate, activate, delete, archive,
restore, invite, duplicate, export, import, assign and unassign. Add/New normalize
to Create; Update/Modify normalize to Edit. Archive and Deactivate remain distinct.
Semantic target prefixes are preserved. Label/component fallback uses conservative
regular English singular/plural rules and lowercase underscore-separated tokens.
Generic Save/Confirm/Back/Cancel controls and input/observation surfaces do not seed
capabilities. APIs, tests and PR prose cannot independently invent a capability.

The canonical key is `domain.verb[_qualifier]`; the graph node ID is
`capability:<key>`. The key contains no source path, line, occurrence index or SHA.
Duplicate keys merge their surface IDs, rule citations, routes and evidence sets;
they do not gain confidence from repetition. Explicit target semantics win over
conflicting labels, with a diagnostic and a review reason. Label-derived keys can
change when inferred product meaning changes; no persistent alias registry or
arbitrary synonym/ontology matching is introduced in this phase.

Each capability retains domain, verb, entity, qualifier, title, candidate status,
heuristic flag, contributing surfaces, rule citations, source/evidence IDs and
source locations. Reports extend the existing surface report and evidence bundle
schemas, retaining their referential and snapshot checks. Graph edges connect
surfaces to capabilities with `IMPLEMENTS` and capabilities to their evidence with
`SUPPORTED_BY`. Existing source, surface and test nodes remain unchanged.

API associations distinguish explicit `HANDLES`/`CALLS`/`CALLS_API` reachability
from component context. Context includes API calls from the component or its named
nested functions, matching the entity/domain path and conventional mutation method
(POST for Create, DELETE for Delete, PATCH/PUT otherwise). This deliberately omits
unresolved context-only POST action endpoints; explicit handler paths retain them.
Call traversal is cycle-safe and preserves the contributing call paths. Context
does not establish opener/state flow or attribute a shared form branch to an action;
it is marked `component-context` and receives no score bonus.

Role observations come only from existing `REQUIRES_PERMISSION` links on selected
source nodes. They retain permission-node provenance and `rolesAreAuthoritative:
false`. These observations can represent positive, negative or unrelated comparisons
within the enclosing component. They are not an authorization policy; no default
roles are invented. Source/test/history/PR provenance uses the existing evidence
collector, preserving historical SHAs separately from the current source commit.

Confidence is explicitly `rule-strength-not-probability`:

| Evidence | Score contribution |
| --- | --- |
| Strongest naming rule: semantic target / accessible name / component name | 0.8 / 0.6 / 0.5 |
| At least one mapped UI action in a normal/only test body | +0.1 |
| At least one API reachable from an explicit surface handler | +0.05 |

Scores cap at 0.95. Low is below 0.7, medium below 0.85, high otherwise. Assertions,
setup/teardown, skipped/fixme tests, PR prose, contextual APIs and duplicate evidence
do not add score. Tests remain statically mined and unexecuted. Every capability
has `reviewRequired: true`; low scores explicitly include `low-confidence`.
Unknown roles, uncommitted snapshots, naming conflicts and contextual API evidence
also remain visible in review reasons.

`evaluateCapabilities(actualIds, expectedIds?)` computes exact-ID set differences
after inference. It reports matched/unexpected/missing IDs and both error counts.
Without ground truth, the status is `not-evaluated` and counts are null. The fixture
has a separately maintained JSON expectation file containing the five intended IDs.
Tests prove that changing expectations changes evaluation without changing the
capabilities or graph. Schema validation rejects fabricated report counts.

The CLI composes source scanning, static Playwright mining and capability discovery.
`capabilities discover [directory] [--expect json-file] [--out directory]
[--exclude path ...]` writes separate `reports/capabilities.json` and
`graph/capability-graph.json` artifacts. The expectation path is relative to the
working directory, not automatically discovered in the scanned repository. Existing
scan/surface/test artifacts are preserved. No repository code or model executes.

## Alternatives

- Reuse all user actions as capabilities: promotes Save, Close and field edits
  into business goals and creates duplicates.
- Hardcode the fixture capabilities or use expectations as a filter: conceals
  discovery failures and makes the false-positive count meaningless.
- Infer capability semantics from LLM/PR prose: unnecessary for the fixture and
  introduces unsupported certainty. The provider interface remains available but
  unused; deterministic facts are sufficient for this phase.
- Generate workflows while linking evidence: sequencing, state transitions and
  executable candidate artifacts are explicitly Phase 8 work.

## Consequences and limits

The fixture yields all five expected capabilities with zero false positives and
zero false negatives. Tests cover duplicate merging, aliases, semantic identity
after label/file changes, confidence/review requirements, provenance, independent
evaluation, malformed reports and repeatable CLI output. The fixture metric says
nothing about accuracy on an arbitrary repository.

Names and annotations are still claims requiring review. Unsupported verbs,
irregular nouns, namespaced annotations, localization, generic verbs without an
entity and inaccessible/dynamic names can be missed. Semantically equivalent keys
with different domains or arbitrary synonyms are not merged. Static surface
limitations from ADR 0008 remain, including unresolved layouts and children/state
projection. Role and contextual API associations may be broader than the specific
action. Reports retain those limits rather than approving behavior.

All required Phase 7 scope is implemented. The CLI and explicit evaluation file
are delivery extensions. No workflow candidate, approval UI, persistent registry,
browser manifest, vendor integration or Phase 8 sequencing is added. Evidence
reports remain private build-time artifacts.
