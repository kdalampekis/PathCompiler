import {
  type RuntimeWorkflow,
  RuntimeWorkflowSchema,
} from "@pathcompiler/workflow-compiler/schema";
import type {
  WorkflowCondition,
  WorkflowTerminalCondition,
} from "@pathcompiler/workflow-ir";

export type { RuntimeWorkflow } from "@pathcompiler/workflow-compiler/schema";
export { createDomEnvironment, type DomEnvironmentOptions } from "./dom.js";

/** What the runtime can observe about one rendered semantic target. */
export type TargetSnapshot = {
  visible: boolean;
  enabled: boolean;
  checked: boolean | null;
  text: string;
};
export type GuideSignal =
  | { type: "change" }
  | {
      type: "interaction";
      target: string;
      kind: "click" | "input" | "change";
    };
/** Framework-independent view of the host application. */
export interface GuideEnvironment {
  route(): string;
  query(target: string): TargetSnapshot[];
  subscribe(listener: (signal: GuideSignal) => void): () => void;
}
export type GuideClock = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};
export type GuideContext = {
  permissions?: string[];
  featureFlags?: Record<string, boolean>;
};

export type GuideStatus =
  | "idle"
  | "waiting-route"
  | "active"
  | "target-missing"
  | "awaiting-completion"
  | "paused"
  | "completed"
  | "stopped"
  | "timed-out"
  | "failed";
export type GuideStep = {
  id: string;
  target: string | null;
  action: RuntimeWorkflow["steps"][number]["action"]["type"];
  instruction: NonNullable<
    RuntimeWorkflow["steps"][number]["instruction"]
  > | null;
};
export type GuideState = {
  status: GuideStatus;
  workflowId: string | null;
  revision: string | null;
  /** Workflow version from the manifest (C1); `null` before a guide starts. */
  version: number | null;
  totalSteps: number;
  completedStepIds: string[];
  step: GuideStep | null;
  /** Rendered match for the current step's target; `null` when it has none. */
  target: { id: string; matches: "one" | "none" | "many" } | null;
  /** Entry route to open while `waiting-route`. */
  expectedRoute: string | null;
  failure: { code: string; message: string } | null;
};

export type GuideRuntimeOptions = {
  environment: GuideEnvironment;
  context?: GuideContext;
  /** Grace period before an unresolved target is reported. Default 3000 ms. */
  targetTimeoutMs?: number;
  /** Maximum time a step may wait for progress while not paused. Default 300000 ms. */
  stepTimeoutMs?: number;
  clock?: GuideClock;
};

export type ExpectedWorkflow = { revision?: string; version?: number };

export interface GuideRuntime {
  getState(): GuideState;
  subscribe(listener: (state: GuideState) => void): () => void;
  /**
   * Starts a guide. `expected` is the revision/version the caller resolved
   * (e.g. from a `workflow_help` result); a different manifest fails with
   * `manifest-mismatch` instead of guiding through stale steps.
   */
  start(workflow: unknown, expected?: ExpectedWorkflow): GuideState;
  pause(): void;
  resume(): void;
  stop(): void;
  /**
   * Advances explain/wait steps and steps expecting `explicit_next`, and
   * completes a run whose terminal condition is `explicit_next`; ignored otherwise.
   */
  next(): void;
  /** Records an application event for `event_emitted` conditions. */
  emit(event: string): void;
  /** Re-reads route and targets, for hosts whose navigation is not observable. */
  refresh(): void;
  setContext(context: GuideContext): void;
  dispose(): void;
}

/** State before any guide starts; also the server-rendering snapshot. */
export const idleGuideState: GuideState = Object.freeze({
  status: "idle",
  workflowId: null,
  revision: null,
  version: null,
  totalSteps: 0,
  completedStepIds: [],
  step: null,
  target: null,
  expectedRoute: null,
  failure: null,
}) as GuideState;
const IDLE = idleGuideState;
const FINISHED: GuideStatus[] = ["completed", "stopped", "timed-out", "failed"];
/** Interactions that count as performing each action; input commits on change. */
const INTERACTIONS: Partial<Record<string, string[]>> = {
  click: ["click"],
  input: ["change"],
  select: ["change", "input"],
};

/** Matches canonical route templates such as `/clients/[id]` or `/docs/[...slug]`. */
export function routeMatches(template: string, route: string): boolean {
  const pattern = template
    .split("/")
    .map((segment) =>
      /^\[\[?\.\.\.[^\]]+\]\]?$/.test(segment)
        ? ".+"
        : /^\[[^\]]+\]$/.test(segment)
          ? "[^/]+"
          : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  const path = route.split(/[?#]/)[0] ?? route;
  return new RegExp(`^${pattern}/?$`).test(path);
}

export function createGuideRuntime(options: GuideRuntimeOptions): GuideRuntime {
  const environment = options.environment;
  const clock: GuideClock = options.clock ?? {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const targetTimeoutMs = options.targetTimeoutMs ?? 3_000;
  const stepTimeoutMs = options.stepTimeoutMs ?? 300_000;
  let context: GuideContext = options.context ?? {};
  let state: GuideState = IDLE;
  let workflow: RuntimeWorkflow | null = null;
  let index = 0;
  let pausedFrom: GuideStatus | null = null;
  const listeners = new Set<(state: GuideState) => void>();
  // Per-step observations, reset whenever a step becomes current.
  let acted = false;
  let sawExpectedFalse = false;
  let manual = false;
  let stepRoute = "";
  let stepEvents = new Set<string>();
  let runEvents = new Set<string>();
  let targetTimer: unknown = null;
  let stepTimer: unknown = null;
  let unsubscribe: (() => void) | null = null;

  // Read through a function: callbacks mutate state, defeating TS narrowing.
  const status = (): GuideStatus => state.status;
  function publish(next: GuideState) {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    for (const listener of [...listeners]) listener(state);
  }
  function update(patch: Partial<GuideState>) {
    publish({ ...state, ...patch });
  }
  function clearTimers() {
    if (targetTimer !== null) clock.clearTimeout(targetTimer);
    if (stepTimer !== null) clock.clearTimeout(stepTimer);
    targetTimer = null;
    stepTimer = null;
  }
  function finish(status: GuideStatus, failure: GuideState["failure"] = null) {
    clearTimers();
    unsubscribe?.();
    unsubscribe = null;
    pausedFrom = null;
    update({ status, failure, target: null });
  }
  function armStepTimer() {
    if (stepTimer !== null) clock.clearTimeout(stepTimer);
    stepTimer = clock.setTimeout(() => {
      stepTimer = null;
      finish("timed-out", {
        code: "step-timeout",
        message: `No progress on ${state.step?.id ?? "completion"} within ${stepTimeoutMs} ms. Restart the guide when ready.`,
      });
    }, stepTimeoutMs);
  }

  function condition(item: WorkflowCondition, scope: "step" | "run"): boolean {
    switch (item.type) {
      case "route_matches":
        return new RegExp(item.pattern).test(environment.route());
      case "target_appears":
        return environment.query(item.target).some((target) => target.visible);
      case "element_text":
        return environment
          .query(item.target)
          .some((target) =>
            item.match === "exact"
              ? target.text === item.text
              : target.text.includes(item.text),
          );
      case "element_count":
        return environment.query(item.target).length === item.count;
      case "element_state": {
        const targets = environment.query(item.target);
        if (item.state === "hidden")
          return targets.every((target) => !target.visible);
        return targets.some((target) =>
          item.state === "visible"
            ? target.visible
            : item.state === "enabled"
              ? target.enabled
              : item.state === "disabled"
                ? !target.enabled
                : target.checked === (item.state === "checked"),
        );
      }
      case "event_emitted":
        return (scope === "step" ? stepEvents : runEvents).has(item.event);
      case "url_changed":
        return item.url === undefined
          ? environment.route() !== stepRoute
          : environment.route() === item.url;
      case "explicit_next":
        return manual;
      case "permission":
        return context.permissions?.includes(item.permission) ?? false;
      case "feature_flag":
        return context.featureFlags?.[item.flag] === item.enabled;
    }
  }
  function mentionsExplicitNext(item: WorkflowTerminalCondition): boolean {
    if ("any" in item)
      return item.any.some((part) => part.type === "explicit_next");
    if ("all" in item)
      return item.all.some((part) => part.type === "explicit_next");
    return item.type === "explicit_next";
  }
  function terminal(item: WorkflowTerminalCondition): boolean {
    if ("any" in item) return item.any.some((part) => condition(part, "run"));
    if ("all" in item) return item.all.every((part) => condition(part, "run"));
    return condition(item, "run");
  }

  function enterStep(position: number) {
    if (!workflow) return;
    const step = workflow.steps[position];
    if (!step) return;
    index = position;
    acted = false;
    manual = false;
    stepEvents = new Set();
    stepRoute = environment.route();
    sawExpectedFalse = step.expected
      ? !condition(step.expected, "step")
      : false;
    if (targetTimer !== null) clock.clearTimeout(targetTimer);
    targetTimer = null;
    update({
      status: "active",
      step: {
        id: step.id,
        target: step.target ?? null,
        action: step.action.type,
        instruction: step.instruction ?? null,
      },
      target: null,
    });
    armStepTimer();
  }

  function advance() {
    if (!workflow) return;
    const step = workflow.steps[index];
    if (!step) return;
    const completedStepIds = [...state.completedStepIds, step.id];
    const branch = step.branches?.find((item) => condition(item.when, "step"));
    const nextId = branch?.next ?? step.next;
    if (nextId === undefined) {
      update({
        completedStepIds,
        status: "awaiting-completion",
        step: null,
        target: null,
      });
      if (targetTimer !== null) clock.clearTimeout(targetTimer);
      targetTimer = null;
      armStepTimer();
      return;
    }
    const position = workflow.steps.findIndex((item) => item.id === nextId);
    update({ completedStepIds });
    enterStep(position);
  }

  function stepDone(): boolean {
    const step = workflow?.steps[index];
    if (!step) return false;
    if (step.expected?.type === "explicit_next") return manual;
    if (step.expected)
      return (
        condition(step.expected, "step") &&
        (acted || sawExpectedFalse || manual)
      );
    switch (step.action.type) {
      case "navigate":
        return routeMatches(step.action.route, environment.route());
      case "explain":
      case "wait":
        return manual;
      default:
        return acted;
    }
  }

  function evaluate(signal?: GuideSignal) {
    if (!workflow || pausedFrom !== null || FINISHED.includes(state.status))
      return;
    if (state.status === "idle") return;
    if (state.status === "waiting-route") {
      if (!onEntryRoute()) return;
      if (!preconditionsMet()) return;
      enterStep(0);
    }
    if (state.status === "awaiting-completion") {
      if (terminal(workflow.terminal)) finish("completed");
      return;
    }
    const first = workflow.steps[index];
    if (
      first &&
      signal?.type === "interaction" &&
      signal.target === first.target &&
      (
        INTERACTIONS[first.action.type] ?? ["click", "input", "change"]
      ).includes(signal.kind)
    )
      acted = true;
    // A completed step may immediately satisfy the next one; bounded for safety.
    for (let hops = 0; hops <= workflow.steps.length; hops += 1) {
      const current = workflow.steps[index];
      if (!current || (status() !== "active" && status() !== "target-missing"))
        break;
      if (current.expected && !condition(current.expected, "step"))
        sawExpectedFalse = true;
      if (!stepDone()) break;
      advance();
    }
    if (
      (status() === "active" || status() === "target-missing") &&
      leftWorkflowRoutes()
    ) {
      finish("stopped", {
        code: "navigated-away",
        message: `The page left the routes of ${workflow.id} (${environment.route()}). Restart the guide when ready.`,
      });
      return;
    }
    if (status() === "awaiting-completion") {
      if (terminal(workflow.terminal)) finish("completed");
      return;
    }
    const step = workflow.steps[index];
    if (!step) return;
    if (!step.target) return;
    const count = environment
      .query(step.target)
      .filter((target) => target.visible).length;
    const matches = count === 1 ? "one" : count === 0 ? "none" : "many";
    if (matches === "one") {
      if (targetTimer !== null) clock.clearTimeout(targetTimer);
      targetTimer = null;
      update({ status: "active", target: { id: step.target, matches } });
      return;
    }
    if (state.status === "target-missing") {
      update({ target: { id: step.target, matches } });
      return;
    }
    update({ target: { id: step.target, matches } });
    if (targetTimer === null)
      targetTimer = clock.setTimeout(() => {
        targetTimer = null;
        if (pausedFrom !== null || FINISHED.includes(state.status)) return;
        const current = workflow?.steps[index];
        if (!current?.target) return;
        const visible = environment
          .query(current.target)
          .filter((target) => target.visible).length;
        if (visible !== 1)
          update({
            status: "target-missing",
            target: {
              id: current.target,
              matches: visible === 0 ? "none" : "many",
            },
          });
      }, targetTimeoutMs);
  }

  /**
   * True when the user is on a route the workflow never mentions: neither an
   * entry, a navigation step, nor anything its conditions look for. Workflows
   * that wait for a URL change or route match are never judged by this.
   */
  function leftWorkflowRoutes(): boolean {
    if (!workflow) return false;
    const conditions = [
      ...workflow.steps.flatMap((step) =>
        step.expected ? [step.expected] : [],
      ),
      workflow.terminal,
    ];
    const mentionsRoutes = (
      item: WorkflowCondition | WorkflowTerminalCondition,
    ): boolean =>
      "all" in item
        ? item.all.some(mentionsRoutes)
        : "any" in item
          ? item.any.some(mentionsRoutes)
          : item.type === "route_matches" || item.type === "url_changed";
    if (conditions.some(mentionsRoutes)) return false;
    const known = [
      ...workflow.entrypoints.flatMap((entry) =>
        entry.route === undefined ? [] : [entry.route],
      ),
      ...workflow.steps.flatMap((step) =>
        step.action.type === "navigate" ? [step.action.route] : [],
      ),
    ];
    return (
      known.length > 0 &&
      !known.some((route) => routeMatches(route, environment.route()))
    );
  }
  function onEntryRoute(): boolean {
    if (!workflow) return false;
    const routes = workflow.entrypoints.flatMap((entry) =>
      entry.route === undefined ? [] : [entry.route],
    );
    if (
      !routes.length ||
      routes.some((route) => routeMatches(route, environment.route()))
    )
      return true;
    update({ status: "waiting-route", expectedRoute: routes[0] ?? null });
    return false;
  }
  function preconditionsMet(): boolean {
    const unmet = workflow?.preconditions.find(
      (item) => !condition(item, "run"),
    );
    if (!unmet) return true;
    finish("failed", {
      code: "precondition-unmet",
      message: `A ${unmet.type} precondition is not met in the current context. Check access and feature flags before starting this guide.`,
    });
    return false;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start(input, expected) {
      const parsed = RuntimeWorkflowSchema.safeParse(input);
      clearTimers();
      unsubscribe?.();
      unsubscribe = null;
      pausedFrom = null;
      if (!parsed.success) {
        workflow = null;
        publish({
          ...IDLE,
          status: "failed",
          failure: {
            code: "invalid-workflow",
            message:
              "Provide a runtime manifest workflow from pathcompiler build.",
          },
        });
        return state;
      }
      const mismatch =
        (expected?.revision !== undefined &&
          expected.revision !== parsed.data.revision) ||
        (expected?.version !== undefined &&
          expected.version !== parsed.data.version);
      if (mismatch) {
        workflow = null;
        publish({
          ...IDLE,
          status: "failed",
          workflowId: parsed.data.id,
          revision: parsed.data.revision,
          version: parsed.data.version,
          failure: {
            code: "manifest-mismatch",
            message:
              "This guide changed since the help answer was produced. Ask again to get the current steps.",
          },
        });
        return state;
      }
      workflow = parsed.data;
      runEvents = new Set();
      publish({
        ...IDLE,
        status: "waiting-route",
        workflowId: workflow.id,
        revision: workflow.revision,
        version: workflow.version,
        totalSteps: workflow.steps.length,
      });
      unsubscribe = environment.subscribe((signal) => evaluate(signal));
      if (onEntryRoute()) {
        update({ expectedRoute: null });
        if (preconditionsMet()) {
          enterStep(0);
          evaluate();
        }
      }
      return state;
    },
    pause() {
      if (
        pausedFrom !== null ||
        FINISHED.includes(state.status) ||
        state.status === "idle"
      )
        return;
      pausedFrom = state.status;
      clearTimers();
      update({ status: "paused" });
    },
    resume() {
      if (pausedFrom === null) return;
      const previous = pausedFrom;
      pausedFrom = null;
      update({ status: previous === "target-missing" ? "active" : previous });
      if (previous !== "waiting-route") armStepTimer();
      evaluate();
    },
    stop() {
      if (state.status === "idle" || FINISHED.includes(state.status)) return;
      finish("stopped");
    },
    next() {
      // A terminal awaiting `explicit_next` completes on next(); otherwise the
      // user would be stuck once every step is done.
      if (
        pausedFrom === null &&
        state.status === "awaiting-completion" &&
        workflow &&
        mentionsExplicitNext(workflow.terminal)
      ) {
        manual = true;
        evaluate();
        return;
      }
      const step = workflow?.steps[index];
      if (
        pausedFrom !== null ||
        !step ||
        !["active", "target-missing"].includes(state.status) ||
        !(
          step.action.type === "explain" ||
          step.action.type === "wait" ||
          step.expected?.type === "explicit_next"
        )
      )
        return;
      manual = true;
      evaluate();
    },
    emit(event) {
      stepEvents.add(event);
      runEvents.add(event);
      evaluate();
    },
    refresh: () => evaluate(),
    setContext(next) {
      context = next;
      evaluate();
    },
    dispose() {
      clearTimers();
      unsubscribe?.();
      unsubscribe = null;
      listeners.clear();
    },
  };
}
