import {
  createStructuredModelProvider,
  ModelProviderError,
  type PathCompilerModelProvider,
  parseModelJson,
  type StructuredCompletion,
} from "@pathcompiler/model-provider";
import { z } from "zod";

/**
 * OpenAI-compatible adapter over plain HTTP (C9, ADR 0071): OpenAI itself, or
 * a local server with the same chat-completions API (Ollama, LM Studio, vLLM).
 * No SDK. Answers are returned unchanged; `guardModelProvider` validates them.
 */
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_KEY_ENV = "OPENAI_API_KEY";
export const DEFAULT_LOCAL_BASE_URL = "http://localhost:11434/v1";

const ChatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
});

type CompatibleOptions = {
  id: "openai" | "local";
  model: string;
  baseUrl: string;
  /** Optional for local servers. */
  apiKey?: string;
  /** Injected for tests. */
  fetch?: typeof fetch;
};

export function createOpenAICompatibleModelProvider(
  options: CompatibleOptions,
): PathCompilerModelProvider {
  return createStructuredModelProvider(
    options.id,
    createOpenAICompatibleCompletion(options),
  );
}

/** The structured-task primitive on its own (see the Anthropic adapter). */
export function createOpenAICompatibleCompletion(
  options: CompatibleOptions,
): StructuredCompletion {
  const { id, model } = options;
  const send = options.fetch ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return async (task) => {
    let response: Response;
    try {
      response = await send(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey
            ? { authorization: `Bearer ${options.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: task.instructions },
            { role: "user", content: task.input },
          ],
          response_format: {
            type: "json_schema",
            // Not strict: strict mode requires every property, and ours have optional ones.
            json_schema: { name: task.kind, schema: task.outputSchema },
          },
        }),
      });
    } catch (error) {
      throw new ModelProviderError(
        "request-failed",
        `${id} ${task.kind} request to ${url} failed: ${(error as Error).message}`,
      );
    }
    if (!response.ok)
      throw new ModelProviderError(
        "request-failed",
        // The body may echo the request; only the status is reported.
        `${id} ${task.kind} request to ${url} failed with HTTP ${response.status}.`,
      );
    const parsed = ChatCompletionSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new ModelProviderError(
        "invalid-response",
        `${id} returned a response that is not a chat completion.`,
      );
    const choice = parsed.data.choices[0] as z.infer<
      typeof ChatCompletionSchema
    >["choices"][number];
    if (choice.message.refusal)
      throw new ModelProviderError(
        "refused",
        `${id} declined the ${task.kind} request; the deterministic result stands.`,
      );
    if (choice.finish_reason === "length")
      throw new ModelProviderError(
        "invalid-response",
        `${id}'s ${task.kind} answer was cut off at the token limit.`,
      );
    return parseModelJson(id, choice.message.content ?? "");
  };
}

export function createOpenAIModelProvider(options: {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}): PathCompilerModelProvider {
  return createOpenAICompatibleModelProvider({
    ...options,
    id: "openai",
    baseUrl: options.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
  });
}

/** A local OpenAI-compatible server; nothing leaves the machine unless `baseUrl` says so. */
export function createLocalModelProvider(options: {
  model: string;
  baseUrl?: string;
  apiKey?: string;
  fetch?: typeof fetch;
}): PathCompilerModelProvider {
  return createOpenAICompatibleModelProvider({
    ...options,
    id: "local",
    baseUrl: options.baseUrl ?? DEFAULT_LOCAL_BASE_URL,
  });
}
