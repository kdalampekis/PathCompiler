# Product north star

Read this before deciding anything. If a change does not serve this page, or
narrows it, it is the wrong change.

## The end goal

> **Take any business and any codebase — any language, any framework, including
> agentic software — recover how that software is allowed to behave, and use
> that knowledge to check changes, agent actions and agent answers before they
> take effect. Harnesses and LLMs, which already have the code and the
> automation, are first-class: they feed the knowledge in, call our checks as
> tools, and get evaluations and corrections back. People decide how automatic
> it is. What happens along the way becomes the datasets that alignment and
> post-training need.**

## What each user gets

| User | Benefit | Where it shows |
| --- | --- | --- |
| Engineering team | Business-logic regressions caught in a change even when the tests pass, in any language | change checks, PR guard, assessment |
| Team running agents | An agent action or answer is checked against the business's rules before it executes or renders, with an explanation the agent can act on | action gate, answer check |
| Team with a harness or LLM | The harness reads the code, history and business documents and proposes rules; works under a policy (approve every step, or automatic within limits); calls our checks as tools while it works and gets corrections | rule discovery, `harness run`, MCP and tool-calling tools |
| AI / alignment team | Datasets for post-training and alignment (supervised, preference pairs, verifiable-reward records, evals) built from real accepted, rejected and corrected agent behavior, with provenance and privacy controls. Not a training loop. | feedback capture, dataset export |
| Product and support | Verified workflows and guides from the same knowledge | the original product |

## Principles

1. **Universal by default.** Nothing may depend on one framework or language.
   When a deterministic analyzer does not exist for a stack, a harness or LLM
   covers it through the same contracts, and the result is labeled as inferred.
2. **Deterministic and harness, together.** Where a feature has both a
   deterministic path and a harness/LLM path, both run and are merged: the
   harness proposes and reads what is not written down; deterministic checks
   verify, bound and decide. A harness never grades itself.
3. **Evidence and provenance.** Every rule says where it came from and how far to
   trust it. A model-found rule is a candidate until a person approves it.
4. **People set the autonomy.** From "approve every step" to "automatic within
   limits I set", with every decision on record. Merging and deploying stay with
   people until that is proven on real software.
5. **Harness-callable.** Every capability is reachable as a tool by any harness
   with local access to the code: MCP, provider function-calling schemas, an SDK,
   a CLI. Packages can be downloaded and embedded.
6. **Feedback becomes data.** Wrappers around agents record the answer, the
   verdict, the correction and the human decision, so alignment datasets exist
   as a by-product of using the product.
7. **Honest results.** A verdict says what was and was not checked. "Nothing
   independent ran" is `review`, never `pass`.
8. **Privacy.** No repository is sent to a model by default; what is sent is
   bounded and can be shown first.

## The decision checklist

Ask these before adding, narrowing or deferring anything:

1. Does it work for any language and framework, and for agentic software? If
   not today, what is the harness path, and is it built?
2. Which part is deterministic, which part is the harness or LLM, and how are
   they merged?
3. Can a harness call it as a tool (MCP, function-calling schema, SDK, CLI)?
4. What feedback does it produce, and does that reach the dataset?
5. Who controls how automatic it is, and where is the decision recorded?
6. What is the provenance and the trust of what it produces?
7. What is the benefit to the user, in one sentence?

## Where we are against it

Honest status; the work is tracked as BX10–BX14 below.

| Capability | Any stack? | Harness-callable? | Feeds datasets? |
| --- | --- | --- | --- |
| Rule extraction | Partly: SQL, OpenAPI, JSON/YAML contracts are stack-neutral; Zod, test assertions and guard clauses are TypeScript only. Harness route (rule discovery) covers any stack. | CLI only | no |
| Verification (the IR) | Yes: the IR and solver do not know the language | CLI only | no |
| PR guard / change check | Only as good as the rules the specification holds for that stack | CLI only; no tool for a harness working on uncommitted changes | no |
| Harness run assessment | **No: the product-model evaluation is Next.js only and the behavior check needs a TypeScript-extractable specification.** Fixed in BX10. | CLI | no |
| Action gate | Yes (concrete values) | library, CLI; no MCP or function-calling schema | no |
| Answer check before rendering | **Not built** | no | no |
| Agentic software (tool definitions, prompts, policies) | **Not built** | no | no |
| Business documents as a rule source | Evidence type exists; not wired into discovery | no | no |
| Alignment and post-training datasets | **Not built** | no | n/a |
| Downloadable packages | **Not built** (all packages are private) | n/a | n/a |

## What I had wrong, and the correction

- I recorded "the evaluation covers Next.js only, so automatic mode will not
  publish elsewhere" as a limitation to live with. It contradicts the end goal.
  It is replaced by a stack-neutral assessment (BX10).
- "Fine-tuning datasets" and "DPO pipelines" were listed as later or non-goals.
  The training loop stays out of scope; **the datasets are in scope now** (BX12).
- The only MCP servers were for product help and developer reasoning. A harness
  could not call the verifier, the change check, the gate or rule discovery as
  tools. That is BX11.
- Agentic software was not a target. Tool definitions, system prompts and
  guardrail configs are rule sources, and an agent's answer is something to check
  before it renders (BX13).
- The harness was treated as an implementer only. It is also the reader of code,
  history and documents (BX8, extended in BX13), a reviewer (BX10), and a client
  of our tools (BX11).

## Roadmap against the goal

| Phase | What | Why (benefit) |
| --- | --- | --- |
| BX10 | Stack-neutral change assessment: ecosystem detection and project checks compared at base and candidate, language-agnostic diff risk analysis, an independent reviewer role, and an explicit, configurable rule for what counts as independent | A change in any repository gets a meaningful verdict, so `harness run` and automatic mode work everywhere |
| BX11 | Tools for harnesses: one provider-neutral registry exposed as an MCP server, function-calling schemas, an SDK and the CLI, including a self-check a harness runs on its uncommitted work | Harnesses with local code access call our checks while they work and get corrections |
| BX12 | Feedback capture by agent wrappers and dataset export (supervised, preferences, verifiable rewards, evals) with a dataset card and redaction | The moat in the architecture: accepted and rejected agent behavior becomes alignment and post-training data |
| BX13 | Agentic software and business documents as rule sources; operation contracts proposed by a harness for any language; answer check before rendering | The rules apply to LLM answers and tool use, and to codebases we have no parser for |
| BX14 | Packaging: public package metadata, an installable CLI and SDK, install and embed docs | People can download and embed it (needs your decision on names and license) |
