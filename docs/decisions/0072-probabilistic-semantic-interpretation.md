# ADR 0072 — Probabilistic semantic interpretation

## Context

Phase P1 (reasoning spec §48–§49) needs four steps:
1. the semantic layer proposes several candidate interpretations;
2. hard constraints remove the impossible ones;
3. the rest are re-scored;
4. the best ones go forward.

Hard constraints must always hold. Soft evidence only selects among
coherent candidates.

The inputs exist:
- C9 (ADR 0071) produces `SemanticHypothesis` records for ambiguous
  capabilities;
- P0 (ADR 0056) fuses evidence by reliability tier.

## Decision

- **Engine in `probabilistic-evidence`:** `interpretCandidates(claim,
  candidates)` for a categorical claim. Each candidate has a value, a prior
  in [0, 1], soft evidence items and hard-constraint violations.
  - Candidates with the same value are pooled: evidence joins, the prior is
    the strongest, and every violation stands.
  - A candidate with any violation is `impossible`, with weight 0. No
    evidence keeps it, not even browser evidence.
  - Consistent candidates are re-scored by conditioning on the constraints:
    weight = prior ÷ the sum of consistent priors. The weight is labeled
    `relative-weight-not-probability`.
  - The best value is P0 fusion over consistent candidates' evidence only.
    Code outranks tests, which outrank models. A contested or empty result
    gives `best: null`, never a guess.
- **Capabilities in `formal-abstraction`:** `interpretCapabilities` treats
  each capability's meaning as a naming claim.
  - **Candidates:**
    - the deterministic rule's ID, with prior equal to the capability's
      rule strength and `static` evidence from the nodes the name was read
      from;
    - one candidate per C9 hypothesis covering the capability, with the
      title parsed to an ID by the same accessible-name rule
      (`capabilityMeaning`, now exported by capability-engine), the
      model-stated prior and `model` evidence.
  - **Hard constraints** (deterministic facts only):
    - *api-verb-mismatch.* No endpoint the action's handler calls could
      perform the verb. A verb-named sub-resource (`/archive`) allows only
      that verb. Otherwise only clear contradictions count: PATCH cannot
      create or delete, PUT cannot delete, DELETE cannot create or edit,
      GET performs nothing but export, and POST rules nothing out.
      Component-context endpoints are too weak to constrain.
    - *unknown-entity.* An entity or domain that no route, endpoint path or
      capability mentions.
    - *duplicate-meaning.* Another capability's ID whose handler calls
      different endpoints.
    - C9 rejections and unparseable titles (*hypothesis-rejected*,
      *not-a-capability*).
  - **Report:** per capability, the ranked candidates, `best` and `changed`.
    The summary counts changed meanings, rule meanings that violate a hard
    constraint, and unresolved subjects.
- **CLI.** `analyze` interprets the ambiguous capabilities after
  hypothesis validation and writes `reports/semantic-interpretations.json`.
  Capabilities are still never changed.

## Alternatives

- **Reusing discovery's verb-to-method table** (create is POST, delete is
  DELETE, everything else PATCH or PUT). It is an association heuristic, not
  a fact: invitations, imports and RPC-style APIs use POST. Making it a hard
  constraint would remove true meanings.
- **Numeric fusion of model confidence with rule strength.** Model
  confidence is self-reported. The P0 tiers keep a model from outranking
  code, and the weight is reported separately for review.
- **SMT encoding of the constraints.** The constraints are per-candidate
  checks. A solver earns its place with P2's weighted soft constraints.

## Consequences

- On the demo fixture every rule meaning is consistent, and nothing changes.
  The API constraint fires only on direct handler calls, which the
  fixture's actions do not have (ISSUES_LOG #37).
- A rule meaning ruled out by its own handler is reported as a possible
  discovery error. Without a consistent alternative the subject is
  unresolved rather than guessed.
- P2 can take the consistent candidates and their weights as weighted soft
  constraints.
