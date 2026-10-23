import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { type PathCompiler, PathCompilerError } from "@pathcompiler/sdk-js";
import { z } from "zod";

export type HttpServiceOptions = {
  client: PathCompiler;
  /**
   * Bearer token required on every request. `null` disables authentication and
   * is intended only for loopback development.
   */
  token: string | null;
  /** Called with unexpected errors; responses never include their details. */
  onError?: (error: unknown) => void;
  maxBodyBytes?: number;
};

const SearchBodySchema = z.strictObject({
  query: z.string().max(500),
  context: z.unknown().optional(),
});

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const STATUS: Record<PathCompilerError["code"], number> = {
  "invalid-request": 400,
  "workflow-not-found": 404,
  "invalid-response": 500,
  unauthorized: 401,
  "transport-failed": 502,
};

/**
 * Request handler mirroring the SDK: each endpoint is one PathCompiler client
 * call, so validation, results and errors match SDK behavior.
 */
export function createRequestHandler(
  options: HttpServiceOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  if (options.token !== null && options.token.length < 16)
    throw new Error("Use an API token of at least 16 characters.");
  const expected =
    options.token === null ? null : Buffer.from(options.token, "utf8");
  const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
  const { client } = options;

  function authorize(request: IncomingMessage) {
    if (!expected) return;
    const header = request.headers.authorization ?? "";
    const supplied = Buffer.from(
      header.startsWith("Bearer ") ? header.slice(7) : "",
      "utf8",
    );
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new HttpError(
        401,
        "unauthorized",
        "Send Authorization: Bearer <token>.",
        { "www-authenticate": 'Bearer realm="pathcompiler"' },
      );
  }

  async function body(request: IncomingMessage): Promise<unknown> {
    const type = request.headers["content-type"] ?? "";
    if (!/^application\/json(?:\s*;|$)/i.test(type))
      throw new HttpError(
        415,
        "unsupported-media-type",
        "Send a JSON body with Content-Type: application/json.",
      );
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > maxBodyBytes)
        throw new HttpError(
          413,
          "payload-too-large",
          `Request bodies are limited to ${maxBodyBytes} bytes.`,
        );
      chunks.push(chunk as Buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HttpError(
        400,
        "invalid-json",
        "The request body is not valid JSON.",
      );
    }
  }

  async function route(request: IncomingMessage): Promise<unknown> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    const only = (allowed: string) => {
      if (method !== allowed)
        throw new HttpError(405, "method-not-allowed", `Use ${allowed}.`, {
          allow: allowed,
        });
    };
    if (url.pathname === "/v1/help/resolve") {
      only("POST");
      return client.resolve((await body(request)) as never);
    }
    if (url.pathname === "/v1/workflows/search") {
      only("POST");
      const parsed = SearchBodySchema.safeParse(await body(request));
      if (!parsed.success)
        throw new PathCompilerError(
          "invalid-request",
          "Search requests need a query of at most 500 characters and an optional context.",
        );
      return {
        workflows: await client.workflows.search(
          parsed.data.query,
          parsed.data.context as never,
        ),
      };
    }
    const match = /^\/v1\/workflows\/([^/]+)(\/runtime|\/related)?$/.exec(
      url.pathname,
    );
    if (match) {
      only("GET");
      let id: string;
      try {
        id = decodeURIComponent(match[1] ?? "");
      } catch {
        throw new HttpError(400, "invalid-request", "Malformed workflow ID.");
      }
      if (match[2] === "/runtime")
        return client.workflows.getRuntimeManifest(id);
      if (match[2] === "/related") return client.workflows.related(id);
      return client.workflows.get(id);
    }
    throw new HttpError(404, "not-found", "Unknown endpoint.");
  }

  return (request, response) => {
    const send = (
      status: number,
      payload: unknown,
      headers: Record<string, string> = {},
    ) => {
      response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...headers,
      });
      response.end(`${JSON.stringify(payload)}\n`);
    };
    (async () => {
      authorize(request);
      return route(request);
    })().then(
      (payload) => send(200, payload),
      (error: unknown) => {
        if (error instanceof HttpError)
          return send(
            error.status,
            { error: { code: error.code, message: error.message } },
            error.headers,
          );
        if (error instanceof PathCompilerError)
          return send(STATUS[error.code], {
            error: { code: error.code, message: error.message },
          });
        options.onError?.(error);
        send(500, {
          error: { code: "internal", message: "Unexpected server error." },
        });
      },
    );
  };
}

export function createHttpService(options: HttpServiceOptions): Server {
  return createServer(createRequestHandler(options));
}
