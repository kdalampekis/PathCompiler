# 0003 — Deterministic local Next.js analysis

Status: accepted for Phase 1.

## Context

The analyzer must discover useful source facts without executing customer code,
depending on installed customer packages, or treating heuristic guesses as truth.
Its output must survive whitespace-only changes and support later evidence and
incremental-analysis phases.

## Decision

- `source-model` reads TypeScript/JavaScript files and project metadata. It skips
  generated directories, hidden files/directories, declarations, binary inputs and
  symlinks. Git scans use `git ls-files` to honor ignore rules; explicit exclusions
  are root-relative directory/file prefixes. Non-Git scans report the lack of Git
  ignore rules and commit metadata.
- `adapter-nextjs` uses the installed TypeScript compiler API over a virtual,
  source-only filesystem. It does not execute Next.js configs or import customer
  dependencies. Relative imports, root `baseUrl`/`paths` aliases, re-exports and
  workspace packages with direct source `exports`/`main` entries are resolved.
- This version does not expand inherited tsconfig aliases, conditional package
  exports, package subpath exports or arbitrary module loaders. Missing local imports
  and unsupported inherited configuration are diagnosed. Asset imports are outside
  the source graph.
- Root `app/` takes precedence over `src/app/`. Route groups and parallel slots are
  removed from URLs. `[id]`, `[...slug]` and `[[...slug]]` become `:id`, `:slug+` and
  `:slug*`. Private folders are excluded from routing. Interception is diagnosed
  and not interpreted as an ordinary page route.
- Named functions and anonymous default exports become symbols. PascalCase/default
  functions containing JSX become candidate components with explicit heuristic
  confidence. Hooks are symbols with `kind: hook`. Named nested handlers retain a
  lexical owner in their IDs. UI actions use owner/tag occurrence IDs; no source
  offsets or formatting-dependent source hashes are used.
- Provenance stores root-relative file/structural locators and current Git HEAD.
  Repository metadata separately records whether the scanned subtree has working-tree
  changes. A dirty scan does not claim its source is identical to HEAD. No Git means
  a null commit, never an invented commit. No raw source, absolute checkout paths or
  timestamps are retained in graph artifacts.
- Local `fetch`, imported `next/link`, imported navigation helpers and `useRouter`
  bindings are resolved conservatively. A single fetch wrapper forwarding URL/method
  parameters can be followed one call deep, covering the fixture's shared save
  helper. Template alternatives and wrapper-derived API relationships carry heuristic
  confidence. Dynamic requests are diagnosed, not guessed as GET. Conditional
  alternatives are considered without proving branch correlation.
- Functions with explicit `use server` directives become ACTION API endpoints.
  Runtime-dispatched actions, HOCs, class components and arbitrary interprocedural
  dataflow remain unsupported.
- Role comparisons, `can(...)` and `featureFlags.*` produce evidence with confidence
  0.5 and `heuristic: true`. These are observations, not authorization or control-flow
  proofs. They must not become runtime permission decisions.
- CLI output defaults to `.pathcompiler/` under the invocation directory. Each JSON
  file is replaced through a temporary file and rename after successful analysis.
  Analysis errors leave existing artifacts untouched. The two-file output is not a
  transactional database or an approved runtime workflow artifact.

## Alternatives

Text regexes cannot reliably connect aliased imports or distinguish shadowed
identifiers. Installing/evaluating a target app adds side effects and dependencies.
Full control-flow analysis, every Next.js convention and arbitrary wrapper inference
would expand Phase 1 without evidence that the extra complexity is needed.

## Consequences

The phase produces reproducible, evidence-backed source graphs with visible limits.
Moving or inserting repeated same-tag actions can change occurrence-based action
IDs; Phase 2 introduces semantic targets. Typechecking builds dependency packages
first so their existing ESM/declaration public exports remain the package boundary.

References: [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API),
[Next.js dynamic segments](https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes),
[Next.js route groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups).
