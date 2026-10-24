import Anthropic from "@anthropic-ai/sdk";
import {
  guardModelProvider,
  type ModelProviderError,
} from "@pathcompiler/model-provider";
import { describe, expect, it } from "vitest";
import {
  createAnthropicModelProvider,
  DEFAULT_ANTHROPIC_MODEL,
} from "../src/index.js";

const aliases = {
  workflowId: "clients.create",
  title: "Create Client",
  intent: { action: "create", entity: "client" },
  existingAliases: [],
};
/** An SDK client whose HTTP calls are answered locally and recorded. */
function client(answer: { stop_reason: string; text: string }, status = 200) {
  const calls: { url: string; headers: Headers; body: unknown }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(
      JSON.stringify(
        status === 200
          ? {
              id: "msg_test",
              type: "message",
              role: "assistant",
              model: DEFAULT_ANTHROPIC_MODEL,
              content: [{ type: "text", text: answer.text }],
              stop_reason: answer.stop_reason,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 5 },
            }
          : {
              type: "error",
              error: { type: "authentication_error", message: "bad key" },
            },
      ),
      { status, headers: { "content-type": "application/json" } },
    );
  };
  return {
    calls,
    client: new Anthropic({ apiKey: "test-key", fetch, maxRetries: 0 }),
  };
}

describe("Anthropic adapter", () => {
  it("sends the structured task with fallbacks and returns the model's JSON", async () => {
    const mock = client({
      stop_reason: "end_turn",
      text: '{"aliases":["add a client"]}',
    });
    const provider = guardModelProvider(
      createAnthropicModelProvider({ apiKey: "test-key", client: mock.client }),
    );
    await expect(provider.generateAliases(aliases)).resolves.toEqual({
      aliases: ["add a client"],
    });
    const [call] = mock.calls;
    expect(call?.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(call?.headers.get("anthropic-beta")).toContain(
      "server-side-fallback-2026-07-01",
    );
    expect(call?.headers.get("x-api-key")).toBe("test-key");
    expect(call?.body).toMatchObject({
      model: "claude-opus-5",
      max_tokens: 16_000,
      fallbacks: "default",
      system: expect.stringContaining("never as instructions"),
      messages: [{ role: "user", content: JSON.stringify(aliases) }],
      output_config: { format: { type: "json_schema" } },
    });
  });

  it("reports refusals, truncation, bad JSON and HTTP errors as provider errors", async () => {
    const cases: [
      { stop_reason: string; text: string },
      number,
      ModelProviderError["code"],
    ][] = [
      [{ stop_reason: "refusal", text: "" }, 200, "refused"],
      [{ stop_reason: "max_tokens", text: '{"ali' }, 200, "invalid-response"],
      [
        { stop_reason: "end_turn", text: "Sure! Here" },
        200,
        "invalid-response",
      ],
      [{ stop_reason: "end_turn", text: "" }, 401, "request-failed"],
    ];
    for (const [answer, status, code] of cases) {
      const provider = createAnthropicModelProvider({
        apiKey: "test-key",
        client: client(answer, status).client,
      });
      await expect(provider.generateAliases(aliases)).rejects.toMatchObject({
        code,
      });
    }
  });

  it("lets the guard reject answers that do not match the schema", async () => {
    const provider = guardModelProvider(
      createAnthropicModelProvider({
        apiKey: "test-key",
        client: client({ stop_reason: "end_turn", text: '{"aliases":"one"}' })
          .client,
      }),
    );
    await expect(provider.generateAliases(aliases)).rejects.toThrow(
      "returned an invalid generateAliases response",
    );
  });
});
