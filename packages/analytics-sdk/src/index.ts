import {
  createEventFactory,
  type EventInput,
  type PrivacyPolicy,
  PrivacyPolicySchema,
  type ProductRuntimeEvent,
  type ProductRuntimeEventType,
  serializeEvent,
} from "@pathcompiler/observability-core";

/**
 * Framework-independent, opt-in analytics (reasoning spec §134, §140). It sends
 * nothing anywhere unless analytics is enabled and a transport is given, and no
 * transport here uses the network.
 */
export interface AnalyticsTransport {
  send(events: ProductRuntimeEvent[]): Promise<void>;
}

/** Keeps sent batches in memory; for tests and local inspection. */
export class InMemoryTransport implements AnalyticsTransport {
  readonly batches: ProductRuntimeEvent[][] = [];
  get events(): ProductRuntimeEvent[] {
    return this.batches.flat();
  }
  async send(events: ProductRuntimeEvent[]): Promise<void> {
    this.batches.push(structuredClone(events));
  }
}

/** Writes each event as one canonical JSON line; for development. */
export class ConsoleTransport implements AnalyticsTransport {
  readonly #write: (line: string) => void;
  constructor(write: (line: string) => void = (line) => console.info(line)) {
    this.#write = write;
  }
  async send(events: ProductRuntimeEvent[]): Promise<void> {
    for (const event of events) this.#write(serializeEvent(event));
  }
}

type Timers = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};
export type AnalyticsOptions = {
  projectId: string;
  /** Application release bound to every event (spec §156). */
  release?: string;
  sessionId?: string;
  /** Privacy policy; analytics stays off unless `enabled: true`. */
  policy?: Partial<PrivacyPolicy>;
  /** Defaults to an in-memory transport; nothing is sent over the network. */
  transport?: AnalyticsTransport;
  /** Events per batch; a full batch is sent immediately. Default 20. */
  batchSize?: number;
  /** Maximum delay before a partial batch is sent. Default 5000 ms. */
  flushIntervalMs?: number;
  /** Queue bound; the oldest events are dropped beyond it. Default 1000. */
  maxQueue?: number;
  /** Rejected events and failed sends; analytics never throws into the app. */
  onError?: (error: Error) => void;
  now?: () => Date;
  nextId?: () => string;
  timers?: Timers;
};
/** Fields merged into every event unless the call overrides them. */
export type AnalyticsContext = {
  route?: string;
  role?: string;
  locale?: string;
  /** Must already be hashed (`hashUserId`) unless the policy disables hashing. */
  anonymousUserId?: string;
  context?: Record<string, string | number | boolean>;
};
export type AnalyticsStats = {
  queued: number;
  sent: number;
  rejected: number;
  dropped: number;
  failedSends: number;
};
type Workflow = { workflowId: string; workflowVersion: number };

export interface Analytics {
  readonly enabled: boolean;
  track<T extends ProductRuntimeEventType>(
    type: T,
    fields: EventInput<T>,
  ): void;
  workflowStarted(
    workflow: Workflow,
    trigger: "guide" | "assistant" | "organic",
  ): void;
  workflowStepReached(
    workflow: Workflow,
    stepId: string,
    stepIndex?: number,
  ): void;
  workflowCompleted(workflow: Workflow, durationMs?: number): void;
  workflowAbandoned(
    workflow: Workflow,
    reason: "stopped" | "timed-out" | "failed" | "navigated-away" | "unknown",
    lastStepId?: string,
  ): void;
  targetActivated(
    semanticTarget: string,
    interaction: "click" | "input" | "select" | "submit",
  ): void;
  goalReached(goalId: string, capabilityId?: string): void;
  routeChanged(route: string, previousRoute?: string): void;
  actionBlocked(
    semanticTarget: string,
    reason: "permission" | "feature_flag" | "precondition" | "unknown",
  ): void;
  setContext(context: AnalyticsContext): void;
  /** Sends queued events now; resolves when the transport has accepted them or failed. */
  flush(): Promise<void>;
  /** Flushes and stops; later calls are ignored. */
  shutdown(): Promise<void>;
  stats(): AnalyticsStats;
}

const defaultTimers: Timers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export function createAnalytics(options: AnalyticsOptions): Analytics {
  const policy = PrivacyPolicySchema.parse(options.policy ?? {});
  const enabled = policy.enabled;
  const transport = options.transport ?? new InMemoryTransport();
  const batchSize = Math.max(1, options.batchSize ?? 20);
  const flushIntervalMs = options.flushIntervalMs ?? 5000;
  const maxQueue = Math.max(batchSize, options.maxQueue ?? 1000);
  const timers = options.timers ?? defaultTimers;
  const report =
    options.onError ??
    ((error: Error) =>
      console.warn(`PathCompiler analytics: ${error.message}`));
  const create = createEventFactory({
    projectId: options.projectId,
    sessionId:
      options.sessionId ??
      globalThis.crypto?.randomUUID?.() ??
      `session-${Date.now()}`,
    ...(options.release === undefined ? {} : { release: options.release }),
    policy,
    ...(options.now ? { now: options.now } : {}),
    ...(options.nextId ? { nextId: options.nextId } : {}),
  });
  let sticky: AnalyticsContext = {};
  let queue: ProductRuntimeEvent[] = [];
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;
  let stopped = false;
  const counters = { sent: 0, rejected: 0, dropped: 0, failedSends: 0 };

  const schedule = () => {
    if (timer !== null || queue.length === 0) return;
    timer = timers.setTimeout(() => {
      timer = null;
      void flush();
    }, flushIntervalMs);
  };
  const flush = async (): Promise<void> => {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
    // One send at a time; events queued meanwhile go in the next batch.
    while (inFlight) await inFlight;
    if (queue.length === 0) return;
    const batch = queue.slice(0, batchSize);
    queue = queue.slice(batch.length);
    let delivered = false;
    inFlight = transport.send(batch).then(
      () => {
        delivered = true;
        counters.sent += batch.length;
      },
      (cause: unknown) => {
        counters.failedSends += 1;
        // Keep the events for a later attempt, within the queue bound.
        queue = [...batch, ...queue];
        trim();
        report(
          new Error(
            `Transport failed to send ${batch.length} events; they will be retried.`,
            { cause },
          ),
        );
      },
    );
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
    // After a failure, wait for the timer instead of retrying in a tight loop.
    if (delivered && queue.length >= batchSize) await flush();
    else schedule();
  };
  const trim = () => {
    const excess = queue.length - maxQueue;
    if (excess > 0) {
      queue = queue.slice(excess);
      counters.dropped += excess;
    }
  };
  const track: Analytics["track"] = (type, fields) => {
    if (!enabled || stopped) return;
    let event: ProductRuntimeEvent;
    try {
      event = create(type, { ...sticky, ...fields } as typeof fields);
    } catch (error) {
      counters.rejected += 1;
      report(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    queue.push(event);
    trim();
    if (queue.length >= batchSize) void flush();
    else schedule();
  };
  return {
    enabled,
    track,
    workflowStarted: (workflow, trigger) =>
      track("workflow.started", { ...workflow, trigger }),
    workflowStepReached: (workflow, stepId, stepIndex) =>
      track("workflow.step_reached", {
        ...workflow,
        stepId,
        ...(stepIndex === undefined ? {} : { stepIndex }),
      }),
    workflowCompleted: (workflow, durationMs) =>
      track("workflow.completed", {
        ...workflow,
        ...(durationMs === undefined ? {} : { durationMs }),
      }),
    workflowAbandoned: (workflow, reason, lastStepId) =>
      track("workflow.abandoned", {
        ...workflow,
        reason,
        ...(lastStepId === undefined ? {} : { lastStepId }),
      }),
    targetActivated: (semanticTarget, interaction) =>
      track("semantic_target.activated", { semanticTarget, interaction }),
    goalReached: (goalId, capabilityId) =>
      track("goal.reached", {
        goalId,
        ...(capabilityId === undefined ? {} : { capabilityId }),
      }),
    routeChanged: (route, previousRoute) =>
      track("route.changed", {
        route,
        ...(previousRoute === undefined ? {} : { previousRoute }),
      }),
    actionBlocked: (semanticTarget, reason) =>
      track("action.blocked", { semanticTarget, reason }),
    setContext(context) {
      sticky = { ...sticky, ...context };
    },
    flush,
    async shutdown() {
      if (stopped) return;
      await flush();
      stopped = true;
    },
    stats: () => ({ queued: queue.length, ...counters }),
  };
}
