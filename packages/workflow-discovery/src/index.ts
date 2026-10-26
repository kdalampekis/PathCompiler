import { createHash } from "node:crypto";
import {
  type CapabilityDiscoveryReport,
  CapabilityDiscoveryReportSchema,
} from "@pathcompiler/capability-engine";
import { collectGraphEvidence, sourceProvenance } from "@pathcompiler/evidence";
import {
  createEdgeId,
  createNodeId,
  type GraphNode,
  ProductGraph,
} from "@pathcompiler/graph-core";
import {
  type AnalysisDiagnostic,
  compareText,
} from "@pathcompiler/source-model";
import {
  type TestAction,
  type TestAssertion,
  type TestTrace,
  type TestTraceReport,
  TestTraceReportSchema,
} from "@pathcompiler/test-miner-playwright";
import {
  type EvidenceRef,
  type WorkflowCondition,
  type WorkflowStep,
  WorkflowV1Schema,
} from "@pathcompiler/workflow-ir";
import { z } from "zod";
import {
  type WorkflowCandidate,
  type WorkflowDiscoveryReport,
  WorkflowDiscoveryReportSchema,
} from "./schema.js";

export * from "./schema.js";

type Event = TestAction | TestAssertion;
type Draft = {
  candidate: WorkflowCandidate;
  roots: string[];
  signature: string;
};
const targetData = z.object({
  semanticId: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
});
const uniqueRefs = (refs: EvidenceRef[]) =>
  [...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([, ref]) => ref);
const diagnostics = (items: AnalysisDiagnostic[]) =>
  [...new Map(items.map((item) => [JSON.stringify(item), item])).entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([, item]) => item);
function eventRef(trace: TestTrace, event: Event, commit: string): EvidenceRef {
  return {
    id: `${trace.id}#event:${event.order}`,
    type: "test",
    locator: `${event.evidence.file}:${event.evidence.line}:${event.evidence.column}`,
    repositoryCommit: commit,
  };
}

/** Test segments establish ordering; source graphs establish targets. Nothing executes or becomes approved. */
export function discoverWorkflows(
  inputGraph: ProductGraph,
  inputCapabilities: CapabilityDiscoveryReport,
  inputTraces: TestTraceReport,
): { graph: ProductGraph; report: WorkflowDiscoveryReport } {
  const capabilities = CapabilityDiscoveryReportSchema.parse(inputCapabilities);
  const traces = TestTraceReportSchema.parse(inputTraces);
  const repository = capabilities.repository;
  if (!repository.commit)
    throw new Error(
      "Workflow candidates require an initial repository commit. Commit the source and rescan.",
    );
  const commit = repository.commit;
  const repo = inputGraph.getNode("repository:.");
  if (
    repo?.data?.commit !== commit ||
    repo.data.dirty !== repository.dirty ||
    traces.repository.commit !== commit ||
    traces.repository.dirty !== repository.dirty
  )
    throw new Error(
      "Workflow evidence snapshots differ. Rescan capabilities and tests together.",
    );
  if (inputGraph.nodesByType("WorkflowCandidate").length)
    throw new Error(
      "Workflow candidates already exist in this graph. Start from fresh capability evidence.",
    );
  const snapshot = inputGraph.toJSON();
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const current = capabilities.evidence.graph.nodes.map((node) =>
    nodes.get(node.id),
  );
  const expectedNodes = ProductGraph.fromJSON({
    schemaVersion: 1,
    nodes: capabilities.evidence.graph.nodes,
    edges: [],
  }).serialize();
  if (
    current.some((node) => !node) ||
    ProductGraph.fromJSON({
      schemaVersion: 1,
      nodes: current,
      edges: [],
    }).serialize() !== expectedNodes
  )
    throw new Error(
      "Capability source evidence does not match the graph. Rescan before workflow discovery.",
    );
  for (const trace of traces.traces) {
    if (nodes.get(trace.id)?.type !== "Test")
      throw new Error(`Missing test evidence node: ${trace.id}`);
    const orders = [...trace.actions, ...trace.assertions].map(
      (event) => event.order,
    );
    if (
      new Set(orders).size !== orders.length ||
      [...trace.actions, ...trace.assertions].some(
        (event) => event.evidence.repositoryCommit !== commit,
      )
    )
      throw new Error(
        `Test ${trace.id} has duplicate event orders or stale evidence. Remine the tests.`,
      );
  }
  function mapped(
    event: Event,
  ): { node: GraphNode; target: string } | undefined {
    if (
      event.target?.resolution !== "matched" ||
      event.target.graphNodeIds.length !== 1
    )
      return;
    const node = nodes.get(event.target.graphNodeIds[0] ?? "");
    if (node?.type !== "UIAction") return;
    const data = targetData.parse(node.data?.target ?? {});
    return data.semanticId ? { node, target: data.semanticId } : undefined;
  }
  function isError(event: TestAssertion): boolean {
    return (
      event.target?.hints.some(
        (hint) =>
          hint.method === "getByRole" &&
          hint.argument.kind === "literal" &&
          hint.argument.value === "alert",
      ) === true ||
      event.target?.graphNodeIds.some(
        (id) =>
          targetData.parse(nodes.get(id)?.data?.target ?? {}).role === "alert",
      ) === true
    );
  }
  function condition(event: TestAssertion): WorkflowCondition | undefined {
    if (
      event.soft ||
      event.conditional ||
      isError(event) ||
      event.target?.hints.length !== 1
    )
      return;
    const match = mapped(event);
    if (!match) return;
    const expected =
      event.expected.kind === "literal" ? event.expected.value : undefined;
    if (
      !event.negated &&
      ["toHaveText", "toContainText"].includes(event.matcher) &&
      typeof expected === "string" &&
      expected.trim()
    )
      return {
        type: "element_text",
        target: match.target,
        text: expected,
        match: event.matcher === "toHaveText" ? "exact" : "contains",
      };
    if (
      !event.negated &&
      event.matcher === "toHaveCount" &&
      typeof expected === "number" &&
      Number.isInteger(expected) &&
      expected >= 0
    )
      return { type: "element_count", target: match.target, count: expected };
    if (["toBeVisible", "toBeHidden"].includes(event.matcher))
      return {
        type: "element_state",
        target: match.target,
        state:
          (event.matcher === "toBeVisible") !== event.negated
            ? "visible"
            : "hidden",
      };
  }
  function terminal(
    event: TestAssertion,
    actions: TestAction[],
  ): WorkflowCondition | undefined {
    const result = condition(event);
    const match = mapped(event);
    if (!result || !match || !actions.length) return;
    const data = targetData.parse(match.node.data?.target ?? {});
    const container =
      ["dialog", "form"].includes(String(match.node.data?.tag)) ||
      ["dialog", "alertdialog", "form"].includes(data.role ?? "");
    if (
      result.type === "element_text" &&
      match.node.data?.kind === "observe" &&
      !container
    )
      return result;
    if (
      actions.length >= 2 &&
      container &&
      ((result.type === "element_count" && result.count === 0) ||
        (result.type === "element_state" && result.state === "hidden"))
    )
      return result;
  }
  function sourceRef(node: GraphNode): EvidenceRef {
    const location = sourceProvenance(node, commit)[0];
    if (!location) throw new Error(`Missing source provenance: ${node.id}`);
    return {
      id: node.id,
      type: node.type === "Route" ? "route" : "symbol",
      locator: location.locator,
      repositoryCommit: commit,
    };
  }
  const entryAnchors = new Map<string, string>();
  for (const capability of capabilities.capabilities)
    for (const id of capability.surfaceIds) {
      const surface = capabilities.surfaces.find((item) => item.id === id);
      if (surface?.kind === "action")
        entryAnchors.set(surface.anchorNodeId, capability.id);
    }
  const drafts: Draft[] = [];
  for (const trace of [...traces.traces].sort((a, b) =>
    compareText(a.id, b.id),
  )) {
    if (!["normal", "only"].includes(trace.mode)) continue;
    const events = [...trace.actions, ...trace.assertions].sort(
      (a, b) => a.order - b.order,
    );
    for (let index = 0; index < events.length; index++) {
      const entry = events[index];
      if (
        !entry ||
        !("operation" in entry) ||
        entry.operation !== "click" ||
        entry.phase !== "test" ||
        entry.conditional
      )
        continue;
      const entryTarget = mapped(entry);
      const capability = capabilities.capabilities.find(
        (item) => item.id === entryAnchors.get(entryTarget?.node.id ?? ""),
      );
      if (!capability || !entryTarget) continue;
      // An entry nested in another capability's dialog (Deactivate inside
      // Edit Client) needs that dialog open: the test's preceding click on
      // the other capability's entry becomes the first step.
      let host: TestAction | undefined;
      if (
        snapshot.edges.some(
          (edge) =>
            edge.type === "CONTAINS" &&
            edge.target === entryTarget.node.id &&
            nodes.get(edge.source)?.type === "UIAction",
        )
      ) {
        const previous = events
          .slice(0, index)
          .filter(
            (event): event is TestAction =>
              "operation" in event &&
              event.phase === "test" &&
              !event.conditional,
          )
          .at(-1);
        const owner =
          previous && entryAnchors.get(mapped(previous)?.node.id ?? "");
        if (previous?.operation === "click" && owner && owner !== capability.id)
          host = previous;
      }
      const actions: TestAction[] = [];
      const observed: TestAssertion[] = [];
      const issues: AnalysisDiagnostic[] = [];
      let finish:
        | { event: TestAssertion; condition: WorkflowCondition }
        | undefined;
      for (const event of events.slice(index)) {
        if (event.phase !== "test") continue;
        if (
          event.conditional ||
          (event.target && event.target.page !== entry.target?.page)
        ) {
          issues.push({
            code: "trace-boundary",
            message:
              "Conditional or cross-page test behavior was not flattened into this workflow.",
          });
          break;
        }
        if ("operation" in event) {
          const target = mapped(event);
          if (
            event !== entry &&
            event.operation === "click" &&
            entryAnchors.has(target?.node.id ?? "")
          )
            break;
          if (
            !target ||
            event.kind !== "ui" ||
            !["click", "fill", "selectOption"].includes(event.operation)
          )
            break;
          if (event.target && event.target.hints.length !== 1) {
            issues.push({
              code: "target-scope-unresolved",
              message:
                "Scoped or transformed locators require explicit runtime scoping.",
            });
            break;
          }
          const data = targetData.parse(target.node.data?.target ?? {});
          if (
            event.operation === "click" &&
            /(?:^|[._\s-])(cancel|close|back)(?:$|[._\s-])/i.test(
              `${target.target} ${data.name ?? ""}`,
            )
          )
            break;
          actions.push(event);
        } else {
          observed.push(event);
          const result = terminal(event, actions);
          if (result) {
            finish = { event, condition: result };
            break;
          }
        }
      }
      if (!finish) continue;
      // A repeated submit around an asserted validation error is a test probe, not a required business step.
      const removed = new Set<number>();
      for (const error of observed.filter(isError)) {
        const attempt = actions
          .filter((action) => action.order < error.order)
          .at(-1);
        if (!attempt || attempt === entry || attempt.operation !== "click")
          continue;
        const target = mapped(attempt);
        if (!target) continue;
        const form = snapshot.edges.find(
          (edge) =>
            edge.type === "CONTAINS" &&
            edge.target === target.node.id &&
            nodes.get(edge.source)?.data?.tag === "form",
        );
        if (!form) continue;
        const retry = actions.find(
          (action) =>
            action.order > error.order &&
            action.operation === "click" &&
            mapped(action)?.node.id === target.node.id,
        );
        if (
          retry &&
          actions.some(
            (action) =>
              action.order > error.order &&
              action.order < retry.order &&
              ["fill", "selectOption"].includes(action.operation),
          )
        ) {
          removed.add(attempt.order);
          issues.push({
            code: "validation-probe-excluded",
            message: `${trace.id} event ${attempt.order}: omitted failed submit before input correction and a repeated submit.`,
          });
        }
      }
      const selected = [
        ...(host ? [host] : []),
        ...actions.filter((action) => !removed.has(action.order)),
      ];
      let route: string | undefined;
      for (const event of events.filter(
        (event) =>
          event.order < entry.order &&
          "operation" in event &&
          event.target?.page === entry.target?.page,
      )) {
        if (!("operation" in event)) continue;
        const id =
          event.target?.resolution === "matched"
            ? event.target.graphNodeIds[0]
            : undefined;
        const node = id ? nodes.get(id) : undefined;
        if (
          event.operation === "goto" &&
          node?.type === "Route" &&
          typeof node.data?.path === "string"
        )
          route = node.data.path;
        if (event.operation === "click" && id) {
          const destination = snapshot.edges.find(
            (edge) => edge.type === "NAVIGATES_TO" && edge.source === id,
          );
          const path = destination
            ? nodes.get(destination.target)?.data?.path
            : undefined;
          if (typeof path === "string") route = path;
        }
      }
      if (!route && capability.routeIds.length === 1) {
        const value = nodes.get(capability.routeIds[0] ?? "")?.data?.path;
        if (typeof value === "string") {
          route = value;
          issues.push({
            code: "entry-route-inferred",
            message:
              "Entrypoint comes from the unique capability route rather than a preceding test navigation.",
          });
        }
      }
      if (
        !route ||
        !capability.routeIds.some((id) => nodes.get(id)?.data?.path === route)
      )
        continue;
      if (trace.partial)
        issues.push({
          code: "partial-source-trace",
          message:
            "The supporting test contains unsupported code outside or around the extracted segment.",
        });
      if (repository.dirty !== false)
        issues.push({
          code: "uncommitted-workflow-evidence",
          message:
            "The source snapshot includes uncommitted or unknown working-tree state.",
        });
      if (
        events.some(
          (event) =>
            event.order < entry.order &&
            "operation" in event &&
            event.kind === "ui" &&
            mapped(event)?.node.data?.kind !== "navigate",
        )
      )
        issues.push({
          code: "prior-test-state",
          message:
            "Earlier test actions are excluded; their required state must be established before execution.",
        });
      if (selected.some((action) => action.operation !== "click"))
        issues.push({
          code: "input-binding-required",
          message:
            "Input/select values require explicit bindings. Test fixture values are not execution defaults.",
        });
      if (finish.condition.type !== "element_text")
        issues.push({
          code: "weak-terminal-signal",
          message:
            "Container disappearance is weaker than an observed business success message; review the completion condition.",
        });
      const roots = new Set<string>([trace.id, ...capability.sourceNodeIds]);
      const terminalTarget = mapped(finish.event);
      if (!terminalTarget) continue;
      roots.add(terminalTarget.node.id);
      const steps: WorkflowStep[] = selected.map((event, stepIndex) => {
        const match = mapped(event);
        if (!match) throw new Error("Selected workflow action lost its target");
        roots.add(match.node.id);
        const nextOrder =
          selected[stepIndex + 1]?.order ?? finish.event.order + 1;
        const assertion = observed.find(
          (item) =>
            item.order > event.order &&
            item.order < nextOrder &&
            condition(item),
        );
        const expected = assertion ? condition(assertion) : undefined;
        const evidence = [
          sourceRef(match.node),
          eventRef(trace, event, commit),
        ];
        if (assertion) {
          evidence.push(eventRef(trace, assertion, commit));
          const target = mapped(assertion);
          if (target) roots.add(target.node.id);
        }
        return {
          id: `step.${stepIndex + 1}`,
          target: match.target,
          action:
            event.operation === "fill"
              ? { type: "input" }
              : event.operation === "selectOption"
                ? { type: "select" }
                : { type: "click" },
          instruction: {
            text: `${event.operation === "fill" ? "Enter" : event.operation === "selectOption" ? "Select" : "Click"} ${targetData.parse(match.node.data?.target ?? {}).name ?? match.target}`,
          },
          ...(expected ? { expected } : {}),
          ...(stepIndex + 1 < selected.length
            ? { next: `step.${stepIndex + 2}` }
            : {}),
          evidence: uniqueRefs(evidence),
        };
      });
      const terminalEvidence = [
        sourceRef(terminalTarget.node),
        eventRef(trace, finish.event, commit),
      ];
      const packet = collectGraphEvidence(inputGraph, [...roots]);
      // Applicability (#21): the capability's roles, and flags the server
      // handlers of its endpoints check.
      const snapshotEdges = inputGraph.toJSON().edges;
      const handlers = new Set(
        snapshotEdges
          .filter(
            (edge) =>
              edge.type === "HANDLES" &&
              capability.apiEvidence.some(
                (item) => item.nodeId === edge.target,
              ),
          )
          .map((edge) => edge.source),
      );
      const flags = [
        ...new Set(
          snapshotEdges
            .filter(
              (edge) =>
                edge.type === "GUARDED_BY_FLAG" &&
                handlers.has(edge.source) &&
                edge.target.startsWith("flag:"),
            )
            .map((edge) => edge.target.slice("flag:".length)),
        ),
      ].sort();
      const workflow = WorkflowV1Schema.parse({
        schemaVersion: 1,
        id: capability.id,
        title: capability.title,
        domain: capability.domain,
        intent: {
          action: capability.verb,
          entity: capability.entity,
          ...(capability.qualifier
            ? { qualifiers: [capability.qualifier] }
            : {}),
        },
        ...(capability.roles.length > 0 ? { roles: capability.roles } : {}),
        entrypoints: [{ route }],
        ...(flags.length > 0
          ? {
              preconditions: flags.map((flag) => ({
                type: "feature_flag" as const,
                flag,
                enabled: true,
              })),
            }
          : {}),
        steps,
        terminal: finish.condition,
        provenance: {
          evidence: uniqueRefs([
            ...packet.refs,
            ...steps.flatMap((step) => step.evidence),
            ...terminalEvidence,
          ]),
        },
        repository: { commit },
        confidence: {
          overall: Math.min(
            capability.confidence,
            finish.condition.type === "element_text" ? 0.8 : 0.55,
          ),
          dimensions: {
            testSequence: 0.8,
            terminal: finish.condition.type === "element_text" ? 0.8 : 0.5,
          },
        },
        status: "candidate",
      });
      const signature = createHash("sha256")
        .update(
          JSON.stringify({
            route,
            steps: steps.map((step) => ({
              target: step.target,
              action: step.action,
              expected: step.expected,
            })),
            terminal: workflow.terminal,
          }),
        )
        .digest("hex")
        .slice(0, 12);
      drafts.push({
        candidate: {
          schemaVersion: 1,
          capabilityId: capability.id,
          workflow,
          reviewRequired: true,
          confidenceMeaning: "rule-strength-not-probability",
          ambiguities: diagnostics(issues),
          observations: [
            {
              traceId: trace.id,
              startOrder: (host ?? entry).order,
              terminalOrder: finish.event.order,
            },
          ],
          validation: {
            schema: "passed",
            repository: "not-run",
            evidence: "not-run",
            testComparison: "not-run",
            browser: "not-run",
          },
        },
        roots: [...roots],
        signature,
      });
    }
  }
  const merged = new Map<string, Draft>();
  for (const draft of drafts) {
    const key = `${draft.candidate.capabilityId}:${draft.signature}`;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, draft);
      continue;
    }
    previous.roots = [...new Set([...previous.roots, ...draft.roots])];
    previous.candidate.observations.push(...draft.candidate.observations);
    previous.candidate.ambiguities = diagnostics([
      ...previous.candidate.ambiguities,
      ...draft.candidate.ambiguities,
    ]);
    previous.candidate.workflow.provenance.evidence = uniqueRefs([
      ...previous.candidate.workflow.provenance.evidence,
      ...draft.candidate.workflow.provenance.evidence,
    ]);
    previous.candidate.workflow.steps.forEach((step, index) => {
      step.evidence = uniqueRefs([
        ...step.evidence,
        ...(draft.candidate.workflow.steps[index]?.evidence ?? []),
      ]);
    });
  }
  const candidates: WorkflowCandidate[] = [];
  const selectedRoots = new Set(capabilities.evidence.rootNodeIds);
  for (const capability of capabilities.capabilities) {
    const variants = [...merged.values()]
      .filter((draft) => draft.candidate.capabilityId === capability.id)
      .sort(
        (a, b) =>
          b.candidate.workflow.confidence.overall -
            a.candidate.workflow.confidence.overall ||
          a.candidate.workflow.steps.length -
            b.candidate.workflow.steps.length ||
          compareText(a.signature, b.signature),
      );
    variants.forEach((draft, index) => {
      if (index)
        draft.candidate.workflow.id = `${capability.id}--${draft.signature}`;
      if (variants.length > 1)
        draft.candidate.ambiguities = diagnostics([
          ...draft.candidate.ambiguities,
          {
            code: "alternative-test-path",
            message:
              "Distinct observed paths are separate candidates; branch guards have not been inferred.",
          },
        ]);
      draft.candidate.observations.sort((a, b) =>
        compareText(JSON.stringify(a), JSON.stringify(b)),
      );
      candidates.push(draft.candidate);
      for (const root of draft.roots) selectedRoots.add(root);
    });
  }
  candidates.sort((a, b) => compareText(a.workflow.id, b.workflow.id));
  const skipped = capabilities.capabilities
    .filter(
      (capability) =>
        !candidates.some(
          (candidate) => candidate.capabilityId === capability.id,
        ),
    )
    .map((capability) => ({
      capabilityId: capability.id,
      reason:
        "No supported test segment with resolved semantic actions and a positive completion assertion. Review the test targets and unsupported or scoped operations.",
    }));
  const report = WorkflowDiscoveryReportSchema.parse({
    schemaVersion: 1,
    evidenceOnly: true,
    repository,
    candidates,
    skipped,
    evidence: collectGraphEvidence(inputGraph, [...selectedRoots]),
    diagnostics: diagnostics([
      ...capabilities.diagnostics,
      ...traces.diagnostics,
    ]),
  });
  const graph = ProductGraph.fromJSON(snapshot);
  for (const candidate of report.candidates) {
    const id = createNodeId("WorkflowCandidate", candidate.workflow.id);
    graph.addNode({
      id,
      type: "WorkflowCandidate",
      data: z.record(z.string(), z.json()).parse(candidate),
    });
    for (const target of new Set([
      createNodeId("Capability", candidate.capabilityId),
      ...candidate.observations.map((observation) => observation.traceId),
    ]))
      graph.addEdge({
        id: createEdgeId("SUPPORTED_BY", id, target),
        type: "SUPPORTED_BY",
        source: id,
        target,
        data: { heuristic: true },
      });
  }
  return { graph, report };
}
