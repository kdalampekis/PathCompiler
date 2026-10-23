import { execFile } from "node:child_process";
import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import type { SemanticChangeReport } from "@pathcompiler/semantic-change";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import {
  approveCandidate,
  serializeReviewedYaml,
} from "@pathcompiler/workflow-review";
import { validateWorkflow } from "@pathcompiler/workflow-validator";
import { afterAll, describe, expect, it } from "vitest";
import {
  APP_PERMISSIONS,
  CHECK_NAME,
  createAppAuth,
  createJobQueue,
  createLocalRepositoryProvider,
  createWebhookHandler,
  createWorkflowCheckWorker,
  githubAppManifest,
  parseWebhookEvent,
  publishCheckRun,
  summarizeWorkflowCheck,
  verifyWebhookSignature,
  type WorkflowCheckJob,
} from "../src/index.js";

const exec = promisify(execFile);
const secret = "webhook-secret-0123456789";
const sign = (body: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const a = "a".repeat(40);
const b = "b".repeat(40);
const repository = { name: "demo", owner: { login: "acme" } };
const temporary: string[] = [];
afterAll(async () => {
  await Promise.all(
    temporary.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
type Call = { url: string; init: RequestInit };
function fakeGitHub(calls: Call[]): typeof fetch {
  return (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/access_tokens"))
      return new Response(
        JSON.stringify({
          token: "ghs_installation",
          expires_at: "2099-01-01T00:00:00Z",
        }),
        { status: 201 },
      );
    return new Response("{}", { status: 201 });
  }) as typeof fetch;
}
const job: WorkflowCheckJob = {
  delivery: "d-1",
  event: "push",
  installationId: 7,
  owner: "acme",
  repo: "demo",
  base: a,
  head: b,
};

describe("GitHub App", () => {
  it("verifies webhook signatures in constant time over the raw body", () => {
    const body = Buffer.from('{"x":1}');
    expect(verifyWebhookSignature(secret, body, sign('{"x":1}'))).toBe(true);
    for (const header of [
      undefined,
      "",
      "sha1=abc",
      sign('{"x":2}'),
      `${sign('{"x":1}')}0`,
    ])
      expect(verifyWebhookSignature(secret, body, header)).toBe(false);
  });

  it("normalizes push and pull request events and ignores the rest", () => {
    const installation = { id: 7 };
    expect(
      parseWebhookEvent("push", "d", {
        before: a,
        after: b,
        installation,
        repository,
      }),
    ).toEqual({ job: { ...job, delivery: "d" } });
    expect(
      parseWebhookEvent("push", "d", {
        before: a,
        after: "0".repeat(40),
        installation,
        repository,
      }),
    ).toHaveProperty("ignored");
    expect(
      parseWebhookEvent("push", "d", {
        before: "0".repeat(40),
        after: b,
        installation,
        repository,
      }),
    ).toHaveProperty("ignored");
    const pr = (action: string) => ({
      action,
      number: 3,
      installation,
      repository,
      pull_request: { base: { sha: a }, head: { sha: b } },
    });
    expect(
      parseWebhookEvent("pull_request", "d", pr("synchronize")),
    ).toMatchObject({
      job: { event: "pull_request", pullRequest: 3, base: a, head: b },
    });
    expect(parseWebhookEvent("pull_request", "d", pr("closed"))).toHaveProperty(
      "ignored",
    );
    expect(parseWebhookEvent("issues", "d", {})).toHaveProperty("ignored");
    expect(parseWebhookEvent("push", "d", { before: "x" })).toHaveProperty(
      "ignored",
    );
  });

  it("acknowledges verified deliveries before processing them asynchronously", async () => {
    let release: () => void = () => {};
    const processed: string[] = [];
    const errors: unknown[] = [];
    const queue = createJobQueue(
      async (item) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        processed.push(item.delivery);
        if (item.delivery === "boom") throw new Error("analysis failed");
      },
      (error) => errors.push(error),
    );
    const server = createServer(createWebhookHandler({ secret, queue }));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (
      event: string,
      delivery: string,
      body: string,
      signature = sign(body),
    ) =>
      fetch(url, {
        method: "POST",
        headers: {
          "x-github-event": event,
          "x-github-delivery": delivery,
          "x-hub-signature-256": signature,
          "content-type": "application/json",
        },
        body,
      });
    try {
      const payload = JSON.stringify({
        before: a,
        after: b,
        installation: { id: 7 },
        repository,
      });
      const accepted = await post("push", "d-1", payload);
      expect(accepted.status).toBe(202);
      expect(await accepted.json()).toEqual({ accepted: true });
      expect(processed).toEqual([]);
      expect(await (await post("push", "d-1", payload)).json()).toMatchObject({
        accepted: false,
        reason: "Duplicate delivery.",
      });
      expect((await post("push", "d-2", payload, sign("other"))).status).toBe(
        401,
      );
      expect((await post("ping", "d-3", "{}")).status).toBe(200);
      expect((await post("push", "d-4", "not json")).status).toBe(400);
      expect((await fetch(url)).status).toBe(405);
      expect((await post("push", "d-5", "x".repeat(1_100_000))).status).toBe(
        413,
      );
      release();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(processed).toEqual(["d-1"]);
      queue.enqueue({ ...job, delivery: "boom" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      release();
      await queue.idle();
      expect(errors).toHaveLength(1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    expect(() => createWebhookHandler({ secret: "short", queue })).toThrow(
      "16 characters",
    );
  });

  it("signs app JWTs and requests scoped, cached installation tokens", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const calls: Call[] = [];
    const auth = createAppAuth({
      appId: "123",
      privateKey: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      fetch: fakeGitHub(calls),
      now: () => Date.parse("2026-10-22T12:00:00Z"),
    });
    const [header, claims, signature] = auth.appJwt().split(".");
    expect(
      JSON.parse(Buffer.from(header ?? "", "base64url").toString()),
    ).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const payload = JSON.parse(
      Buffer.from(claims ?? "", "base64url").toString(),
    );
    expect(payload.iss).toBe("123");
    expect(payload.exp - payload.iat).toBe(600);
    expect(
      createVerify("RSA-SHA256")
        .update(`${header}.${claims}`)
        .verify(publicKey, Buffer.from(signature ?? "", "base64url")),
    ).toBe(true);
    expect(await auth.installationToken(7)).toBe("ghs_installation");
    expect(await auth.installationToken(7)).toBe("ghs_installation");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://api.github.com/app/installations/7/access_tokens",
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      permissions: { checks: "write", contents: "read", metadata: "read" },
    });
    const refused = createAppAuth({
      appId: "123",
      privateKey: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      fetch: (async () => new Response("{}", { status: 401 })) as typeof fetch,
    });
    await expect(refused.installationToken(7)).rejects.toThrow(
      "installation token",
    );
    expect(() => createAppAuth({ appId: "x", privateKey: "" })).toThrow();
  });

  it("publishes completed check runs and declares least-privilege permissions", async () => {
    const calls: Call[] = [];
    await publishCheckRun({
      token: "ghs_x",
      owner: "acme",
      repo: "demo",
      headSha: b,
      check: { conclusion: "neutral", title: "t", summary: "s", text: "x" },
      fetch: fakeGitHub(calls),
    });
    expect(calls[0]?.url).toBe(
      "https://api.github.com/repos/acme/demo/check-runs",
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      name: CHECK_NAME,
      head_sha: b,
      status: "completed",
      conclusion: "neutral",
      output: { title: "t", summary: "s", text: "x" },
    });
    expect(APP_PERMISSIONS).toEqual({
      checks: "write",
      contents: "read",
      metadata: "read",
      pull_requests: "read",
    });
    expect(
      githubAppManifest({
        name: "PathCompiler",
        url: "https://example.test",
        webhookUrl: "https://example.test/hook",
      }),
    ).toMatchObject({
      default_events: ["push", "pull_request"],
      public: false,
    });
    expect(() =>
      githubAppManifest({
        name: "x",
        url: "https://e.test",
        webhookUrl: "http://e.test",
      }),
    ).toThrow();
  });

  it("summarizes impact in the check format", () => {
    const check = summarizeWorkflowCheck(
      {
        schemaVersion: 1,
        base: { commit: a },
        head: { commit: b },
        method: "deterministic-rules",
        impacts: [
          {
            workflowId: "x.one",
            severity: "high",
            reasons: [
              {
                code: "target-removed",
                severity: "high",
                message: "Gone.",
                stepIds: [],
              },
            ],
            affectedSteps: [],
          },
          {
            workflowId: "x.two",
            severity: "low",
            reasons: [],
            affectedSteps: [],
          },
          {
            workflowId: "x.three",
            severity: "none",
            reasons: [],
            affectedSteps: [],
          },
        ],
      },
      {
        schemaVersion: 1,
        base: { commit: a },
        head: { commit: b },
        detections: [],
      },
    );
    expect(check).toMatchObject({
      conclusion: "neutral",
      title: "1 workflow requires review",
      summary:
        "✓ 2 workflows unaffected\n⚠ 1 workflow requires review\n+ 0 possible new workflows",
    });
    expect(check.text).toContain("x.one (high): Gone.");
  });

  it("adds an optional product logic section", () => {
    const impact = {
      schemaVersion: 1 as const,
      base: { commit: a },
      head: { commit: b },
      method: "deterministic-rules+bounded-smt" as const,
      impacts: [],
    };
    const detections = {
      schemaVersion: 1 as const,
      base: { commit: a },
      head: { commit: b },
      detections: [],
    };
    const empty = { added: [], removed: [], changed: [] };
    const model = {
      id: "product",
      hash: "sha256:x",
      repositoryCommit: a,
      source: "extracted" as const,
      transitions: {
        total: 1,
        deterministic: 1,
        tests: 0,
        runtime: 0,
        semanticOnly: 0,
      },
      uncertainties: 0,
    };
    const semantic: SemanticChangeReport = {
      schemaVersion: 1,
      type: "semantic_change_report",
      commitRange: { base: a, head: b },
      method: "bounded-smt",
      newReachability: [],
      removedReachability: [],
      changedApplicability: [],
      changedProperties: [],
      modelDiff: {
        variables: empty,
        actions: empty,
        goals: empty,
        invariants: empty,
      },
      affectedWorkflows: [
        {
          capabilityId: "clients.create",
          goal: "clients.created",
          code: "reachability-removed",
          message: "clients.created is no longer reachable for role=editor.",
        },
      ],
      models: { base: model, head: { ...model, repositoryCommit: b } },
      uncertainty: [],
      stats: { queries: 1, solverCalls: 1, durationMs: 1 },
    };
    expect(summarizeWorkflowCheck(impact, detections, semantic).text).toBe(
      [
        "PathCompiler Product Logic",
        "REMOVED REACHABILITY",
        "- clients.created is no longer reachable for role=editor.",
        "WORKFLOW IMPACT",
        "1 capability requires review: clients.create",
      ].join("\n"),
    );
    expect(summarizeWorkflowCheck(impact, detections).text).toBe(
      "No approved workflow is affected by this change.",
    );
  });

  it("analyzes a pushed change end to end and publishes the check", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-app-"));
    temporary.push(root);
    const origin = path.join(root, "origin");
    const clone = path.join(root, "clone");
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@example.test",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@example.test",
    };
    const git = async (cwd: string, ...args: string[]) =>
      (await exec("git", ["-C", cwd, ...args], { env })).stdout.trim();
    const fixture = fileURLToPath(
      new URL("../../../fixtures/next-demo", import.meta.url),
    );
    for (const file of (
      await exec("git", ["-C", fixture, "ls-files", "-z", "--", "."])
    ).stdout
      .split("\0")
      .filter(Boolean)) {
      await mkdir(path.dirname(path.join(origin, file)), { recursive: true });
      await cp(path.join(fixture, file), path.join(origin, file));
    }
    await git(root, "init", "--quiet", origin);
    await git(origin, "add", ".");
    await git(origin, "commit", "--quiet", "-m", "base");
    const base = await git(origin, "rev-parse", "HEAD");
    await git(root, "clone", "--quiet", origin, clone);
    const project = await readSourceProject(origin);
    const mined = minePlaywrightTests(
      project,
      analyzeNextProject(project).graph,
    );
    const capabilities = discoverCapabilities(mined.graph);
    await mkdir(path.join(clone, ".pathcompiler/workflows"), {
      recursive: true,
    });
    for (const candidate of discoverWorkflows(
      capabilities.graph,
      capabilities.report,
      mined.report,
    ).report.candidates)
      await writeFile(
        path.join(
          clone,
          `.pathcompiler/workflows/${candidate.workflow.id}.yaml`,
        ),
        serializeReviewedYaml(
          approveCandidate(candidate, {
            approvedBy: "Ana",
            approvedAt: "2026-10-22T10:00:00.000Z",
            validation: validateWorkflow(candidate.workflow, {
              graph: mined.graph,
              traces: mined.report,
            }),
            repository: project.repository,
          }),
        ),
      );
    const plans = path.join(origin, "components/plans.tsx");
    await writeFile(
      plans,
      (await readFile(plans, "utf8")).replace(
        '"plans.change_structure"',
        '"plans.restructure"',
      ),
    );
    await git(origin, "commit", "--quiet", "-am", "Rename structure action");
    const head = await git(origin, "rev-parse", "HEAD");
    const calls: Call[] = [];
    const worker = createWorkflowCheckWorker({
      auth: { installationToken: async () => "ghs_installation" },
      repositories: createLocalRepositoryProvider({
        "acme/demo": { path: clone },
      }),
      fetch: fakeGitHub(calls),
    });
    const check = await worker({ ...job, base, head });
    expect(check.conclusion).toBe("neutral");
    expect(check.summary).toContain("⚠ 1 workflow requires review");
    expect(check.summary).toContain("✓ 2 workflows unaffected");
    expect(check.text).toContain("plans.change_structure (high)");
    const published = JSON.parse(String(calls.at(-1)?.init.body));
    expect(published).toMatchObject({
      head_sha: head,
      conclusion: "neutral",
      name: CHECK_NAME,
    });
    expect(JSON.stringify(calls)).not.toContain("x-access-token");

    await expect(worker({ ...job, repo: "other", base, head })).rejects.toThrow(
      "not configured",
    );
    expect(JSON.parse(String(calls.at(-1)?.init.body))).toMatchObject({
      conclusion: "failure",
      output: { summary: expect.stringContaining("not configured") },
    });
  }, 90_000);
});
