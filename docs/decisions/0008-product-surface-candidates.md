# ADR 0008 — Deterministic product surface candidates

Status: Accepted for Phase 6

## Context

The technical graph identifies source declarations, routes, UI targets and their
supporting tests/history. Phase 6 needs recognizable product surfaces before
Phase 7 can group them into capabilities. Static source establishes possible render
relationships, not live visibility, product intent or approved behavior.

## Decision

Create `evidence` and `capability-engine` as headless packages. The capability
engine's `discoverProductSurfaces(technicalGraph)` returns a cloned enriched graph
and a versioned report. It rejects graphs containing existing ProductSurface nodes
so refreshes cannot silently replace prior candidates. No model or vendor SDK is
part of the deterministic path.

Rules produce these candidate kinds:

| Source evidence | Surface |
| --- | --- |
| App Router page route | Page, named from the final URL segment (`/` becomes Home) |
| Component ending in Panel, Modal/Dialog or Form | Corresponding container, confidence 0.6 |
| Native form/dialog or static form/dialog/alertdialog/region/tabpanel/complementary role | Form, modal or panel |
| Native interaction, resolved Next Link or supported interactive ARIA role | User action |

Custom component event/role props alone are not DOM evidence. Native/ARIA
containers suppress duplicate suffix-based guesses from their owning component.
Observation anchors such as feedback and rows remain evidence, not actions.
Titles prefer static accessible names, then humanized semantic IDs, then an
explicit fallback with a diagnostic. Name-based semantic normalization and
business capability merging are deferred to Phase 7.

IDs are `surface:<kind>:<technical-anchor-id>`. Annotated actions inherit semantic
identity stability; unannotated structural/component/route anchors inherit their
existing move/rename limitations. All records have `status: candidate`,
`heuristic: true`, confidence, rule/title source, routes, nearest container parents,
source IDs, evidence IDs and complete supporting source locations. Confidence is
rule strength, not a calibrated probability or a permission decision.

The Next.js adapter now emits lexical `CONTAINS` between extracted JSX elements
and extracts unannotated native dialogs. Nesting stops at function/callback
boundaries. Surface containment uses those edges, component `RENDERS` and action
ownership; imports, navigation, calls and prose do not create containment.
Candidates without any static path to a page are omitted with diagnostics.
Recursive render cycles terminate; cyclic surface parent edges are omitted
deterministically with diagnostics. Report schemas reject dangling/cyclic parents,
duplicate references, missing evidence and stale/unsupported provenance.

Shared components remain one source declaration with multiple parents and routes,
not synthetic per-render instances. Page evidence includes the route and its
directly rendered components; other surfaces include their technical ancestors.
Generated `SUPPORTED_BY` edges refer to the selected evidence, and `CONTAINS`
connects candidate containers. Existing nodes and edges remain intact.

`collectGraphEvidence(graph, roots)` builds a deterministic packet of selected
nodes plus two outward support hops to Test, Commit and PullRequest nodes. This
covers source → commit → PR without unrelated graph traversal. Raw selected nodes
and edges preserve source/test/history association details, including heuristic
flags. It reuses workflow-ir's `EvidenceRef` contract rather than defining a second
workflow provenance format. Source/Test references use the scan commit, Commit
references use their historical SHA and PR references use their head SHA. All
source locations must agree with the source snapshot. Unborn source keeps raw
provenance but has no invented commit-bound workflow reference. Dirty/unknown
snapshots are explicitly flagged by the discovery report.

The optional `SemanticModel` interface exposes the specified classification and
summary methods. Request/result schemas and output parsers validate shapes and
reject citations outside supplied evidence/surfaces. The contract produces
unapproved proposals only; Phase 6 has no provider implementation or automatic
model invocation. Supplying a selected packet is the future caller's responsibility.

## Alternatives

- Infer surfaces from an LLM or PR prose: unnecessary for facts already available
  from source; adds a provider/privacy dependency and nondeterministic results.
- Model live component instances, visibility and state transitions now: requires
  prop/control-flow/runtime analysis beyond this phase. Preserve uncertainty.
- Use only component naming conventions: misses native forms/dialogs and treats
  ordinary component names as stronger evidence than they are.
- Add a graph database or an evidence storage service: current in-memory graphs
  and versioned JSON artifacts satisfy the phase without new infrastructure.

## Consequences and limits

`surfaces discover [directory] [--out directory] [--exclude path ...]` is a small
delivery extension to the spec. It writes `reports/product-surfaces.json` and
`graph/surface-graph.json`, preserving existing source/history/test artifacts.
The CLI scans source only; callers compose enriched graphs through the library.
No Phase 6 scope is omitted, and no Phase 7 capability discovery is implemented.

Static containment does not project custom component children, follow portals,
resolve conditional visibility or infer which button opens which modal. Shared
dialog content passed as children can therefore remain grouped under its source
page rather than the shared dialog. Layout-only controls currently have no route
render path and are omitted with diagnostics. Redirect-only pages retain an
unresolved-render diagnostic. Hidden, disabled or unreachable runtime branches
can still yield candidates; browser validation is a later phase.

The fixture produces 24 candidates: three pages, one shared modal, three forms
and 17 actions. Its five primary workflow action anchors are preserved; named
and ARIA panels are exercised by synthetic tests. Tests also cover nesting,
callback boundaries, shared components, recursion, stable annotated identities,
source immutability, repeatable bytes, evidence snapshots and the provider boundary.

Evidence packets contain private analysis details and can retain historical text.
They are build-time artifacts, never browser manifests. No approved workflow can
be overwritten because this phase creates no approved workflow artifacts.
