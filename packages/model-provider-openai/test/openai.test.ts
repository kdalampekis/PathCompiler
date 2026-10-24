import { guardModelProvider } from "@pathcompiler/model-provider";
import { describe, expect, it } from "vitest";
import {
  createLocalModelProvider,
  createOpenAIModelProvider,
} from "../src/index.js";

const aliases = {
  workflowId: "clients.create",
  title: "Create Client",
  intent: { action: "create", entity: "client" },
  existingAliases: [],
};
function server(body: unknown, status = 200) {
  const calls: { url: string; headers: Headers; body: unknown }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}
const completion = (message: object, finish = "stop") => ({
  choices: [{ finish_reason: finish, message }],
});

describe("OpenAI-compatible adapter", () => {
  it("posts a chat completion with a JSON schema and returns the model's JSON", async () => {
    const mock = server(completion({ content: '{"aliases":["new client"]}' }));
    const provider = guardModelProvider(
      createOpenAIModelProvider({
        apiKey: "test-key",
        model: "test-model",
        fetch: mock.fetch,
      }),
    );
    await expect(provider.generateAliases(aliases)).resolves.toEqual({
      aliases: ["new client"],
    });
    const [call] = mock.calls;
    expect(call?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call?.headers.get("authorization")).toBe("Bearer test-key");
    expect(call?.body).toMatchObject({
      model: "test-model",
      messages: [
        { role: "system", content: expect.stringContaining("Task:") },
        { role: "user", content: JSON.stringify(aliases) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "generateAliases", schema: { type: "object" } },
      },
    });
  });

  it("talks to a local server without a key by default", async () => {
    const mock = server(completion({ content: '{"aliases":[]}' }));
    const provider = createLocalModelProvider({
      model: "llama",
      fetch: mock.fetch,
    });
    expect(provider.id).toBe("local");
    await provider.generateAliases(aliases);
    expect(mock.calls[0]?.url).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
    expect(mock.calls[0]?.headers.has("authorization")).toBe(false);
  });

  it("reports refusals, truncation, HTTP errors and malformed bodies", async () => {
    const cases: [unknown, number, string][] = [
      [completion({ content: null, refusal: "no" }), 200, "refused"],
      [completion({ content: '{"al' }, "length"), 200, "invalid-response"],
      [{ error: { message: "echo of the request" } }, 401, "request-failed"],
      [{ unexpected: true }, 200, "invalid-response"],
    ];
    for (const [body, status, code] of cases) {
      const provider = createOpenAIModelProvider({
        apiKey: "test-key",
        model: "test-model",
        fetch: server(body, status).fetch,
      });
      const error = await provider.generateAliases(aliases).catch((e) => e);
      expect(error).toMatchObject({ code });
      // The error body may echo the request; it is never repeated.
      expect(String(error.message)).not.toContain("echo");
    }
  });
});
