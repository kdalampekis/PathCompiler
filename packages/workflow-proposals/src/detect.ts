import { CapabilitySchema } from "@pathcompiler/capability-engine";
import { GraphDeltaSchema } from "@pathcompiler/graph-delta";
import { WorkflowCandidateSchema } from "@pathcompiler/workflow-discovery";
import {
  ApprovedWorkflowSchema,
  RejectedWorkflowSchema,
} from "@pathcompiler/workflow-review";
import { z } from "zod";

/** Weights sum to 1; confidence is rule strength, not probability. */
const SIGNALS = {
  "new-user-action": 0.3,
  "new-write-api": 0.25,
  "new-playwright-flow": 0.2,
  "new-route-or-dialog": 0.15,
  "commit-title": 0.1,
} as const;
const SignalSchema = z.enum(
  Object.keys(SIGNALS) as [keyof typeof SIGNALS, ...(keyof typeof SIGNALS)[]],
);
export const NewWorkflowDetectionSchema = z.strictObject({
  capabilityId: z.string(),
  title: z.string(),
  /**
   * `new-candidate`: two or more signals and a test-backed candidate exists.
   * `needs-evidence`: two or more signals but no supported test flow yet.
   * `insufficient-evidence`: a single signal; no candidate is proposed.
   */
  status: z.enum(["new-candidate", "needs-evidence", "insufficient-evidence"]),
  confidence: z.number().min(0).max(1),
  confidenceMeaning: z.literal("rule-strength-not-probability"),
  signals: z.array(
    z.strictObject({
      signal: SignalSchema,
      nodeIds: z.array(z.string()),
      detail: z.string(),
    }),
  ),
  candidate: WorkflowCandidateSchema.nullable(),
});
export const NewWorkflowReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  base: z.strictObject({ commit: z.string() }),
  head: z.strictObject({ commit: z.string() }),
  detections: z.array(NewWorkflowDetectionSchema),
});
export type NewWorkflowDetection = z.infer<typeof NewWorkflowDetectionSchema>;
export type NewWorkflowReport = z.infer<typeof NewWorkflowReportSchema>;

export type DetectionInput = {
  delta: unknown;
  /** Capabilities discovered at the base and head commits. */
  baseCapabilities: readonly unknown[];
  headCapabilities: readonly unknown[];
  /** Workflow candidates discovered at the head commit. */
  candidates: readonly unknown[];
  approved: readonly unknown[];
  rejected?: readonly unknown[];
  commitSubjects?: string[];
};

const WRITE = /^api:(POST|PUT|PATCH|DELETE):/;

/**
 * Pure: capabilities new at head with no approved or rejected workflow, scored
 * from independent signals. One signal alone never proposes a candidate.
 */
export function detectNewWorkflows(input: DetectionInput): NewWorkflowReport {
  const delta = GraphDeltaSchema.parse(input.delta);
  const before = new Set(
    input.baseCapabilities.map((item) => CapabilitySchema.parse(item).id),
  );
  const reviewed = [
    ...input.approved.map(
      (item) => ApprovedWorkflowSchema.parse(item).workflow,
    ),
    ...(input.rejected ?? []).map(
      (item) => RejectedWorkflowSchema.parse(item).workflow,
    ),
  ];
  const candidates = input.candidates.map((item) =>
    WorkflowCandidateSchema.parse(item),
  );
  const added = new Map(delta.addedNodes.map((node) => [node.id, node]));
  const subjects = (input.commitSubjects ?? []).map((subject) =>
    subject.toLowerCase(),
  );
  const detections = input.headCapabilities
    .map((item) => CapabilitySchema.parse(item))
    .filter(
      (capability) =>
        !before.has(capability.id) &&
        !reviewed.some(
          (workflow) =>
            workflow.id === capability.id ||
            (workflow.domain === capability.domain &&
              workflow.intent.action === capability.verb &&
              workflow.intent.entity === capability.entity),
        ),
    )
    .map((capability): NewWorkflowDetection => {
      const candidate =
        candidates.find((item) => item.capabilityId === capability.id) ?? null;
      const evidence = new Set([
        ...capability.sourceNodeIds,
        ...capability.evidenceNodeIds,
        ...capability.routeIds,
        ...capability.apiEvidence.map((item) => item.nodeId),
      ]);
      const addedOf = (test: (id: string, type: string) => boolean) =>
        [...evidence]
          .filter((id) => {
            const node = added.get(id);
            return node !== undefined && test(id, node.type);
          })
          .sort();
      const signals: NewWorkflowDetection["signals"] = [];
      const push = (
        signal: keyof typeof SIGNALS,
        nodeIds: string[],
        detail: string,
      ) => {
        if (nodeIds.length || signal === "commit-title")
          signals.push({ signal, nodeIds, detail });
      };
      push(
        "new-user-action",
        addedOf((_, type) => type === "UIAction"),
        "A user-facing action for this capability was added.",
      );
      // Also follow new CALLS_API edges from functions of the capability's
      // components (e.g. `Plans.duplicate`); API association can be coarse.
      const components = capability.sourceNodeIds
        .filter((id) => id.startsWith("component:"))
        .map((id) => `symbol:${id.slice("component:".length)}`);
      const calledApis = delta.addedEdges
        .filter(
          (edge) =>
            edge.type === "CALLS_API" &&
            WRITE.test(edge.target) &&
            added.has(edge.target) &&
            components.some(
              (symbol) =>
                edge.source === symbol || edge.source.startsWith(`${symbol}.`),
            ),
        )
        .map((edge) => edge.target);
      push(
        "new-write-api",
        [
          ...new Set([
            ...addedOf((id, type) => type === "APIEndpoint" && WRITE.test(id)),
            ...calledApis,
          ]),
        ].sort(),
        "A write API used by this capability was added.",
      );
      const tests = new Set([
        ...addedOf((_, type) => type === "Test"),
        ...(candidate?.observations ?? [])
          .map((item) => item.traceId)
          .filter((id) => added.has(id)),
      ]);
      push(
        "new-playwright-flow",
        [...tests].sort(),
        "A new Playwright test exercises this capability.",
      );
      push(
        "new-route-or-dialog",
        addedOf((_, type) => type === "Route" || type === "Component"),
        "A new route or component (for example a dialog) supports this capability.",
      );
      const words = [capability.verb, capability.entity].map((word) =>
        word.toLowerCase(),
      );
      if (
        subjects.some((subject) =>
          words.every((word) => subject.includes(word)),
        )
      )
        push(
          "commit-title",
          [],
          `A commit subject in the range names "${words.join(" ")}".`,
        );
      const confidence =
        Math.round(
          signals.reduce((sum, item) => sum + SIGNALS[item.signal], 0) * 1000,
        ) / 1000;
      return {
        capabilityId: capability.id,
        title: capability.title,
        status:
          signals.length < 2
            ? "insufficient-evidence"
            : candidate
              ? "new-candidate"
              : "needs-evidence",
        confidence,
        confidenceMeaning: "rule-strength-not-probability",
        signals,
        candidate: signals.length < 2 ? null : candidate,
      };
    })
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        (a.capabilityId < b.capabilityId ? -1 : 1),
    );
  return NewWorkflowReportSchema.parse({
    schemaVersion: 1,
    base: delta.base,
    head: delta.head,
    detections,
  });
}
