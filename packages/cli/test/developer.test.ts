import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { nextDemoFormalModel } from "../../formal-model/test/next-demo-model.js";
import { runCli } from "../src/index.js";

const binary = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo/", import.meta.url),
);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => rm(item, { recursive: true, force: true })),
  );
});

describe("developer reasoning surfaces", () => {
  it("serve exposes /v1/reason/* to the developer token only", async () => {
    const cwd = await mkdtemp(
      path.join(os.tmpdir(), "pathcompiler-developer-"),
    );
    temporary.push(cwd);
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    await run(["workflows", "discover", fixture]);
    await run(["build"]);
    await writeFile(
      path.join(cwd, "model.json"),
      JSON.stringify(nextDemoFormalModel("abc")),
    );
    const token = "cli-test-token-0123456789";
    const developer = "developer-token-0123456789";
    const child = spawn(
      process.execPath,
      [binary, "serve", "--out", "out", "--port", "0", "--model", "model.json"],
      {
        cwd,
        env: {
          ...process.env,
          PATHCOMPILER_API_TOKEN: token,
          PATHCOMPILER_DEVELOPER_TOKEN: developer,
        },
      },
    );
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let seen = "";
        child.stdout.on("data", (chunk: Buffer) => {
          seen += chunk.toString();
          const found = /listening on (http:\/\/\S+)/.exec(seen);
          if (found?.[1] && seen.includes("Developer reasoning"))
            resolve(found[1]);
        });
        child.once("exit", (code) => reject(new Error(`serve exited ${code}`)));
      });
      const ask = (bearer: string) =>
        fetch(`${url}/v1/reason/why-unreachable`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${bearer}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            goal: "clients.created",
            context: { role: "viewer" },
          }),
        });
      expect((await ask(token)).status).toBe(401);
      const answer = await ask(developer);
      expect(answer.status).toBe(200);
      const body = await answer.json();
      expect(body.status).toBe("unreachable");
      expect(body).not.toHaveProperty("stats");
    } finally {
      child.kill();
    }
  }, 120_000);

  it("mcp-reasoning serves the developer tools over stdio", async () => {
    const cwd = await mkdtemp(
      path.join(os.tmpdir(), "pathcompiler-developer-"),
    );
    temporary.push(cwd);
    await writeFile(
      path.join(cwd, "model.json"),
      JSON.stringify(nextDemoFormalModel("abc")),
    );
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [binary, "mcp-reasoning", "--model", "model.json"],
        cwd,
        stderr: "ignore",
      }),
    );
    try {
      const result = await client.callTool({
        name: "pathcompiler.check_reachability",
        arguments: { goal: "clients.created", context: { role: "editor" } },
      });
      expect(result.structuredContent).toMatchObject({
        result: { status: "reachable" },
      });
    } finally {
      await client.close();
    }
    await runCli(["init"], cwd);
    await expect(
      runCli(["mcp-reasoning", "--model", "model.json"], cwd),
    ).rejects.toThrow(
      /mcp-reasoning is disabled .* reasoning\.enabled to true/,
    );
  }, 120_000);
});
