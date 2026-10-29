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

export type FetchTransportOptions = {
  /** The ingestion endpoint, e.g. https://example.test/v1/events/batch. */
  url: string;
  /** Bearer token; use an ingest-only token in browser builds. */
  token?: string;
  fetch?: typeof fetch;
  /** Lets the last batch survive page unload in browsers. */
  keepalive?: boolean;
  /** Events the server refused (privacy or schema); they are not retried. */
  onRejected?: (rejected: {
    events: ProductRuntimeEvent[];
    reason: string;
  }) => void;
};
/**
 * Posts batches to `POST /v1/events/batch` (phase O5). 429 and 5xx responses
 * throw so the SDK retries; other client errors and per-event rejections are
 * reported through `onRejected` and not retried.
 */
export class FetchTransport implements AnalyticsTransport {
  readonly #options: FetchTransportOptions;
  constructor(options: FetchTransportOptions) {
    this.#options = options;
  }
  async send(events: ProductRuntimeEvent[]): Promise<void> {
    const { url, token, keepalive, onRejected } = this.#options;
    const request = this.#options.fetch ?? globalThis.fetch;
    const response = await request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ events }),
      ...(keepalive ? { keepalive: true } : {}),
    });
    if (response.status === 429 || response.status >= 500)
      throw new Error(
        `Event ingestion responded ${response.status}; retrying later.`,
      );
    if (!response.ok) {
      onRejected?.({ events, reason: `HTTP ${response.status}` });
      return;
    }
    const result = (await response.json()) as {
      rejected?: { index: number; issues: string[] }[];
    };
    if (result.rejected?.length)
      onRejected?.({
        events: result.rejected.flatMap((item) => {
          const event = events[item.index];
          return event ? [event] : [];
        }),
        reason: result.rejected
          .map((item) => `#${item.index}: ${item.issues.join("; ")}`)
          .join(" | "),
      });
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
  /**
   * Known Formal Product Model goal IDs (`model.goals.map((goal) => goal.id)`).
   * When set, `goal.reached` events for other IDs are rejected and reported.
   */
  goals?: readonly string[];
  /** When set, only these `domain.event` names are accepted. */
  domainEvents?: readonly string[];
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
  /** Explicit business event, e.g. `client.created` (spec §138). */
  domainEvent(name: string): void;
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
  const goals = options.goals ? new Set(options.goals) : null;
  const domainEvents = options.domainEvents
    ? new Set(options.domainEvents)
    : null;
  const track: Analytics["track"] = (type, fields) => {
    if (!enabled || stopped) return;
    const goal = (fields as { goalId?: string }).goalId;
    const name = (fields as { name?: string }).name;
    const unknown =
      type === "goal.reached" && goals && goal !== undefined && !goals.has(goal)
        ? `Unknown goal ${goal}; known goals: ${[...goals].join(", ") || "none"}.`
        : type === "domain.event" &&
            domainEvents &&
            name !== undefined &&
            !domainEvents.has(name)
          ? `Unknown domain event ${name}; declare it in domainEvents.`
          : null;
    if (unknown) {
      counters.rejected += 1;
      report(new Error(unknown));
      return;
    }
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
    domainEvent: (name) => track("domain.event", { name }),
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

/** The part of a guide runtime's state that telemetry reads (`@pathcompiler/runtime-core`). */
export type GuideStateLike = {
  status: string;
  workflowId: string | null;
  revision: string | null;
  version: number | null;
  completedStepIds: string[];
  step: { id: string } | null;
  failure?: { code: string } | null;
};
export type GuideLike = {
  getState(): GuideStateLike;
  subscribe(listener: (state: GuideStateLike) => void): () => void;
};
const ABANDONED: Partial<Record<string, "stopped" | "timed-out" | "failed">> = {
  stopped: "stopped",
  "timed-out": "timed-out",
  failed: "failed",
};

/**
 * Emits workflow lifecycle events from guide state transitions (phase O3):
 * started, step reached, completed, or abandoned with the reason. A guide that
 * fails before starting (invalid manifest, unmet precondition, mismatch) emits
 * nothing. Returns the unsubscribe function.
 */
export function instrumentGuide(
  guide: GuideLike,
  analytics: Analytics,
  options: { now?: () => number } = {},
): () => void {
  const now = options.now ?? (() => Date.now());
  let run: {
    key: string;
    workflow: Workflow;
    startedAt: number;
    lastStepId: string | undefined;
  } | null = null;
  const observe = (state: GuideStateLike) => {
    const key =
      state.workflowId && state.revision
        ? `${state.workflowId}@${state.revision}`
        : null;
    const finished = ["completed", "stopped", "timed-out", "failed"].includes(
      state.status,
    );
    // `start` again on a running guide returns it to `waiting-route`.
    if (
      run &&
      key === run.key &&
      state.status === "waiting-route" &&
      run.lastStepId !== undefined
    ) {
      analytics.workflowAbandoned(run.workflow, "stopped", run.lastStepId);
      run = null;
    }
    if (
      key &&
      state.version !== null &&
      !finished &&
      state.status !== "idle" &&
      (run === null || run.key !== key)
    ) {
      run = {
        key,
        workflow: {
          workflowId: state.workflowId as string,
          workflowVersion: state.version,
        },
        startedAt: now(),
        lastStepId: undefined,
      };
      analytics.workflowStarted(run.workflow, "guide");
    }
    if (!run || key !== run.key) return;
    if (state.step && state.step.id !== run.lastStepId) {
      run.lastStepId = state.step.id;
      analytics.workflowStepReached(
        run.workflow,
        state.step.id,
        state.completedStepIds.length,
      );
    }
    if (state.status === "completed") {
      analytics.workflowCompleted(
        run.workflow,
        Math.max(0, now() - run.startedAt),
      );
      run = null;
    } else {
      const reason =
        state.status === "stopped" && state.failure?.code === "navigated-away"
          ? "navigated-away"
          : ABANDONED[state.status];
      if (reason) {
        analytics.workflowAbandoned(run.workflow, reason, run.lastStepId);
        run = null;
      }
    }
  };
  return guide.subscribe(observe);
}
