import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import type { FormalProductModel } from "@pathcompiler/formal-model";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createProductReasoner,
  findMinimalEnablement,
  type MinimalEnablementResult,
  type ProductReasoner,
} from "../src/index.js";

let solver: SolverProvider;
let reasoner: ProductReasoner;
let extracted: FormalProductModel;
beforeAll(async () => {
  solver = await createZ3SolverProvider();
  reasoner = createProductReasoner(solver);
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  extracted = buildFormalModel(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).model;
}, 60_000);
afterAll(async () => {
  await solver?.close();
});
const sets = (result: MinimalEnablementResult) =>
  result.corrections.map((item) =>
    item.changes.map((change) =>
      change.kind === "context"
        ? `context:${change.variable}`
        : `guard:${change.actionId}`,
    ),
  );

describe("minimal enablement (MCS)", () => {
  it("answers what minimal change lets a viewer create a client", async () => {
    const before = structuredClone(extracted);
    const result = await findMinimalEnablement(reasoner, extracted, {
      goal: "clients.created",
      context: { role: "unlisted" },
    });
    expect(result).toMatchObject({
      status: "enableable",
      minimum: true,
      diagnosticOnly: true,
    });
    // Either run as another role, or drop the submit handler's role guard.
    expect(sets(result)).toEqual([
      ["context:role"],
      ["guard:clients.create.submit"],
    ]);
    const [role, guard] = result.corrections;
    expect(role?.witness.context.role).toMatch(/^(admin|editor)$/);
    expect(role?.changes[0]?.suggestion).toMatch(
      /^Run with a different role: the witness uses role = (admin|editor)\.$/,
    );
    expect(guard?.changes[0]).toMatchObject({
      description:
        "clients.create.submit requires role = admin or role = editor",
      capabilityId: "clients.create",
    });
    expect(guard?.changes[0]?.evidence.map((ref) => ref.id)).toContain(
      "symbol:lib/session.ts#requireEditor",
    );
    // Diagnostic only: the model is untouched.
    expect(extracted).toEqual(before);
  }, 120_000);

  it("names the flag when only the flag blocks an admin", async () => {
    const result = await findMinimalEnablement(reasoner, extracted, {
      goal: "plans.archived",
      context: { role: "admin", plan_archive_enabled: false },
    });
    expect(sets(result)).toEqual([
      ["context:plan_archive_enabled"],
      ["guard:plans.archive.archive"],
    ]);
    expect(result.corrections[0]?.witness.context.plan_archive_enabled).toBe(
      true,
    );
  }, 120_000);

  it("needs two changes when both the role and the flag block", async () => {
    const result = await findMinimalEnablement(reasoner, extracted, {
      goal: "plans.archived",
      context: { role: "editor", plan_archive_enabled: false },
    });
    expect(result.status).toBe("enableable");
    expect(result.minimum).toBe(true);
    for (const set of sets(result)) expect(set).toHaveLength(2);
    expect(sets(result)).toContainEqual([
      "context:plan_archive_enabled",
      "context:role",
    ]);
  }, 300_000);

  it("reports reachable goals and structurally blocked ones", async () => {
    expect(
      (
        await findMinimalEnablement(reasoner, extracted, {
          goal: "clients.created",
          context: { role: "editor" },
        })
      ).status,
    ).toBe("already-reachable");
    // Without its only goal-setting action, no policy change can help.
    const blocked: FormalProductModel = {
      ...extracted,
      actions: extracted.actions.filter(
        (item) => item.id !== "clients.create.submit",
      ),
    };
    expect(
      await findMinimalEnablement(reasoner, blocked, {
        goal: "clients.created",
        context: { role: "unlisted" },
      }),
    ).toMatchObject({
      status: "not-enableable",
      minimum: true,
      corrections: [],
    });
  }, 120_000);
});
