import type { Analytics } from "@pathcompiler/analytics-sdk";
import {
  createDomEnvironment,
  createGuideRuntime,
  type ExpectedWorkflow,
  type GuideContext,
  type GuideEnvironment,
  type GuideRuntime,
  type GuideRuntimeOptions,
  type GuideState,
  idleGuideState,
} from "@pathcompiler/runtime-core";
import type {
  PathCompiler,
  ProductHelpResult,
  ResolveContext,
  WorkflowDetails,
} from "@pathcompiler/sdk-js";
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

export type {
  ExpectedWorkflow,
  GuideState,
  GuideStatus,
} from "@pathcompiler/runtime-core";
export type {
  ProductHelpResult,
  ResolveContext,
  RuntimeContext,
  WorkflowDetails,
  WorkflowHelpResult,
} from "@pathcompiler/sdk-js";

export type PathCompilerProviderProps = {
  client: PathCompiler;
  /** Current route from the application's router; enables SPA route awareness. */
  route?: string;
  /** Role, permissions and feature flags used for resolution and guide conditions. */
  context?: Omit<ResolveContext, "route">;
  /** Overrides DOM observation, e.g. for tests or non-DOM hosts. */
  environment?: GuideEnvironment;
  runtimeOptions?: Omit<GuideRuntimeOptions, "environment" | "context">;
  /**
   * Optional analytics (`@pathcompiler/analytics-sdk`). When given, the provider
   * reports route changes and activations of semantic targets; it never reads
   * input values.
   */
  analytics?: Analytics;
  /** Attribute that marks semantic targets. Default `data-pathcompiler`. */
  targetAttribute?: string;
  children?: ReactNode;
};

type ProviderValue = {
  client: PathCompiler;
  route: string | undefined;
  context: Omit<ResolveContext, "route">;
  runtime: GuideRuntime | null;
  analytics: Analytics | null;
};
const PathCompilerContext = createContext<ProviderValue | null>(null);

/**
 * Supplies the SDK client and one guide runtime. The runtime is created after
 * mount, so server rendering never touches the DOM.
 */
export function PathCompilerProvider(
  props: PathCompilerProviderProps,
): ReactNode {
  const routeRef = useRef(props.route);
  routeRef.current = props.route;
  const [runtime, setRuntime] = useState<GuideRuntime | null>(null);
  const contextKey = JSON.stringify(props.context ?? {});
  // biome-ignore lint/correctness/useExhaustiveDependencies: contextKey captures context by value.
  const context = useMemo(() => props.context ?? {}, [contextKey]);
  const { environment, runtimeOptions } = props;
  const optionsKey = JSON.stringify(runtimeOptions ?? {});
  // biome-ignore lint/correctness/useExhaustiveDependencies: recreate only for a new environment or option values.
  useEffect(() => {
    const created = createGuideRuntime({
      ...runtimeOptions,
      environment:
        environment ??
        createDomEnvironment({
          route: () => routeRef.current ?? window.location.pathname,
        }),
      context: guideContext(context),
    });
    setRuntime(created);
    return () => {
      created.dispose();
      setRuntime(null);
    };
  }, [environment, optionsKey]);
  useEffect(() => {
    runtime?.setContext(guideContext(context));
  }, [runtime, context]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read targets whenever the router reports a new route.
  useEffect(() => {
    runtime?.refresh();
  }, [runtime, props.route]);
  const analytics = props.analytics ?? null;
  useEffect(() => {
    analytics?.setContext({
      ...(props.route === undefined ? {} : { route: props.route }),
      ...(context.role === undefined ? {} : { role: context.role }),
      ...(context.locale === undefined ? {} : { locale: context.locale }),
    });
  }, [analytics, props.route, context]);
  const previousRoute = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!analytics || props.route === undefined) return;
    if (previousRoute.current === props.route) return;
    analytics.routeChanged(props.route, previousRoute.current);
    previousRoute.current = props.route;
  }, [analytics, props.route]);
  const attribute = props.targetAttribute ?? "data-pathcompiler";
  useEffect(() => {
    if (!analytics || typeof document === "undefined") return;
    const report = (event: Event) => {
      const origin = event.target;
      if (!(origin instanceof Element)) return;
      const element = origin.closest(`[${attribute}]`);
      const target = element?.getAttribute(attribute);
      if (!element || !target) return;
      const tag = element.tagName.toLowerCase();
      if (event.type === "submit") analytics.targetActivated(target, "submit");
      else if (event.type === "change")
        analytics.targetActivated(
          target,
          tag === "select" ? "select" : "input",
        );
      // Field clicks are focus, not activation; forms report on submit.
      else if (!["input", "select", "textarea", "form"].includes(tag))
        analytics.targetActivated(target, "click");
    };
    const types = ["click", "change", "submit"] as const;
    for (const type of types) document.addEventListener(type, report, true);
    return () => {
      for (const type of types)
        document.removeEventListener(type, report, true);
    };
  }, [analytics, attribute]);
  const value = useMemo<ProviderValue>(
    () => ({
      client: props.client,
      route: props.route,
      context,
      runtime,
      analytics,
    }),
    [props.client, props.route, context, runtime, analytics],
  );
  return createElement(PathCompilerContext.Provider, { value }, props.children);
}

function guideContext(context: Omit<ResolveContext, "route">): GuideContext {
  return {
    ...(context.permissions === undefined
      ? {}
      : { permissions: context.permissions }),
    ...(context.featureFlags === undefined
      ? {}
      : { featureFlags: context.featureFlags }),
  };
}

function usePathCompiler(): ProviderValue {
  const value = useContext(PathCompilerContext);
  if (!value)
    throw new Error(
      "PathCompiler hooks must be used inside <PathCompilerProvider>.",
    );
  return value;
}

export type AsyncResult<T> =
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: null; error: null }
  | { status: "success"; data: T; error: null }
  | { status: "error"; data: null; error: Error };
const idle = { status: "idle", data: null, error: null } as const;
const loading = { status: "loading", data: null, error: null } as const;

function useAsync<T>(
  key: string | null,
  load: () => Promise<T>,
): AsyncResult<T> {
  const [result, setResult] = useState<AsyncResult<T> & { key?: string }>(idle);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key identifies the request.
  useEffect(() => {
    if (key === null) {
      setResult(idle);
      return;
    }
    let current = true;
    setResult({ ...loading, key });
    load().then(
      (data) => {
        if (current) setResult({ status: "success", data, error: null, key });
      },
      (error: unknown) => {
        if (current)
          setResult({
            status: "error",
            data: null,
            error: error instanceof Error ? error : new Error(String(error)),
            key,
          });
      },
    );
    return () => {
      current = false;
    };
  }, [key]);
  if (key === null) return idle;
  if (result.key !== key) return loading;
  const { key: _key, ...rest } = result;
  return rest as AsyncResult<T>;
}

/** Resolves a help request; blank queries stay idle and stale answers are dropped. */
export function useProductHelp(
  query: string,
  options: { context?: ResolveContext } = {},
): AsyncResult<ProductHelpResult> {
  const { client, route, context } = usePathCompiler();
  const request = {
    query,
    context: {
      ...(route === undefined ? {} : { route }),
      ...context,
      ...options.context,
    },
  };
  const key = query.trim() ? JSON.stringify(request) : null;
  return useAsync(key, () => client.resolve(request));
}

/** The provider's analytics instance, or `null` when analytics is not configured. */
export function useAnalytics(): Analytics | null {
  return usePathCompiler().analytics;
}

export function useWorkflow(id: string | null): AsyncResult<WorkflowDetails> {
  const { client } = usePathCompiler();
  return useAsync(id, () => client.workflows.get(id ?? ""));
}

function useGuideState(runtime: GuideRuntime | null): GuideState {
  const subscribe = useCallback(
    (listener: () => void) => runtime?.subscribe(listener) ?? (() => {}),
    [runtime],
  );
  return useSyncExternalStore(
    subscribe,
    () => runtime?.getState() ?? idleGuideState,
    () => idleGuideState,
  );
}

export type GuideControls = {
  state: GuideState;
  /**
   * Loads the runtime manifest and starts the guide; rejects if loading fails.
   * Pass the resolved revision/version to fail with `manifest-mismatch` on stale manifests.
   */
  start(workflowId: string, expected?: ExpectedWorkflow): Promise<GuideState>;
  pause(): void;
  resume(): void;
  stop(): void;
  next(): void;
  emit(event: string): void;
};

export function useGuideRuntime(): GuideControls {
  const { client, runtime } = usePathCompiler();
  const state = useGuideState(runtime);
  return useMemo(
    () => ({
      state,
      async start(workflowId, expected) {
        if (!runtime)
          throw new Error(
            "The guide runtime is not ready yet. Start guides after the provider has mounted.",
          );
        const manifest = await client.workflows.getRuntimeManifest(workflowId);
        return runtime.start(manifest, expected);
      },
      pause: () => runtime?.pause(),
      resume: () => runtime?.resume(),
      stop: () => runtime?.stop(),
      next: () => runtime?.next(),
      emit: (event) => runtime?.emit(event),
    }),
    [client, runtime, state],
  );
}

export type WorkflowProgress = {
  workflowId: string | null;
  status: GuideState["status"];
  completed: number;
  total: number;
  /** 0–1; 1 only when the guide has completed. */
  fraction: number;
  step: GuideState["step"];
};

export function useWorkflowProgress(): WorkflowProgress {
  const { runtime } = usePathCompiler();
  const state = useGuideState(runtime);
  const completed = state.completedStepIds.length;
  return {
    workflowId: state.workflowId,
    status: state.status,
    completed,
    total: state.totalSteps,
    fraction:
      state.status === "completed"
        ? 1
        : state.totalSteps
          ? Math.min(completed / state.totalSteps, 0.99)
          : 0,
    step: state.step,
  };
}
