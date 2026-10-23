import { execFile } from "node:child_process";
import {
  copyFile,
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
import { afterEach, describe, expect, it } from "vitest";
import { nextDemoFormalModel } from "../../formal-model/test/next-demo-model.js";
import { runCli } from "../src/index.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo/", import.meta.url),
);
const exec = promisify(execFile);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function directory() {
  const result = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-reason-"));
  temporary.push(result);
  return result;
}

describe("pathcompiler reason reachable", () => {
  it("extracts the model from the repository and answers with a witness or proof", async () => {
    const out = await directory();
    const reachable = await runCli([
      "reason",
      "reachable",
      "clients.created",
      fixture,
      "--context",
      "role=editor",
      "--out",
      out,
    ]);
    expect(reachable).toContain("clients.created under role=editor: REACHABLE");
    expect(reachable).toContain(
      "5. clients.create.submit [client.form.submit]",
    );
    expect(reachable).toMatch(
      /Model coverage: 25 transitions \(3 deterministic, 22 from tests, 0 semantic-only\); \d+ uncertainties\./,
    );
    const report = JSON.parse(
      await readFile(
        path.join(out, "reports/reasoning/clients.created.json"),
        "utf8",
      ),
    );
    expect(report).toMatchObject({
      schemaVersion: 1,
      type: "reachability_result",
      result: { status: "reachable", model: { source: "extracted" } },
    });
    expect(report.uncertainties.length).toBeGreaterThan(0);

    const viewer = await runCli([
      "reason",
      "reachable",
      "plans.structure_changed",
      fixture,
      "--context",
      "role=unlisted",
      "--out",
      out,
    ]);
    expect(viewer).toContain("UNREACHABLE");
    expect(viewer).toContain(
      "Unreachable in the extracted model; review its uncertainties",
    );
  });

  it("reasons over a supplied model file and prints JSON on request", async () => {
    const out = await directory();
    const file = path.join(out, "model.json");
    await writeFile(file, JSON.stringify(nextDemoFormalModel("abc")));
    const json = JSON.parse(
      await runCli([
        "reason",
        "reachable",
        "plans.structure_changed",
        "--model",
        file,
        "--context",
        "plan_structure_enabled=false",
        "--json",
        "--out",
        out,
      ]),
    );
    expect(json.result).toMatchObject({
      status: "unreachable",
      context: { plan_structure_enabled: false },
      model: { source: "hand-encoded", repositoryCommit: "abc" },
    });
    expect(json.modelCoverage).toBeUndefined();
    const bounded = await runCli([
      "reason",
      "reachable",
      "clients.created",
      "--model",
      file,
      "--max-depth",
      "2",
      "--out",
      out,
    ]);
    expect(bounded).toContain("UNKNOWN");
    expect(bounded).toContain("Reason: bound-insufficient.");
  });

  it("plans a goal and compares the plan with the approved workflow", async () => {
    const out = await directory();
    const file = path.join(out, "model.json");
    await writeFile(file, JSON.stringify(nextDemoFormalModel("abc")));
    const args = [
      "reason",
      "plan",
      "clients.created",
      "--model",
      file,
      "--out",
      out,
    ];
    const alone = await runCli([...args, "--context", "role=editor"]);
    expect(alone).toContain(
      "clients.created under role=editor: PLAN FOUND (5 steps, cost 5; shortest and cheapest)",
    );
    expect(alone).toContain("1. nav.open_clients [nav.clients]");
    expect(alone).toContain("No approved workflow to compare with.");
    await mkdir(path.join(out, "workflows"), { recursive: true });
    await copyFile(
      fileURLToPath(
        new URL(
          "../../../examples/custom-assistant/.pathcompiler/workflows/clients.create.yaml",
          import.meta.url,
        ),
      ),
      path.join(out, "workflows/clients.create.yaml"),
    );
    const compared = await runCli([...args, "--context", "role=editor"]);
    expect(compared).toContain(
      "Approved workflow clients.create: 4/4 major steps matched.",
    );
    const report = JSON.parse(
      await readFile(
        path.join(out, "reports/reasoning/plans/clients.created.json"),
        "utf8",
      ),
    );
    expect(report).toMatchObject({
      type: "plan_result",
      comparedWorkflow: "clients.create",
      evaluation: {
        goalReached: true,
        invalidActionCount: 0,
        majorSteps: { score: 1 },
      },
      result: {
        status: "found",
        optimality: { length: "optimal", cost: "optimal" },
      },
    });
    expect(await runCli([...args, "--context", "role=viewer"])).toContain(
      "clients.created under role=viewer: IMPOSSIBLE",
    );
  });

  it("explains why a goal is unreachable with source evidence", async () => {
    const out = await directory();
    const output = await runCli([
      "reason",
      "why-not",
      "clients.created",
      fixture,
      "--context",
      "role=unlisted",
      "--out",
      out,
    ]);
    expect(output).toContain(
      "clients.created under role=unlisted: UNREACHABLE",
    );
    expect(output).toContain(
      "  Only clients.create.submit can make clients.created true.",
    );
    expect(output).toContain("  clients.create.submit requires role = editor.");
    expect(output).toMatch(
      /precondition:clients\.create\.submit#4: .*symbol:lib\/session\.ts#requireEditor/,
    );
    const report = JSON.parse(
      await readFile(
        path.join(out, "reports/reasoning/why-not/clients.created.json"),
        "utf8",
      ),
    );
    expect(report).toMatchObject({
      type: "explanation_result",
      result: { status: "unreachable", explanation: { minimal: true } },
    });
  });

  it("reports a permission change semantically and feeds it into proposals", async () => {
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
    await run(["workflows", "approve", "clients.create", "app", "--by", "Ana"]);
    const session = path.join(app, "lib/session.ts");
    await writeFile(
      session,
      (await readFile(session, "utf8")).replace(
        'session.role !== "editor"',
        'session.role !== "owner"',
      ),
    );
    await git("commit", "--quiet", "-am", "Only owners may edit");
    const head = await git("rev-parse", "HEAD");

    const diff = await run(["reason", "diff", base, "HEAD", "app"]);
    expect(diff).toContain(
      `PathCompiler Product Logic ${base.slice(0, 12)}..${head.slice(0, 12)}`,
    );
    expect(diff).toContain(
      "- clients.created is no longer reachable for role=editor: clients.create.submit requires role = owner (changed in lib/session.ts).",
    );
    expect(diff).toContain(
      "+ clients.created is newly reachable for role=owner.",
    );
    expect(diff).toContain("5 capabilities require review");

    const generated = await run([
      "proposals",
      "generate",
      base,
      "HEAD",
      "app",
      "--reasoning",
    ]);
    expect(generated).toContain(`clients.create.${head}`);
    const proposal = await readFile(
      path.join(cwd, "out/proposals", `clients.create.${head}.yaml`),
      "utf8",
    );
    expect(proposal).toContain("code: reachability-removed");
    expect(proposal).toContain(
      "clients.created is no longer reachable for role=editor",
    );
    const impact = JSON.parse(
      await readFile(
        path.join(cwd, "out/reports/workflow-impact.json"),
        "utf8",
      ),
    );
    expect(impact).toMatchObject({
      method: "deterministic-rules+bounded-smt",
      impacts: [{ workflowId: "clients.create", severity: "high" }],
    });
    expect(await readdir(path.join(cwd, "out/reports"))).toContain(
      "semantic-change.json",
    );
    await expect(run(["scan", "app", "--reasoning"])).rejects.toThrow(
      /--reasoning is only supported by impact and proposals generate/,
    );
  }, 300_000);

  it("rejects malformed invocations with actionable errors", async () => {
    const out = await directory();
    const file = path.join(out, "model.json");
    await writeFile(file, JSON.stringify(nextDemoFormalModel("abc")));
    await expect(
      runCli([
        "reason",
        "reachable",
        "missing.goal",
        "--model",
        file,
        "--out",
        out,
      ]),
    ).rejects.toThrow(/Unknown goal missing\.goal/);
    await expect(
      runCli([
        "reason",
        "reachable",
        "clients.created",
        "--model",
        file,
        "--context",
        "role",
      ]),
    ).rejects.toThrow(/--context expects name=value/);
    await expect(
      runCli([
        "reason",
        "reachable",
        "clients.created",
        fixture,
        "--model",
        file,
      ]),
    ).rejects.toThrow(/do not also pass a directory/);
    await expect(
      runCli([
        "reason",
        "reachable",
        "clients.created",
        "--model",
        file,
        "--max-depth",
        "two",
      ]),
    ).rejects.toThrow(/--max-depth must be a non-negative integer/);
    await expect(
      runCli(["scan", fixture, "--context", "role=editor"]),
    ).rejects.toThrow(/only supported by reason reachable, plan and why-not/);
    await writeFile(file, "{}");
    await expect(
      runCli(["reason", "reachable", "clients.created", "--model", file]),
    ).rejects.toThrow(/Cannot read the Formal Product Model/);
  });
});
