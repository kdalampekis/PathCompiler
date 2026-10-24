import type { ProductRuntimeEvent } from "@pathcompiler/observability-core";
import { wilsonInterval } from "./transition-model.js";

/**
 * Release behavior diff (O12, reasoning spec §158): what changed in observed
 * goal reach between two releases, set against what changed formally (R11
 * semantic diff between their commits). Changes are classified, never
 * judged: an unexplained change is a question, not a bug report.
 */
export type FormalGoalChange = { goal: string; direction: "added" | "removed" };
export type ReleaseGoalComparison = {
  goal: string;
  base: ReleaseGoalSample;
  head: ReleaseGoalSample;
  /** `up`/`down` only when the 95% intervals do not overlap. */
  observed: "up" | "down" | "no-change" | "insufficient-data";
  /** `changed`: reachability was both added and removed (applicability shifted). */
  formal: "added" | "removed" | "changed" | "no-change" | "not-compared";
  class:
    | "expected-change"
    | "unexplained-behavior-change"
    | "formal-change-not-observed"
    | "stable"
    | "insufficient-data";
};
export type ReleaseGoalSample = {
  sessions: number;
  reaching: number;
  share: number;
  interval: [number, number];
};
export type ReleaseBehaviorDiff = {
  schemaVersion: 1;
  meaning: "hypothesis";
  baseRelease: string;
  headRelease: string;
  minSessions: number;
  sessions: { base: number; head: number };
  goals: ReleaseGoalComparison[];
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round = (value: number) => Math.round(value * 10_000) / 10_000;

export function compareReleaseBehavior(
  events: readonly ProductRuntimeEvent[],
  baseRelease: string,
  headRelease: string,
  options: {
    /** From R11 between the releases' commits; omit to compare behavior only. */
    formalChanges?: FormalGoalChange[];
    /** Sessions each release needs before a change is called. Default 30. */
    minSessions?: number;
  } = {},
): ReleaseBehaviorDiff {
  const minSessions = options.minSessions ?? 30;
  // Sessions per release, and the goals each reached.
  const sessions = new Map<
    string,
    { release: string | undefined; goals: Set<string> }
  >();
  for (const event of events) {
    const key = `${event.projectId}\u0000${event.sessionId}`;
    const entry = sessions.get(key) ?? {
      release: event.release,
      goals: new Set<string>(),
    };
    entry.release ??= event.release;
    if (event.type === "goal.reached") entry.goals.add(event.goalId);
    sessions.set(key, entry);
  }
  const of = (release: string) =>
    [...sessions.values()].filter((entry) => entry.release === release);
  const base = of(baseRelease);
  const head = of(headRelease);
  const formal = new Map<string, "added" | "removed" | "changed">();
  for (const change of options.formalChanges ?? []) {
    const known = formal.get(change.goal);
    formal.set(
      change.goal,
      known && known !== change.direction ? "changed" : change.direction,
    );
  }
  const goals = [
    ...new Set([
      ...[...base, ...head].flatMap((entry) => [...entry.goals]),
      ...formal.keys(),
    ]),
  ].sort(compare);
  const sample = (list: typeof base, goal: string): ReleaseGoalSample => {
    const reaching = list.filter((entry) => entry.goals.has(goal)).length;
    return {
      sessions: list.length,
      reaching,
      share: list.length === 0 ? 0 : round(reaching / list.length),
      interval: wilsonInterval(reaching, list.length),
    };
  };
  return {
    schemaVersion: 1,
    meaning: "hypothesis",
    baseRelease,
    headRelease,
    minSessions,
    sessions: { base: base.length, head: head.length },
    goals: goals.map((goal): ReleaseGoalComparison => {
      const before = sample(base, goal);
      const after = sample(head, goal);
      const enough =
        before.sessions >= minSessions && after.sessions >= minSessions;
      const observed: ReleaseGoalComparison["observed"] = !enough
        ? "insufficient-data"
        : after.interval[0] > before.interval[1]
          ? "up"
          : after.interval[1] < before.interval[0]
            ? "down"
            : "no-change";
      const formalChange: ReleaseGoalComparison["formal"] =
        options.formalChanges === undefined
          ? "not-compared"
          : (formal.get(goal) ?? "no-change");
      const changedFormally =
        formalChange === "added" ||
        formalChange === "removed" ||
        formalChange === "changed";
      const matches =
        (formalChange === "added" && observed === "up") ||
        (formalChange === "removed" && observed === "down") ||
        (formalChange === "changed" &&
          (observed === "up" || observed === "down"));
      return {
        goal,
        base: before,
        head: after,
        observed,
        formal: formalChange,
        class:
          observed === "insufficient-data"
            ? "insufficient-data"
            : matches
              ? "expected-change"
              : observed === "up" || observed === "down"
                ? "unexplained-behavior-change"
                : changedFormally
                  ? "formal-change-not-observed"
                  : "stable",
      };
    }),
  };
}
