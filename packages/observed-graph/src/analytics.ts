import type { ProductRuntimeEvent } from "@pathcompiler/observability-core";

/** Per workflow version (reasoning spec §145); observed facts, never formal claims. */
export type WorkflowSegment = {
  value: string;
  starts: number;
  completions: number;
  /** `null` until the segment has `minRuns` starts. */
  completionRate: number | null;
};
export type WorkflowAnalytics = {
  workflowId: string;
  workflowVersion: number;
  starts: number;
  byTrigger: Record<string, number>;
  completions: number;
  abandonments: number;
  byAbandonReason: Record<string, number>;
  /** Started but neither completed nor abandoned before the session's last event. */
  unfinished: number;
  /** `completions / starts`; `null` until `starts >= minRuns`. */
  completionRate: number | null;
  medianDurationMs: number | null;
  p95DurationMs: number | null;
  /** Semantic-target activations within completed runs. */
  medianActionCount: number | null;
  /** Runs that reached each step, in first-seen step order (a drop-off funnel). */
  steps: { stepId: string; runs: number }[];
  /** Segments below `minSegmentSize` starts are merged into `(suppressed)`. */
  byRole: WorkflowSegment[];
  byRelease: WorkflowSegment[];
  sufficient: boolean;
};
export type WorkflowAnalyticsReport = {
  schemaVersion: 1;
  minRuns: number;
  minSegmentSize: number;
  workflows: WorkflowAnalytics[];
};
export type WorkflowAnalyticsOptions = {
  /** Starts needed before rates are reported. Default 30. */
  minRuns?: number;
  /** Starts a role or release segment needs before it is shown. Default 5. */
  minSegmentSize?: number;
  release?: string;
};

type Run = {
  workflowId: string;
  workflowVersion: number;
  trigger: string;
  role: string;
  release: string;
  startedAt: number;
  steps: string[];
  actions: number;
  outcome: "completed" | "abandoned" | "unfinished";
  reason?: string;
  durationMs?: number;
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const percentile = (values: number[], share: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank percentile.
  return sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)] as number;
};
const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};
const rate = (part: number, whole: number, minimum: number) =>
  whole >= minimum && whole > 0
    ? Math.round((part / whole) * 1000) / 1000
    : null;
const counts = (values: string[]) => {
  const map = new Map<string, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return Object.fromEntries([...map].sort(([a], [b]) => compare(a, b)));
};

/** Reconstructs guide runs from lifecycle events and aggregates them per workflow version. */
export function computeWorkflowAnalytics(
  input: readonly ProductRuntimeEvent[],
  options: WorkflowAnalyticsOptions = {},
): WorkflowAnalyticsReport {
  const minRuns = options.minRuns ?? 30;
  const minSegmentSize = options.minSegmentSize ?? 5;
  const events = input.filter(
    (event) =>
      options.release === undefined || event.release === options.release,
  );
  const sessions = new Map<string, ProductRuntimeEvent[]>();
  for (const event of events) {
    const key = `${event.projectId}\u0000${event.sessionId}`;
    sessions.set(key, [...(sessions.get(key) ?? []), event]);
  }
  const runs: Run[] = [];
  for (const list of sessions.values()) {
    const ordered = [...list].sort(
      (a, b) =>
        compare(a.timestamp, b.timestamp) || compare(a.eventId, b.eventId),
    );
    const open = new Map<string, Run>();
    const close = (
      key: string,
      outcome: Run["outcome"],
      extra: Partial<Run> = {},
    ) => {
      const run = open.get(key);
      if (!run) return;
      open.delete(key);
      runs.push({ ...run, outcome, ...extra });
    };
    for (const event of ordered) {
      const time = Date.parse(event.timestamp);
      if (event.type === "semantic_target.activated")
        for (const run of open.values()) run.actions += 1;
      if (!event.type.startsWith("workflow.") || event.workflowId === undefined)
        continue;
      const key = `${event.workflowId}@${event.workflowVersion}`;
      if (event.type === "workflow.started") {
        close(key, "unfinished");
        open.set(key, {
          workflowId: event.workflowId,
          workflowVersion: event.workflowVersion,
          trigger: event.trigger,
          role: event.role ?? "(none)",
          release: event.release ?? "(none)",
          startedAt: time,
          steps: [],
          actions: 0,
          outcome: "unfinished",
        });
      } else if (event.type === "workflow.step_reached") {
        const run = open.get(key);
        if (run && !run.steps.includes(event.stepId))
          run.steps.push(event.stepId);
      } else if (event.type === "workflow.completed")
        close(key, "completed", {
          durationMs:
            event.durationMs ??
            Math.max(0, time - (open.get(key)?.startedAt ?? time)),
        });
      else if (event.type === "workflow.abandoned")
        close(key, "abandoned", { reason: event.reason });
    }
    for (const key of [...open.keys()]) close(key, "unfinished");
  }
  const groups = new Map<string, Run[]>();
  for (const run of runs) {
    const key = `${run.workflowId}@${run.workflowVersion}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const segments = (
    list: Run[],
    pick: (run: Run) => string,
  ): WorkflowSegment[] => {
    const byValue = new Map<string, Run[]>();
    for (const run of list)
      byValue.set(pick(run), [...(byValue.get(pick(run)) ?? []), run]);
    const shown: WorkflowSegment[] = [];
    const hidden: Run[] = [];
    for (const [value, members] of [...byValue].sort(([a], [b]) =>
      compare(a, b),
    ))
      if (members.length >= minSegmentSize) {
        const completions = members.filter(
          (run) => run.outcome === "completed",
        ).length;
        shown.push({
          value,
          starts: members.length,
          completions,
          completionRate: rate(completions, members.length, minRuns),
        });
      } else hidden.push(...members);
    if (hidden.length)
      shown.push({
        value: "(suppressed)",
        starts: hidden.length,
        completions: hidden.filter((run) => run.outcome === "completed").length,
        completionRate: null,
      });
    return shown;
  };
  const workflows = [...groups.values()]
    .map((list): WorkflowAnalytics => {
      const first = list[0] as Run;
      const completed = list.filter((run) => run.outcome === "completed");
      const abandoned = list.filter((run) => run.outcome === "abandoned");
      const order: string[] = [];
      for (const run of list)
        for (const step of run.steps)
          if (!order.includes(step)) order.push(step);
      const durations = completed.map((run) => run.durationMs ?? 0);
      return {
        workflowId: first.workflowId,
        workflowVersion: first.workflowVersion,
        starts: list.length,
        byTrigger: counts(list.map((run) => run.trigger)),
        completions: completed.length,
        abandonments: abandoned.length,
        byAbandonReason: counts(
          abandoned.map((run) => run.reason ?? "unknown"),
        ),
        unfinished: list.filter((run) => run.outcome === "unfinished").length,
        completionRate: rate(completed.length, list.length, minRuns),
        medianDurationMs: median(durations),
        p95DurationMs: percentile(durations, 0.95),
        medianActionCount: median(completed.map((run) => run.actions)),
        steps: order.map((stepId) => ({
          stepId,
          runs: list.filter((run) => run.steps.includes(stepId)).length,
        })),
        byRole: segments(list, (run) => run.role),
        byRelease: segments(list, (run) => run.release),
        sufficient: list.length >= minRuns,
      };
    })
    .sort(
      (a, b) =>
        compare(a.workflowId, b.workflowId) ||
        a.workflowVersion - b.workflowVersion,
    );
  return { schemaVersion: 1, minRuns, minSegmentSize, workflows };
}
