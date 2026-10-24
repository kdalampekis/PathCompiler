import {
  type GuideState,
  type ProductHelpResult,
  useGuideRuntime,
  useProductHelp,
  useWorkflow,
  useWorkflowProgress,
  type WorkflowHelpResult,
} from "@pathcompiler/react";
import { type FormEvent, useEffect, useId, useState } from "react";

/**
 * Optional convenience components built only from public @pathcompiler/react
 * hooks, so each can be replaced by an application's own. Theme them with
 * class names or these CSS custom properties: --pc-accent, --pc-surface,
 * --pc-text, --pc-radius, --pc-z-index.
 */
export const defaultLabels = {
  startGuide: "Show me",
  steps: "Steps",
  chooseWorkflow: "Which of these did you mean?",
  unsupported: "No approved guide matches that request yet.",
  unavailable: "A matching guide exists but is not available to you here.",
  loading: "Loading…",
  loadFailed: "This guide could not be loaded.",
  search: "Search guides",
  searchButton: "Search",
  results: (count: number) =>
    count === 1 ? "1 guide found" : `${count} guides found`,
  done: "done",
  current: "current step",
  guide: "Guide",
  stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
  pause: "Pause",
  resume: "Resume",
  stop: "Stop guide",
  next: "Next",
  dismiss: "Dismiss",
  targetMissing:
    "This control isn't visible right now. Follow the instruction below, or check that you're on the right page.",
  waitingRoute: (route: string) => `Open ${route} to start this guide.`,
  waitingCompletion: "Finish the last step to complete this guide.",
  completed: "Guide complete.",
  stopped: "Guide stopped.",
  timedOut: "The guide stopped after waiting too long.",
  failed: "The guide could not start.",
  continueWith: (target: string | null) =>
    target ? `Continue with ${target}` : "Continue",
};
export type Labels = typeof defaultLabels;
type Common = { className?: string; labels?: Partial<Labels> };
const labelsOf = (labels?: Partial<Labels>): Labels => ({
  ...defaultLabels,
  ...labels,
});

export type ProductHelpCardProps = Common & {
  result: ProductHelpResult;
  /** Called with a workflow ID when the user picks an ambiguous option. */
  onSelect?: (workflowId: string) => void;
  /** Defaults to starting the guide runtime. */
  onStartGuide?: (workflowId: string) => void;
};

export function ProductHelpCard(props: ProductHelpCardProps) {
  const text = labelsOf(props.labels);
  const headingId = useId();
  const className = cx("pathcompiler-help-card", props.className);
  const { result } = props;
  if (result.type === "unsupported")
    return (
      <section className={className} role="status">
        <p>
          {result.reason === "not_available_for_context"
            ? text.unavailable
            : text.unsupported}
        </p>
      </section>
    );
  if (result.type === "ambiguous")
    return (
      <section className={className} aria-labelledby={headingId}>
        <h2 id={headingId}>{text.chooseWorkflow}</h2>
        <ul>
          {result.candidates.map((candidate) => (
            <li key={candidate.workflowId}>
              <button
                type="button"
                onClick={() => props.onSelect?.(candidate.workflowId)}
              >
                {candidate.title}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <WorkflowCard
      className={className}
      headingId={headingId}
      text={text}
      result={result}
      {...(props.onStartGuide ? { onStartGuide: props.onStartGuide } : {})}
    />
  );
}

function WorkflowCard(props: {
  className: string;
  headingId: string;
  text: Labels;
  result: WorkflowHelpResult;
  onStartGuide?: (workflowId: string) => void;
}) {
  const { result } = props;
  const guide = useGuideRuntime();
  const [error, setError] = useState<string | null>(null);
  const start = () => {
    setError(null);
    if (props.onStartGuide) return props.onStartGuide(result.workflowId);
    guide
      .start(result.workflowId, {
        revision: result.revision,
        version: result.workflowVersion,
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  };
  // Runtime Result v1 carries the steps; no second request is needed.
  return (
    <section className={props.className} aria-labelledby={props.headingId}>
      <h2 id={props.headingId}>{result.content.title}</h2>
      {result.content.summary && <p>{result.content.summary}</p>}
      <ol aria-label={props.text.steps}>
        {result.content.steps.map((step) => (
          <li key={step.id}>{step.text}</li>
        ))}
      </ol>
      {result.capabilities.guide && (
        <button type="button" onClick={start}>
          {props.text.startGuide}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export type WorkflowChecklistProps = Common & { workflowId: string };

/** Ordered steps, marked done/current while this workflow's guide runs. */
export function WorkflowChecklist(props: WorkflowChecklistProps) {
  const text = labelsOf(props.labels);
  const details = useWorkflow(props.workflowId);
  const progress = useWorkflowProgress();
  const guide = useGuideRuntime();
  const className = cx("pathcompiler-checklist", props.className);
  if (details.status === "error")
    return (
      <p className={className} role="alert">
        {text.loadFailed}
      </p>
    );
  if (details.status !== "success")
    return (
      <p className={className} role="status">
        {text.loading}
      </p>
    );
  const tracking = progress.workflowId === props.workflowId;
  const done = new Set(tracking ? guide.state.completedStepIds : []);
  return (
    <ol className={className} aria-label={details.data.title}>
      {details.data.steps.map((step) => {
        const current = tracking && progress.step?.id === step.id;
        const finished = done.has(step.id);
        return (
          <li
            key={step.id}
            data-state={finished ? "done" : current ? "current" : "pending"}
            aria-current={current ? "step" : undefined}
          >
            {step.text}
            {finished && (
              <span className="pathcompiler-step-state">{` (${text.done})`}</span>
            )}
            {current && (
              <span className="pathcompiler-step-state">{` (${text.current})`}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export type WorkflowSearchProps = Common & {
  onSelect: (workflowId: string) => void;
};

/** Search form; resolves on submit so typing does not issue a request per keystroke. */
export function WorkflowSearch(props: WorkflowSearchProps) {
  const text = labelsOf(props.labels);
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const help = useProductHelp(query);
  const options =
    help.status !== "success"
      ? []
      : help.data.type === "workflow_help"
        ? [{ workflowId: help.data.workflowId, title: help.data.content.title }]
        : help.data.type === "ambiguous"
          ? help.data.candidates
          : [];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setQuery(draft);
  };
  return (
    <search className={cx("pathcompiler-search", props.className)}>
      <form onSubmit={submit}>
        <label htmlFor={inputId}>{text.search}</label>
        <input
          id={inputId}
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit">{text.searchButton}</button>
      </form>
      <p role="status" aria-live="polite">
        {help.status === "loading"
          ? text.loading
          : help.status === "success"
            ? text.results(options.length)
            : ""}
      </p>
      {options.length > 0 && (
        <ul>
          {options.map((option) => (
            <li key={option.workflowId}>
              <button
                type="button"
                onClick={() => props.onSelect(option.workflowId)}
              >
                {option.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </search>
  );
}

export type GuideOverlayProps = Common & {
  /** Semantic target attribute used to find the highlighted element. */
  attribute?: string;
};

type Box = { top: number; left: number; width: number; height: number };

/** Non-modal guide panel plus a pointer-transparent highlight around the current target. */
export function GuideOverlay(props: GuideOverlayProps) {
  const text = labelsOf(props.labels);
  const guide = useGuideRuntime();
  const { state } = guide;
  const headingId = useId();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const box = useTargetBox(state, props.attribute ?? "data-pathcompiler");
  const runKey = `${state.workflowId}:${state.revision}`;
  if (state.status === "idle" || dismissed === runKey) return null;
  const finished = ["completed", "stopped", "timed-out", "failed"].includes(
    state.status,
  );
  const position = state.completedStepIds.length + (state.step ? 1 : 0);
  const message = statusMessage(state, text);
  const manual =
    state.step?.action === "explain" || state.step?.action === "wait";
  return (
    <>
      {box && !finished && (
        <div
          aria-hidden="true"
          className="pathcompiler-highlight"
          style={{
            position: "fixed",
            top: box.top - 4,
            left: box.left - 4,
            width: box.width + 8,
            height: box.height + 8,
            border: "2px solid var(--pc-accent, #2563eb)",
            borderRadius: "var(--pc-radius, 6px)",
            pointerEvents: "none",
            zIndex: "var(--pc-z-index, 2147483000)",
          }}
        />
      )}
      <aside
        aria-labelledby={headingId}
        className={cx("pathcompiler-guide", props.className)}
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          maxWidth: 360,
          padding: 16,
          background: "var(--pc-surface, #ffffff)",
          color: "var(--pc-text, #111827)",
          borderRadius: "var(--pc-radius, 6px)",
          boxShadow: "0 8px 24px rgb(0 0 0 / 0.18)",
          zIndex: "var(--pc-z-index, 2147483000)",
        }}
      >
        <h2 id={headingId}>{text.guide}</h2>
        {state.totalSteps > 0 && !finished && state.step && (
          <p>{text.stepOf(position, state.totalSteps)}</p>
        )}
        <div role="status" aria-live="polite">
          {message && <p>{message}</p>}
          {state.step && !finished && (
            <p>
              <strong>
                {state.step.instruction?.text ??
                  text.continueWith(state.step.target)}
              </strong>
            </p>
          )}
        </div>
        {finished ? (
          <button type="button" onClick={() => setDismissed(runKey)}>
            {text.dismiss}
          </button>
        ) : (
          <div>
            {manual && state.status !== "paused" && (
              <button type="button" onClick={guide.next}>
                {text.next}
              </button>
            )}
            {state.status === "paused" ? (
              <button type="button" onClick={guide.resume}>
                {text.resume}
              </button>
            ) : (
              <button type="button" onClick={guide.pause}>
                {text.pause}
              </button>
            )}
            <button type="button" onClick={guide.stop}>
              {text.stop}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

function statusMessage(state: GuideState, text: Labels): string | null {
  switch (state.status) {
    case "target-missing":
      return text.targetMissing;
    case "waiting-route":
      return state.expectedRoute
        ? text.waitingRoute(state.expectedRoute)
        : null;
    case "awaiting-completion":
      return text.waitingCompletion;
    case "completed":
      return text.completed;
    case "stopped":
      return text.stopped;
    case "timed-out":
      return text.timedOut;
    case "failed":
      return state.failure?.message ?? text.failed;
    default:
      return null;
  }
}

function useTargetBox(state: GuideState, attribute: string): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  const target = state.target?.matches === "one" ? state.target.id : null;
  useEffect(() => {
    if (!target) {
      setBox(null);
      return;
    }
    const measure = () => {
      const element = [...document.querySelectorAll(`[${attribute}]`)].find(
        (item) => item.getAttribute(attribute) === target,
      );
      const rect = element?.getBoundingClientRect();
      setBox(
        rect
          ? {
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            }
          : null,
      );
    };
    measure();
    window.addEventListener("scroll", measure, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
    };
  }, [target, attribute]);
  return box;
}

function cx(...names: (string | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
