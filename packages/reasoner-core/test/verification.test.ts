import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import { type FormalProductModel, f } from "@pathcompiler/formal-model";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nextDemoFormalModel } from "../../formal-model/test/next-demo-model.js";
import {
  createProductReasoner,
  type ProductProperty,
  type ProductReasoner,
  propertiesFromInvariants,
  ReasoningQueryError,
} from "../src/index.js";

const exec = promisify(execFile);
const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo", import.meta.url),
);
let solver: SolverProvider;
let reasoner: ProductReasoner;
let hand: FormalProductModel;
const temporary: string[] = [];
async function extract(edit?: [string, string, string]) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "pathcompiler-verify-"),
  );
  temporary.push(directory);
  const tracked = (
    await exec("git", ["-C", fixture, "ls-files", "-z", "--", "."])
  ).stdout
    .split("\0")
    .filter(Boolean);
  for (const file of tracked) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await cp(path.join(fixture, file), path.join(directory, file));
  }
  if (edit) {
    const [file, from, to] = edit;
    const target = path.join(directory, file);
    const content = await readFile(target, "utf8");
    if (!content.includes(from)) throw new Error(`Missing ${from} in ${file}`);
    await writeFile(target, content.replace(from, to));
  }
  const project = await readSourceProject(directory, {
    snapshot: { commit: "f".repeat(40) },
  });
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  return buildFormalModel(capabilities.graph, capabilities.report, mined.report)
    .model;
}
beforeAll(async () => {
  solver = await createZ3SolverProvider();
  reasoner = createProductReasoner(solver);
  hand = nextDemoFormalModel("abc");
});
afterAll(async () => {
  await solver?.close();
  await Promise.all(
    temporary.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});
const viewerNeverCreates: ProductProperty = {
  kind: "never",
  id: "security.viewer_never_creates_client",
  description: "A viewer can never create a client",
  goal: "clients.created",
  context: { role: "unlisted" },
};

describe("property verification", () => {
  it("proves the hand model's invariants and security properties", async () => {
    for (const property of propertiesFromInvariants(hand)) {
      const result = await reasoner.verifyProperty(hand, property);
      expect(result.status, property.id).toBe("holds");
    }
    const never = await reasoner.verifyProperty(hand, {
      ...viewerNeverCreates,
      context: { role: "viewer" },
    });
    expect(never).toMatchObject({
      status: "holds",
      property: { id: "security.viewer_never_creates_client", kind: "never" },
      proof: { method: "k-induction" },
      model: { id: "next_demo", source: "hand-encoded" },
    });
    expect(
      await reasoner.verifyProperty(hand, {
        kind: "always",
        id: "plans.confirmation_needs_dialog",
        description: "Confirmation only shows inside the structure dialog",
        condition: f.implies(
          f.var("confirmation_open"),
          f.var("structure_dialog_open"),
        ),
      }),
    ).toMatchObject({ status: "holds" });
  });

  it("returns a counterexample when a path avoids a required step", async () => {
    const both = await reasoner.verifyProperty(hand, {
      kind: "via",
      id: "plans.structure_change_saves",
      description: "Every structure change is saved or confirmed",
      goal: "plans.structure_changed",
      via: ["plans.save_structure", "plans.confirm_simplify"],
    });
    expect(both).toMatchObject({ status: "holds", vacuous: false });
    const confirmed = await reasoner.verifyProperty(hand, {
      kind: "via",
      id: "plans.structure_change_confirmed",
      description: "Every structure change passes through confirmation",
      goal: "plans.structure_changed",
      via: ["plans.confirm_simplify"],
      context: { role: "editor" },
    });
    expect(confirmed.status).toBe("violated");
    if (confirmed.status === "violated") {
      expect(confirmed.counterexample.goal).toBe(
        "plans.structure_change_confirmed",
      );
      expect(confirmed.counterexample.actions.at(-1)?.actionId).toBe(
        "plans.save_structure",
      );
      expect(confirmed.counterexample.context.role).toBe("editor");
    }
    const vacuous = await reasoner.verifyProperty(hand, {
      kind: "via",
      id: "clients.viewer_create_confirmed",
      description: "Viewer client creation passes through submit",
      goal: "clients.created",
      via: ["clients.submit_create"],
      context: { role: "viewer" },
    });
    expect(vacuous).toMatchObject({ status: "holds", vacuous: true });
  });

  it("proves the extracted model's structural invariants", async () => {
    const extracted = await extract();
    const properties = propertiesFromInvariants(extracted);
    expect(properties.length).toBeGreaterThan(4);
    for (const property of properties)
      expect(
        (await reasoner.verifyProperty(extracted, property)).status,
        property.id,
      ).toBe("holds");
    expect(
      (await reasoner.verifyProperty(extracted, viewerNeverCreates)).status,
    ).toBe("holds");
  }, 60_000);

  it("finds the seeded authorization bug with a counterexample", async () => {
    const buggy = await extract([
      "app/api/clients/route.ts",
      "    requireEditor(session);\n",
      "",
    ]);
    const result = await reasoner.verifyProperty(buggy, viewerNeverCreates);
    expect(result.status).toBe("violated");
    if (result.status !== "violated") return;
    expect(result.counterexample.context.role).toBe("unlisted");
    expect(result.counterexample.actions.map((step) => step.actionId)).toEqual([
      "navigate.nav_clients",
      "clients.create.open",
      "clients.create.enter_email",
      "clients.create.enter_name",
      "clients.create.submit",
    ]);
    expect(result.counterexample.actions.at(-1)?.semanticTarget).toBe(
      "client.form.submit",
    );
  }, 60_000);

  it("rejects malformed and dangling properties", async () => {
    await expect(
      reasoner.verifyProperty(hand, {
        kind: "never",
        id: "x.y",
        description: "Nothing",
      } as ProductProperty),
    ).rejects.toThrow(/exactly one of goal or condition/);
    await expect(
      reasoner.verifyProperty(hand, { ...viewerNeverCreates, goal: "missing" }),
    ).rejects.toThrow(/unknown goal missing/);
    await expect(
      reasoner.verifyProperty(hand, {
        kind: "always",
        id: "x.y",
        description: "Bad",
        condition: f.var("nope"),
      }),
    ).rejects.toThrow(ReasoningQueryError);
    await expect(
      reasoner.verifyProperty(hand, {
        kind: "via",
        id: "x.y",
        description: "Bad",
        goal: "clients.created",
        via: ["nope"],
      }),
    ).rejects.toThrow(/unknown action nope/);
  });
});
