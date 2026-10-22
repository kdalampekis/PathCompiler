import { sourceProvenance } from "@pathcompiler/evidence";
import type { GraphNode, ProductGraph } from "@pathcompiler/graph-core";
import { compareText, SourceProjectSchema } from "@pathcompiler/source-model";
import {
  type TestAction,
  type TestAssertion,
  type TestTraceReport,
  TestTraceReportSchema,
} from "@pathcompiler/test-miner-playwright";
import {
  type WorkflowCondition,
  type WorkflowStep,
  WorkflowV1Schema,
} from "@pathcompiler/workflow-ir";
import { z } from "zod";
import {
  type ValidationCheck,
  type ValidationIssue,
  type ValidationReport,
  ValidationReportSchema,
} from "./schema.js";

export * from "./schema.js";
export type ValidationContext = {
  graph: ProductGraph;
  traces?: TestTraceReport;
};
type Event = TestAction | TestAssertion;
const edgeEvidenceSchema = z.array(
  z.object({
    order: z.number(),
    file: z.string(),
    line: z.number(),
    column: z.number(),
    repositoryCommit: z.string().nullable(),
  }),
);
const eventId = (id: string) => {
  const match = /^(.*)#event:(\d+)$/.exec(id);
  return match
    ? { traceId: match[1] ?? "", order: Number(match[2]) }
    : undefined;
};

/** Static checks only. A valid report does not mean approved, safe to execute, or browser verified. */
export function validateWorkflow(
  input: unknown,
  context: ValidationContext,
): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const checks: ValidationCheck[] = [];
  const parsed = WorkflowV1Schema.safeParse(input);
  const repositoryData = context.graph.getNode("repository:.")?.data;
  const repository = SourceProjectSchema.shape.repository.safeParse({
    commit: repositoryData?.commit,
    dirty: repositoryData?.dirty,
  });
  const commit = repository.success ? repository.data.commit : null;
  function check(
    name: ValidationCheck["name"],
    before: number,
    details: string,
  ) {
    checks.push({
      name,
      status: errors.length === before ? "passed" : "failed",
      details,
    });
  }
  function result(): ValidationReport {
    for (const name of [
      "schema",
      "structure",
      "repository",
      "evidence",
      "testComparison",
      "browser",
    ] as const)
      if (!checks.some((item) => item.name === name))
        checks.push({
          name,
          status: "not-run",
          details:
            name === "browser"
              ? "Browser verification is separate; no code or tests were executed."
              : "Requires valid workflow input and preceding evidence.",
        });
    const ordered = (items: ValidationIssue[]) =>
      [...new Map(items.map((item) => [JSON.stringify(item), item])).entries()]
        .sort(([a], [b]) => compareText(a, b))
        .map(([, item]) => item);
    return ValidationReportSchema.parse({
      schemaVersion: 1,
      workflowId: parsed.success ? parsed.data.id : null,
      repositoryCommit: commit,
      valid:
        errors.length === 0 &&
        checks.slice(0, 4).every((item) => item.status === "passed"),
      errors: ordered(errors),
      warnings: ordered(warnings),
      checks,
    });
  }
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      errors.push({
        code: "invalid-schema",
        message: `${issue.path.join(".") || "workflow"}: ${issue.message}`,
      });
    check("schema", 0, "Workflow V1 schema and explicit step references.");
    return result();
  }
  const workflow = parsed.data;
  check("schema", 0, "Workflow V1 schema and explicit step references.");
  let before = errors.length;
  const steps = new Map(workflow.steps.map((step) => [step.id, step]));
  const nextIds = (step: WorkflowStep) => [
    ...new Set([
      ...(step.next ? [step.next] : []),
      ...(step.branches ?? []).map((branch) => branch.next),
    ]),
  ];
  const visited = new Set<string>();
  const active = new Set<string>();
  // Iterative DFS avoids a recursion limit for imported workflows.
  const stack: { id: string; exit: boolean }[] = [
    { id: workflow.steps[0]?.id ?? "", exit: false },
  ];
  while (stack.length) {
    const item = stack.pop();
    if (!item) break;
    if (item.exit) {
      active.delete(item.id);
      continue;
    }
    if (active.has(item.id)) {
      errors.push({
        code: "unbounded-cycle",
        stepId: item.id,
        message:
          "Cycle has no declared iteration bound. Remove the cycle before execution.",
      });
      continue;
    }
    if (visited.has(item.id)) continue;
    visited.add(item.id);
    active.add(item.id);
    stack.push({ id: item.id, exit: true });
    const step = steps.get(item.id);
    if (step)
      for (const id of nextIds(step).reverse()) stack.push({ id, exit: false });
  }
  for (const step of workflow.steps) {
    if (!visited.has(step.id))
      errors.push({
        code: "unreachable-step",
        stepId: step.id,
        message:
          "Step cannot be reached from the first step through explicit transitions.",
      });
    if (["click", "input", "select"].includes(step.action.type) && !step.target)
      errors.push({
        code: "missing-action-target",
        stepId: step.id,
        message: "Interactive actions require a semantic target.",
      });
    const guards =
      step.branches?.map((branch) => JSON.stringify(branch.when)) ?? [];
    if (new Set(guards).size !== guards.length)
      errors.push({
        code: "shadowed-branch",
        stepId: step.id,
        message:
          "An earlier identical branch guard makes a later branch impossible.",
      });
  }
  if (
    !workflow.steps.some(
      (step) => visited.has(step.id) && nextIds(step).length === 0,
    )
  )
    errors.push({
      code: "terminal-unreachable",
      message:
        "No transition-free step is reachable to wait for terminal completion.",
    });
  check(
    "structure",
    before,
    "First step is the entry; explicit edges only. Checks reachability and rejects cycles without bounds. Terminal reachability is structural, not a claim that its condition occurs.",
  );

  before = errors.length;
  if (!repository.success || !commit)
    errors.push({
      code: "missing-repository-snapshot",
      message:
        "Graph needs a committed repository snapshot. Commit and rescan.",
    });
  else if (commit !== workflow.repository.commit)
    errors.push({
      code: "stale-workflow",
      message:
        "Workflow commit differs from the current graph. Regenerate or review it against the current commit.",
    });
  if (repository.success && repository.data.dirty !== false)
    warnings.push({
      code: "dirty-repository",
      message:
        "Uncommitted or unknown source state cannot be reproduced from the commit alone.",
    });
  const snapshot = context.graph.toJSON();
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const targets = new Map<string, GraphNode[]>();
  for (const node of snapshot.nodes) {
    const target = z
      .object({ semanticId: z.string().optional() })
      .safeParse(node.data?.target);
    if (node.type === "UIAction" && target.success && target.data.semanticId)
      targets.set(target.data.semanticId, [
        ...(targets.get(target.data.semanticId) ?? []),
        node,
      ]);
  }
  const validatedNodes = new Set<string>();
  function validateNode(node: GraphNode) {
    if (validatedNodes.has(node.id)) return;
    validatedNodes.add(node.id);
    try {
      sourceProvenance(node, commit);
    } catch {
      errors.push({
        code: "stale-target-evidence",
        evidenceId: node.id,
        message:
          "Source provenance is missing or differs from the graph commit. Rescan the repository.",
      });
    }
  }
  function targetNode(target: string, stepId?: string): GraphNode | undefined {
    const matches = targets.get(target) ?? [];
    if (matches.length !== 1)
      errors.push({
        code: matches.length ? "ambiguous-target" : "missing-target",
        ...(stepId ? { stepId } : {}),
        message: `Semantic target ${target} must resolve to exactly one source declaration; found ${matches.length}.`,
      });
    else {
      const node = matches[0];
      if (node) validateNode(node);
      return node;
    }
  }
  function routeNode(route: string, stepId?: string): GraphNode | undefined {
    const pathname = route.split(/[?#]/)[0]?.replace(/\/$/, "") || "/";
    const matches = snapshot.nodes.filter(
      (node) => node.type === "Route" && node.data?.path === pathname,
    );
    if (matches.length !== 1)
      errors.push({
        code: "missing-route",
        ...(stepId ? { stepId } : {}),
        message: `Route ${route} must identify one canonical repository route. Use the graph route template for dynamic paths.`,
      });
    else {
      const node = matches[0];
      if (node) validateNode(node);
      return node;
    }
  }
  const terminal =
    "any" in workflow.terminal
      ? workflow.terminal.any
      : "all" in workflow.terminal
        ? workflow.terminal.all
        : [workflow.terminal];
  const conditions: { condition: WorkflowCondition; stepId?: string }[] = [
    ...terminal,
    ...(workflow.preconditions ?? []),
  ].map((condition) => ({ condition }));
  const stepNodes = new Map<string, string>();
  for (const step of workflow.steps) {
    if (step.target) {
      const node = targetNode(step.target, step.id);
      if (node) stepNodes.set(step.id, node.id);
    }
    if (step.action.type === "navigate") {
      const node = routeNode(step.action.route, step.id);
      if (node) stepNodes.set(step.id, node.id);
    }
    if (step.expected)
      conditions.push({ condition: step.expected, stepId: step.id });
    for (const branch of step.branches ?? [])
      conditions.push({ condition: branch.when, stepId: step.id });
  }
  for (const entry of workflow.entrypoints) {
    if (entry.route) routeNode(entry.route);
    else
      warnings.push({
        code: "state-entry-unverified",
        message: "State-only entrypoints need runtime state verification.",
      });
  }
  for (const { condition, stepId } of conditions) {
    if ("target" in condition) targetNode(condition.target, stepId);
    else if (condition.type === "url_changed" && condition.url)
      routeNode(condition.url, stepId);
    else
      warnings.push({
        code: "runtime-condition-unverified",
        ...(stepId ? { stepId } : {}),
        message: `Condition ${condition.type} requires runtime verification; static route/target checks do not evaluate it.`,
      });
  }
  check(
    "repository",
    before,
    "Checks canonical routes, semantic source declarations and provenance against the current commit; DOM visibility and instance uniqueness require browser verification.",
  );

  before = errors.length;
  const allRefs = [
    ...workflow.provenance.evidence,
    ...workflow.steps.flatMap((step) => step.evidence),
  ];
  const refNodes = new Map<string, string[]>();
  for (const ref of [
    ...new Map(allRefs.map((ref) => [JSON.stringify(ref), ref])).values(),
  ]) {
    const event = ref.type === "test" ? eventId(ref.id) : undefined;
    let linked: string[] = [];
    if (event) {
      linked = snapshot.edges
        .filter((edge) => {
          if (edge.type !== "TESTED_BY" || edge.target !== event.traceId)
            return false;
          const evidence = edgeEvidenceSchema.safeParse(edge.data?.evidence);
          return (
            evidence.success &&
            evidence.data.some(
              (item) =>
                item.order === event.order &&
                `${item.file}:${item.line}:${item.column}` === ref.locator &&
                item.repositoryCommit === commit,
            )
          );
        })
        .map((edge) => edge.source);
      if (!linked.length || ref.repositoryCommit !== commit)
        errors.push({
          code: "invalid-test-evidence",
          evidenceId: ref.id,
          message:
            "Test event citation does not match current mapped graph evidence. Remine tests.",
        });
    } else {
      const node = nodes.get(ref.id);
      if (["documentation", "runtime"].includes(ref.type))
        warnings.push({
          code: "external-evidence-unverified",
          evidenceId: ref.id,
          message:
            "This validator cannot authenticate external documentation or runtime evidence.",
        });
      else if (!node)
        errors.push({
          code: "missing-evidence",
          evidenceId: ref.id,
          message: "Referenced evidence node is absent from the current graph.",
        });
      else {
        const type =
          node.type === "File"
            ? "source_file"
            : node.type === "Route"
              ? "route"
              : node.type === "APIEndpoint"
                ? "api"
                : node.type === "Test"
                  ? "test"
                  : node.type === "Commit"
                    ? "commit"
                    : node.type === "PullRequest"
                      ? "pull_request"
                      : "symbol";
        let matches = type === ref.type;
        if (node.type === "Commit" || node.type === "PullRequest")
          matches &&=
            ref.repositoryCommit ===
              (node.type === "Commit" ? node.data?.sha : node.data?.headSha) &&
            ref.locator === (node.type === "Commit" ? node.id : node.data?.url);
        else {
          try {
            matches &&=
              ref.repositoryCommit === commit &&
              sourceProvenance(node, commit).some(
                (location) => location.locator === ref.locator,
              );
          } catch {
            matches = false;
          }
        }
        if (!matches)
          errors.push({
            code: "mismatched-evidence",
            evidenceId: ref.id,
            message:
              "Evidence type, locator or commit disagrees with its graph node.",
          });
        else linked = [node.id];
      }
    }
    refNodes.set(JSON.stringify(ref), linked);
    if (ref.confidence !== undefined && ref.confidence < 0.5)
      warnings.push({
        code: "low-confidence-evidence",
        evidenceId: ref.id,
        message: "Evidence confidence is below 0.5 and requires review.",
      });
  }
  for (const step of workflow.steps)
    if (
      !step.evidence.some((ref) =>
        refNodes
          .get(JSON.stringify(ref))
          ?.includes(stepNodes.get(step.id) ?? ""),
      )
    )
      warnings.push({
        code: "weak-step-evidence",
        stepId: step.id,
        message:
          "Step lacks a direct current source or mapped test citation for its target/route. Context or historical evidence alone is weak.",
      });
  if (workflow.confidence.overall < 0.6)
    warnings.push({
      code: "low-workflow-confidence",
      message:
        "Workflow confidence is below 0.6; review its inferred behavior and completion.",
    });
  if (
    terminal.some(
      (condition) =>
        condition.type === "explicit_next" ||
        (condition.type === "element_count" && condition.count === 0) ||
        (condition.type === "element_state" && condition.state === "hidden"),
    )
  )
    warnings.push({
      code: "weak-terminal-evidence",
      message:
        "Manual completion or disappearing UI is weaker than a business success signal.",
    });
  check(
    "evidence",
    before,
    "Checks cited source/test/history identity, location and commit. Reports weak or unverifiable support separately.",
  );

  before = errors.length;
  const traceResult =
    context.traces === undefined
      ? undefined
      : TestTraceReportSchema.safeParse(context.traces);
  if (traceResult && !traceResult.success)
    errors.push({
      code: "invalid-test-report",
      message: "Playwright trace report is invalid. Remine tests.",
    });
  else if (traceResult?.success) compareTests(traceResult.data);
  if (errors.length > before)
    check(
      "testComparison",
      before,
      "Static trace comparison failed; tests were not executed.",
    );
  else if (!checks.some((item) => item.name === "testComparison")) {
    warnings.push({
      code: "test-comparison-not-run",
      message:
        "No complete supported trace comparison is available; this is not a passing test result.",
    });
    checks.push({
      name: "testComparison",
      status: "not-run",
      details: "No complete supported trace comparison; no tests executed.",
    });
  }
  return result();

  function compareTests(report: TestTraceReport) {
    if (
      report.repository.commit !== commit ||
      (repository.success && report.repository.dirty !== repository.data.dirty)
    ) {
      errors.push({
        code: "stale-test-report",
        message:
          "Test traces and source graph have different snapshots. Rescan together.",
      });
      return;
    }
    const traces = new Map(report.traces.map((trace) => [trace.id, trace]));
    if (traces.size !== report.traces.length) {
      errors.push({
        code: "duplicate-test-trace",
        message: "Trace IDs must be unique.",
      });
      return;
    }
    const cited = new Set(
      allRefs
        .filter((ref) => ref.type === "test")
        .map((ref) => eventId(ref.id)?.traceId ?? ref.id),
    );
    const usable = report.traces.filter(
      (trace) => cited.has(trace.id) && ["normal", "only"].includes(trace.mode),
    );
    for (const trace of usable) {
      const node = nodes.get(trace.id);
      const events = [...trace.actions, ...trace.assertions];
      if (
        node?.type !== "Test" ||
        node.data?.mode !== trace.mode ||
        node.data?.partial !== trace.partial ||
        node.data?.sourceFile !== trace.sourceFile ||
        new Set(events.map((event) => event.order)).size !== events.length ||
        events.some((event) => event.evidence.repositoryCommit !== commit)
      )
        errors.push({
          code: "mismatched-test-trace",
          evidenceId: trace.id,
          message:
            "Trace metadata or events disagree with the current graph snapshot.",
        });
    }
    if (!usable.length || errors.length > before) return;
    const operation = (step: WorkflowStep) =>
      ({
        click: "click",
        input: "fill",
        select: "selectOption",
        navigate: "goto",
        explain: "",
        wait: "",
      })[step.action.type];
    function mapped(event: Event, nodeId: string | undefined) {
      return (
        !event.conditional &&
        event.phase === "test" &&
        event.target?.resolution === "matched" &&
        event.target.graphNodeIds.length === 1 &&
        event.target.graphNodeIds[0] === nodeId &&
        event.target.hints.length <= 1
      );
    }
    function matchesAction(event: TestAction, step: WorkflowStep) {
      return (
        event.operation === operation(step) &&
        mapped(event, stepNodes.get(step.id))
      );
    }
    for (const step of workflow.steps)
      for (const ref of step.evidence) {
        const citation = ref.type === "test" ? eventId(ref.id) : undefined;
        if (!citation) continue;
        const trace = traces.get(citation.traceId);
        const event = trace?.actions.find(
          (item) => item.order === citation.order,
        );
        if (
          event &&
          (!trace ||
            !["normal", "only"].includes(trace.mode) ||
            !matchesAction(event, step))
        )
          errors.push({
            code: "test-step-mismatch",
            stepId: step.id,
            evidenceId: ref.id,
            message:
              "Cited test action does not match the workflow action and unscoped semantic target.",
          });
      }
    if (
      workflow.steps.some(
        (step) => (step.branches?.length ?? 0) > 0 || !operation(step),
      )
    ) {
      warnings.push({
        code: "partial-test-comparison",
        message:
          "Branch guards, wait and explain steps need additional trace coverage; full-path comparison was not run.",
      });
      return;
    }
    function assertionMatches(
      assertion: TestAssertion,
      condition: WorkflowCondition,
    ): boolean {
      if (
        assertion.soft ||
        assertion.conditional ||
        assertion.phase !== "test" ||
        !("target" in condition) ||
        !mapped(assertion, targets.get(condition.target)?.[0]?.id)
      )
        return false;
      const value =
        assertion.expected.kind === "literal"
          ? assertion.expected.value
          : undefined;
      if (condition.type === "element_text")
        return (
          !assertion.negated &&
          assertion.matcher ===
            (condition.match === "exact" ? "toHaveText" : "toContainText") &&
          value === condition.text
        );
      if (condition.type === "element_count")
        return (
          !assertion.negated &&
          assertion.matcher === "toHaveCount" &&
          value === condition.count
        );
      if (condition.type === "target_appears")
        return assertion.matcher === "toBeVisible" && !assertion.negated;
      if (
        condition.type === "element_state" &&
        ["visible", "hidden"].includes(condition.state)
      )
        return (
          ["toBeVisible", "toBeHidden"].includes(assertion.matcher) &&
          ((assertion.matcher === "toBeVisible") !== assertion.negated) ===
            (condition.state === "visible")
        );
      return false;
    }
    const supported = (condition: WorkflowCondition) =>
      ["element_text", "element_count", "target_appears"].includes(
        condition.type,
      ) ||
      (condition.type === "element_state" &&
        ["visible", "hidden"].includes(condition.state));
    if (
      !terminal.every(supported) ||
      workflow.steps.some((step) => step.expected && !supported(step.expected))
    ) {
      warnings.push({
        code: "unsupported-test-condition",
        message:
          "A transition or terminal condition cannot be compared by this static trace checker.",
      });
      return;
    }
    const ordered: WorkflowStep[] = [];
    let step = workflow.steps[0];
    const seen = new Set<string>();
    while (step && !seen.has(step.id)) {
      ordered.push(step);
      seen.add(step.id);
      step = step.next ? steps.get(step.next) : undefined;
    }
    let matched = false;
    for (const trace of usable) {
      let previousOrder = -1;
      const actions: TestAction[] = [];
      for (const item of ordered) {
        const citedOrders = new Set(
          item.evidence
            .filter((ref) => ref.type === "test")
            .flatMap((ref) => {
              const citation = eventId(ref.id);
              return citation?.traceId === trace.id ? [citation.order] : [];
            }),
        );
        const action = [...trace.actions]
          .sort((a, b) => a.order - b.order)
          .find(
            (event) =>
              event.order > previousOrder &&
              citedOrders.has(event.order) &&
              matchesAction(event, item),
          );
        if (!action) break;
        actions.push(action);
        previousOrder = action.order;
      }
      if (
        actions.length !== ordered.length ||
        new Set(actions.map((action) => action.target?.page)).size !== 1
      )
        continue;
      const page = actions[0]?.target?.page;
      const start = actions[0]?.order ?? -1;
      const selectedOrders = new Set(actions.map((action) => action.order));
      const omitted = trace.actions.filter(
        (action) =>
          action.order > start &&
          action.order < previousOrder &&
          !selectedOrders.has(action.order),
      );
      const isValidationProbe = (attempt: TestAction) => {
        if (
          attempt.operation !== "click" ||
          attempt.conditional ||
          attempt.phase !== "test" ||
          !attempt.target ||
          attempt.target?.page !== page ||
          attempt.target.hints.length !== 1
        )
          return false;
        const id = attempt.target.graphNodeIds[0];
        if (
          !id ||
          !snapshot.edges.some(
            (edge) =>
              edge.type === "CONTAINS" &&
              edge.target === id &&
              nodes.get(edge.source)?.data?.tag === "form",
          )
        )
          return false;
        const retry = actions.find(
          (action) =>
            action.order > attempt.order &&
            action.operation === "click" &&
            action.target?.graphNodeIds[0] === id,
        );
        if (!retry) return false;
        return trace.assertions.some(
          (assertion) =>
            assertion.order > attempt.order &&
            assertion.order < retry.order &&
            !assertion.negated &&
            !assertion.soft &&
            !assertion.conditional &&
            assertion.target !== null &&
            assertion.target?.page === page &&
            assertion.target.hints.some(
              (hint) =>
                hint.method === "getByRole" &&
                hint.argument.kind === "literal" &&
                hint.argument.value === "alert",
            ) &&
            actions.some(
              (action) =>
                action.order > assertion.order &&
                action.order < retry.order &&
                ["fill", "selectOption"].includes(action.operation),
            ),
        );
      };
      if (omitted.some((action) => !isValidationProbe(action))) continue;
      const boundary = Math.min(
        ...trace.actions
          .filter((action) => action.order > previousOrder)
          .map((action) => action.order),
        Number.POSITIVE_INFINITY,
      );
      const matching = (
        condition: WorkflowCondition,
        from: number,
        until = boundary,
      ) =>
        trace.assertions.some(
          (assertion) =>
            assertion.order > from &&
            assertion.order < until &&
            assertion.target?.page === page &&
            assertionMatches(assertion, condition),
        );
      if (
        !ordered.every(
          (item, index) =>
            !item.expected ||
            matching(
              item.expected,
              actions[index]?.order ?? -1,
              actions[index + 1]?.order,
            ),
        )
      )
        continue;
      const completed =
        "any" in workflow.terminal
          ? terminal.some((condition) => matching(condition, previousOrder))
          : terminal.every((condition) => matching(condition, previousOrder));
      if (!completed) continue;
      matched = true;
      if (omitted.length)
        warnings.push({
          code: "validation-probe-excluded",
          evidenceId: trace.id,
          message:
            "Comparison excludes an asserted failed form submission followed by corrected input and retry.",
        });
      if (trace.partial)
        warnings.push({
          code: "partial-supporting-trace",
          evidenceId: trace.id,
          message:
            "The matching trace contains unsupported code outside or around the compared path.",
        });
    }
    if (!matched)
      errors.push({
        code: "test-path-mismatch",
        message:
          "No cited active trace supports the ordered actions, expected transitions and terminal assertion together.",
      });
    else if (errors.length === before)
      checks.push({
        name: "testComparison",
        status: "passed",
        details:
          "A cited active trace supports the ordered actions and assertions. Static comparison only; tests were not executed and prerequisites/input bindings remain unverified.",
      });
  }
}
