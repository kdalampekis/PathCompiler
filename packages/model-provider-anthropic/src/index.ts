import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import {
  createStructuredModelProvider,
  ModelProviderError,
  type PathCompilerModelProvider,
  parseModelJson,
} from "@pathcompiler/model-provider";

/**
 * Anthropic adapter (C9, ADR 0071). The only package allowed the vendor SDK.
 * It receives guarded, minimal evidence through the structured-task primitive
 * and returns the model's JSON unchanged; `guardModelProvider` validates it.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";
export const DEFAULT_ANTHROPIC_KEY_ENV = "ANTHROPIC_API_KEY";

export function createAnthropicModelProvider(options: {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  /** Injected for tests; built from `apiKey` otherwise. */
  client?: Anthropic;
}): PathCompilerModelProvider {
  const id = "anthropic";
  const model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  return createStructuredModelProvider(id, async (task) => {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: options.maxTokens ?? 16_000,
        // A declined request is re-run on Anthropic's recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: task.instructions,
        messages: [{ role: "user", content: task.input }],
        output_config: {
          // `transform` rewrites schema keywords structured outputs do not support.
          format: jsonSchemaOutputFormat(
            task.outputSchema as { type: "object" },
            { transform: true },
          ),
        },
      });
    } catch (error) {
      throw new ModelProviderError(
        "request-failed",
        `Anthropic ${task.kind} request failed: ${error instanceof Anthropic.APIError ? `${error.status ?? "no status"} ${error.message}` : (error as Error).message}`,
      );
    }
    if (response.stop_reason === "refusal")
      throw new ModelProviderError(
        "refused",
        `Anthropic declined the ${task.kind} request, including its fallback; the deterministic result stands.`,
      );
    if (response.stop_reason === "max_tokens")
      throw new ModelProviderError(
        "invalid-response",
        `Anthropic's ${task.kind} answer was cut off at the token limit.`,
      );
    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    return parseModelJson(id, text);
  });
}
