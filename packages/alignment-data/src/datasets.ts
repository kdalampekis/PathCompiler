import type { FeedbackEvent } from "./events.js";

/**
 * Turns recorded feedback into the datasets alignment and post-training work
 * needs. Four shapes, each a by-product of using the checks:
 *
 *  - `preference`: a rejected attempt and the accepted one that followed it in
 *    the same session, with the rules that explain the difference.
 *  - `sft`: attempts that passed or that a person approved, with the
 *    correction the agent had been given when it was a retry.
 *  - `reward`: every checked attempt with a reward from the verifier or a
 *    person, and the checks behind it (verifiable, not model-judged).
 *  - `eval`: labeled actions in the format `pathcompiler agent eval` reads.
 *
 * Nothing here trains a model. By default the content of what was checked
 * (requests, answers) is left out and only structure is exported; including it
 * is an explicit choice.
 */
export type DatasetFormat = "preference" | "sft" | "reward" | "eval";
export const DATASET_FORMATS: readonly DatasetFormat[] = [
  "preference",
  "sft",
  "reward",
  "eval",
];

export type DatasetOptions = {
  formats?: readonly DatasetFormat[];
  /** Include requests, answers and summaries. Default false. */
  includePayloads?: boolean;
};
export type DatasetBuild = {
  files: Record<string, string>;
  counts: Record<DatasetFormat, number>;
  card: string;
};

const BLOCKING = new Set(["block", "fail"]);
const PASSING = new Set(["pass", "approved", "accepted"]);
const reward = (verdict: string): number | null =>
  PASSING.has(verdict)
    ? 1
    : BLOCKING.has(verdict) || verdict === "rejected"
      ? 0
      : verdict === "review"
        ? 0.5
        : null;

const lines = (items: readonly unknown[]) =>
  items.length === 0
    ? ""
    : `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;

export function buildDatasets(
  events: readonly FeedbackEvent[],
  options: DatasetOptions = {},
): DatasetBuild {
  const formats = options.formats ?? DATASET_FORMATS;
  const payloads = options.includePayloads === true;
  // Time order, and recorded order for events in the same millisecond.
  const sorted = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) =>
      a.event.at === b.event.at
        ? a.index - b.index
        : a.event.at < b.event.at
          ? -1
          : 1,
    )
    .map((item) => item.event);
  const byId = new Map(sorted.map((event) => [event.id, event]));
  const subject = (event: FeedbackEvent) =>
    payloads
      ? event.subject
      : {
          ...(event.subject.operation
            ? { operation: event.subject.operation }
            : {}),
        };
  const reasons = (event: FeedbackEvent) =>
    event.checks
      .filter((check) => check.status !== "verified")
      .map((check) => ({
        rule: check.rule,
        kind: check.kind,
        status: check.status,
        // Explanations quote the checked values, so they are content too.
        ...(payloads ? { explanation: check.explanation } : {}),
        humanBacked: check.humanBacked,
      }));

  // An explicit correction wins over an inferred retry: it names the attempt it
  // answers and carries the corrected content.
  const pairs: { rejected: FeedbackEvent; chosen: FeedbackEvent }[] = [];
  const correctedFrom = new Map<string, FeedbackEvent>();
  const explicitlyAnswered = new Set<string>();
  for (const event of sorted) {
    const rejected = event.relatesTo ? byId.get(event.relatesTo) : undefined;
    if (
      rejected &&
      BLOCKING.has(rejected.verdict) &&
      !explicitlyAnswered.has(rejected.id) &&
      (PASSING.has(event.verdict) || event.verdict === "corrected")
    ) {
      explicitlyAnswered.add(rejected.id);
      pairs.push({ rejected, chosen: event });
      correctedFrom.set(event.id, rejected);
    }
  }
  // Otherwise: a block followed, in the same session and for the same
  // operation, by an attempt that passed.
  const pending = new Map<string, FeedbackEvent>();
  const groupKey = (event: FeedbackEvent) =>
    [
      event.session ?? "",
      event.agent ?? "",
      event.subject.operation ?? "",
    ].join("|");
  for (const event of sorted) {
    if (event.kind === "human_decision" || event.kind === "outcome") continue;
    const key = groupKey(event);
    if (BLOCKING.has(event.verdict)) {
      if (!explicitlyAnswered.has(event.id)) pending.set(key, event);
    } else if (PASSING.has(event.verdict) && pending.has(key)) {
      const rejected = pending.get(key) as FeedbackEvent;
      pairs.push({ rejected, chosen: event });
      correctedFrom.set(event.id, rejected);
      pending.delete(key);
    }
  }

  const files: Record<string, string> = {};
  const counts: Record<DatasetFormat, number> = {
    preference: 0,
    sft: 0,
    reward: 0,
    eval: 0,
  };

  if (formats.includes("preference")) {
    const rows = pairs.map((pair) => ({
      id: `${pair.rejected.id}>${pair.chosen.id}`,
      operation:
        pair.chosen.subject.operation ?? pair.rejected.subject.operation,
      rejected: subject(pair.rejected),
      chosen: subject(pair.chosen),
      because: reasons(pair.rejected),
      source: {
        rejected: pair.rejected.id,
        chosen: pair.chosen.id,
        agent: pair.chosen.agent,
      },
    }));
    counts.preference = rows.length;
    files["preference.jsonl"] = lines(rows);
  }
  if (formats.includes("sft")) {
    const rows = sorted
      .filter(
        (event) =>
          event.kind !== "outcome" &&
          PASSING.has(event.verdict) &&
          (event.kind !== "human_decision" || event.verdict === "approved"),
      )
      .map((event) => ({
        id: event.id,
        kind: event.kind,
        operation: event.subject.operation,
        subject: subject(event),
        afterCorrection: correctedFrom.has(event.id)
          ? reasons(correctedFrom.get(event.id) as FeedbackEvent)
          : null,
      }));
    counts.sft = rows.length;
    files["sft.jsonl"] = lines(rows);
  }
  if (formats.includes("reward")) {
    const rows = sorted.flatMap((event) => {
      const value = reward(event.verdict);
      if (value === null || event.kind === "outcome") return [];
      return [
        {
          id: event.id,
          kind: event.kind,
          operation: event.subject.operation,
          subject: subject(event),
          reward: value,
          rewardSource:
            event.kind === "human_decision" ? "human" : "pathcompiler-verifier",
          checks: payloads
            ? event.checks
            : event.checks.map(
                ({ explanation: _explanation, ...rest }) => rest,
              ),
          specHash: event.specHash,
        },
      ];
    });
    counts.reward = rows.length;
    files["reward.jsonl"] = lines(rows);
  }
  if (formats.includes("eval") && payloads) {
    const rows = sorted.flatMap((event) => {
      if (event.kind !== "action_check" || !event.subject.request) return [];
      if (event.verdict === "pass")
        return [
          { id: event.id, label: "safe", request: event.subject.request },
        ];
      const violated = event.checks.find(
        (check) => check.status === "violated",
      );
      // A block for a missing value says nothing about whether the action was unsafe.
      if (event.verdict !== "block" || !violated) return [];
      return [
        {
          id: event.id,
          label: "unsafe",
          request: event.subject.request,
          ...(violated.rule ? { expectedRule: violated.rule } : {}),
        },
      ];
    });
    counts.eval = rows.length;
    files["eval-cases.json"] = `${JSON.stringify({ cases: rows }, null, 2)}\n`;
  }

  const card = datasetCard(sorted, counts, formats, payloads);
  files["DATASET_CARD.md"] = card;
  return { files, counts, card };
}

function datasetCard(
  events: readonly FeedbackEvent[],
  counts: Record<DatasetFormat, number>,
  formats: readonly DatasetFormat[],
  payloads: boolean,
): string {
  const tally = (pick: (event: FeedbackEvent) => string | undefined) => {
    const map = new Map<string, number>();
    for (const event of events) {
      const key = pick(event);
      if (key) map.set(key, (map.get(key) ?? 0) + 1);
    }
    return (
      [...map]
        .sort()
        .map(([key, count]) => `${key} ${count}`)
        .join(", ") || "none"
    );
  };
  const first = events[0]?.at ?? "n/a";
  const last = events[events.length - 1]?.at ?? "n/a";
  return `# Dataset card

Generated by PathCompiler from recorded agent checks and human decisions. No
model was trained or called to produce it.

## Contents

- Events: ${events.length} (${first} to ${last})
- By kind: ${tally((e) => e.kind)}
- By verdict: ${tally((e) => e.verdict)}
- Agents: ${tally((e) => e.agent)}
- Specification versions: ${tally((e) => e.specHash?.slice(0, 19))}
- Files: ${formats.map((format) => `${format} (${counts[format]})`).join(", ")}

## How the labels were made

- \`reward\` and \`eval\` labels come from deterministic checks of the
  specification (and from people for \`human_decision\`), not from a model.
- A label is only as right as the rules behind it. Rules a person approved are
  marked \`humanBacked\` in each record's checks; the others are extracted or
  proposed and may be wrong. Filter on \`humanBacked\` when you need ground truth.
- A \`preference\` pair is a block followed, in the same session and for the same
  operation, by an accepted attempt (or an explicit correction). It shows what
  changed, not that the accepted attempt is ideal.

## Privacy

- Secrets (keys, tokens, credentials) were redacted when recorded.
- Content of requests, answers and change summaries: **${payloads ? "included" : "not included (structure only)"}**.${payloads ? " Review the data for personal or customer information before sharing it; redaction covers secrets, not personal data." : " Export with --include-payloads to include it; `eval` cases need it."}

## Limits

- Events come from the agents and harnesses that were wired to record, in this
  repository, under this specification; they are not a sample of any wider
  population.
- You are responsible for having the right to use the recorded content.
`;
}
