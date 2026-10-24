import { createHash } from "node:crypto";
import {
  type CapabilityClassificationInput,
  CapabilityClassificationInputSchema,
  type CapabilityClassificationResult,
  type EvidenceSummaryInput,
  type EvidenceSummaryResult,
  parseCapabilityClassification,
  parseEvidenceSummary,
  type SemanticModel,
} from "@pathcompiler/capability-engine";
import { EvidenceBundleSchema } from "@pathcompiler/evidence";
import { WorkflowV1Schema } from "@pathcompiler/workflow-ir";
import { z } from "zod";

/**
 * Model provider boundary (CODEX spec §45–§47). Models are optional semantic
 * helpers: every request is minimal structured evidence, every response is
 * schema-validated and may cite only evidence it was given, and nothing here
 * depends on a vendor SDK. Vendor adapters (C9) implement the interface.
 */
const text = z.string().trim().min(1);
export const SynthesizeWorkflowRequestSchema = z.strictObject({
  capabilityId: text,
  title: text,
  evidence: EvidenceBundleSchema,
});
export const SynthesizeWorkflowResponseSchema = z.strictObject({
  /** A candidate only; null when the evidence is not enough. */
  workflow: WorkflowV1Schema.nullable(),
  evidenceIds: z.array(text),
  rationale: text,
});
export const ExplainImpactRequestSchema = z.strictObject({
  workflowId: text,
  severity: z.enum(["none", "low", "medium", "high"]),
  reasons: z.array(z.strictObject({ code: text, message: text })).min(1),
});
export const ExplainImpactResponseSchema = z.strictObject({
  explanation: text,
  /** Reason codes the explanation is based on; must come from the request. */
  reasonCodes: z.array(text).min(1),
});
export const GenerateAliasesRequestSchema = z.strictObject({
  workflowId: text,
  title: text,
  intent: z.strictObject({
    action: text,
    entity: text,
    qualifiers: z.array(text).optional(),
  }),
  existingAliases: z.array(text),
});
export const GenerateAliasesResponseSchema = z.strictObject({
  aliases: z.array(text.max(120)).max(20),
});
export type InferCapabilitiesRequest = CapabilityClassificationInput;
export type InferCapabilitiesResponse = CapabilityClassificationResult;
export type SynthesizeWorkflowRequest = z.infer<
  typeof SynthesizeWorkflowRequestSchema
>;
export type SynthesizeWorkflowResponse = z.infer<
  typeof SynthesizeWorkflowResponseSchema
>;
export type ExplainImpactRequest = z.infer<typeof ExplainImpactRequestSchema>;
export type ExplainImpactResponse = z.infer<typeof ExplainImpactResponseSchema>;
export type GenerateAliasesRequest = z.infer<
  typeof GenerateAliasesRequestSchema
>;
export type GenerateAliasesResponse = z.infer<
  typeof GenerateAliasesResponseSchema
>;

/** Spec §46, plus `summarizeEvidence` so `SemanticModel` routes through the same boundary. */
export interface PathCompilerModelProvider {
  readonly id: string;
  inferCapabilities(
    request: InferCapabilitiesRequest,
  ): Promise<InferCapabilitiesResponse>;
  synthesizeWorkflow(
    request: SynthesizeWorkflowRequest,
  ): Promise<SynthesizeWorkflowResponse>;
  explainImpact(request: ExplainImpactRequest): Promise<ExplainImpactResponse>;
  generateAliases(
    request: GenerateAliasesRequest,
  ): Promise<GenerateAliasesResponse>;
  summarizeEvidence(
    request: EvidenceSummaryInput,
  ): Promise<EvidenceSummaryResult>;
}
export type ModelRequestKind =
  | "inferCapabilities"
  | "synthesizeWorkflow"
  | "explainImpact"
  | "generateAliases"
  | "summarizeEvidence";

export class ModelProviderError extends Error {
  constructor(
    readonly code:
      | "fixture-missing"
      | "invalid-response"
      | "unsupported"
      | "no-provider",
    message: string,
  ) {
    super(message);
    this.name = "ModelProviderError";
  }
}

/** The default: no model. Every method answers "nothing inferred" deterministically. */
export class NoopModelProvider implements PathCompilerModelProvider {
  readonly id = "none";
  async inferCapabilities(): Promise<InferCapabilitiesResponse> {
    return { capabilities: [] };
  }
  async synthesizeWorkflow(): Promise<SynthesizeWorkflowResponse> {
    return {
      workflow: null,
      evidenceIds: [],
      rationale: "No model provider is configured.",
    };
  }
  async explainImpact(
    request: ExplainImpactRequest,
  ): Promise<ExplainImpactResponse> {
    const parsed = ExplainImpactRequestSchema.parse(request);
    // Deterministic fallback: the reasons themselves, unchanged.
    return {
      explanation: parsed.reasons.map((reason) => reason.message).join(" "),
      reasonCodes: parsed.reasons.map((reason) => reason.code),
    };
  }
  async generateAliases(): Promise<GenerateAliasesResponse> {
    return { aliases: [] };
  }
  async summarizeEvidence(): Promise<EvidenceSummaryResult> {
    throw new ModelProviderError(
      "no-provider",
      "Evidence summaries need a model provider. Set model_provider in pathcompiler.yaml, or use the deterministic evidence report.",
    );
  }
}

/** Canonical JSON (sorted keys) of a request, hashed: the fixture lookup key. */
export function fixtureKey(kind: ModelRequestKind, request: unknown): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : value;
  return `${kind}:${createHash("sha256")
    .update(JSON.stringify(canonical(request)))
    .digest("hex")
    .slice(0, 16)}`;
}
export type ModelFixture = {
  kind: ModelRequestKind;
  /** `fixtureKey(kind, request)`, or the request itself. */
  key?: string;
  request?: unknown;
  response: unknown;
};
/** Replays recorded responses by request key; an unknown request is an error, never a guess. */
export class FixtureModelProvider implements PathCompilerModelProvider {
  readonly id = "fixture";
  private readonly responses = new Map<string, unknown>();
  constructor(fixtures: readonly ModelFixture[]) {
    for (const fixture of fixtures) {
      const key =
        fixture.key ??
        (fixture.request === undefined
          ? undefined
          : fixtureKey(fixture.kind, fixture.request));
      if (!key) throw new Error("A model fixture needs a key or a request.");
      this.responses.set(key, fixture.response);
    }
  }
  private answer(kind: ModelRequestKind, request: unknown): Promise<never> {
    const key = fixtureKey(kind, request);
    if (!this.responses.has(key))
      return Promise.reject(
        new ModelProviderError(
          "fixture-missing",
          `No model fixture for ${key}. Record a response for this request.`,
        ),
      );
    return Promise.resolve(structuredClone(this.responses.get(key)) as never);
  }
  inferCapabilities(request: InferCapabilitiesRequest) {
    return this.answer("inferCapabilities", request);
  }
  synthesizeWorkflow(request: SynthesizeWorkflowRequest) {
    return this.answer("synthesizeWorkflow", request);
  }
  explainImpact(request: ExplainImpactRequest) {
    return this.answer("explainImpact", request);
  }
  generateAliases(request: GenerateAliasesRequest) {
    return this.answer("generateAliases", request);
  }
  summarizeEvidence(request: EvidenceSummaryInput) {
    return this.answer("summarizeEvidence", request);
  }
}

// --- Privacy (spec §47) -----------------------------------------------------

const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  {
    name: "private-key",
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { name: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "provider-key", pattern: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    name: "assigned-secret",
    pattern:
      /((?:api[_-]?key|secret|token|password|passwd)["']?\s*[:=]\s*["'])(?!\[REDACTED\])[^"'\s]{8,}(["'])/gi,
  },
];
export const REDACTED = "[REDACTED]";
/** Replaces obvious secrets; reports how many by kind, never the values. */
export function redactSecrets(input: string): {
  text: string;
  redactions: Record<string, number>;
} {
  let text = input;
  const redactions: Record<string, number> = {};
  for (const { name, pattern } of SECRET_PATTERNS)
    text = text.replace(pattern, (...match: string[]) => {
      redactions[name] = (redactions[name] ?? 0) + 1;
      return name === "assigned-secret"
        ? `${match[1]}${REDACTED}${match[2]}`
        : REDACTED;
    });
  return { text, redactions };
}
/** Redacts every string in a JSON value. */
export function redactValue<T>(value: T): {
  value: T;
  redactions: Record<string, number>;
} {
  const redactions: Record<string, number> = {};
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") {
      const result = redactSecrets(item);
      for (const [name, count] of Object.entries(result.redactions))
        redactions[name] = (redactions[name] ?? 0) + count;
      return result.text;
    }
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([key, entry]) => [key, walk(entry)]),
      );
    return item;
  };
  return { value: walk(value) as T, redactions };
}

export type ModelContextEntry = {
  kind: ModelRequestKind;
  provider: string;
  bytes: number;
  /** Graph nodes in the request's evidence, by type. */
  evidenceNodes: Record<string, number>;
  /** Repository files the evidence points to (paths only; contents are never sent). */
  files: string[];
  redactions: Record<string, number>;
};
/** What a request carries, for the context log and the dry run. */
export function describeModelRequest(
  kind: ModelRequestKind,
  provider: string,
  request: unknown,
  redactions: Record<string, number> = {},
): ModelContextEntry {
  const evidence = EvidenceBundleSchema.safeParse(
    (request as { evidence?: unknown } | null)?.evidence,
  );
  const nodes = evidence.success ? evidence.data.graph.nodes : [];
  const evidenceNodes: Record<string, number> = {};
  const files = new Set<string>();
  for (const node of nodes) {
    evidenceNodes[node.type] = (evidenceNodes[node.type] ?? 0) + 1;
    const locations = node.data?.evidence;
    if (Array.isArray(locations))
      for (const location of locations)
        if (
          location &&
          typeof location === "object" &&
          "file" in location &&
          typeof location.file === "string"
        )
          files.add(location.file);
  }
  return {
    kind,
    provider,
    bytes: Buffer.byteLength(JSON.stringify(request)),
    evidenceNodes: Object.fromEntries(
      Object.entries(evidenceNodes).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
    files: [...files].sort(),
    redactions,
  };
}

/**
 * The boundary every model call goes through: requests are validated and
 * secret-redacted, the context is recorded, and responses are validated
 * against their schema and the evidence they may cite.
 */
export function guardModelProvider(
  provider: PathCompilerModelProvider,
  options: { onContext?: (entry: ModelContextEntry) => void } = {},
): PathCompilerModelProvider {
  const send = async <Request, Response>(
    kind: ModelRequestKind,
    schema: z.ZodType<Request>,
    input: Request,
    call: (request: Request) => Promise<unknown>,
    check: (request: Request, output: unknown) => Response,
  ): Promise<Response> => {
    const { value: request, redactions } = redactValue(schema.parse(input));
    options.onContext?.(
      describeModelRequest(kind, provider.id, request, redactions),
    );
    const output = await call(request);
    try {
      return check(request, output);
    } catch (error) {
      throw new ModelProviderError(
        "invalid-response",
        `Model provider ${provider.id} returned an invalid ${kind} response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const cited = (
    evidence: z.infer<typeof EvidenceBundleSchema>,
    ids: string[],
  ) => {
    const known = new Set(evidence.graph.nodes.map((node) => node.id));
    if (ids.some((id) => !known.has(id)))
      throw new Error("it cites evidence outside its request.");
  };
  return {
    id: provider.id,
    inferCapabilities: (input) =>
      send(
        "inferCapabilities",
        CapabilityClassificationInputSchema,
        input,
        (request) => provider.inferCapabilities(request),
        parseCapabilityClassification,
      ),
    synthesizeWorkflow: (input) =>
      send(
        "synthesizeWorkflow",
        SynthesizeWorkflowRequestSchema,
        input,
        (request) => provider.synthesizeWorkflow(request),
        (request, output) => {
          const result = SynthesizeWorkflowResponseSchema.parse(output);
          cited(request.evidence, result.evidenceIds);
          if (result.workflow && result.workflow.status !== "candidate")
            throw new Error("a model may only propose candidates.");
          if (result.workflow && result.workflow.id !== request.capabilityId)
            throw new Error("the workflow ID differs from the capability.");
          return result;
        },
      ),
    explainImpact: (input) =>
      send(
        "explainImpact",
        ExplainImpactRequestSchema,
        input,
        (request) => provider.explainImpact(request),
        (request, output) => {
          const result = ExplainImpactResponseSchema.parse(output);
          const codes = new Set(request.reasons.map((reason) => reason.code));
          if (result.reasonCodes.some((code) => !codes.has(code)))
            throw new Error("it cites reason codes outside its request.");
          return result;
        },
      ),
    generateAliases: (input) =>
      send(
        "generateAliases",
        GenerateAliasesRequestSchema,
        input,
        (request) => provider.generateAliases(request),
        (_, output) => GenerateAliasesResponseSchema.parse(output),
      ),
    summarizeEvidence: (input) =>
      send(
        "summarizeEvidence",
        z.strictObject({ evidence: EvidenceBundleSchema }),
        input,
        (request) => provider.summarizeEvidence(request),
        parseEvidenceSummary,
      ),
  };
}

/** `SemanticModel` (capability-engine's optional boundary) over a guarded provider. */
export function semanticModelFromProvider(
  provider: PathCompilerModelProvider,
  options: Parameters<typeof guardModelProvider>[1] = {},
): SemanticModel {
  const guarded = guardModelProvider(provider, options);
  return {
    classifyCapabilities: (input) => guarded.inferCapabilities(input),
    summarizeEvidence: (input) => guarded.summarizeEvidence(input),
  };
}
