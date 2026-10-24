import { execFile, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createStaticTransport, PathCompiler } from "@pathcompiler/sdk-js";
import { parseCandidateYaml } from "@pathcompiler/workflow-discovery";
import { parseApprovedWorkflowYaml } from "@pathcompiler/workflow-review";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const exec = promisify(execFile);
const temporary: string[] = [];
const binary = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo/", import.meta.url),
);
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function directory() {
  const result = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-cli-"));
  temporary.push(result);
  return result;
}

describe("pathcompiler CLI", () => {
  it("validates a fresh candidate and writes actionable failed reports without changing YAML", async () => {
    const cwd = await directory();
    await exec(
      process.execPath,
      [binary, "workflows", "discover", fixture, "--out", "artifacts"],
      { cwd },
    );
    const yamlPath = path.join(
      cwd,
      "artifacts/workflows/candidates/clients.create.yaml",
    );
    const yaml = await readFile(yamlPath, "utf8");
    const args = [
      binary,
      "workflows",
      "validate",
      "clients.create",
      fixture,
      "--out",
      "artifacts",
    ];
    const result = await exec(process.execPath, args, { cwd });
    expect(result.stdout).toContain("passed static validation");
    expect(result.stdout).toContain("Browser verification has not run");
    const reportPath = path.join(
      cwd,
      "artifacts/reports/validation/clients.create.json",
    );
    const report = await readFile(reportPath, "utf8");
    expect(JSON.parse(report).valid).toBe(true);
    await exec(process.execPath, args, { cwd });
    expect(await readFile(reportPath, "utf8")).toBe(report);
    expect(await readFile(yamlPath, "utf8")).toBe(yaml);
    const stale = yaml.replace(
      "target: clients.create",
      "target: stale.create",
    );
    await writeFile(yamlPath, stale);
    await expect(exec(process.execPath, args, { cwd })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("failed validation"),
    });
    const failed = JSON.parse(await readFile(reportPath, "utf8"));
    expect(failed.valid).toBe(false);
    expect(failed.errors).toContainEqual(
      expect.objectContaining({ code: "missing-target", stepId: "step.1" }),
    );
    expect(await readFile(yamlPath, "utf8")).toBe(stale);
    await expect(
      runCli(["workflows", "validate", "../secret", fixture], cwd),
    ).rejects.toThrow("Workflow ID");
  }, 20_000);

  it("approves, rejects, lists and shows reviewed workflows without replacing decisions", async () => {
    const cwd = await directory();
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    await run(["workflows", "discover", fixture]);
    const base = path.join(cwd, "out/workflows");
    const candidatePath = path.join(base, "candidates/clients.create.yaml");
    const candidate = await readFile(candidatePath, "utf8");
    const previous = process.env.PATHCOMPILER_USER;
    delete process.env.PATHCOMPILER_USER;
    try {
      await expect(
        run(["workflows", "approve", "clients.create", fixture]),
      ).rejects.toThrow("PATHCOMPILER_USER");
    } finally {
      if (previous !== undefined) process.env.PATHCOMPILER_USER = previous;
    }
    await expect(
      run(["workflows", "approve", "clients.create", fixture, "--by", " x"]),
    ).rejects.toThrow("Reviewer");
    const stale = candidate.replaceAll(
      parseCandidateYaml(candidate).workflow.repository.commit,
      "f".repeat(40),
    );
    await writeFile(candidatePath, stale);
    await expect(
      run(["workflows", "approve", "clients.create", fixture, "--by", "Ana"]),
    ).rejects.toThrow("different commit");
    await writeFile(candidatePath, candidate);
    expect(await readdir(base)).not.toContain("clients.create.yaml");

    const approved = await run([
      "workflows",
      "approve",
      "clients.create",
      fixture,
      "--by",
      "Ana",
    ]);
    expect(approved).toContain("Approved clients.create");
    const approvedPath = path.join(base, "clients.create.yaml");
    const approvedYaml = await readFile(approvedPath, "utf8");
    const record = parseApprovedWorkflowYaml(approvedYaml);
    expect(record.approval.approvedBy).toBe("Ana");
    expect(record.approval.approvedCommit).toBe(
      parseCandidateYaml(candidate).workflow.repository.commit,
    );
    expect(Date.parse(record.approval.approvedAt)).not.toBeNaN();
    expect(record.workflow.status).toBe("approved");
    expect(await readFile(candidatePath, "utf8")).toBe(candidate);
    for (const repeat of [
      ["workflows", "approve", "clients.create", fixture, "--by", "Bo"],
      ["workflows", "reject", "clients.create", "--by", "Bo"],
    ])
      await expect(run(repeat)).rejects.toThrow("already approved");
    await run(["workflows", "discover", fixture]);
    expect(await readFile(approvedPath, "utf8")).toBe(approvedYaml);

    await run([
      "workflows",
      "reject",
      "plans.create",
      "--by",
      "Ana",
      "--reason",
      "Covered by onboarding",
    ]);
    await expect(
      run(["workflows", "reject", "plans.create", "--by", "Ana"]),
    ).rejects.toThrow("already rejected");
    const listed = JSON.parse(await run(["workflows", "list", "--json"]));
    expect(
      listed.workflows.map((item: { id: string; state: string }) => [
        item.id,
        item.state,
      ]),
    ).toEqual([
      ["clients.create", "approved"],
      ["clients.deactivate", "candidate"],
      ["plans.archive", "candidate"],
      ["plans.change_structure", "candidate"],
      ["plans.create", "rejected"],
    ]);
    expect(await run(["workflows", "list"])).toContain(
      "1 approved, 1 rejected, 3 candidates",
    );
    const shown = JSON.parse(
      await run(["workflows", "show", "plans.create", "--json"]),
    );
    expect(shown.state).toBe("rejected");
    expect(shown.artifact.rejection.reason).toBe("Covered by onboarding");
    expect(await run(["workflows", "show", "clients.create"])).toContain(
      approvedYaml,
    );
    for (const invalid of [
      ["workflows", "show", "clients.missing"],
      ["workflows", "show", "../secret"],
      ["workflows", "list", "--by", "Ana"],
      ["workflows", "approve", "plans.change_structure", "--reason", "x"],
      [
        "workflows",
        "reject",
        "plans.change_structure",
        "--by",
        "Ana",
        "--reason",
        "",
      ],
      ["workflows", "list", "--exclude", "tests"],
    ])
      await expect(run(invalid)).rejects.toThrow();
    expect(await readdir(path.join(base, "rejected"))).toEqual([
      "plans.create.yaml",
    ]);
  }, 30_000);

  it("builds repeatable generated artifacts from approved workflows only", async () => {
    const cwd = await directory();
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    expect(await run(["build"])).toContain("Compiled 0 approved workflows");
    await run(["workflows", "discover", fixture]);
    await run([
      "workflows",
      "approve",
      "clients.create",
      fixture,
      "--by",
      "Ana",
    ]);
    await run(["workflows", "reject", "plans.create", "--by", "Ana"]);
    const result = await exec(
      process.execPath,
      [binary, "build", "--out", "out"],
      { cwd },
    );
    expect(result.stdout).toContain("Compiled 1 approved workflows");
    const generated = path.join(cwd, "out/generated");
    expect((await readdir(generated)).sort()).toEqual([
      "documentation.json",
      "runtime-manifest.json",
      "search-index.json",
    ]);
    const files = await Promise.all(
      ["search-index", "runtime-manifest", "documentation"].map((name) =>
        readFile(path.join(generated, `${name}.json`), "utf8"),
      ),
    );
    const [search, runtime] = files.map((file) => JSON.parse(file));
    expect(search.workflows.map((item: { id: string }) => item.id)).toEqual([
      "clients.create",
    ]);
    expect(runtime.workflows[0].steps).toHaveLength(4);
    const commit = parseApprovedWorkflowYaml(
      await readFile(
        path.join(cwd, "out/workflows/clients.create.yaml"),
        "utf8",
      ),
    ).approval.approvedCommit;
    expect(files[1]).not.toContain(commit);
    expect(files[1]).not.toContain("Ana");
    await run(["build"]);
    for (const [index, name] of [
      "search-index",
      "runtime-manifest",
      "documentation",
    ].entries())
      expect(await readFile(path.join(generated, `${name}.json`), "utf8")).toBe(
        files[index],
      );
    await writeFile(path.join(cwd, "out/workflows/broken.yaml"), "kind: x\n");
    await expect(run(["build"])).rejects.toThrow("broken.yaml");
    await writeFile(
      path.join(cwd, "out/workflows/plans.create.yaml"),
      "kind: x\n",
    );
    await rm(path.join(cwd, "out/workflows/broken.yaml"));
    await expect(run(["build"])).rejects.toThrow("approved workflow");
    for (const invalid of [
      ["build", "extra"],
      ["build", "--json"],
      ["build", "--exclude", "tests"],
    ])
      await expect(run(invalid)).rejects.toThrow();
  }, 30_000);

  it("serves MCP tools over stdio from generated artifacts", async () => {
    const cwd = await directory();
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    await expect(run(["mcp"])).rejects.toThrow("Run pathcompiler build first");
    await run(["workflows", "discover", fixture]);
    await run([
      "workflows",
      "approve",
      "clients.create",
      fixture,
      "--by",
      "Ana",
    ]);
    await run(["build"]);
    const client = new Client({ name: "cli-test", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [binary, "mcp", "--out", "out"],
      cwd,
      stderr: "pipe",
    });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools).toHaveLength(5);
      const result = await client.callTool({
        name: "pathcompiler.resolve_help",
        arguments: { query: "how do I add a new client" },
      });
      expect(result.structuredContent).toMatchObject({
        result: { type: "workflow_help", workflowId: "clients.create" },
      });
    } finally {
      await client.close();
    }
    for (const invalid of [
      ["mcp", "extra"],
      ["mcp", "--exclude", "x"],
    ])
      await expect(run(invalid)).rejects.toThrow();
  }, 30_000);

  it("serves the token-protected HTTP API from generated artifacts", async () => {
    const cwd = await directory();
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    await run(["workflows", "discover", fixture]);
    await run([
      "workflows",
      "approve",
      "clients.create",
      fixture,
      "--by",
      "Ana",
    ]);
    await run(["build"]);
    const token = "cli-test-token-0123456789";
    const child = spawn(
      process.execPath,
      [binary, "serve", "--out", "out", "--port", "0", "--events"],
      { cwd, env: { ...process.env, PATHCOMPILER_API_TOKEN: token } },
    );
    try {
      const url = await new Promise<string>((resolve, reject) => {
        child.stdout.on("data", (chunk: Buffer) => {
          const found = /listening on (http:\/\/\S+)/.exec(chunk.toString());
          if (found?.[1]) resolve(found[1]);
        });
        child.once("exit", (code) => reject(new Error(`serve exited ${code}`)));
      });
      const denied = await fetch(`${url}/v1/workflows/clients.create`);
      expect(denied.status).toBe(401);
      const response = await fetch(`${url}/v1/help/resolve`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: "add a new client" }),
      });
      expect(await response.json()).toMatchObject({
        type: "workflow_help",
        workflowId: "clients.create",
      });
      const ingest = await fetch(`${url}/v1/events/batch`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          events: [
            {
              schemaVersion: 1,
              eventId: "evt-1",
              timestamp: "2026-10-23T10:00:00.000Z",
              // The served project is named after the output's parent directory.
              projectId: path.basename(cwd),
              sessionId: "s-1",
              privacy: { pii: false, userIdHashed: false },
              type: "goal.reached",
              goalId: "clients.created",
            },
          ],
        }),
      });
      expect(await ingest.json()).toEqual({ accepted: 1, rejected: [] });
      expect(
        await readFile(
          path.join(cwd, "out/events", path.basename(cwd), "2026-10-23.ndjson"),
          "utf8",
        ),
      ).toContain('"goalId":"clients.created"');
      const observed = await run(["observe", "graph"]);
      expect(observed).toContain(
        "Observed 1 events in 1 sessions: 3 states, 2 transitions.",
      );
      expect(
        JSON.parse(
          await readFile(
            path.join(cwd, "out/reports/observed-graph.json"),
            "utf8",
          ),
        ).edges.map(
          (edge: { from: string; to: string }) => `${edge.from}>${edge.to}`,
        ),
      ).toEqual([
        "goal:clients.created>session:end",
        "session:start>goal:clients.created",
      ]);
      expect(await run(["observe", "workflows"])).toContain(
        "No guide runs recorded (workflow.started events).",
      );
      const reconciled = await run(["observe", "reconcile", fixture]);
      expect(reconciled).toMatch(
        /^Reconciled \d+ goal\/target × role pairs \(roles: \(none\) 1 sessions\)/,
      );
      expect(reconciled).toContain(
        "Discrepancies are evidence to investigate, not verdicts.",
      );
      const efficiency = await run(["observe", "efficiency", fixture]);
      expect(efficiency).toContain(
        "  clients.created ((none)): 1 completions; too few to compute a ratio",
      );
      expect(await run(["observe", "drop-offs", fixture])).toMatch(
        /^Drop-offs \(hypotheses; rates need 30\+ attempts/,
      );
    } finally {
      child.kill();
    }
    const previous = process.env.PATHCOMPILER_API_TOKEN;
    delete process.env.PATHCOMPILER_API_TOKEN;
    try {
      await expect(run(["serve"])).rejects.toThrow("PATHCOMPILER_API_TOKEN");
    } finally {
      if (previous !== undefined) process.env.PATHCOMPILER_API_TOKEN = previous;
    }
    for (const invalid of [
      ["build", "--port", "1"],
      ["mcp", "--host", "0.0.0.0"],
    ])
      await expect(run(invalid)).rejects.toThrow("--port and --host");
  }, 30_000);

  it("writes a graph delta between two local commits", async () => {
    const cwd = await directory();
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.test",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.test",
    };
    const git = async (...args: string[]) =>
      (await exec("git", ["-C", cwd, ...args], { env })).stdout.trim();
    await mkdir(path.join(cwd, "app"), { recursive: true });
    await writeFile(
      path.join(cwd, "app/page.tsx"),
      "export default function Page() { return <main />; }\n",
    );
    await git("init", "--quiet");
    await git("add", ".");
    await git("commit", "--quiet", "-m", "base");
    const base = await git("rev-parse", "HEAD");
    await mkdir(path.join(cwd, "app/settings"));
    await writeFile(
      path.join(cwd, "app/settings/page.tsx"),
      "export default function Settings() { return <main />; }\n",
    );
    await git("add", ".");
    await git("commit", "--quiet", "-m", "head");
    const result = await exec(
      process.execPath,
      [binary, "diff", base, "HEAD", ".", "--out", "out"],
      { cwd },
    );
    expect(result.stdout).toContain("1 files changed");
    expect(result.stdout).toContain("Routes +1 -0 ~0");
    const delta = JSON.parse(
      await readFile(path.join(cwd, "out/reports/graph-delta.json"), "utf8"),
    );
    expect(delta.base.commit).toBe(base);
    expect(delta.summary.routes.added).toEqual(["route:/settings"]);
    expect(await git("status", "--porcelain", "--", "app")).toBe("");
    await expect(runCli(["diff", base], cwd)).rejects.toThrow();
    await expect(runCli(["diff", base, "nope"], cwd)).rejects.toThrow();
  }, 30_000);

  it("reports workflow impact between commits without changing approvals", async () => {
    const cwd = await directory();
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.test",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.test",
    };
    const app = path.join(cwd, "app");
    const git = async (...args: string[]) =>
      (await exec("git", ["-C", app, ...args], { env })).stdout.trim();
    const tracked = (
      await exec("git", ["-C", fixture, "ls-files", "-z", "--", "."])
    ).stdout
      .split("\0")
      .filter(Boolean);
    for (const file of tracked) {
      await mkdir(path.dirname(path.join(app, file)), { recursive: true });
      await writeFile(
        path.join(app, file),
        await readFile(path.join(fixture, file)),
      );
    }
    await git("init", "--quiet");
    await git("add", ".");
    await git("commit", "--quiet", "-m", "base");
    const base = await git("rev-parse", "HEAD");
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    await expect(run(["impact", base, "HEAD", "app"])).rejects.toThrow(
      "No approved workflows",
    );
    await run(["workflows", "discover", "app"]);
    await run([
      "workflows",
      "approve",
      "plans.change_structure",
      "app",
      "--by",
      "Ana",
    ]);
    const approvedPath = path.join(
      cwd,
      "out/workflows/plans.change_structure.yaml",
    );
    const approvedYaml = await readFile(approvedPath, "utf8");
    const plans = path.join(app, "components/plans.tsx");
    await writeFile(
      plans,
      (await readFile(plans, "utf8")).replace(
        'data-pathcompiler="plans.change_structure"',
        'data-pathcompiler="plans.restructure"',
      ),
    );
    await git("commit", "--quiet", "-am", "rename target");
    const output = await run(["impact", base, "HEAD", "app"]);
    expect(output).toContain("high   plans.change_structure  target-removed");
    const report = JSON.parse(
      await readFile(
        path.join(cwd, "out/reports/workflow-impact.json"),
        "utf8",
      ),
    );
    expect(report.impacts[0]).toMatchObject({
      workflowId: "plans.change_structure",
      severity: "high",
      affectedSteps: ["step.1"],
    });
    expect(await readFile(approvedPath, "utf8")).toBe(approvedYaml);
  }, 60_000);

  it("generates, lists, shows and accepts workflow update proposals", async () => {
    const cwd = await directory();
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.test",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.test",
    };
    const app = path.join(cwd, "app");
    const git = async (...args: string[]) =>
      (await exec("git", ["-C", app, ...args], { env })).stdout.trim();
    const tracked = (
      await exec("git", ["-C", fixture, "ls-files", "-z", "--", "."])
    ).stdout
      .split("\0")
      .filter(Boolean);
    for (const file of tracked) {
      await mkdir(path.dirname(path.join(app, file)), { recursive: true });
      await writeFile(
        path.join(app, file),
        await readFile(path.join(fixture, file)),
      );
    }
    await git("init", "--quiet");
    await git("add", ".");
    await git("commit", "--quiet", "-m", "base");
    const base = await git("rev-parse", "HEAD");
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    await run(["workflows", "discover", "app"]);
    await run([
      "workflows",
      "approve",
      "plans.change_structure",
      "app",
      "--by",
      "Ana",
    ]);
    for (const file of ["components/plans.tsx", "tests/workflows.spec.ts"]) {
      const target = path.join(app, file);
      await writeFile(
        target,
        (await readFile(target, "utf8")).replaceAll(
          '"plans.change_structure"',
          '"plans.restructure"',
        ),
      );
    }
    await git("commit", "--quiet", "-am", "Rename plan structure action");
    const head = await git("rev-parse", "HEAD");
    const generated = await run(["proposals", "generate", base, "HEAD", "app"]);
    const name = `plans.change_structure.${head}`;
    expect(generated).toContain("Wrote 1 proposals");
    expect(generated).toContain(name);
    const listed = JSON.parse(await run(["proposals", "list", "--json"]));
    expect(listed.proposals).toEqual([
      expect.objectContaining({
        name,
        severity: "high",
        status: "pending",
        valid: true,
      }),
    ]);
    const shown = await run(["proposals", "show", name]);
    expect(shown).toMatch(/^--- approved plans\.change_structure/);
    expect(shown).toContain(
      "-     target: plans.change_structure\n+     target: plans.restructure",
    );
    const approvedPath = path.join(
      cwd,
      "out/workflows/plans.change_structure.yaml",
    );
    await writeFile(path.join(app, "scratch.ts"), "export const x = 1;\n");
    await expect(
      run(["proposals", "accept", name, "app", "--by", "Bo"]),
    ).rejects.toThrow("Commit or stash");
    await rm(path.join(app, "scratch.ts"));
    const accepted = await run([
      "proposals",
      "accept",
      name,
      "app",
      "--by",
      "Bo",
    ]);
    expect(accepted).toContain("Accepted");
    const record = parseApprovedWorkflowYaml(
      await readFile(approvedPath, "utf8"),
    );
    expect(record.approval).toMatchObject({
      approvedBy: "Bo",
      approvedCommit: head,
    });
    expect(record.workflow.steps[0]?.target).toBe("plans.restructure");
    await expect(
      run(["proposals", "reject", name, "--by", "Bo"]),
    ).rejects.toThrow("already accepted");
    expect(await run(["proposals", "generate", base, "HEAD", "app"])).toContain(
      "kept 1 existing",
    );
    for (const invalid of [
      ["proposals", "show", "bad name"],
      ["proposals", "list", "--by", "x"],
      ["proposals", "show", name, "--json"],
    ])
      await expect(run(invalid)).rejects.toThrow();
  }, 90_000);

  it("detects a new capability and writes an approvable candidate", async () => {
    const cwd = await directory();
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.test",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.test",
    };
    const app = path.join(cwd, "app");
    const git = async (...args: string[]) =>
      (await exec("git", ["-C", app, ...args], { env })).stdout.trim();
    const tracked = (
      await exec("git", ["-C", fixture, "ls-files", "-z", "--", "."])
    ).stdout
      .split("\0")
      .filter(Boolean);
    for (const file of tracked) {
      await mkdir(path.dirname(path.join(app, file)), { recursive: true });
      await writeFile(
        path.join(app, file),
        await readFile(path.join(fixture, file)),
      );
    }
    await git("init", "--quiet");
    await git("add", ".");
    await git("commit", "--quiet", "-m", "base");
    const base = await git("rev-parse", "HEAD");
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    await run(["workflows", "discover", "app"]);
    for (const id of [
      "clients.create",
      "plans.create",
      "plans.change_structure",
    ])
      await run(["workflows", "approve", id, "app", "--by", "Ana"]);
    const plans = path.join(app, "components/plans.tsx");
    await writeFile(
      plans,
      (await readFile(plans, "utf8"))
        .replace(
          '  return (\n    <>\n      <div className="page-heading">',
          "  async function duplicate(plan: Plan) {\n    await save(`/api/plans/$" +
            '{plan.id}/duplicate`, "POST", {});\n    setNotice("Plan duplicated");\n    router.refresh();\n  }\n\n  return (\n    <>\n      <div className="page-heading">',
        )
        .replace(
          "                  Change Plan Structure\n                </button>\n              )}",
          '                  Change Plan Structure\n                </button>\n              )}\n              {canEdit && (\n                <button\n                  data-pathcompiler="plans.duplicate"\n                  type="button"\n                  onClick={() => duplicate(plan)}\n                >\n                  Duplicate Plan\n                </button>\n              )}',
        ),
    );
    await mkdir(path.join(app, "app/api/plans/[id]/duplicate"), {
      recursive: true,
    });
    await writeFile(
      path.join(app, "app/api/plans/[id]/duplicate/route.ts"),
      'import { handleRequest, readSession, writeSession } from "../../../../../lib/session";\n\nexport async function POST() {\n  return handleRequest(async () => writeSession(await readSession(), null, 201));\n}\n',
    );
    const tests = path.join(app, "tests/workflows.spec.ts");
    await writeFile(
      tests,
      `${await readFile(tests, "utf8")}\ntest("Duplicate Plan", async ({ page }) => {\n  await page.goto("/plans");\n  await page.locator('[data-pathcompiler="plans.duplicate"]').click();\n  await expect(page.locator('[data-pathcompiler="plans.feedback"]')).toHaveText("Plan duplicated");\n});\n`,
    );
    await git("add", ".");
    await git("commit", "--quiet", "-m", "Duplicate a plan");
    const output = await run(["workflows", "detect", base, "HEAD", "app"]);
    expect(output).toContain("new-candidate         plans.duplicate");
    expect(output).toContain("Wrote 1 candidates");
    const report = JSON.parse(
      await readFile(path.join(cwd, "out/reports/new-workflows.json"), "utf8"),
    );
    expect(
      report.detections.map(
        (item: { capabilityId: string }) => item.capabilityId,
      ),
    ).toEqual(["plans.duplicate"]);
    expect(
      await run([
        "workflows",
        "approve",
        "plans.duplicate",
        "app",
        "--by",
        "Ana",
      ]),
    ).toContain("Approved plans.duplicate");
    expect(await run(["workflows", "detect", base, "HEAD", "app"])).toContain(
      "0 new capabilities",
    );
  }, 90_000);

  it("proposes and accepts deprecation when a workflow loses its support", async () => {
    const cwd = await directory();
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.test",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.test",
    };
    const app = path.join(cwd, "app");
    const git = async (...args: string[]) =>
      (await exec("git", ["-C", app, ...args], { env })).stdout.trim();
    const tracked = (
      await exec("git", ["-C", fixture, "ls-files", "-z", "--", "."])
    ).stdout
      .split("\0")
      .filter(Boolean);
    for (const file of tracked) {
      await mkdir(path.dirname(path.join(app, file)), { recursive: true });
      await writeFile(
        path.join(app, file),
        await readFile(path.join(fixture, file)),
      );
    }
    await git("init", "--quiet");
    await git("add", ".");
    await git("commit", "--quiet", "-m", "base");
    const base = await git("rev-parse", "HEAD");
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    await run(["workflows", "discover", "app"]);
    await run([
      "workflows",
      "approve",
      "plans.change_structure",
      "app",
      "--by",
      "Ana",
    ]);
    await run(["workflows", "approve", "plans.create", "app", "--by", "Ana"]);
    const plans = path.join(app, "components/plans.tsx");
    const source = await readFile(plans, "utf8");
    const start = source.indexOf(
      "              {canEdit && session.featureFlags.planStructure && (",
    );
    const end =
      source.indexOf("              )}", start) + "              )}".length;
    expect(start).toBeGreaterThan(0);
    await writeFile(plans, source.slice(0, start) + source.slice(end));
    await git("commit", "--quiet", "-am", "Remove plan structure editing");
    const head = await git("rev-parse", "HEAD");
    expect(await run(["proposals", "generate", base, "HEAD", "app"])).toContain(
      `plans.change_structure.${head}`,
    );
    const name = `plans.change_structure.${head}`;
    const listed = JSON.parse(await run(["proposals", "list", "--json"]));
    expect(listed.proposals).toContainEqual(
      expect.objectContaining({ name, kind: "deprecation", severity: "high" }),
    );
    expect(await run(["proposals", "show", name])).toContain(
      "lost implementation support",
    );
    const approvedPath = path.join(
      cwd,
      "out/workflows/plans.change_structure.yaml",
    );
    const accepted = await run(["proposals", "accept", name, "--by", "Bo"]);
    expect(accepted).toContain("Deprecated plans.change_structure");
    await expect(readFile(approvedPath, "utf8")).rejects.toThrow();
    const shown = JSON.parse(
      await run(["workflows", "show", "plans.change_structure", "--json"]),
    );
    expect(shown).toMatchObject({
      state: "deprecated",
      artifact: { deprecation: { deprecatedBy: "Bo", deprecatedCommit: head } },
    });
    await run(["build"]);
    const index = JSON.parse(
      await readFile(path.join(cwd, "out/generated/search-index.json"), "utf8"),
    );
    expect(index.workflows.map((item: { id: string }) => item.id)).toEqual([
      "plans.create",
    ]);
    await expect(
      run([
        "workflows",
        "approve",
        "plans.change_structure",
        "app",
        "--by",
        "Ana",
      ]),
    ).rejects.toThrow("deprecated");
  }, 90_000);

  it("prints the GitHub App manifest and serves verified webhooks", async () => {
    const cwd = await directory();
    const manifest = JSON.parse(
      await runCli(
        [
          "github-app",
          "manifest",
          "--name",
          "PathCompiler",
          "--url",
          "https://example.test",
          "--webhook",
          "https://example.test/hook",
        ],
        cwd,
      ),
    );
    expect(manifest.default_permissions).toEqual({
      checks: "write",
      contents: "read",
      metadata: "read",
      pull_requests: "read",
    });
    const { generateKeyPairSync, createHmac } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await writeFile(
      path.join(cwd, "app.pem"),
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    await writeFile(
      path.join(cwd, "app.json"),
      JSON.stringify({
        appId: "123",
        privateKeyPath: "app.pem",
        repositories: { "acme/demo": { path: "clone" } },
      }),
    );
    const secret = "cli-webhook-secret-0123";
    const child = spawn(
      process.execPath,
      [binary, "github-app", "serve", "--config", "app.json", "--port", "0"],
      { cwd, env: { ...process.env, GITHUB_WEBHOOK_SECRET: secret } },
    );
    try {
      const url = await new Promise<string>((resolve, reject) => {
        child.stdout.on("data", (chunk: Buffer) => {
          const found = /listening on (http:\/\/\S+)/.exec(chunk.toString());
          if (found?.[1]) resolve(found[1]);
        });
        child.once("exit", (code) => reject(new Error(`serve exited ${code}`)));
      });
      const body = "{}";
      const ping = await fetch(url, {
        method: "POST",
        headers: {
          "x-github-event": "ping",
          "x-github-delivery": "1",
          "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
        },
        body,
      });
      expect(ping.status).toBe(200);
      const forged = await fetch(url, {
        method: "POST",
        headers: { "x-github-event": "ping", "x-github-delivery": "2" },
        body,
      });
      expect(forged.status).toBe(401);
    } finally {
      child.kill();
    }
    const previous = process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.GITHUB_WEBHOOK_SECRET;
    try {
      await expect(
        runCli(["github-app", "serve", "--config", "app.json"], cwd),
      ).rejects.toThrow("GITHUB_WEBHOOK_SECRET");
    } finally {
      if (previous !== undefined) process.env.GITHUB_WEBHOOK_SECRET = previous;
    }
    await expect(runCli(["build", "--config", "x"], cwd)).rejects.toThrow(
      "only supported by github-app",
    );
  }, 30_000);

  it("exports static JSON, YAML and Markdown usable without any server", async () => {
    const cwd = await directory();
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    await run(["workflows", "discover", fixture]);
    await run([
      "workflows",
      "approve",
      "clients.create",
      fixture,
      "--by",
      "Ana",
    ]);
    expect(
      await run(["build", "--format", "json,yaml", "--format", "markdown"]),
    ).toContain("(json, markdown, yaml)");
    const generated = path.join(cwd, "out/generated");
    expect((await readdir(generated)).sort()).toEqual([
      "documentation.json",
      "documentation.yaml",
      "runtime-manifest.json",
      "runtime-manifest.yaml",
      "search-index.json",
      "search-index.yaml",
      "workflows.md",
    ]);
    expect(
      await readFile(path.join(generated, "workflows.md"), "utf8"),
    ).toContain("# Product workflows");
    const [searchIndex, runtimeManifest, documentation] = await Promise.all(
      ["search-index", "runtime-manifest", "documentation"].map(async (name) =>
        JSON.parse(
          await readFile(path.join(generated, `${name}.json`), "utf8"),
        ),
      ),
    );
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network disabled");
    }) as typeof fetch;
    try {
      const client = new PathCompiler({
        project: "offline",
        transport: createStaticTransport({
          searchIndex,
          runtimeManifest,
          documentation,
        }),
      });
      expect(await client.resolve({ query: "add a client" })).toMatchObject({
        type: "workflow_help",
        workflowId: "clients.create",
      });
      expect(
        (await client.workflows.getRuntimeManifest("clients.create")).steps,
      ).toHaveLength(4);
    } finally {
      globalThis.fetch = realFetch;
    }
    for (const invalid of [
      ["build", "--format", "xml"],
      ["build", "--format", ""],
      ["workflows", "list", "--format", "json"],
    ])
      await expect(run(invalid)).rejects.toThrow("--format");
  }, 30_000);

  it("exports help pages from approved workflows without overwriting hand-written docs", async () => {
    const cwd = await directory();
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    await run(["workflows", "discover", fixture]);
    await run([
      "workflows",
      "approve",
      "clients.create",
      fixture,
      "--by",
      "Ana",
    ]);
    await run(["workflows", "approve", "plans.create", fixture, "--by", "Ana"]);
    const help = path.join(cwd, "docs/help");
    await mkdir(help, { recursive: true });
    await writeFile(path.join(help, "faq.md"), "# FAQ\nHand-written.\n");
    expect(await run(["docs", "export"])).toContain("Exported 2 help pages");
    expect((await readdir(help)).sort()).toEqual([
      "clients.create.md",
      "faq.md",
      "index.md",
      "plans.create.md",
    ]);
    const page = await readFile(path.join(help, "clients.create.md"), "utf8");
    expect(page).toContain("1. Click Create Client");
    await run(["docs", "export"]);
    expect(await readFile(path.join(help, "clients.create.md"), "utf8")).toBe(
      page,
    );
    expect(await readFile(path.join(help, "faq.md"), "utf8")).toBe(
      "# FAQ\nHand-written.\n",
    );
    await rm(path.join(cwd, "out/workflows/plans.create.yaml"));
    expect(await run(["docs", "export"])).toContain("removed 1 pages");
    expect(await readdir(help)).not.toContain("plans.create.md");
    await writeFile(path.join(help, "clients.create.md"), "# My own page\n");
    await expect(run(["docs", "export"])).rejects.toThrow(
      "Refusing to replace hand-written",
    );
    expect(await readFile(path.join(help, "clients.create.md"), "utf8")).toBe(
      "# My own page\n",
    );
    expect(await run(["docs", "export", "--dir", "site/help"])).toContain(
      path.join(cwd, "site/help"),
    );
    await expect(run(["build", "--dir", "x"])).rejects.toThrow("--dir");
  }, 30_000);

  it("writes repeatable candidate YAML and protects approved artifacts before any replacement", async () => {
    const cwd = await directory();
    const args = [binary, "workflows", "discover", fixture];
    const first = await exec(process.execPath, args, { cwd });
    expect(first.stdout).toContain("Discovered 5 workflow candidates");
    expect(first.stderr).toBe("");
    const base = path.join(cwd, ".pathcompiler");
    const reportPath = path.join(base, "reports/workflow-candidates.json");
    const yamlPath = path.join(
      base,
      "workflows/candidates/clients.create.yaml",
    );
    const report = await readFile(reportPath, "utf8");
    const yaml = await readFile(yamlPath, "utf8");
    expect(parseCandidateYaml(yaml).workflow.id).toBe("clients.create");
    expect(await readdir(path.join(base, "workflows/candidates"))).toHaveLength(
      5,
    );
    await writeFile(
      path.join(base, "graph/source-graph.json"),
      "preserve prior artifact",
    );
    await exec(process.execPath, args, { cwd });
    expect(await readFile(reportPath, "utf8")).toBe(report);
    expect(await readFile(yamlPath, "utf8")).toBe(yaml);
    expect(
      await readFile(path.join(base, "graph/source-graph.json"), "utf8"),
    ).toBe("preserve prior artifact");
    const protectedPath = path.join(
      base,
      "workflows/candidates/plans.create.yaml",
    );
    const approved = (await readFile(protectedPath, "utf8")).replace(
      "status: candidate",
      "status: approved",
    );
    await writeFile(protectedPath, approved);
    await writeFile(yamlPath, `${yaml}# preserve on preflight failure\n`);
    await expect(
      runCli(["workflows", "discover", fixture], cwd),
    ).rejects.toThrow("Refusing to replace");
    expect(await readFile(protectedPath, "utf8")).toBe(approved);
    expect(await readFile(yamlPath, "utf8")).toBe(
      `${yaml}# preserve on preflight failure\n`,
    );
    await runCli(
      [
        "workflows",
        "discover",
        fixture,
        "--out",
        "no-tests",
        "--exclude",
        "tests",
      ],
      cwd,
    );
    expect(
      JSON.parse(
        await readFile(
          path.join(cwd, "no-tests/reports/workflow-candidates.json"),
          "utf8",
        ),
      ).candidates,
    ).toEqual([]);
    for (const invalid of [
      ["workflows", "discover", fixture, "--json"],
      ["workflows", "discover", fixture, "--expect", "file"],
      ["workflows", "discover", fixture, "extra"],
    ])
      await expect(runCli(invalid, cwd)).rejects.toThrow();
  });

  it("writes the specified artifacts from the built binary with repeatable bytes", async () => {
    const cwd = await directory();
    const first = await exec(process.execPath, [binary, "scan", fixture], {
      cwd,
    });
    expect(first.stdout).toContain("Scanned");
    expect(first.stderr).toBe("");
    const graphPath = path.join(cwd, ".pathcompiler/graph/source-graph.json");
    const reportPath = path.join(
      cwd,
      ".pathcompiler/reports/scan-summary.json",
    );
    const graph = await readFile(graphPath, "utf8");
    const report = await readFile(reportPath, "utf8");
    expect(JSON.parse(graph).schemaVersion).toBe(1);
    expect(JSON.parse(report).framework).toBe("nextjs-app-router");
    await exec(process.execPath, [binary, "scan", fixture], { cwd });
    expect(await readFile(graphPath, "utf8")).toBe(graph);
    expect(await readFile(reportPath, "utf8")).toBe(report);
  });

  it("supports explicit output and exclusions without mutating source files", async () => {
    const cwd = await directory();
    await mkdir(path.join(cwd, "app"));
    await mkdir(path.join(cwd, "private"));
    const source = "export default function Page() { return <main />; }";
    await writeFile(path.join(cwd, "app/page.tsx"), source);
    await writeFile(path.join(cwd, "private/invalid.ts"), "invalid syntax %%%");
    await runCli(
      ["scan", ".", "--out", "artifacts", "--exclude", "private"],
      cwd,
    );
    expect(await readFile(path.join(cwd, "app/page.tsx"), "utf8")).toBe(source);
    expect(
      await readFile(
        path.join(cwd, "artifacts/graph/source-graph.json"),
        "utf8",
      ),
    ).not.toContain("private/invalid.ts");
  });

  it("suggests targets with readable and versioned JSON output without writing files", async () => {
    const cwd = await directory();
    await mkdir(path.join(cwd, "app"));
    const source =
      'export default function Page() { return <><button data-pathcompiler="clients.create">Create</button><button data-testid="save">Save</button></>; }';
    await writeFile(path.join(cwd, "app/page.tsx"), source);
    const first = await exec(
      process.execPath,
      [binary, "targets", "suggest", "--json"],
      { cwd },
    );
    const second = await exec(
      process.execPath,
      [binary, "targets", "suggest", ".", "--json"],
      { cwd },
    );
    expect(first.stdout).toBe(second.stdout);
    const report = JSON.parse(first.stdout);
    expect(report).toMatchObject({
      schemaVersion: 1,
      targets: expect.arrayContaining([
        expect.objectContaining({
          suggestedTarget: "page.save",
          file: "app/page.tsx",
          target: expect.objectContaining({ confidence: 0.8 }),
        }),
        expect.objectContaining({
          nodeId: "ui:clients.create",
          target: expect.objectContaining({ confidence: 1 }),
        }),
      ]),
    });
    expect(await runCli(["targets", "suggest"], cwd)).toContain(
      "Suggested target: page.save",
    );
    expect(await readdir(cwd)).toEqual(["app"]);
    expect(await readFile(path.join(cwd, "app/page.tsx"), "utf8")).toBe(source);
    await mkdir(path.join(cwd, "excluded"));
    await writeFile(path.join(cwd, "excluded/bad.ts"), "invalid %%%");
    expect(
      await runCli(["targets", "suggest", ".", "--exclude", "excluded"], cwd),
    ).toContain("No files changed");
    for (const args of [
      ["targets", "apply"],
      ["targets", "suggest", "--out", "x"],
      ["targets", "suggest", ".", "extra"],
      ["scan", ".", "--json"],
    ]) {
      await expect(runCli(args, cwd)).rejects.toThrow();
    }
  });

  it("mines fixture test evidence into separate repeatable artifacts through the built CLI", async () => {
    const cwd = await directory();
    const args = [binary, "tests", "mine", fixture, "--out", "evidence"];
    const first = await exec(process.execPath, args, { cwd });
    expect(first.stdout).toContain("Mined 9 Playwright tests");
    const traceFile = path.join(cwd, "evidence/reports/test-traces.json");
    const graphFile = path.join(cwd, "evidence/graph/test-graph.json");
    const traces = await readFile(traceFile, "utf8");
    const graph = await readFile(graphFile, "utf8");
    expect(JSON.parse(traces)).toMatchObject({
      schemaVersion: 1,
      evidenceOnly: true,
      execution: "not-run",
      traces: expect.any(Array),
    });
    expect(
      JSON.parse(graph).nodes.filter(
        (node: { type: string }) => node.type === "Test",
      ),
    ).toHaveLength(9);
    await exec(process.execPath, args, { cwd });
    expect(await readFile(traceFile, "utf8")).toBe(traces);
    expect(await readFile(graphFile, "utf8")).toBe(graph);
    expect(await readdir(path.join(cwd, "evidence/graph"))).toEqual([
      "test-graph.json",
    ]);
    expect(
      await runCli(
        ["tests", "mine", fixture, "--out", "excluded", "--exclude", "tests"],
        cwd,
      ),
    ).toContain("Mined 0 Playwright tests");
    for (const args of [
      ["tests", "mine", fixture, "extra"],
      ["tests", "mine", fixture, "--json"],
      ["tests", "unknown"],
    ])
      await expect(runCli(args, cwd)).rejects.toThrow();
  });

  it("discovers repeatable surface artifacts, preserving source and existing scan outputs", async () => {
    const cwd = await directory();
    await mkdir(path.join(cwd, "app"));
    await mkdir(path.join(cwd, "excluded"));
    const source =
      'export default function Page() { return <dialog><form data-pathcompiler="client.form"><button data-pathcompiler="client.save">Save</button></form></dialog>; }';
    await writeFile(path.join(cwd, "app/page.tsx"), source);
    await writeFile(path.join(cwd, "excluded/bad.ts"), "invalid syntax %%%");
    await runCli(
      ["scan", ".", "--exclude", "excluded", "--out", "artifacts"],
      cwd,
    );
    const sourceGraph = await readFile(
      path.join(cwd, "artifacts/graph/source-graph.json"),
      "utf8",
    );
    const args = [
      binary,
      "surfaces",
      "discover",
      "--exclude",
      "excluded",
      "--out",
      "artifacts",
    ];
    const first = await exec(process.execPath, args, { cwd });
    expect(first.stdout).toContain("Discovered 4 candidate product surfaces");
    expect(first.stderr).toBe("");
    const reportPath = path.join(
      cwd,
      "artifacts/reports/product-surfaces.json",
    );
    const graphPath = path.join(cwd, "artifacts/graph/surface-graph.json");
    const report = await readFile(reportPath, "utf8");
    const graph = await readFile(graphPath, "utf8");
    expect(JSON.parse(report)).toMatchObject({
      schemaVersion: 1,
      evidenceOnly: true,
      repository: { commit: null, dirty: null },
      surfaces: expect.any(Array),
    });
    expect(report).not.toContain("excluded/bad.ts");
    expect(graph).toContain('"ProductSurface"');
    await exec(process.execPath, args, { cwd });
    expect(await readFile(reportPath, "utf8")).toBe(report);
    expect(await readFile(graphPath, "utf8")).toBe(graph);
    expect(
      await readFile(
        path.join(cwd, "artifacts/graph/source-graph.json"),
        "utf8",
      ),
    ).toBe(sourceGraph);
    expect(await readFile(path.join(cwd, "app/page.tsx"), "utf8")).toBe(source);
    for (const invalid of [
      ["surfaces", "discover", "--json"],
      ["surfaces", "discover", "--node", "x"],
      ["surfaces", "discover", "--pr", "1"],
      ["surfaces", "discover", ".", "extra"],
      ["surfaces", "unknown"],
    ])
      await expect(runCli(invalid, cwd)).rejects.toThrow();
  });

  it("discovers all fixture capabilities and evaluates explicit ground truth through the built CLI", async () => {
    const cwd = await directory();
    const args = [
      binary,
      "capabilities",
      "discover",
      fixture,
      "--out",
      "artifacts",
      "--expect",
      path.join(fixture, "capabilities.expected.json"),
    ];
    await runCli(["surfaces", "discover", fixture, "--out", "artifacts"], cwd);
    const oldSurfaceGraph = await readFile(
      path.join(cwd, "artifacts/graph/surface-graph.json"),
      "utf8",
    );
    const first = await exec(process.execPath, args, { cwd });
    expect(first.stdout).toContain("Discovered 6 candidate capabilities");
    expect(first.stdout).toContain("False positives: 0; false negatives: 0");
    expect(first.stderr).toBe("");
    const reportPath = path.join(cwd, "artifacts/reports/capabilities.json");
    const graphPath = path.join(cwd, "artifacts/graph/capability-graph.json");
    const report = await readFile(reportPath, "utf8");
    const graph = await readFile(graphPath, "utf8");
    expect(JSON.parse(report)).toMatchObject({
      schemaVersion: 1,
      evidenceOnly: true,
      evaluation: {
        status: "evaluated",
        falsePositiveCount: 0,
        falseNegativeCount: 0,
      },
    });
    await exec(process.execPath, args, { cwd });
    expect(await readFile(reportPath, "utf8")).toBe(report);
    expect(await readFile(graphPath, "utf8")).toBe(graph);
    expect(
      await readFile(
        path.join(cwd, "artifacts/graph/surface-graph.json"),
        "utf8",
      ),
    ).toBe(oldSurfaceGraph);
    expect(
      await runCli(
        [
          "capabilities",
          "discover",
          fixture,
          "--out",
          "no-tests",
          "--exclude",
          "tests",
        ],
        cwd,
      ),
    ).toContain("False positives: not evaluated");
    const noTests = JSON.parse(
      await readFile(
        path.join(cwd, "no-tests/reports/capabilities.json"),
        "utf8",
      ),
    );
    expect(noTests.capabilities).toHaveLength(6);
    expect(
      noTests.evidence.graph.nodes.some(
        (node: { type: string }) => node.type === "Test",
      ),
    ).toBe(false);
    await writeFile(
      path.join(cwd, "expected.json"),
      JSON.stringify({
        schemaVersion: 1,
        capabilityIds: ["clients.create", "clients.delete"],
      }),
    );
    expect(
      await runCli(
        [
          "capabilities",
          "discover",
          fixture,
          "--out",
          "artifacts",
          "--expect",
          "expected.json",
        ],
        cwd,
      ),
    ).toContain("False positives: 5; false negatives: 1");
    expect(await readFile(graphPath, "utf8")).toBe(graph);
    await writeFile(path.join(cwd, "invalid.json"), "{}");
    for (const invalid of [
      ["capabilities", "discover", fixture, "--expect", "missing.json"],
      ["capabilities", "discover", fixture, "--expect", "invalid.json"],
      ["capabilities", "discover", fixture, "--json"],
      ["capabilities", "discover", fixture, "extra"],
      ["surfaces", "discover", fixture, "--expect", "expected.json"],
      ["capabilities", "unknown"],
    ])
      await expect(runCli(invalid, cwd)).rejects.toThrow();
  });

  it("prints help and fails nonzero for invalid arguments or source syntax", async () => {
    expect(await runCli(["--help"])).toContain("Usage: pathcompiler scan");
    for (const args of [
      [],
      ["unknown"],
      ["scan"],
      ["scan", fixture, "--unknown"],
    ]) {
      await expect(
        exec(process.execPath, [binary, ...args]),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("PathCompiler:"),
      });
    }
    const cwd = await directory();
    await mkdir(path.join(cwd, "app"));
    await writeFile(
      path.join(cwd, "app/page.tsx"),
      "export default function ( broken",
    );
    await expect(
      exec(process.execPath, [binary, "scan", cwd], { cwd }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("app/page.tsx"),
    });
    await expect(
      readFile(path.join(cwd, ".pathcompiler/graph/source-graph.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("inspects bounded node history through the built CLI and preserves existing artifacts", async () => {
    const cwd = await directory();
    const sourceDirectory = path.join(cwd, "source");
    await mkdir(path.join(sourceDirectory, "app"), { recursive: true });
    const git = async (...args: string[]) =>
      exec("git", [
        "-C",
        sourceDirectory,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ]);
    await git("init", "-b", "main");
    const file = path.join(sourceDirectory, "app/page.tsx");
    const source =
      'export default function Page() { return <button data-pathcompiler="clients.create">Create</button>; }';
    await writeFile(file, source);
    await git("add", ".");
    await git("commit", "-m", "Add client action");
    await writeFile(file, source.replace("Create</", "Add client</"));
    await git("add", ".");
    await git("commit", "-m", "Clarify label");
    const marker = path.join(sourceDirectory, "EXECUTED");
    await git("config", "core.fsmonitor", `touch '${marker}'`);
    await runCli(["scan", sourceDirectory, "--out", "evidence"], cwd);
    const scanPath = path.join(cwd, "evidence/graph/source-graph.json");
    const scan = await readFile(scanPath, "utf8");
    const args = [
      binary,
      "git",
      "inspect",
      sourceDirectory,
      "--node",
      "ui:clients.create",
      "--limit",
      "1",
      "--out",
      "evidence",
    ];
    expect((await exec(process.execPath, args, { cwd })).stdout).toContain(
      "Inspected 1 local commits",
    );
    const reportPath = path.join(cwd, "evidence/reports/git-evidence.json");
    const graphPath = path.join(cwd, "evidence/graph/history-graph.json");
    const report = await readFile(reportPath, "utf8");
    const graph = await readFile(graphPath, "utf8");
    expect(JSON.parse(report)).toMatchObject({
      schemaVersion: 1,
      evidenceOnly: true,
      nodeId: "ui:clients.create",
      histories: [expect.objectContaining({ limited: true })],
    });
    expect(JSON.parse(graph).edges).toContainEqual(
      expect.objectContaining({
        source: "ui:clients.create",
        type: "CHANGED_BY",
      }),
    );
    await exec(process.execPath, args, { cwd });
    expect(await readFile(reportPath, "utf8")).toBe(report);
    expect(await readFile(graphPath, "utf8")).toBe(graph);
    expect(await readFile(scanPath, "utf8")).toBe(scan);
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (await git("-c", "core.fsmonitor=false", "status", "--porcelain")).stdout,
    ).toBe("");
    for (const args of [
      ["git", "inspect", sourceDirectory],
      ["git", "inspect", sourceDirectory, "--node", "missing"],
      [
        "git",
        "inspect",
        sourceDirectory,
        "--node",
        "ui:clients.create",
        "--exclude",
        "app",
      ],
      [
        "git",
        "inspect",
        sourceDirectory,
        "--node",
        "ui:clients.create",
        "--limit",
        "101",
      ],
      [
        "git",
        "inspect",
        sourceDirectory,
        "--node",
        "ui:clients.create",
        "--json",
      ],
      ["scan", sourceDirectory, "--limit", "1"],
    ])
      await expect(runCli(args, cwd)).rejects.toThrow();
  });

  it("reads mock GitHub PR evidence through the built CLI without replacing source artifacts", async () => {
    const cwd = await directory();
    const root = path.join(cwd, "repository");
    const scan = path.join(root, "apps/demo");
    await mkdir(path.join(scan, "app"), { recursive: true });
    await mkdir(path.join(scan, "components"));
    const git = async (...args: string[]) =>
      exec("git", [
        "-C",
        root,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ]);
    await git("init", "-b", "main");
    await writeFile(
      path.join(scan, "app/page.tsx"),
      'import { AddClientModal } from "../components/AddClientModal"; export default function Page() { return <AddClientModal />; }',
    );
    await writeFile(
      path.join(scan, "components/AddClientModal.tsx"),
      'export function AddClientModal() { return <button data-pathcompiler="clients.create">Create</button>; }',
    );
    await git("add", ".");
    await git("commit", "-m", "Fixture");
    const head = (await git("rev-parse", "HEAD")).stdout.trim();
    const output = path.join(cwd, "evidence");
    await exec(process.execPath, [binary, "scan", scan, "--out", output], {
      cwd,
    });
    const sourceFile = path.join(output, "graph/source-graph.json");
    const source = await readFile(sourceFile, "utf8");
    const metadata = {
      number: 12,
      title: "Client creation",
      body: "PR intent",
      state: "closed",
      merged: true,
      merge_commit_sha: head,
      updated_at: "2026-01-02T03:04:05Z",
      commits: 1,
      changed_files: 1,
      head: { sha: head },
      base: { sha: "a".repeat(40), repo: { full_name: "example/product" } },
    };
    const mock = path.join(cwd, "github-mock.mjs");
    await writeFile(
      mock,
      `const metadata = ${JSON.stringify(metadata)};
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== "https://api.github.com" || init.headers.Authorization !== "Bearer fixture_token") throw new Error("Unexpected request");
  if (url.pathname.endsWith("/files")) return Response.json([{filename: "apps/demo/components/AddClientModal.tsx", status: "modified"}]);
  if (url.pathname.endsWith("/commits")) return Response.json([{sha: metadata.head.sha}]);
  if (url.pathname.includes("/commits/")) return Response.json([{number: 12, base: metadata.base}]);
  return Response.json(metadata);
};\n`,
    );
    const options = {
      cwd: scan,
      env: { ...process.env, GITHUB_TOKEN: "fixture_token" },
    };
    const args = [
      "--import",
      mock,
      binary,
      "github",
      "inspect",
      "--repo",
      "example/product",
      "--pr",
      "12",
      "--out",
      output,
    ];
    expect((await exec(process.execPath, args, options)).stdout).toContain(
      "Associated PR #12",
    );
    const reportFile = path.join(output, "reports/pr-evidence.json");
    const graphFile = path.join(output, "graph/pr-graph.json");
    const report = await readFile(reportFile, "utf8");
    const graph = await readFile(graphFile, "utf8");
    expect(JSON.parse(report)).toMatchObject({
      schemaVersion: 1,
      evidenceOnly: true,
      repositoryPath: "apps/demo",
      associatedNodeIds: expect.arrayContaining(["ui:clients.create"]),
    });
    expect(graph).not.toContain("fixture_token");
    await exec(process.execPath, args, options);
    expect(await readFile(reportFile, "utf8")).toBe(report);
    expect(await readFile(graphFile, "utf8")).toBe(graph);
    const lookup = [
      "--import",
      mock,
      binary,
      "github",
      "inspect",
      "--repo",
      "example/product",
      "--commit",
      head,
      "--out",
      output,
    ];
    expect((await exec(process.execPath, lookup, options)).stdout).toContain(
      "Associated PR #12",
    );
    expect(await readFile(sourceFile, "utf8")).toBe(source);
    expect((await git("status", "--porcelain")).stdout).toBe("");
    await expect(
      exec(process.execPath, args, {
        ...options,
        env: { ...process.env, GITHUB_TOKEN: "" },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Set GITHUB_TOKEN"),
    });
    for (const invalid of [
      ["github", "inspect"],
      ["github", "inspect", "--repo", "example/product"],
      [
        "github",
        "inspect",
        "--repo",
        "example/product",
        "--pr",
        "12",
        "--commit",
        head,
      ],
      ["scan", scan, "--pr", "12"],
    ])
      await expect(runCli(invalid, cwd)).rejects.toThrow();
    const excluded = await exec(
      process.execPath,
      [...args, "--exclude", "components"],
      options,
    );
    expect(excluded.stdout).toContain("with 0 graph nodes");
  });
});
