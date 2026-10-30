# ADR 0089 — Deterministic behavior extractors (BX2)

## Context

BehaviorIR (ADR 0088) needs rules. AGENTS.md prefers deterministic parsing
over model inference wherever facts can be derived statically, and the
expansion's own risk analysis names bad extraction as the main way a verifier
proves nothing useful. Extraction therefore starts with the sources that state
rules most directly and treats every result as a candidate with provenance.

## Decision

- **New `@pathcompiler/behavior-extraction`** (no model, no solver; pure
  functions from files to specification fragments).
  - **SQL DDL:** `CHECK` constraints become invariants over `table.column`
    state variables; `IN ('a', 'b')` makes a string column an enum;
    `NOT NULL`, `UNIQUE`, primary and foreign keys become data constraints.
  - **Zod:** `z.object({...})` models, classified by name as operation input
    (`…Input`, `…Request`, `…Body`), context (an actor or session) or stored
    state; integer bounds become preconditions or invariants.
  - **OpenAPI (JSON or YAML):** request fields and parameters give the same
    input contract (bounds, enums, required), security requirements give
    `authentication_required`.
  - **Test assertions:** `expect(a.b).toBeGreaterThanOrEqual(0)` and
    relations between two fields; INFERRED, MEDIUM confidence.
  - **Source-code guard clauses (BX2b):** for an exported function, `if
    (cond) throw …` at the top level is a precondition `!cond` (comparisons
    flipped, De Morgan applied), `x.y += e` / `= e` / `++` on a state entity
    is an effect, and an explicit role check also yields `allow`
    permissions. SOURCE_CODE / INFERRED / MEDIUM: the code says what it
    does, not what the business wants. Module-level literal constants are
    inlined, so a refactor that names `5000` does not change the contract.
  - **Approved rules:** a JSON file of rules a person declares
    (HUMAN_DECLARATION / HUMAN_APPROVED, `declaredBy` required).
- **IR extensions (additive):** `dataConstraints` (null, uniqueness, keys,
  required, authentication; recorded and reviewable, not verified),
  `appliesTo` on business rules and data policies (an execution rule can be
  limited to named operations), and `limitations` on operations (constructs an
  extractor saw but could not model, so a verifier can say a violation may be
  spurious).
- **Origin rules:** only what is read verbatim from a declaration is
  EXPLICIT. Rules lifted from assertions are INFERRED. A comparison with a
  non-zero literal and an equality are *not* lifted: they are test data and
  examples, and are listed as unsupported.
- **Never guess:** an unsupported column type, `IS NULL`, an unknown column,
  a `z.number()` without `.int()`, a bound on an optional field and response
  status contracts are returned in `unsupported` with file, lines and reason.
  A rule that fails IR validation is quarantined into `unsupported`, not
  allowed to fail the extraction.
- **Corroboration:** the same rule stated by several sources is kept once
  with every provenance record (a CHECK, a Zod bound and a test assertion for
  `refunded_amount >= 0`). The same operation from several sources becomes
  one contract with unioned preconditions.
- **Ledger and evaluation:** each fact keeps its own provenance in a ledger
  (operation preconditions merge into one contract, so the ledger is how
  per-rule provenance stays visible). `scoreExtraction` computes precision,
  recall and provenance correctness against a hand-written ground truth.
- **CLI:** `pathcompiler behavior extract [directory] --bind payment=payments`
  writes `reports/behavior-spec.json` and `reports/behavior-extraction.json`.
  `--bind` maps a code identifier to the entity or operation prefix; without
  it a name is used as written, and an assertion on an unbound entity is
  reported, not guessed.

### What the guard extractor refuses

Calls, loops, conditionals that do not simply throw, `return` guards, locals,
and any condition that reads a value updated earlier in the function (effects
are evaluated in the pre-state) are not modeled. Each one becomes a
**limitation** of the operation and an `unsupported` entry, so the extracted
preconditions are known to be possibly weaker than the code. A TypeScript
`number` is modeled as an integer, which is wrong for decimal money.
The same operation defined in two source files is reported as a conflict
instead of silently merged (analyze one version at a time with `--exclude`).

## Alternatives

- **LLM extraction first:** broader coverage, but the first rules would be
  the least trustworthy. Kept as a later, INFERRED-only source.
- **Per-precondition provenance in the IR:** more precise, but changes every
  operation consumer; the extraction ledger gives the reviewer the same
  information without touching the IR.
- **Guessing entity bindings from names:** convenient and wrong often enough
  to matter; an explicit `--bind` is one line.

## Consequences

- Precision and recall on the refund fixture are measured (1.0 / 1.0 against a
  ground truth the author reviewed by hand). That is a small, friendly
  fixture: the numbers show the extractors do what they claim on constructs
  they support, not how they perform on an arbitrary repository. Real
  repositories are the C6 validation.
- Decimal money, null semantics, string length and response contracts are not
  modeled. Systems whose rules live there are partly out of scope until the IR
  grows.
