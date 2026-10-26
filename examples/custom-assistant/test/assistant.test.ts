import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runCli } from "@pathcompiler/cli";
import { createStaticTransport, PathCompiler } from "@pathcompiler/sdk-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ChatModel,
  ExistingAssistant,
  ScriptedModel,
} from "../src/assistant.ts";
import { renderTerminal, toCard } from "../src/ui.ts";

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../../../fixtures/next-demo");
let out: string;
let pathcompiler: PathCompiler;
beforeAll(async () => {
  out = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-example-"));
  // Approval needs a clean, committed repository (#19): approve from a
  // committed copy of the fixture, not the working tree.
  const fixture = path.join(out, "next-demo");
  const tracked = (
    await exec("git", ["-C", source, "ls-files", "-z", "--", "."])
  ).stdout
    .split("\0")
    .filter(Boolean);
  for (const file of tracked) {
    await mkdir(path.dirname(path.join(fixture, file)), { recursive: true });
    await writeFile(
      path.join(fixture, file),
      await readFile(path.join(source, file)),
    );
  }
  const git = (...args: string[]) =>
    exec("git", ["-C", fixture, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.test",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.test",
      },
    });
  await git("init", "--quiet");
  await git("add", ".");
  await git("commit", "--quiet", "-m", "fixture");
  const run = (...args: string[]) => runCli([...args, "--out", out], out);
  await run("workflows", "discover", fixture);
  for (const id of ["clients.create", "plans.create", "plans.change_structure"])
    await run("workflows", "approve", id, fixture, "--by", "Example Reviewer");
  await run("build");
  const load = async (name: string) =>
    JSON.parse(
      await readFile(path.join(out, `generated/${name}.json`), "utf8"),
    );
  pathcompiler = new PathCompiler({
    project: "example",
    transport: createStaticTransport({
      searchIndex: await load("search-index"),
      runtimeManifest: await load("runtime-manifest"),
      documentation: await load("documentation"),
    }),
  });
}, 60_000);
afterAll(async () => {
  await rm(out, { recursive: true, force: true });
});

describe("existing assistant using PathCompiler", () => {
  it("answers a how-to question with steps and its own action buttons", async () => {
    const assistant = new ExistingAssistant(new ScriptedModel(), pathcompiler);
    const answer = await assistant.ask("How do I add a new client?");
    expect(answer.help).toMatchObject({
      type: "workflow_help",
      workflowId: "clients.create",
    });
    expect(answer.actions).toEqual({
      explain: true,
      checklist: true,
      navigate: true,
      guide: true,
      execute: false,
    });
    const card = toCard(answer);
    expect(card).toEqual({
      heading: "Create Client",
      body: [
        "Here's how to create client.",
        "1. Click Create Client",
        "2. Enter Name",
        "3. Enter Email",
        "4. Click client.form.submit",
        'Done when clients.feedback shows "Client created".',
      ],
      buttons: ["Open /clients", "Show me", "Checklist"],
    });
    expect(renderTerminal(card)).toContain("| Create Client");
  });

  it("asks for clarification, admits unsupported requests and skips the tool otherwise", async () => {
    const calls: string[] = [];
    const model = new ScriptedModel();
    const spy: ChatModel = {
      respond: async (messages, tools) => {
        const turn = await model.respond(messages);
        calls.push(turn.type === "tool_call" ? turn.name : "text");
        expect(tools.map((tool) => tool.name)).toEqual([
          "resolve_product_help",
        ]);
        return turn;
      },
    };
    const assistant = new ExistingAssistant(spy, pathcompiler);
    const ambiguous = await assistant.ask("Can I help with a plan?");
    expect(ambiguous.help?.type).toBe("ambiguous");
    expect(toCard(ambiguous).body[0]).toMatch(/^Which of these did you mean:/);
    expect((await assistant.ask("How do I delete a client?")).text).toBe(
      "I couldn't find an approved guide for that yet.",
    );
    const smallTalk = await assistant.ask("Thanks!");
    expect(smallTalk.help).toBeNull();
    expect(calls).toEqual([
      "resolve_product_help",
      "text",
      "resolve_product_help",
      "text",
      "text",
    ]);
  });

  it("runs as a standalone program from static artifacts", async () => {
    const { stdout } = await exec(process.execPath, [
      path.resolve(here, "../src/main.ts"),
      "How do I change the structure of a plan?",
      path.join(out, "generated"),
    ]);
    expect(stdout).toContain("| Change Plan Structure");
    expect(stdout).toContain("[Show me]");
  });

  it("does not depend on PathCompiler UI or React packages", async () => {
    const manifest = await readFile(
      path.resolve(here, "../package.json"),
      "utf8",
    );
    expect(manifest).not.toMatch(/@pathcompiler\/(ui|react|runtime-core)"/);
    for (const file of ["assistant.ts", "ui.ts", "main.ts"]) {
      const source = await readFile(
        path.resolve(here, `../src/${file}`),
        "utf8",
      );
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map(
        (match) => match[1],
      );
      expect(
        imports.filter((name) => name?.startsWith("@pathcompiler/")),
      ).toEqual(
        expect.not.arrayContaining(["@pathcompiler/ui", "@pathcompiler/react"]),
      );
    }
  });
});
