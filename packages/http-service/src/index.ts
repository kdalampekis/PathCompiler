import { timingSafeEqual } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import {
  EventPolicyError,
  type PrivacyPolicy,
  type ProductRuntimeEvent,
  serializeEvent,
  validateEvent,
} from "@pathcompiler/observability-core";
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
  /** Event ingestion (`POST /v1/events/batch`); the endpoint is off without it. */
  events?: EventIngestionOptions;
  /**
   * Developer reasoning endpoints (`POST /v1/reason/<operation>`); off without
   * it. They accept only the developer token, which is accepted nowhere else:
   * end-user API and ingest tokens never reach reasoning.
   */
  reasoning?: DeveloperReasoningOptions;
};

export type DeveloperReasoningOptions = {
  token: string;
  /** Errors named `ReasoningRequestError` become 400 responses. */
  service: { handle(operation: string, input: unknown): Promise<unknown> };
};

/** Where accepted events go; one call per accepted batch, already validated. */
export interface EventSink {
  append(projectId: string, events: ProductRuntimeEvent[]): Promise<void>;
}
export type EventIngestionOptions = {
  sink: EventSink;
  /** Privacy policy applied to every event (allowed context keys, PII, hashing). */
  policy?: Partial<PrivacyPolicy>;
  /**
   * Token that may only post events, e.g. for a browser build. The API token
   * is accepted too.
   */
  ingestToken?: string;
  /** Events per project per window. Default 10 000 per 60 s. */
  rateLimit?: { events: number; windowMs: number };
  /** Events per request. Default 500. */
  maxBatch?: number;
  now?: () => number;
};

/** Keeps accepted events in memory per project; for tests and development. */
export class InMemoryEventSink implements EventSink {
  readonly events = new Map<string, ProductRuntimeEvent[]>();
  async append(projectId: string, events: ProductRuntimeEvent[]) {
    this.events.set(projectId, [
      ...(this.events.get(projectId) ?? []),
      ...events,
    ]);
  }
}

/**
 * Appends canonical NDJSON to `<directory>/<projectId>/<YYYY-MM-DD>.ndjson`
 * (UTC day of each event).
 */
export function createFileEventSink(directory: string): EventSink {
  return {
    async append(projectId, events) {
      const days = new Map<string, string[]>();
      for (const event of events) {
        const day = event.timestamp.slice(0, 10);
        days.set(day, [...(days.get(day) ?? []), serializeEvent(event)]);
      }
      const folder = path.join(directory, encodeURIComponent(projectId));
      await mkdir(folder, { recursive: true });
      for (const [day, lines] of days)
        await appendFile(
          path.join(folder, `${day}.ndjson`),
          `${lines.join("\n")}\n`,
        );
    },
  };
}

const EventBatchSchema = z.strictObject({ events: z.array(z.unknown()) });

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
  const ingestion = options.events;
  if (ingestion?.ingestToken !== undefined && ingestion.ingestToken.length < 16)
    throw new Error("Use an ingest token of at least 16 characters.");
  const ingestExpected =
    ingestion?.ingestToken === undefined
      ? null
      : Buffer.from(ingestion.ingestToken, "utf8");
  const reasoning = options.reasoning;
  if (reasoning !== undefined && reasoning.token.length < 16)
    throw new Error("Use a developer token of at least 16 characters.");
  if (
    reasoning !== undefined &&
    (reasoning.token === options.token ||
      reasoning.token === ingestion?.ingestToken)
  )
    throw new Error(
      "The developer token must differ from the API and ingest tokens.",
    );
  const developerExpected =
    reasoning === undefined ? null : Buffer.from(reasoning.token, "utf8");
  const limit = ingestion?.rateLimit ?? { events: 10_000, windowMs: 60_000 };
  const maxBatch = ingestion?.maxBatch ?? 500;
  const now = ingestion?.now ?? (() => Date.now());
  const windows = new Map<string, { start: number; count: number }>();
  const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
  const { client } = options;

  const matches = (supplied: Buffer, wanted: Buffer | null) =>
    wanted !== null &&
    supplied.length === wanted.length &&
    timingSafeEqual(supplied, wanted);
  function authorize(request: IncomingMessage) {
    const header = request.headers.authorization ?? "";
    const supplied = Buffer.from(
      header.startsWith("Bearer ") ? header.slice(7) : "",
      "utf8",
    );
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    // Developer reasoning has its own token, required even when the API
    // runs without authentication on loopback.
    if (pathname.startsWith("/v1/reason/")) {
      if (developerExpected && !matches(supplied, developerExpected))
        throw new HttpError(
          401,
          "developer-token-required",
          "Reasoning endpoints need the developer token: Authorization: Bearer <developer token>.",
          { "www-authenticate": 'Bearer realm="pathcompiler-reasoning"' },
        );
      return;
    }
    if (developerExpected && matches(supplied, developerExpected))
      throw new HttpError(
        403,
        "developer-token-not-accepted",
        "The developer token is only for /v1/reason/* endpoints.",
      );
    if (!expected) return;
    const eventsOnly = pathname === "/v1/events/batch";
    if (
      !matches(supplied, expected) &&
      !(eventsOnly && matches(supplied, ingestExpected))
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
    if (url.pathname === "/v1/events/batch") {
      only("POST");
      if (!ingestion)
        throw new HttpError(
          404,
          "ingestion-disabled",
          "Event ingestion is not enabled on this service.",
        );
      return ingest(await body(request));
    }
    if (url.pathname.startsWith("/v1/reason/")) {
      only("POST");
      if (!reasoning)
        throw new HttpError(
          404,
          "reasoning-disabled",
          "Developer reasoning is not enabled on this service.",
        );
      const operation = url.pathname.slice("/v1/reason/".length);
      try {
        return await reasoning.service.handle(operation, await body(request));
      } catch (error) {
        if (error instanceof Error && error.name === "ReasoningRequestError")
          throw new HttpError(400, "invalid-request", error.message);
        throw error;
      }
    }
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

  async function ingest(input: unknown) {
    if (!ingestion) throw new Error("Unreachable: ingestion disabled");
    const parsed = EventBatchSchema.safeParse(input);
    if (!parsed.success)
      throw new HttpError(
        400,
        "invalid-request",
        'Send { "events": [...] } with semantic runtime events.',
      );
    const { events } = parsed.data;
    if (events.length > maxBatch)
      throw new HttpError(
        413,
        "batch-too-large",
        `Batches are limited to ${maxBatch} events.`,
      );
    // One service serves one project; events for others are refused.
    const project = client.project;
    const window = windows.get(project);
    const at = now();
    const current =
      window && at - window.start < limit.windowMs
        ? window
        : { start: at, count: 0 };
    if (current.count + events.length > limit.events)
      throw new HttpError(
        429,
        "rate-limited",
        `At most ${limit.events} events per ${limit.windowMs} ms for this project.`,
        {
          "retry-after": String(
            Math.max(
              1,
              Math.ceil((current.start + limit.windowMs - at) / 1000),
            ),
          ),
        },
      );
    current.count += events.length;
    windows.set(project, current);
    const accepted: ProductRuntimeEvent[] = [];
    const rejected: { index: number; issues: string[] }[] = [];
    for (const [index, item] of events.entries()) {
      try {
        const event = validateEvent(item, ingestion.policy ?? {});
        if (event.projectId !== project)
          rejected.push({
            index,
            issues: [`projectId ${event.projectId} does not match ${project}`],
          });
        else accepted.push(event);
      } catch (error) {
        if (!(error instanceof EventPolicyError)) throw error;
        rejected.push({ index, issues: error.issues });
      }
    }
    if (accepted.length) await ingestion.sink.append(project, accepted);
    return { accepted: accepted.length, rejected };
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
