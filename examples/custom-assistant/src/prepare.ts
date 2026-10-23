// Discovers, approves and compiles the fixture's workflows into ./.pathcompiler.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "@pathcompiler/cli";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "../../../fixtures/next-demo");
const out = path.resolve(here, "../.pathcompiler");
const run = (...args: string[]) => runCli([...args, "--out", out], here);
await run("workflows", "discover", fixture);
for (const id of ["clients.create", "plans.create", "plans.change_structure"])
  await run(
    "workflows",
    "approve",
    id,
    fixture,
    "--by",
    "Example Reviewer",
  ).catch((error: unknown) => {
    // Re-running is fine: already approved workflows stay approved.
    if (!(error instanceof Error && error.message.includes("already approved")))
      throw error;
  });
console.log(await run("build"));
