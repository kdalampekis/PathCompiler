/**
 * Semantic trace deduplication (reasoning spec §28): many solver traces,
 * few business variants. A variant is identified by its goal, entry
 * capability, entry route and major actions. Navigation, detours that leave
 * no lasting effect (open a dialog, then cancel) and the order of form
 * fields do not make a new variant.
 */
export type TraceStepLike = {
  actionId: string;
  semanticTarget?: string;
  capabilityId?: string;
  /** State variables the step changed, with their new values. */
  changes: Record<string, boolean | number | string>;
};
export type TraceLike = {
  goal: string;
  initialState?: Record<string, boolean | number | string>;
  /** Plans call them `steps`, traces `actions`. */
  steps?: TraceStepLike[];
  actions?: TraceStepLike[];
};
export type TraceSignature = {
  goal: string;
  entryCapability: string | null;
  /** Where the last navigation before the first major action led (e.g. `current_area=CLIENTS`). */
  entryRoute: string | null;
  /** Capabilities whose steps leave a lasting effect, in order. */
  capabilities: string[];
  /** Semantic targets of those steps; fields within a step run are sorted. */
  majorActions: string[];
};
export type TraceVariant = {
  id: string;
  signature: TraceSignature;
  /** Input indices of the traces in this variant, in input order. */
  members: number[];
  /** The shortest member (first in input order among equals). */
  representative: number;
};
export type TraceClustering = {
  total: number;
  variants: TraceVariant[];
  /** Share of traces that repeat an earlier variant (0 when every trace is distinct). */
  duplicateRate: number;
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function traceSignature(trace: TraceLike): TraceSignature {
  const steps = trace.steps ?? trace.actions ?? [];
  // Segments: maximal runs of steps on the same capability.
  type Segment = {
    capability: string;
    steps: TraceStepLike[];
    route: string | null;
    start: number;
    end: number;
  };
  const segments: Segment[] = [];
  let route: string | null = null;
  for (const [index, step] of steps.entries()) {
    if (!step.capabilityId) {
      // Route family: the place a navigation leads (enum-valued state such
      // as an area), not the link used to get there.
      const place = Object.entries(step.changes)
        .filter(([, value]) => typeof value === "string")
        .map(([id, value]) => `${id}=${value}`)
        .sort(compare)
        .join(",");
      if (place) route = place;
      continue;
    }
    const last = segments.at(-1);
    if (last && last.capability === step.capabilityId && last.end === index - 1)
      last.end = index;
    else
      segments.push({
        capability: step.capabilityId,
        steps: [],
        route,
        start: index,
        end: index,
      });
    (segments.at(-1) as Segment).steps.push(step);
  }
  // State before step `index`; variables the trace does not know start
  // unset, which for booleans (dialogs, entered fields) means false.
  const stateAt = (index: number) => {
    const state = new Map<string, unknown>(
      Object.entries(trace.initialState ?? {}),
    );
    for (const step of steps.slice(0, index))
      for (const [id, value] of Object.entries(step.changes))
        state.set(id, value);
    return state;
  };
  const restored = (
    before: Map<string, unknown>,
    after: Map<string, unknown>,
    ids: Iterable<string>,
  ) =>
    [...ids].every((id) => {
      const value = after.get(id);
      return (
        (before.get(id) ?? (typeof value === "boolean" ? false : undefined)) ===
        value
      );
    });
  // A detour leaves no lasting effect: its own steps undo it (open, cancel),
  // or the navigation right after it does. A hand-over into the next
  // capability (Edit Client → Deactivate inside it) is kept.
  const kept = segments.filter((segment) => {
    const changed = new Set(
      segment.steps.flatMap((step) => Object.keys(step.changes)),
    );
    const before = stateAt(segment.start);
    if (restored(before, stateAt(segment.end + 1), changed)) return false;
    let next = segment.end + 1;
    while (next < steps.length && !steps[next]?.capabilityId) next += 1;
    return !(
      next > segment.end + 1 && restored(before, stateAt(next), changed)
    );
  });
  const majorActions: string[] = [];
  for (const segment of kept) {
    const targets = segment.steps.flatMap((step) =>
      step.semanticTarget ? [step.semanticTarget] : [],
    );
    const ordered =
      targets.length <= 2
        ? targets
        : [
            targets[0] as string,
            ...targets.slice(1, -1).sort(compare),
            targets.at(-1) as string,
          ];
    for (const target of ordered)
      if (majorActions.at(-1) !== target) majorActions.push(target);
  }
  return {
    goal: trace.goal,
    entryCapability: kept[0]?.capability ?? null,
    entryRoute: kept[0]?.route ?? null,
    capabilities: kept.map((segment) => segment.capability),
    majorActions,
  };
}

export function clusterTraces(traces: readonly TraceLike[]): TraceClustering {
  const groups = new Map<
    string,
    { signature: TraceSignature; members: number[] }
  >();
  traces.forEach((trace, index) => {
    const signature = traceSignature(trace);
    const key = JSON.stringify(signature);
    const group = groups.get(key) ?? { signature, members: [] };
    group.members.push(index);
    groups.set(key, group);
  });
  const length = (index: number) => {
    const trace = traces[index] as TraceLike;
    return (trace.steps ?? trace.actions ?? []).length;
  };
  const variants = [...groups.values()].map((group, position) => ({
    id: `variant-${position + 1}`,
    signature: group.signature,
    members: group.members,
    representative: group.members.reduce((best, index) =>
      length(index) < length(best) ? index : best,
    ),
  }));
  return {
    total: traces.length,
    variants,
    duplicateRate:
      traces.length === 0
        ? 0
        : Math.round(
            ((traces.length - variants.length) / traces.length) * 1000,
          ) / 1000,
  };
}
