// Usage: node src/main.ts "How do I add a new client?" [generated-dir]
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createStaticTransport, PathCompiler } from "@pathcompiler/sdk-js";
import { ExistingAssistant, ScriptedModel } from "./assistant.ts";
import { renderTerminal, toCard } from "./ui.ts";

const question = process.argv[2] ?? "How do I add a new client?";
const generated = path.resolve(process.argv[3] ?? ".pathcompiler/generated");
const load = async (name: string) =>
  JSON.parse(
    await readFile(path.join(generated, `${name}.json`), "utf8"),
  ) as unknown;
const pathcompiler = new PathCompiler({
  project: "next-demo",
  // Static artifacts: no PathCompiler server is needed at runtime.
  transport: createStaticTransport({
    searchIndex: await load("search-index"),
    runtimeManifest: await load("runtime-manifest"),
    documentation: await load("documentation"),
  }),
});
const assistant = new ExistingAssistant(
  new ScriptedModel({ route: "/" }),
  pathcompiler,
);
console.log(renderTerminal(toCard(await assistant.ask(question))));
