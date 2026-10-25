import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  type ProductRuntimeEvent,
  parseEvents,
} from "@pathcompiler/observability-core";

/**
 * Observed behavior (reasoning spec §131, §141): what actually happened,
 * aggregated from semantic events. Deliberately independent of the Formal
 * Product Model; comparing the two is reconciliation (O8).
 */
export const OBSERVED_GRAPH_SCHEMA_VERSION = 1;
export const SESSION_START = "session:start";
export const SESSION_END = "session:end";

export type ObservedStateKind =
  | "session"
  | "route"
  | "target"
  | "step"
  | "workflow"
  | "goal"
  | "domain"
  | "blocked";
export type ObservedNode = {
  id: string;
  kind: ObservedStateKind;
  /** Times the state was entered. */
  count: number;
  sessions: number;
};
export type ObservedEdge = {
  from: string;
  to: string;
  count: number;
  sessions: number;
  /** Share of the source state's outgoing transitions (0–1). */
  frequency: number;
  /** Median time between the two events; `null` for synthetic session edges. */
  medianMs: number | null;
  byRole: Record<string, number>;
  byRelease: Record<string, number>;
  /** At least `minSessions` sessions took this edge (no conclusions otherwise). */
  sufficient: boolean;
};
export type ObservedGraph = {
  schemaVersion: typeof OBSERVED_GRAPH_SCHEMA_VERSION;
  filter: ObservedGraphFilter;
  minSessions: number;
  events: number;
  sessions: number;
  nodes: ObservedNode[];
  edges: ObservedEdge[];
  /** Most common complete session paths. */
  paths: { states: string[]; sessions: number }[];
};
export type ObservedGraphFilter = {
  projectId?: string;
  release?: string;
  role?: string;
  /** Only events of this workflow (other events in those sessions are dropped). */
  workflowId?: string;
  workflowVersion?: number;
};
export type ObservedGraphOptions = ObservedGraphFilter & {
  /** Sessions an edge needs before it counts as evidence. Default 30. */
  minSessions?: number;
  /** Number of top paths to keep. Default 10. */
  topPaths?: number;
};

/** The observed state an event enters, e.g. `route:/clients` or `goal:clients.created`. */
export function observedState(event: ProductRuntimeEvent): {
  id: string;
  kind: ObservedStateKind;
} {
  switch (event.type) {
    case "route.changed":
      return { id: `route:${event.route}`, kind: "route" };
    case "semantic_target.activated":
      return {
        id: `target:${event.semanticTarget}:${event.interaction}`,
        kind: "target",
      };
    case "workflow.step_reached":
      return {
        id: `step:${event.workflowId}@${event.workflowVersion}:${event.stepId}`,
        kind: "step",
      };
    case "workflow.started":
    case "workflow.completed":
    case "workflow.abandoned":
      return {
        id: `workflow:${event.workflowId}@${event.workflowVersion}:${event.type.slice("workflow.".length)}`,
        kind: "workflow",
      };
    case "goal.reached":
      return { id: `goal:${event.goalId}`, kind: "goal" };
    case "domain.event":
      return { id: `domain:${event.name}`, kind: "domain" };
    case "action.blocked":
      return {
        id: `blocked:${event.semanticTarget}:${event.reason}`,
        kind: "blocked",
      };
  }
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};
const sortedRecord = (map: Map<string, number>) =>
  Object.fromEntries([...map].sort(([a], [b]) => compare(a, b)));

/** Builds the observed transition graph; output is independent of input order. */
export function buildObservedGraph(
  input: readonly ProductRuntimeEvent[],
  options: ObservedGraphOptions = {},
): ObservedGraph {
  const { minSessions = 30, topPaths = 10, ...filter } = options;
  const events = input.filter(
    (event) =>
      (filter.projectId === undefined ||
        event.projectId === filter.projectId) &&
      (filter.release === undefined || event.release === filter.release) &&
      (filter.role === undefined || event.role === filter.role) &&
      (filter.workflowId === undefined ||
        event.workflowId === filter.workflowId) &&
      (filter.workflowVersion === undefined ||
        event.workflowVersion === filter.workflowVersion),
  );
  const sessions = new Map<string, ProductRuntimeEvent[]>();
  for (const event of events)
    sessions.set(`${event.projectId}\u0000${event.sessionId}`, [
      ...(sessions.get(`${event.projectId}\u0000${event.sessionId}`) ?? []),
      event,
    ]);
  const nodes = new Map<string, ObservedNode & { members: Set<string> }>();
  type EdgeAccumulator = {
    from: string;
    to: string;
    count: number;
    members: Set<string>;
    times: number[];
    byRole: Map<string, number>;
    byRelease: Map<string, number>;
  };
  const edges = new Map<string, EdgeAccumulator>();
  const paths = new Map<string, number>();
  const enter = (id: string, kind: ObservedStateKind, session: string) => {
    const node = nodes.get(id) ?? {
      id,
      kind,
      count: 0,
      sessions: 0,
      members: new Set<string>(),
    };
    node.count += 1;
    node.members.add(session);
    nodes.set(id, node);
  };
  const move = (
    from: string,
    to: string,
    session: string,
    event: ProductRuntimeEvent | undefined,
    elapsed: number | null,
  ) => {
    const key = `${from}\u0000${to}`;
    const edge = edges.get(key) ?? {
      from,
      to,
      count: 0,
      members: new Set<string>(),
      times: [],
      byRole: new Map<string, number>(),
      byRelease: new Map<string, number>(),
    };
    edge.count += 1;
    edge.members.add(session);
    if (elapsed !== null) edge.times.push(elapsed);
    const role = event?.role ?? "(none)";
    const release = event?.release ?? "(none)";
    edge.byRole.set(role, (edge.byRole.get(role) ?? 0) + 1);
    edge.byRelease.set(release, (edge.byRelease.get(release) ?? 0) + 1);
    edges.set(key, edge);
  };
  for (const [session, list] of [...sessions].sort(([a], [b]) =>
    compare(a, b),
  )) {
    const ordered = [...list].sort(
      (a, b) =>
        compare(a.timestamp, b.timestamp) || compare(a.eventId, b.eventId),
    );
    enter(SESSION_START, "session", session);
    let previous = SESSION_START;
    let previousTime: number | null = null;
    const trail = [SESSION_START];
    for (const event of ordered) {
      const state = observedState(event);
      const time = Date.parse(event.timestamp);
      // Repeating the same state (e.g. a double click) is not a transition.
      if (state.id === previous) continue;
      enter(state.id, state.kind, session);
      move(
        previous,
        state.id,
        session,
        event,
        previousTime === null ? null : time - previousTime,
      );
      previous = state.id;
      previousTime = time;
      trail.push(state.id);
    }
    enter(SESSION_END, "session", session);
    move(previous, SESSION_END, session, ordered.at(-1), null);
    trail.push(SESSION_END);
    const key = JSON.stringify(trail);
    paths.set(key, (paths.get(key) ?? 0) + 1);
  }
  const outgoing = new Map<string, number>();
  for (const edge of edges.values())
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + edge.count);
  return {
    schemaVersion: OBSERVED_GRAPH_SCHEMA_VERSION,
    filter,
    minSessions,
    events: events.length,
    sessions: sessions.size,
    nodes: [...nodes.values()]
      .map(({ members, ...node }) => ({ ...node, sessions: members.size }))
      .sort((a, b) => compare(a.id, b.id)),
    edges: [...edges.values()]
      .map((edge) => ({
        from: edge.from,
        to: edge.to,
        count: edge.count,
        sessions: edge.members.size,
        frequency:
          Math.round((edge.count / (outgoing.get(edge.from) ?? 1)) * 1000) /
          1000,
        medianMs: median(edge.times),
        byRole: sortedRecord(edge.byRole),
        byRelease: sortedRecord(edge.byRelease),
        sufficient: edge.members.size >= minSessions,
      }))
      .sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to)),
    paths: [...paths]
      .map(([key, count]) => ({
        states: JSON.parse(key) as string[],
        sessions: count,
      }))
      .sort(
        (a, b) =>
          b.sessions - a.sessions ||
          compare(JSON.stringify(a.states), JSON.stringify(b.states)),
      )
      .slice(0, Math.max(0, topPaths)),
  };
}

/** Reads every `*.ndjson` file under a project's event directory (O5 file sink). */
export async function readEventDirectory(
  directory: string,
): Promise<ProductRuntimeEvent[]> {
  let names: string[];
  try {
    names = (await readdir(directory))
      .filter((name) => name.endsWith(".ndjson"))
      .sort(compare);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const events: ProductRuntimeEvent[] = [];
  for (const name of names)
    events.push(
      ...parseEvents(await readFile(path.join(directory, name), "utf8")),
    );
  return events;
}
export * from "./analytics.js";
export * from "./model-checking.js";
export * from "./release-diff.js";
export * from "./transition-model.js";
