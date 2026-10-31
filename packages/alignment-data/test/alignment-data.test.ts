import { appendFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ActionRequest,
  createActionGate,
  evaluateGate,
  guardTool,
  type LabeledAction,
} from "@pathcompiler/agent-gate";
import {
  extractBehavior,
  readSourceFiles,
} from "@pathcompiler/behavior-extraction";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildDatasets,
  fileRecorder,
  memoryRecorder,
  readFeedback,
  recordGateDecisions,
} from "../src/index.js";

const root = fileURLToPath(
  new URL("../../../fixtures/refunds/", import.meta.url),
);
const files = await readSourceFiles(root, ["variants"]);
const { spec, specHash } = extractBehavior(files, {
  bindings: {
    payment: "payments",
    request: "refund_requests",
    createRefund: "refund",
  },
});
const gate = createActionGate(spec);
type Args = { amount: number; approved: boolean };
const toRequest = (args: Args): ActionRequest => ({
  operation: "refund",
  inputs: {
    payment_id: 1,
    amount: args.amount,
    manager_approval: args.approved,
  },
  context: { "actor.role": "support_agent", "actor.id": "a1" },
  state: { "payments.original_amount": 10000, "payments.refunded_amount": 0 },
});

async function agentSession() {
  const recorder = memoryRecorder({
    now: (() => {
      let t = 0;
      return () => new Date(Date.UTC(2026, 9, 30, 12, 0, t++));
    })(),
  });
  const tool = guardTool(
    gate,
    async (args: Args) => ({ refunded: args.amount }),
    {
      toRequest,
      onDecision: (decision, args) => {
        void recordGateDecisions(recorder, toRequest, {
          agent: "support-bot",
          session: "s1",
          specHash,
        })(decision, args);
      },
    },
  );
  await tool({ amount: 6000, approved: false }); // blocked
  await tool({ amount: 6000, approved: true }); // the corrected attempt
  await tool({ amount: 200, approved: false }); // an unrelated safe attempt
  await new Promise((resolve) => setTimeout(resolve, 10));
  return recorder;
}

describe("feedback capture and datasets", () => {
  it("turns a block and the retry that followed into a preference pair with the reason", async () => {
    const recorder = await agentSession();
    expect(recorder.events.map((item) => item.verdict).sort()).toEqual([
      "block",
      "pass",
      "pass",
    ]);
    const build = buildDatasets(recorder.events, { includePayloads: true });
    expect(build.counts).toMatchObject({
      preference: 1,
      sft: 2,
      reward: 3,
      eval: 3,
    });
    const [pair] =
      build.files["preference.jsonl"]
        ?.trim()
        .split("\n")
        .map((line) => JSON.parse(line)) ?? [];
    expect(pair.operation).toBe("refund");
    expect(pair.rejected.request.inputs.manager_approval).toBe(false);
    expect(pair.chosen.request.inputs.manager_approval).toBe(true);
    expect(pair.because[0]).toMatchObject({
      rule: "refunds.manager_approval_over_limit",
      humanBacked: true,
    });
    const rewards = build.files["reward.jsonl"]
      ?.trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rewards?.map((item) => item.reward).sort()).toEqual([0, 1, 1]);
    expect(
      rewards?.every((item) => item.rewardSource === "pathcompiler-verifier"),
    ).toBe(true);
    const retry = build.files["sft.jsonl"]
      ?.trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((item) => item.afterCorrection);
    expect(retry.afterCorrection[0].rule).toBe(
      "refunds.manager_approval_over_limit",
    );
  });

  it("exports eval cases the gate evaluation can run", async () => {
    const recorder = await agentSession();
    const build = buildDatasets(recorder.events, {
      includePayloads: true,
      formats: ["eval"],
    });
    const cases = (
      JSON.parse(build.files["eval-cases.json"] as string) as {
        cases: LabeledAction[];
      }
    ).cases;
    const result = evaluateGate(gate, cases);
    expect(result.unsafe).toBe(1);
    expect(result.safe).toBe(2);
    expect(result.falseBlocks).toEqual([]);
    expect(result.rightReason).toBe(1);
  });

  it("leaves content out unless asked and says so on the card", async () => {
    const recorder = await agentSession();
    const build = buildDatasets(recorder.events);
    expect(build.files["preference.jsonl"]).not.toContain("6000");
    expect(build.files["preference.jsonl"]).not.toContain("explanation");
    expect(build.files["reward.jsonl"]).not.toContain("6000");
    expect(build.files["eval-cases.json"]).toBeUndefined();
    expect(build.card).toContain("not included (structure only)");
    expect(build.card).toContain("No\nmodel was trained");
    expect(
      buildDatasets(recorder.events, { includePayloads: true }).card,
    ).toContain("included");
  });

  it("uses an explicit correction reported by the agent", () => {
    const recorder = memoryRecorder();
    void (async () => {
      const blocked = await recorder.record({
        kind: "output_check",
        agent: "a",
        verdict: "block",
        subject: { text: "We guarantee a refund." },
        checks: [{ rule: "policy.no_guarantees", status: "violated" }],
      });
      await recorder.record({
        kind: "outcome",
        agent: "a",
        verdict: "corrected",
        relatesTo: blocked.id,
        subject: { text: "Refunds are subject to review." },
      });
    })();
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        const build = buildDatasets(recorder.events, {
          includePayloads: true,
          formats: ["preference"],
        });
        expect(build.counts.preference).toBe(1);
        expect(build.files["preference.jsonl"]).toContain(
          "Refunds are subject to review.",
        );
        resolve();
      }, 10),
    );
  });

  it("pairs an explicit correction once, whatever order same-millisecond events sort in", async () => {
    const fixed = new Date(Date.UTC(2026, 9, 30, 12));
    for (let run = 0; run < 20; run += 1) {
      const recorder = memoryRecorder({ now: () => fixed });
      const blocked = await recorder.record({
        kind: "output_check",
        agent: "a",
        session: `s${run}`,
        verdict: "block",
        subject: { text: "no" },
      });
      await recorder.record({
        kind: "output_check",
        agent: "a",
        session: `s${run}`,
        verdict: "pass",
        subject: { text: "retry" },
      });
      await recorder.record({
        kind: "outcome",
        agent: "a",
        session: `s${run}`,
        verdict: "corrected",
        relatesTo: blocked.id,
        subject: { text: "the correction" },
      });
      const build = buildDatasets(recorder.events, {
        includePayloads: true,
        formats: ["preference"],
      });
      expect(build.counts.preference).toBe(1);
      expect(build.files["preference.jsonl"]).toContain("the correction");
    }
  });

  it("redacts secrets before anything is written and survives a damaged line", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-fb-"));
    try {
      const recorder = fileRecorder(directory);
      await recorder.record({
        kind: "output_check",
        verdict: "pass",
        subject: { text: "token = 'sk-ant-abcdefghijklmnopqrstuvwxyz'" },
      });
      await appendFile(recorder.file, "not json\n");
      const { events, invalid } = await readFeedback(directory);
      expect(invalid).toBe(1);
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain("sk-ant-abc");
      expect(JSON.stringify(events)).toContain("[redacted]");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

afterAll(() => undefined);
