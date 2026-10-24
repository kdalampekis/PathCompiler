# ADR 0056 — Probabilistic evidence model

## Context

Phase P0 implements reasoning spec §43–§47. Evidence about a product claim
(code, tests, PRs, docs, runtime, model hypotheses) supports or contradicts
it, and different evidence is more or less reliable depending on the claim
type. The spec requires four things:
- start simple, without a probabilistic programming framework;
- never call a heuristic score a probability unless it is calibrated;
- never average evidence;
- make conflicts first-class objects, such as "likely stale documentation".

Existing confidence fields stay labeled `rule-strength-not-probability`.

## Decision

- **New `@pathcompiler/probabilistic-evidence`:**
  - `EvidenceClaim`: existence, behavior, naming or permission; binary or
    categorical, for example a canonical name;
  - `EvidenceItem`: an evidence class, a stance (or a value for categorical
    claims), `current`, a summary and an optional `EvidenceRef`;
  - `fuseEvidence(claim, items, { calibration? })`, which returns a
    `ConfidenceAssessment`;
  - `calibrate` and `graphEvidenceItems`.
- **Evidence classes:** browser, observed, test, formal, static, pr, commit,
  docs, historical and model. A `RELIABILITY` table gives each class a tier
  per claim type. Prose and model output never outrank code or tests.
  Observed usage ranks low for permission claims, because seeing a user do
  something does not show they were allowed to.
- **Fusion rules, with no averaging:**
  1. Each evidence class counts once, so repeated evidence is not independent
     evidence.
  2. The highest tier present decides. Categorical claims take the value with
     the highest tier, then the one with more classes at that tier; a
     remaining tie is `contested`.
  3. Disagreement below the deciding tier becomes an `EvidenceConflict`:
     - `likely-stale-artifact` for docs, historical prose, commits, PRs or
       non-current items;
     - `unsupported-hypothesis` for model output;
     - `unexplained-contradiction` otherwise, which caps confidence at
       medium.

     A tie at the top tier is an `unresolved` conflict.
  4. Band: `high` needs a deciding tier of 5 or more plus two distinct current
     classes at tier 4 or more; `medium` needs tier 4; everything else is
     `low`. The score (0.9, 0.6 or 0.3) is labeled
     `rule-strength-not-probability`.
- **Probability is separate.** `probability.value` is set only from a
  `CalibrationTable` (labeled outcomes per band) with at least `minSamples`
  samples for that band. Otherwise it is `null`, with the reason.
- **Graph adapter.** `graphEvidenceItems` maps graph nodes to items: source
  nodes are `static`, tests `test`, commits and pull requests `commit` and
  `pr`. Callers add docs, runtime and model items. No node prose is copied.

## Alternatives

- **Weighted averages or naive Bayes over item counts.** These reward
  repetition and let many weak artifacts outvote one test, which the spec
  forbids.
- **A probabilistic programming framework.** Deferred until the rules prove
  insufficient (spec §43).
- **Calibrating on the five-capability fixture.** Too few samples. The
  calibration API exists, and real tables need review outcomes (P-RV) or
  alpha repositories (C6).

## Consequences

P1, P3, P4 and I0 can express uncertain claims with explicit conflicts. The
`probabilistic.evidence_fusion` flag from C2 is not read yet: no CLI or
runtime surface uses fusion until P1 or I0 adds one. Nothing at runtime
changes.
