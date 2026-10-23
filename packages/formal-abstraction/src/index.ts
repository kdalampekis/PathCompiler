import {
  type Capability,
  type CapabilityDiscoveryReport,
  CapabilityDiscoveryReportSchema,
} from "@pathcompiler/capability-engine";
import {
  type FormalAction,
  type FormalEffect,
  type FormalExpr,
  type FormalGoal,
  type FormalInvariant,
  type FormalProductModel,
  type FormalStateVariable,
  f,
  normalizeFormalModel,
} from "@pathcompiler/formal-model";
import type {
  EdgeType,
  GraphEdge,
  GraphNode,
  ProductGraph,
} from "@pathcompiler/graph-core";
import { compareText } from "@pathcompiler/source-model";
import {
  type TestTraceReport,
  TestTraceReportSchema,
} from "@pathcompiler/test-miner-playwright";
import type { EvidenceRef } from "@pathcompiler/workflow-ir";

export const FORMAL_ABSTRACTION_VERSION = "formal-abstraction-r1";

/** Where a transition's semantics come from (reasoning spec §85). */
export type TransitionBasis =
  | "deterministic"
  | "tests"
  | "runtime"
  | "semantic";
export type UncertaintyKind =
  | "ambiguous-entry"
  | "capability-not-modeled"
  | "enabling-condition-unknown"
  | "heuristic-guard"
  | "outcome-condition-unknown"
  | "required-fields-from-tests"
  | "role-values-incomplete"
  | "ui-guard-not-modeled"
  | "unresolved-test-step"
  | "value-not-persisted";
export type AbstractionUncertainty = {
  kind: UncertaintyKind;
  /** Model object (action, variable) or capability ID the uncertainty is about. */
  subject: string;
  message: string;
  nodeIds: string[];
};
export type ActionCoverage = {
  actionId: string;
  basis: TransitionBasis;
  rules: string[];
};
export type ModelCoverage = {
  transitions: {
    total: number;
    deterministic: number;
    tests: number;
    runtime: number;
    semanticOnly: number;
  };
  actions: ActionCoverage[];
  capabilities: { total: number; modeled: string[]; notModeled: string[] };
  testSessions: { used: number; discarded: number };
};
export type FormalAbstraction = {
  model: FormalProductModel;
  coverage: ModelCoverage;
  uncertainties: AbstractionUncertainty[];
};

type StepKind = "field" | "form-button" | "dialog-button" | "cancel";
type Step = { kind: StepKind; node?: string; value?: string; order: number };
type Session = {
  capability: string;
  trace: string;
  entry: string;
  steps: Step[];
  dialogs: Set<string>;
};

const OUTSIDE_ROLE = "unlisted";
const ENDS_SESSION = new Set([
  "close",
  "goBack",
  "goForward",
  "newContext",
  "newPage",
  "reload",
]);
const ROW_TAGS = new Set(["li", "tr"]);
const sorted = (values: Iterable<string>) =>
  [...new Set(values)].sort(compareText);
const words = (text: string) =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
function snake(text: string): string {
  const value = words(text);
  return /^[a-z]/.test(value) ? value : `x_${value}`;
}
const upper = (text: string) => snake(text).toUpperCase();
const all = (expressions: FormalExpr[]): FormalExpr =>
  expressions.length === 0
    ? f.bool(true)
    : expressions.length === 1
      ? (expressions[0] as FormalExpr)
      : f.and(...expressions);
const any = (expressions: FormalExpr[]): FormalExpr =>
  expressions.length === 1
    ? (expressions[0] as FormalExpr)
    : f.or(...expressions);
const past = (verb: string) => (verb.endsWith("e") ? `${verb}d` : `${verb}ed`);

/**
 * Derives a candidate Formal Product Model from deterministic graph facts and
 * mined test traces. The result over-approximates where evidence is missing and
 * reports every such gap; it never consults workflow candidates.
 */
export function buildFormalModel(
  graph: ProductGraph,
  inputCapabilities: CapabilityDiscoveryReport,
  inputTraces: TestTraceReport,
  options: { id?: string } = {},
): FormalAbstraction {
  const capabilities = CapabilityDiscoveryReportSchema.parse(inputCapabilities);
  const traces = TestTraceReportSchema.parse(inputTraces);
  const commit = traces.repository.commit;
  if (commit === null)
    throw new Error(
      "Formal abstraction needs a committed scan: evidence is bound to a repository commit. Commit the repository and rescan.",
    );
  if (capabilities.repository.commit !== commit)
    throw new Error(
      `Capabilities (${capabilities.repository.commit}) and test traces (${commit}) come from different commits. Rerun discovery on one scan.`,
    );
  const snapshot = graph.toJSON();
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of snapshot.edges)
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  const targets = (id: string, type: EdgeType) =>
    (outgoing.get(id) ?? [])
      .filter((edge) => edge.type === type)
      .map((edge) => edge.target);
  const text = (node: GraphNode | undefined, key: string) => {
    const value = node?.data?.[key];
    return typeof value === "string" ? value : undefined;
  };
  const semanticId = (id: string) => {
    const target = nodes.get(id)?.data?.target;
    return target &&
      typeof target === "object" &&
      !Array.isArray(target) &&
      typeof target.semanticId === "string"
      ? target.semanticId
      : undefined;
  };
  const shortName = (id: string) =>
    snake((semanticId(id) ?? id).split(".").at(-1) ?? id);
  function ref(id: string): EvidenceRef {
    const node = nodes.get(id);
    if (!node)
      throw new Error(`Formal abstraction cites missing graph node ${id}`);
    const evidence = node.data?.evidence;
    const locators = Array.isArray(evidence)
      ? evidence.flatMap((item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          typeof item.locator === "string"
            ? [item.locator]
            : [],
        )
      : [];
    return {
      id,
      type:
        node.type === "File"
          ? "source_file"
          : node.type === "Route"
            ? "route"
            : node.type === "APIEndpoint"
              ? "api"
              : node.type === "Test"
                ? "test"
                : "symbol",
      locator: sorted(locators)[0] ?? id,
      repositoryCommit: commit as string,
    };
  }
  const refs = (ids: Iterable<string>) => sorted(ids).map(ref);
  const uncertainties: AbstractionUncertainty[] = [];
  const doubt = (
    kind: UncertaintyKind,
    subject: string,
    message: string,
    nodeIds: Iterable<string>,
  ) => uncertainties.push({ kind, subject, message, nodeIds: sorted(nodeIds) });

  // Context: roles, named permissions and feature flags.
  const variables: FormalStateVariable[] = [];
  const permissions = [...nodes.values()].filter(
    (node) => node.type === "Permission",
  );
  const rolePermissions = new Map<string, string>();
  for (const node of permissions) {
    const role = text(node, "role");
    if (role) rolePermissions.set(node.id, role);
    else
      variables.push({
        id: `can_${snake(text(node, "name") ?? node.id)}`,
        type: "boolean",
        scope: "context",
        description: `Holds permission ${text(node, "name") ?? node.id}`,
        evidence: refs([node.id]),
      });
  }
  if (rolePermissions.size > 0) {
    const roles = sorted([...rolePermissions.values()].map(snake));
    variables.push({
      id: "role",
      type: "enum",
      values: [...roles, OUTSIDE_ROLE],
      scope: "context",
      description: "Session role",
      evidence: refs(rolePermissions.keys()),
    });
    doubt(
      "role-values-incomplete",
      "role",
      `Only roles checked in code are listed; every other role is "${OUTSIDE_ROLE}".`,
      rolePermissions.keys(),
    );
  }
  const flagVariable = (id: string) =>
    `${snake(text(nodes.get(id), "name") ?? id)}_enabled`;
  for (const node of nodes.values())
    if (node.type === "FeatureFlag")
      variables.push({
        id: flagVariable(node.id),
        type: "boolean",
        scope: "context",
        description: `${text(node, "name") ?? node.id} feature flag`,
        evidence: refs([node.id]),
      });
  const permissionGuard = (id: string): FormalExpr => {
    const role = rolePermissions.get(id);
    return role
      ? f.is("role", snake(role))
      : f.var(`can_${snake(text(nodes.get(id), "name") ?? id)}`);
  };

  // Areas: capability routes and navigation targets.
  const navigations = snapshot.edges
    .filter(
      (edge) =>
        edge.type === "NAVIGATES_TO" &&
        nodes.get(edge.source)?.type === "UIAction",
    )
    .sort(
      (a, b) =>
        compareText(a.source, b.source) || compareText(a.target, b.target),
    );
  const routeIds = sorted([
    ...capabilities.capabilities.flatMap((item) => item.routeIds),
    ...navigations.map((edge) => edge.target),
  ]);
  const area = new Map(
    routeIds.map((id) => [
      id,
      upper(text(nodes.get(id), "path") ?? id) || "ROOT",
    ]),
  );
  variables.push({
    id: "current_area",
    type: "enum",
    values: sorted(["OTHER", ...area.values()]),
    scope: "state",
    description: "Route area the user is on",
    evidence: refs(routeIds),
  });
  const areaGuard = (ids: string[]) =>
    ids.length === 0
      ? []
      : [
          any(
            sorted(ids.map((id) => area.get(id) ?? "OTHER")).map((value) =>
              f.is("current_area", value),
            ),
          ),
        ];

  // UI structure: containment, dialogs and dialog chrome (close buttons).
  const parents = new Map<string, string[]>();
  for (const edge of snapshot.edges)
    if (
      edge.type === "CONTAINS" &&
      nodes.get(edge.source)?.type === "UIAction" &&
      nodes.get(edge.target)?.type === "UIAction"
    )
      parents.set(edge.target, [
        ...(parents.get(edge.target) ?? []),
        edge.source,
      ]);
  const ancestors = (id: string) => {
    const seen = new Set<string>();
    const queue = [...(parents.get(id) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...(parents.get(next) ?? []));
    }
    return sorted(seen);
  };
  const dialogComponents = new Set<string>();
  const chrome = new Set<string>();
  for (const node of nodes.values()) {
    if (node.type !== "Component") continue;
    const exposed = targets(node.id, "EXPOSES_ACTION");
    if (exposed.some((id) => text(nodes.get(id), "tag") === "dialog")) {
      dialogComponents.add(text(node, "name") ?? node.id);
      for (const id of exposed) chrome.add(id);
    }
  }
  const isDialog = (id: string) => {
    const tag = text(nodes.get(id), "tag");
    return tag === "dialog" || (tag !== undefined && dialogComponents.has(tag));
  };
  const dialogOf = (id: string) => ancestors(id).find(isDialog);
  const inForm = (id: string) =>
    ancestors(id).some((item) => text(nodes.get(item), "kind") === "submit");

  // Capability entries: semantic-target UI controls a capability was inferred from.
  const entryOwners = new Map<string, string[]>();
  for (const capability of capabilities.capabilities)
    for (const id of sorted(
      capability.inferences
        .map((item) => item.nodeId)
        .filter((id) => text(nodes.get(id), "kind") === "click"),
    ))
      entryOwners.set(id, [...(entryOwners.get(id) ?? []), capability.id]);
  const entryOf = new Map<string, string>();
  for (const [id, owners] of entryOwners)
    if (owners.length === 1) entryOf.set(id, owners[0] as string);
    else
      doubt(
        "ambiguous-entry",
        id,
        `${id} is the entry of several capabilities (${owners.join(", ")}); its test sessions are not used.`,
        [id],
      );

  // Test sessions: an entry click followed by interactions inside its dialog.
  const sessions: Session[] = [];
  let discarded = 0;
  for (const trace of traces.traces) {
    if (trace.mode === "skip" || trace.mode === "fixme") continue;
    let current: Session | undefined;
    let tainted = false;
    const close = () => {
      if (current) {
        if (tainted) discarded += 1;
        else sessions.push(current);
      }
      current = undefined;
      tainted = false;
    };
    for (const action of [...trace.actions].sort((a, b) => a.order - b.order)) {
      if (action.kind === "ui") {
        const ids = action.target?.graphNodeIds ?? [];
        const id =
          action.target?.resolution === "matched" && ids.length === 1
            ? ids[0]
            : undefined;
        if (!id) {
          if (current && !tainted) {
            tainted = true;
            doubt(
              "unresolved-test-step",
              current.capability,
              `${trace.testName}: step ${action.order} (${action.operation}) has no single graph target; the session is not used.`,
              [trace.id],
            );
          }
          continue;
        }
        const capability = entryOf.get(id);
        if (capability) {
          close();
          current = {
            capability,
            trace: trace.id,
            entry: id,
            steps: [],
            dialogs: new Set(),
          };
          continue;
        }
        if (!current) continue;
        if (chrome.has(id)) {
          current.steps.push({ kind: "cancel", node: id, order: action.order });
          close();
          continue;
        }
        const dialog = dialogOf(id);
        if (!dialog) {
          close();
          continue;
        }
        current.dialogs.add(dialog);
        const value =
          action.operation === "selectOption" &&
          action.value.kind === "literal" &&
          typeof action.value.value === "string"
            ? action.value.value
            : undefined;
        current.steps.push({
          kind:
            text(nodes.get(id), "kind") === "input"
              ? "field"
              : inForm(id)
                ? "form-button"
                : "dialog-button",
          node: id,
          order: action.order,
          ...(value === undefined ? {} : { value }),
        });
      } else if (
        action.kind === "navigate" ||
        (action.kind === "page" && ENDS_SESSION.has(action.operation))
      )
        close();
      else if (
        current &&
        action.kind === "page" &&
        action.operation === "press" &&
        action.value.kind === "literal" &&
        action.value.value === "Escape"
      ) {
        current.steps.push({ kind: "cancel", order: action.order });
        close();
      }
    }
    close();
  }

  // Fields: enum when every observed selection is a literal string, else "entered".
  const fieldValues = new Map<string, Set<string> | null>();
  for (const session of sessions)
    for (const step of session.steps)
      if (step.kind === "field" && step.node) {
        const known = fieldValues.get(step.node);
        if (step.value === undefined || known === null)
          fieldValues.set(step.node, null);
        else
          fieldValues.set(step.node, new Set([...(known ?? []), step.value]));
      }
  const fieldVariable = (id: string) => {
    const name = snake(semanticId(id) ?? id);
    return fieldValues.get(id) ? name : `${name}_entered`;
  };
  const fieldTests = new Map<string, Set<string>>();
  for (const session of sessions)
    for (const step of session.steps)
      if (step.kind === "field" && step.node)
        fieldTests.set(
          step.node,
          new Set([...(fieldTests.get(step.node) ?? []), session.trace]),
        );
  for (const [id, values] of [...fieldValues].sort(([a], [b]) =>
    compareText(a, b),
  ))
    variables.push(
      values
        ? {
            id: fieldVariable(id),
            type: "enum",
            values: sorted([...values].map(upper)),
            scope: "state",
            evidence: refs([id, ...(fieldTests.get(id) ?? [])]),
          }
        : {
            id: fieldVariable(id),
            type: "boolean",
            scope: "state",
            evidence: refs([id]),
          },
    );

  // Per-capability session automata: open → (confirming) → commit/back/cancel.
  type Analysis = {
    capability: Capability;
    sessions: Session[];
    stage2: Set<string>;
    commits: Map<string, Session[]>;
    toConfirm: Map<string, Session[]>;
    backs: Map<string, Session[]>;
    cancels: Map<string, Session[]>;
    rejections: Session[];
    required: string[];
    fields: string[];
  };
  const add = (map: Map<string, Session[]>, key: string, session: Session) =>
    map.set(key, [...(map.get(key) ?? []), session]);
  const analyses: Analysis[] = [];
  const notModeled: string[] = [];
  for (const capability of [...capabilities.capabilities].sort((a, b) =>
    compareText(a.id, b.id),
  )) {
    const own = sessions.filter((item) => item.capability === capability.id);
    const stage2 = new Set<string>();
    for (let changed = true; changed; ) {
      changed = false;
      for (const session of own)
        for (const step of session.steps) {
          if (
            step.kind !== "dialog-button" ||
            !step.node ||
            stage2.has(step.node)
          )
            continue;
          const occurrences = own.flatMap((item) =>
            item.steps.flatMap((candidate, position) =>
              candidate.node === step.node ? [item.steps[position - 1]] : [],
            ),
          );
          if (
            occurrences.every(
              (previous) =>
                previous?.kind === "form-button" ||
                (previous?.node !== undefined && stage2.has(previous.node)),
            )
          ) {
            stage2.add(step.node);
            changed = true;
          }
        }
    }
    const analysis: Analysis = {
      capability,
      sessions: own,
      stage2,
      commits: new Map(),
      toConfirm: new Map(),
      backs: new Map(),
      cancels: new Map(),
      rejections: [],
      required: [],
      fields: [],
    };
    const textFields = new Set<string>();
    const enteredAtCommit: Set<string>[] = [];
    const missingAtRejection = new Set<string>();
    for (const session of own) {
      const entered = new Set<string>();
      for (const [index, step] of session.steps.entries()) {
        const next = session.steps[index + 1];
        const node = step.node ?? "";
        if (step.kind === "field") {
          if (!fieldValues.get(node)) {
            textFields.add(node);
            entered.add(node);
          }
          continue;
        }
        if (step.kind === "cancel") {
          add(analysis.cancels, node, session);
          continue;
        }
        const nextStage2 =
          next?.kind === "dialog-button" && stage2.has(next.node ?? "");
        if (!next) {
          add(analysis.commits, node, session);
          enteredAtCommit.push(new Set(entered));
        } else if (step.kind === "form-button") {
          if (nextStage2) add(analysis.toConfirm, node, session);
          else if (next.kind === "field") {
            analysis.rejections.push(session);
            for (const field of session.steps)
              if (
                field.kind === "field" &&
                field.node &&
                !entered.has(field.node)
              )
                missingAtRejection.add(field.node);
          }
        } else if (stage2.has(node) && !nextStage2 && next.kind !== "cancel")
          add(analysis.backs, node, session);
      }
    }
    if (analysis.commits.size === 0) {
      notModeled.push(capability.id);
      doubt(
        "capability-not-modeled",
        capability.id,
        `No test session completes ${capability.id}; it has no transitions or goal in the model.`,
        capability.inferences.map((item) => item.nodeId),
      );
      continue;
    }
    analysis.fields = sorted(
      own.flatMap((item) =>
        item.steps.flatMap((step) =>
          step.kind === "field" && step.node ? [step.node] : [],
        ),
      ),
    );
    analysis.required = sorted(textFields).filter(
      (field) =>
        missingAtRejection.has(field) &&
        enteredAtCommit.every((entered) => entered.has(field)),
    );
    analyses.push(analysis);
  }

  const openVariable = (id: string) => `${snake(id)}_open`;
  const confirmingVariable = (id: string) => `${snake(id)}_confirming`;
  const goalVariable = (capability: Capability) =>
    `${snake(capability.domain)}_${capability.qualifier ? `${capability.qualifier}_` : ""}${past(capability.verb)}`;
  const existsVariable = (entity: string) => `${snake(entity)}_exists`;
  const sessionVariables = analyses.flatMap((item) => [
    openVariable(item.capability.id),
    ...(item.stage2.size > 0 ? [confirmingVariable(item.capability.id)] : []),
  ]);
  const closeAll = sessionVariables.map((id) => f.set(id, false));
  const rowsOf = (entry: string) =>
    (parents.get(entry) ?? []).filter((id) =>
      ROW_TAGS.has(text(nodes.get(id), "tag") ?? ""),
    );
  const existence = new Map<string, Set<string>>();
  for (const item of analyses)
    for (const entry of new Set(item.sessions.map((session) => session.entry)))
      for (const row of rowsOf(entry))
        existence.set(
          item.capability.entity,
          new Set([...(existence.get(item.capability.entity) ?? []), row]),
        );
  for (const [entity, rows] of [...existence].sort(([a], [b]) =>
    compareText(a, b),
  ))
    variables.push({
      id: existsVariable(entity),
      type: "boolean",
      scope: "state",
      description: `At least one ${entity} exists`,
      evidence: refs(rows),
    });

  const actions: FormalAction[] = [];
  const coverage: ActionCoverage[] = [];
  const invariants: FormalInvariant[] = [];
  const goals: FormalGoal[] = [];
  const initial: FormalExpr[] = [f.is("current_area", "OTHER")];
  const action = (
    item: Omit<FormalAction, "evidence"> & { evidence: Iterable<string> },
    basis: TransitionBasis,
    rules: string[],
  ) => {
    actions.push({ ...item, evidence: refs(item.evidence) });
    coverage.push({ actionId: item.id, basis, rules: sorted(rules) });
  };
  const target = (id: string | undefined) => {
    const value = id ? semanticId(id) : undefined;
    return value ? { semanticTarget: value } : {};
  };

  for (const edge of navigations) {
    const value = area.get(edge.target) ?? "OTHER";
    action(
      {
        id: `navigate.${snake(semanticId(edge.source) ?? edge.source)}`,
        precondition: f.bool(true),
        effects: [f.set("current_area", value), ...closeAll],
        ...target(edge.source),
        evidence: [edge.source, edge.target],
      },
      "deterministic",
      ["navigates-to"],
    );
  }

  for (const item of analyses) {
    const { capability } = item;
    const id = capability.id;
    const open = openVariable(id);
    const confirming =
      item.stage2.size > 0 ? confirmingVariable(id) : undefined;
    const tests = (list: Session[] = item.sessions) =>
      list.map((session) => session.trace);
    const dialogs = sorted(
      item.sessions.flatMap((session) => [...session.dialogs]),
    );
    const routeGuard = areaGuard(capability.routeIds);
    const goal = goalVariable(capability);
    variables.push({
      id: open,
      type: "boolean",
      scope: "state",
      description: `${capability.title} dialog is open`,
      evidence: refs([
        ...dialogs,
        ...item.sessions.map((session) => session.entry),
      ]),
    });
    if (confirming)
      variables.push({
        id: confirming,
        type: "boolean",
        scope: "state",
        description: `${capability.title} is awaiting confirmation`,
        evidence: refs(item.stage2),
      });
    const apiIds = capability.apiEvidence.map((api) => api.nodeId);
    variables.push({
      id: goal,
      type: "boolean",
      scope: "state",
      description: `${capability.title} completed during this session`,
      evidence: refs(apiIds.length > 0 ? apiIds : capability.routeIds),
    });
    initial.push(
      f.not(f.var(open)),
      ...(confirming ? [f.not(f.var(confirming))] : []),
      f.not(f.var(goal)),
    );

    // Server-enforced guards: permission and flag checks reachable from the API handler.
    const handlers = snapshot.edges
      .filter((edge) => edge.type === "HANDLES" && apiIds.includes(edge.target))
      .map((edge) => edge.source);
    const scope = sorted([
      ...handlers,
      ...handlers.flatMap((handler) => targets(handler, "CALLS")),
    ]);
    const guardEdges = snapshot.edges.filter(
      (edge) =>
        scope.includes(edge.source) &&
        (edge.type === "REQUIRES_PERMISSION" ||
          edge.type === "GUARDED_BY_FLAG"),
    );
    const roleGuards = sorted(
      guardEdges
        .filter((edge) => rolePermissions.has(edge.target))
        .map((edge) => edge.target),
    );
    const guards: FormalExpr[] = [
      ...(roleGuards.length > 0 ? [any(roleGuards.map(permissionGuard))] : []),
      ...sorted(
        guardEdges
          .filter(
            (edge) =>
              edge.type === "REQUIRES_PERMISSION" &&
              !rolePermissions.has(edge.target),
          )
          .map((edge) => edge.target),
      ).map(permissionGuard),
      ...sorted(
        guardEdges
          .filter((edge) => edge.type === "GUARDED_BY_FLAG")
          .map((edge) => edge.target),
      ).map((flag) => f.var(flagVariable(flag))),
    ];
    const guardNodes = [
      ...apiIds,
      ...handlers,
      ...guardEdges.flatMap((edge) => [edge.source, edge.target]),
    ];
    if (guardEdges.some((edge) => edge.data?.heuristic === true))
      doubt(
        "heuristic-guard",
        id,
        `Guards on ${id} come from heuristic permission/flag edges on its API handler; their polarity is not proven.`,
        guardEdges.flatMap((edge) => [edge.source, edge.target]),
      );
    const uiGuards = snapshot.edges.filter(
      (edge) =>
        (edge.type === "REQUIRES_PERMISSION" ||
          edge.type === "GUARDED_BY_FLAG") &&
        capability.sourceNodeIds.includes(edge.source) &&
        !scope.includes(edge.source),
    );
    if (uiGuards.length > 0)
      doubt(
        "ui-guard-not-modeled",
        `${id}.open`,
        `UI code for ${id} is guarded by ${sorted(uiGuards.map((edge) => edge.target)).join(", ")}; only server-enforced guards are applied, so the dialog may open in contexts where the UI hides it.`,
        uiGuards.flatMap((edge) => [edge.source, edge.target]),
      );

    const notConfirming = confirming ? [f.not(f.var(confirming))] : [];
    const entries = sorted(item.sessions.map((session) => session.entry));
    const rows = entries.flatMap(rowsOf);
    const textFields = item.fields.filter((field) => !fieldValues.get(field));
    for (const entry of entries)
      action(
        {
          id:
            entries.length === 1
              ? `${id}.open`
              : `${id}.open_${shortName(entry)}`,
          precondition: all([
            ...routeGuard,
            ...sessionVariables.map((variable) => f.not(f.var(variable))),
            ...(rows.length > 0
              ? [f.var(existsVariable(capability.entity))]
              : []),
          ]),
          effects: [
            f.set(open, true),
            ...(confirming ? [f.set(confirming, false)] : []),
            ...textFields.map((field) => f.set(fieldVariable(field), false)),
          ],
          ...target(entry),
          capabilityId: id,
          evidence: [entry, ...rows, ...dialogs, ...tests()],
        },
        "tests",
        [
          "test-session-entry",
          ...(rows.length > 0 ? ["row-entity-exists"] : []),
        ],
      );
    const fieldNames = new Map(
      item.fields.map((field) => [field, shortName(field)]),
    );
    const named = (field: string) =>
      [...fieldNames.values()].filter((name) => name === fieldNames.get(field))
        .length > 1
        ? snake(semanticId(field) ?? field)
        : (fieldNames.get(field) as string);
    const enumFields = item.fields.filter((field) =>
      fieldValues.get(field),
    ).length;
    for (const field of item.fields) {
      const values = fieldValues.get(field);
      const fieldSessions = item.sessions.filter((session) =>
        session.steps.some((step) => step.node === field),
      );
      for (const value of values ? sorted([...values].map(upper)) : [undefined])
        action(
          {
            id: value
              ? `${id}.select_${enumFields === 1 ? "" : `${named(field)}_`}${value.toLowerCase()}`
              : `${id}.enter_${named(field)}`,
            precondition: all([f.var(open), ...notConfirming]),
            effects: [f.set(fieldVariable(field), value ?? true)],
            ...target(field),
            capabilityId: id,
            evidence: [field, ...tests(fieldSessions)],
          },
          "tests",
          ["test-session-field"],
        );
      if (values)
        doubt(
          "value-not-persisted",
          fieldVariable(field),
          `The value chosen in ${semanticId(field) ?? field} is not linked to ${capability.entity} state; committing ${id} does not record it.`,
          [field],
        );
    }
    const required = item.required.map((field) => f.var(fieldVariable(field)));
    if (item.required.length > 0)
      doubt(
        "required-fields-from-tests",
        id,
        `${id} requires ${item.required.map((field) => semanticId(field) ?? field).join(", ")}: a test shows the form rejecting a submit without them. Validation code is not analyzed.`,
        [...item.required, ...tests(item.rejections)],
      );
    const finish: FormalEffect[] = [
      f.set(goal, true),
      f.set(open, false),
      ...(confirming ? [f.set(confirming, false)] : []),
      ...(capability.verb === "create" && existence.has(capability.entity)
        ? [f.set(existsVariable(capability.entity), true)]
        : []),
    ];
    for (const [button, list] of [...item.commits].sort(([a], [b]) =>
      compareText(a, b),
    )) {
      const stage2 = item.stage2.has(button);
      action(
        {
          id: `${id}.${shortName(button)}`,
          precondition: all([
            f.var(open),
            ...(confirming
              ? [stage2 ? f.var(confirming) : f.not(f.var(confirming))]
              : []),
            ...(stage2 ? [] : required),
            ...guards,
          ]),
          effects: finish,
          ...target(button),
          capabilityId: id,
          evidence: [button, ...guardNodes, ...tests(list)],
        },
        "tests",
        [
          "test-session-commit",
          ...(guards.length > 0 ? ["api-handler-guard"] : []),
        ],
      );
    }
    for (const [button, list] of [...item.toConfirm].sort(([a], [b]) =>
      compareText(a, b),
    )) {
      const name = item.commits.has(button)
        ? `${shortName(button)}_for_confirmation`
        : shortName(button);
      action(
        {
          id: `${id}.${name}`,
          precondition: all([f.var(open), ...notConfirming, ...required]),
          effects: [f.set(confirming as string, true)],
          ...target(button),
          capabilityId: id,
          evidence: [button, ...item.stage2, ...tests(list)],
        },
        "tests",
        ["test-session-confirmation"],
      );
      if (item.commits.has(button))
        doubt(
          "outcome-condition-unknown",
          `${id}.${name}`,
          `${semanticId(button) ?? button} sometimes completes ${id} and sometimes asks for confirmation; the deciding condition is unknown, so both outcomes are modeled.`,
          [button, ...tests(list), ...tests(item.commits.get(button))],
        );
    }
    for (const [button, list] of [...item.backs].sort(([a], [b]) =>
      compareText(a, b),
    ))
      action(
        {
          id: `${id}.${item.commits.has(button) ? `${shortName(button)}_return` : shortName(button)}`,
          precondition: f.var(confirming as string),
          effects: [f.set(confirming as string, false)],
          ...target(button),
          capabilityId: id,
          evidence: [button, ...tests(list)],
        },
        "tests",
        ["test-session-back"],
      );
    if (item.cancels.size > 0) {
      const buttons = sorted([...item.cancels.keys()].filter(Boolean));
      action(
        {
          id: `${id}.cancel`,
          precondition: f.var(open),
          effects: [
            f.set(open, false),
            ...(confirming ? [f.set(confirming, false)] : []),
          ],
          ...target(buttons[0]),
          capabilityId: id,
          evidence: [
            ...buttons,
            ...dialogs,
            ...tests([...item.cancels.values()].flat()),
          ],
        },
        "tests",
        ["test-session-cancel"],
      );
    }

    if (routeGuard.length > 0)
      invariants.push({
        id: `${id}.open_only_in_area`,
        description: `The ${capability.title} dialog is open only on its route`,
        condition: f.implies(f.var(open), all(routeGuard)),
        evidence: refs([...dialogs, ...capability.routeIds]),
      });
    if (confirming)
      invariants.push({
        id: `${id}.confirmation_inside_dialog`,
        description: `${capability.title} confirmation appears only inside its dialog`,
        condition: f.implies(f.var(confirming), f.var(open)),
        evidence: refs([...item.stage2, ...dialogs]),
      });
    goals.push({
      id: `${snake(capability.domain)}.${capability.qualifier ? `${capability.qualifier}_` : ""}${past(capability.verb)}`,
      condition: f.var(goal),
      businessMeaning: capability.title,
      capabilityId: id,
      evidence: refs([
        ...apiIds,
        ...entries,
        ...tests([...item.commits.values()].flat()),
      ]),
      confidence: capability.confidence,
    });
  }
  for (const field of sorted(fieldValues.keys()))
    if (!fieldValues.get(field))
      initial.push(f.not(f.var(fieldVariable(field))));

  const entryIds = new Set(entryOf.keys());
  for (const trace of traces.traces)
    for (const assertion of trace.assertions) {
      const ids = assertion.target?.graphNodeIds ?? [];
      const node = ids.length === 1 ? ids[0] : undefined;
      if (
        assertion.matcher === "toBeDisabled" &&
        !assertion.negated &&
        node &&
        entryIds.has(node)
      )
        doubt(
          "enabling-condition-unknown",
          `${entryOf.get(node)}.open`,
          `${trace.testName} observes ${semanticId(node) ?? node} disabled; the enabling condition is not modeled.`,
          [node, trace.id],
        );
    }

  const model = normalizeFormalModel({
    schemaVersion: 1,
    id: options.id ?? "product",
    metadata: {
      repositoryCommit: commit,
      source: "extracted",
      extractorVersion: FORMAL_ABSTRACTION_VERSION,
    },
    variables,
    initial: all(initial),
    actions,
    invariants,
    goals,
  });
  const count = (basis: TransitionBasis) =>
    coverage.filter((item) => item.basis === basis).length;
  const unique = new Map(
    uncertainties.map((item) => [JSON.stringify(item), item]),
  );
  return {
    model,
    coverage: {
      transitions: {
        total: coverage.length,
        deterministic: count("deterministic"),
        tests: count("tests"),
        runtime: count("runtime"),
        semanticOnly: count("semantic"),
      },
      actions: coverage.sort((a, b) => compareText(a.actionId, b.actionId)),
      capabilities: {
        total: capabilities.capabilities.length,
        modeled: sorted(analyses.map((item) => item.capability.id)),
        notModeled: sorted(notModeled),
      },
      testSessions: { used: sessions.length, discarded },
    },
    uncertainties: [...unique.values()].sort(
      (a, b) =>
        compareText(a.kind, b.kind) ||
        compareText(a.subject, b.subject) ||
        compareText(a.message, b.message),
    ),
  };
}
