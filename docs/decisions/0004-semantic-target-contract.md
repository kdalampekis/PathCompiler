# ADR 0004 — Semantic targets and read-only suggestions

Status: Accepted for Phase 2

## Context

File/owner/occurrence locators explain where an action was found but change when
components move or nearby JSX is reordered. Browser guidance needs identities
that developers can preserve across those edits. Existing test IDs and accessible
names are useful evidence, but neither proves a stable product meaning or a unique
visible DOM element.

## Decision

Use literal `data-pathcompiler` annotations on native JSX elements and Next.js
`Link`. IDs start with an ASCII letter and otherwise contain only letters, digits,
underscores, dots, colons or hyphens. A unique supported annotation becomes the
UIAction ID `ui:<semantic-id>`; provenance still records its source file, structural
locator and repository commit. Noninteractive annotated elements, including rows
and feedback, use `kind: observe`. Existing event/navigation edges use the semantic
node ID.

Store target evidence separately from confidence in the static action's existence:

| Evidence | Target confidence | Meaning |
| --- | --- | --- |
| Valid explicit annotation | 1.0 | Developer supplied identity |
| Literal `data-testid` | 0.8 | Existing test contract, pending semantic review |
| Static accessible role/name | 0.6 | Heuristic fallback |
| Insufficient evidence | 0 | No suggestion |

These values rank evidence; they are not calibrated probabilities or assertions
about visibility, availability, permission or DOM uniqueness. Annotations remain
highest confidence even when a label is dynamic. Test IDs and accessible evidence
remain available alongside explicit annotations.

Different source declarations using the same ID produce diagnostics and keep
separate structural IDs. Even mutually exclusive declarations require distinct
IDs in this version. Dynamic/invalid annotations, possible later-spread overrides
and unverified custom-component forwarding also produce diagnostics. Suggestions
are withheld for those declarations until the conflict is resolved. Put an
annotation on the underlying DOM element, after any spread props.

A single annotated declaration inside a list or a reusable component may have
multiple live instances. The ID describes the action, not a database record. The
fixture demonstrates scoping `clients.edit` and `plans.change_structure` inside
`clients.row` / `plans.row`, selected using `data-client-id` / `data-plan-id`.
Future browser resolution must check cardinality within the selected scope.

`pathcompiler targets suggest [directory]` scans the requested repository (current
directory by default), prints current annotations, candidate mappings and unresolved
evidence, and never writes files. `--json` prints a versioned, validated report with
provenance, commit/dirty metadata and scan diagnostics; `--exclude` matches scan.
`--out` is rejected. Suggestions use owner/name or owner/test-ID tokens, with
sorted deterministic numeric suffixes to avoid collisions with other candidates
and existing valid annotations. Proposed names are review aids, not stable IDs
until adopted. There is no `targets apply` command.

## Alternatives

- Keep positional IDs or generate structural CSS selectors: easy to create but
  unstable across ordinary component changes; neither is a semantic target.
- Infer every name or use an LLM: unnecessary for explicit annotations and would
  obscure uncertainty. This phase uses only deterministic source analysis.
- Add a React wrapper or runtime SDK now: the attribute meets this phase's scope.
  Wrappers and DOM resolution belong to later runtime work.

## Consequences and limits

- Accessible names are conservative source hints, not a full browser accessible-name
  implementation. Supported sources are literal `aria-labelledby` references in
  the same file, `aria-label`, native wrapping/`htmlFor` labels and static nested
  button/link content. Dynamic names, custom children and spread-dependent names
  are left unresolved. No runtime rendering, CSS visibility analysis, inter-file
  label resolution or complete ARIA role validation is performed.
- Duplicate IDs are checked within the scanned source set. Exclusions can remove
  evidence; passing static checks does not prove runtime uniqueness.
- The graph and JSON suggestion report contain private build-time provenance and
  must not be served as browser runtime manifests. Runtime-safe artifacts remain
  future compiler work.
- All five fixture workflows have explicit action, input and observation anchors.
  Browser tests exercise the anchors, both structure branches and repeated rows.
- No dependencies or packages were added. The adapter owns framework extraction;
  the CLI prints its public structured report.
