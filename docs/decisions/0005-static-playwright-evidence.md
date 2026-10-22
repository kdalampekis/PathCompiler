# ADR 0005 — Static Playwright evidence, not workflow approval

Status: Accepted for Phase 3

## Context

Phase 2 provides stable source targets. Playwright tests provide ordered examples
of interacting with those targets, but can also contain setup, API shortcuts,
invalid inputs, skipped cases and cleanup. Extracting a test does not demonstrate
that it passed or that its sequence is an approved product workflow.

## Decision

Add `@pathcompiler/test-miner-playwright`, depending on source-model, graph-core,
TypeScript and Zod. Its public `minePlaywrightTests(project, sourceGraph?)` accepts
validated source snapshots and returns a versioned trace report plus a new graph.
The input graph is not mutated. When repository metadata exists in the graph it
must agree with the supplied snapshot.

Use the TypeScript AST and symbols in a source-only compiler host. No repository
imports, config, callbacks, test runner or browser are executed. Direct named and
namespace imports from `@playwright/test` identify test/expect symbols, including
aliases; unrelated and shadowed names are not treated as Playwright APIs.

Each trace contains its name, file, deterministic test ID, declared mode, initial
route (or null), actions, assertions, terminal assertion (or null), partial flag
and diagnostics. Actions and assertions share an `order` sequence. Their evidence
includes the source line/column, repository commit and helper call sites. Setup,
test and teardown phases remain explicit. A terminal assertion is present only
when the final extracted test-body event is an assertion; teardown cannot replace
it. It is still test evidence, including when negative, soft or conditional.

The supported subset includes:

- literal named tests and nested describes, with only/skip/fixme modes;
- inline beforeEach/afterEach callbacks, ordered by suite nesting and declaration;
- fixture destructuring/aliases, simple const aliases, test.step blocks, and bounded
  same-file block-bodied helpers with positional parameters and literal defaults;
- goto, common locator interactions, reload/back/forward/close, keyboard press,
  direct API requests, and basic browser/context/page creation;
- chained locator hints, role/label/test-ID/semantic-attribute targets, negated/soft
  expectations, literal expected values and regex descriptions.

Only exact semantic-attribute selectors are mapped as semantic IDs. Test IDs and
role/name or label evidence map at lower confidence. Route mapping supports exact
local paths. Multiple graph candidates remain ambiguous; only a unique match
creates a `TESTED_BY` edge from source node to Test node. Locator scopes, filters
and positional modifiers remain in the trace; a unique source declaration is not
proof of a unique live DOM element. CSS and regex hints are retained without
executing selectors or regular expressions during mapping.

Loop and branch bodies are omitted with diagnostics, and later events are marked
conditional. Try-body events are retained as conditional evidence; catch/finally
are not expanded. Unknown calls are explicit unsupported events. Recursion/deep
helper expansion is bounded at eight nested helpers, with a 2,000-event guard per
trace. Literal data is preserved; unknown values remain dynamic rather than being
guessed. Direct request bodies are omitted.

`pathcompiler tests mine [directory]` performs one local source ingestion, analyzes
source targets, and mines that same snapshot. It writes:

- `.pathcompiler/reports/test-traces.json`
- `.pathcompiler/graph/test-graph.json`

`--out` and `--exclude` follow the existing scan conventions. The source-scan
artifacts are preserved. Reports explicitly state `evidenceOnly: true` and
`execution: not-run`. No WorkflowCandidate or approved workflow is generated.

## Alternatives

- Execute tests or ingest runtime trace ZIPs: stronger runtime evidence, but adds
  browser/config execution and environment setup beyond this static-mining phase.
- Flatten every AST call: would invent ordering across branches, parallel calls,
  callbacks and helpers. Explicit gaps are more useful for later review.
- Build a general JavaScript interpreter or add an LLM: unnecessary for the
  straightforward sequences required here. Add supported syntax based on actual
  evidence needs, with focused regression tests.

## Consequences and limits

Two fixture workflow tests are fully extracted within this subset. Five other
fixture tests retain useful ordered evidence but are explicitly partial because
of schema/data-processing calls, loops or try/finally. The API-only test has no
browser start route. All seven retain terminal assertions. The create-client
helper provides the route, semantic actions and successful feedback assertion
needed to reconstruct `clients.create` from test evidence.

Imported/page-object helpers, custom test.extend fixtures, arbitrary computation,
closures with mutable state, generated/conditional registrations, Promise.all,
polling and full control-flow interpretation remain outside the supported subset.
Config and project expansion are not executed; beforeAll/afterAll/test.use are
reported as unmodeled setup. `getByTestId` mapping assumes Playwright's default
`data-testid` attribute. Runtime selector cardinality, browser state, test results
and business-workflow boundaries require later validation and review.

Reports may contain literal test inputs and private source provenance. They are
build-time artifacts and must not be exposed as browser runtime manifests. The
existing source exclusion and Git-ignore rules apply.

## API references

The supported syntax follows the official [Playwright test API](https://playwright.dev/docs/api/class-test),
[locator APIs](https://playwright.dev/docs/locators) and
[assertion APIs](https://playwright.dev/docs/test-assertions). These describe test
semantics; our static supported subset is deliberately narrower.
