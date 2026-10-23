# ADR 0015 — Lexical product help resolver

## Context

Phase 13 maps natural-language help requests to approved workflows using the
compiled search index, without graph traversal. Accuracy must be measured on
paraphrases that were not used to tune the matcher.

## Decision

Add `@pathcompiler/resolver` with `createResolver(searchIndex)`, which validates
the index once and exposes a synchronous, deterministic `resolveProductHelp`.

Matching, in order:

1. Normalize: NFKD without marks, lowercase, split on non-letters/digits, drop
   possessive `'s`, singularize simple plurals, join `set up` into `setup`.
2. Approved aliases match as contiguous token sequences and win outright.
3. Otherwise the record's entity tokens must all appear. If the query contains a
   known action verb, the record's action must belong to the same group, so
   "delete a client" never returns a create workflow.
4. Score action, entity and qualifier hits; a matching context route adds a
   tie-breaker. Equal top scores are `ambiguous`. An entity-only match asks for
   confirmation (`action-unclear`).

The verb lexicon is generic English (create/change/delete groups). Entity
synonyms and product phrasing must come from approved aliases, which keeps
fixture vocabulary out of the code.

Context requirements (roles, permissions, feature flags) exclude a record only
when the caller provides that context. If every match is excluded, the result is
`unavailable-in-context` and lists what each workflow requires.

The evaluation set (20 paraphrases plus 5 controls, target 80%) was written and
saved before the matcher. Cases must not be edited to raise accuracy. New cases
are added instead. The first and current run scores 17/20, and every control
passes. The three misses (an unknown synonym, "restructure", "rearrange") return
unsupported or ambiguous, not a wrong workflow.

## Alternatives

- Embeddings or a model: non-deterministic, needs a provider, and is unnecessary
  at this catalog size. It stays optional behind a future adapter.
- Hard route filtering: users ask for help from any page.
- Fuzzy title similarity alone: returns confident wrong workflows for
  action-mismatched queries.

## Consequences

Resolution is fast, offline and explainable through `matched`. Recall for
uncommon phrasing depends on approved aliases, so alias generation (an LLM-assisted
task per the model policy) is the natural improvement.
