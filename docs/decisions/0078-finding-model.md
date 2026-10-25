# ADR 0078 — Finding model (I0)

## Context

The improvement loop starts with findings: evidence-backed statements about
the product (reasoning spec §175–§177, §241). The I0 prompt (§255) asks for:
- typed `ProductFinding` and `ImprovementOpportunity` models;
- the existing reasoning and analytics evidence references;
- deterministic classification of at least workflow friction, permission
  regression, release regression and low adoption;
- no recommendations yet.

## Decision

- **New `@pathcompiler/findings`.** `deriveFindings(inputs, options)` reads
  the reports that already exist. Every input is optional.
  - **R11 semantic change:**
    - lost reachability is a *release regression*, or a *permission
      regression* when its context has a role;
    - new reachability for a role is a permission regression (possibly
      unintended access).
  - **Workflow impact:** definite breaks (removed target, condition target,
    route or endpoint) are release regressions; removed access conditions
    are permission regressions.
  - **O12 release diff:** goal reach that went *down* is a release
    regression, rated high when no formal change explains it.
  - **O9 efficiency friction and O10 drop-off friction points** become
    *workflow friction*.
  - **O8 reconciliation:**
    - goals possible but unobserved, with enough sessions, are *low
      adoption*, with formal and observed evidence;
    - unexpected observations are *runtime/formal discrepancies*.
- **Findings:**
  - **IDs:** stable, `finding:<kind>:<target kind>:<id>[@context]`. Context
    is the role for role-specific findings; full contexts, such as flag
    values, stay in the evidence.
  - **Evidence:** P0 evidence items plus lineage `{ report, entry }`, for
    example `removedReachability[0]`.
  - **Confidence:** P0 fusion that the finding is real. It is never
    confidence in an intervention (§182).
  - **Severity:** info through critical.
  - **Context:** the detection time, which callers pass for reproducibility,
    and the model version.
- **Opportunities** group findings by capability; goals map to capabilities
  through R11 or a given map. `PriorityAssessment` multiplies explained
  components: worst severity, strongest confidence, regression versus
  behavioral, and corroboration. It is labeled `ordering-not-probability`.
- **CLI.** `findings [workflow|capability|goal]` reads whichever of the six
  reports exist under the output, validating them at the boundary, and
  writes `reports/findings.json`. This is the human trigger. The roadmap
  named it `analyze <workflow>`, but C9 already uses `analyze`. The release
  trigger is running it after `impact --reasoning` or `reason diff`.

## Alternatives

- **Re-running the analyses inside `findings`.** The reports already hold
  the results, and re-running would duplicate work and drift from what
  developers saw. Findings are a pure derivation.
- **One finding per full context** (role × flags). In the first run this
  made 18 near-duplicate findings for a single role rename. The role is the
  permission-relevant part.

## Consequences

- Recommendations (I1) consume opportunities.
- Analytics-threshold triggers are not automatic; findings run on demand
  (ISSUES_LOG #43).
- Low adoption uses O8's "possible but unobserved" goals, not
  reachability-adjusted adoption rates.
