import {
  createHmac,
  createPrivateKey,
  createSign,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

export * from "./worker.js";

export const CHECK_NAME = "PathCompiler Workflow Check";
export const GITHUB_API = "https://api.github.com";
export const GITHUB_API_VERSION = "2026-03-10";

/** Least privilege: read code and PR metadata, write only check runs. */
export const APP_PERMISSIONS = {
  checks: "write",
  contents: "read",
  metadata: "read",
  pull_requests: "read",
} as const;

/** GitHub App manifest for the manifest registration flow. */
export function githubAppManifest(options: {
  name: string;
  url: string;
  webhookUrl: string;
}) {
  const parsed = z
    .strictObject({
      name: z.string().min(1).max(34),
      url: z.url(),
      webhookUrl: z.url().refine((value) => value.startsWith("https://"), {
        message: "Webhook URL must use HTTPS",
      }),
    })
    .parse(options);
  return {
    name: parsed.name,
    url: parsed.url,
    hook_attributes: { url: parsed.webhookUrl, active: true },
    public: false,
    default_permissions: APP_PERMISSIONS,
    default_events: ["push", "pull_request"],
  };
}

/** Verifies `X-Hub-Signature-256` over the exact raw body in constant time. */
export function verifyWebhookSignature(
  secret: string,
  body: Buffer,
  header: string | undefined,
): boolean {
  if (!header || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
  );
  const supplied = Buffer.from(header);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const ZERO = "0".repeat(40);
const repository = z.object({
  name: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
});
export const WorkflowCheckJobSchema = z.strictObject({
  delivery: z.string().min(1),
  event: z.enum(["push", "pull_request"]),
  installationId: z.number().int().positive(),
  owner: z.string().min(1),
  repo: z.string().min(1),
  base: sha,
  head: sha,
  pullRequest: z.number().int().positive().optional(),
});
export type WorkflowCheckJob = z.infer<typeof WorkflowCheckJobSchema>;

/**
 * Normalizes a webhook into a check job, or explains why it is ignored.
 * Branch creation/deletion and non-code PR actions produce no job.
 */
export function parseWebhookEvent(
  event: string,
  delivery: string,
  payload: unknown,
): { job: WorkflowCheckJob } | { ignored: string } {
  if (event === "push") {
    const parsed = z
      .object({
        before: sha,
        after: sha,
        installation: z.object({ id: z.number().int().positive() }),
        repository,
      })
      .safeParse(payload);
    if (!parsed.success) return { ignored: "Unsupported push payload." };
    const { before, after, installation, repository: repo } = parsed.data;
    if (after === ZERO)
      return { ignored: "Branch deletion has no code to check." };
    if (before === ZERO)
      return { ignored: "New branch push has no base commit to compare." };
    return {
      job: WorkflowCheckJobSchema.parse({
        delivery,
        event: "push",
        installationId: installation.id,
        owner: repo.owner.login,
        repo: repo.name,
        base: before,
        head: after,
      }),
    };
  }
  if (event === "pull_request") {
    const parsed = z
      .object({
        action: z.string(),
        number: z.number().int().positive(),
        installation: z.object({ id: z.number().int().positive() }),
        repository,
        pull_request: z.object({
          base: z.object({ sha }),
          head: z.object({ sha }),
        }),
      })
      .safeParse(payload);
    if (!parsed.success)
      return { ignored: "Unsupported pull_request payload." };
    if (!["opened", "synchronize", "reopened"].includes(parsed.data.action))
      return {
        ignored: `Pull request action ${parsed.data.action} changes no code.`,
      };
    return {
      job: WorkflowCheckJobSchema.parse({
        delivery,
        event: "pull_request",
        installationId: parsed.data.installation.id,
        owner: parsed.data.repository.owner.login,
        repo: parsed.data.repository.name,
        base: parsed.data.pull_request.base.sha,
        head: parsed.data.pull_request.head.sha,
        pullRequest: parsed.data.number,
      }),
    };
  }
  return { ignored: `Event ${event} is not handled.` };
}

export type JobQueue = {
  /** Returns immediately; the job runs later. Duplicate deliveries are dropped. */
  enqueue(job: WorkflowCheckJob): boolean;
  /** Resolves when all queued jobs have finished. */
  idle(): Promise<void>;
};

/** In-process sequential queue. Failures go to `onError` and never stop the queue. */
export function createJobQueue(
  work: (job: WorkflowCheckJob) => Promise<void>,
  onError: (error: unknown, job: WorkflowCheckJob) => void,
  options: { rememberDeliveries?: number } = {},
): JobQueue {
  const seen: string[] = [];
  const limit = options.rememberDeliveries ?? 1_000;
  let tail = Promise.resolve();
  return {
    enqueue(job) {
      if (seen.includes(job.delivery)) return false;
      seen.push(job.delivery);
      if (seen.length > limit) seen.shift();
      tail = tail.then(() =>
        work(job).catch((error: unknown) => onError(error, job)),
      );
      return true;
    },
    idle: () => tail,
  };
}

/** Verify, acknowledge quickly, enqueue; never runs analysis on the request path. */
export function createWebhookHandler(options: {
  secret: string;
  queue: JobQueue;
  maxBodyBytes?: number;
}): (request: IncomingMessage, response: ServerResponse) => void {
  if (options.secret.length < 16)
    throw new Error("Use a webhook secret of at least 16 characters.");
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  return (request, response) => {
    const send = (status: number, payload: unknown) => {
      response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(`${JSON.stringify(payload)}\n`);
    };
    if (request.method !== "POST") return send(405, { error: "Use POST." });
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBodyBytes && !rejected) {
        rejected = true;
        send(413, { error: "Payload too large." });
        request.destroy();
      } else if (!rejected) chunks.push(chunk);
    });
    request.on("end", () => {
      if (rejected) return;
      const body = Buffer.concat(chunks);
      const header = request.headers["x-hub-signature-256"];
      if (
        !verifyWebhookSignature(
          options.secret,
          body,
          typeof header === "string" ? header : undefined,
        )
      )
        return send(401, { error: "Invalid webhook signature." });
      const event = String(request.headers["x-github-event"] ?? "");
      const delivery = String(request.headers["x-github-delivery"] ?? "");
      if (!delivery) return send(400, { error: "Missing X-GitHub-Delivery." });
      if (event === "ping") return send(200, { ok: true });
      let payload: unknown;
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        return send(400, { error: "Body is not JSON." });
      }
      const parsed = parseWebhookEvent(event, delivery, payload);
      if ("ignored" in parsed)
        return send(202, { accepted: false, reason: parsed.ignored });
      const queued = options.queue.enqueue(parsed.job);
      send(202, {
        accepted: queued,
        ...(queued ? {} : { reason: "Duplicate delivery." }),
      });
    });
  };
}

const TokenResponseSchema = z.object({
  token: z.string().min(1),
  expires_at: z.iso.datetime(),
});

/** GitHub App authentication: RS256 app JWT, then scoped installation tokens. */
export function createAppAuth(options: {
  appId: string;
  privateKey: string;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  if (!/^\d+$/.test(options.appId))
    throw new Error("GitHub App ID must be numeric.");
  const key = createPrivateKey(options.privateKey);
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => Date.now());
  const cache = new Map<number, { token: string; expires: number }>();
  const base64url = (value: string | Buffer) =>
    Buffer.from(value).toString("base64url");
  function appJwt(): string {
    const issued = Math.floor(now() / 1000) - 60;
    const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
      JSON.stringify({ iat: issued, exp: issued + 600, iss: options.appId }),
    )}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(key);
    return `${unsigned}.${base64url(signature)}`;
  }
  async function installationToken(installationId: number): Promise<string> {
    const cached = cache.get(installationId);
    if (cached && cached.expires - 60_000 > now()) return cached.token;
    const response = await send(
      `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${appJwt()}`,
          "content-type": "application/json",
          "x-github-api-version": GITHUB_API_VERSION,
        },
        // Scope the token below the installation's grant.
        body: JSON.stringify({
          permissions: { checks: "write", contents: "read", metadata: "read" },
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        `GitHub refused an installation token (HTTP ${response.status}). Check the app ID, private key and installation.`,
      );
    const parsed = TokenResponseSchema.parse(await response.json());
    cache.set(installationId, {
      token: parsed.token,
      expires: Date.parse(parsed.expires_at),
    });
    return parsed.token;
  }
  return { appJwt, installationToken };
}
export type AppAuth = ReturnType<typeof createAppAuth>;

export type CheckSummary = {
  conclusion: "success" | "neutral" | "failure";
  title: string;
  summary: string;
  text: string;
};

/** Publishes a completed check run on the head commit. */
export async function publishCheckRun(options: {
  token: string;
  owner: string;
  repo: string;
  headSha: string;
  check: CheckSummary;
  fetch?: typeof fetch;
}): Promise<void> {
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);
  const owner = z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/)
    .parse(options.owner);
  const repo = z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,100}$/)
    .parse(options.repo);
  const response = await send(
    `${GITHUB_API}/repos/${owner}/${repo}/check-runs`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
        "x-github-api-version": GITHUB_API_VERSION,
      },
      body: JSON.stringify({
        name: CHECK_NAME,
        head_sha: sha.parse(options.headSha),
        status: "completed",
        conclusion: options.check.conclusion,
        output: {
          title: options.check.title,
          summary: options.check.summary,
          text: options.check.text,
        },
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      `GitHub refused the check run (HTTP ${response.status}). Ensure the app has checks:write.`,
    );
}
