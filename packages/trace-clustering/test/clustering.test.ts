import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import {
  createProductReasoner,
  type PlanEnumerationResult,
} from "@pathcompiler/reasoner-core";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { beforeAll, describe, expect, it } from "vitest";
import {
  clusterTraces,
  type TraceStepLike,
  traceSignature,
} from "../src/index.js";

const step = (
  actionId: string,
  changes: TraceStepLike["changes"],
  capabilityId?: string,
  semanticTarget?: string,
): TraceStepLike => ({
  actionId,
  changes,
  ...(capabilityId ? { capabilityId } : {}),
  ...(semanticTarget ? { semanticTarget } : {}),
});
const nav = (target: string, area: string) =>
  step(`navigate.${target}`, { area, dialog_open: false }, undefined, target);
const open = step("c.open", { dialog_open: true }, "c.create", "c.create");
const name = step("c.name", { name_entered: true }, "c.create", "form.name");
const email = step(
  "c.email",
  { email_entered: true },
  "c.create",
  "form.email",
);
const submit = step(
  "c.submit",
  { created: true, dialog_open: false },
  "c.create",
  "form.submit",
);

describe("trace signatures", () => {
  it("ignores navigation links, field order and detours", () => {
    const plain = traceSignature({
      goal: "c.created",
      steps: [nav("nav.a", "A"), open, name, email, submit],
    });
    expect(plain).toEqual({
      goal: "c.created",
      entryCapability: "c.create",
      entryRoute: "area=A",
      capabilities: ["c.create"],
      majorActions: ["c.create", "form.email", "form.name", "form.submit"],
    });
    // Another link to the same place, swapped fields, and a dialog opened
    // then abandoned by navigating away.
    const noisy = traceSignature({
      goal: "c.created",
      steps: [
        nav("nav.b", "A"),
        step("d.open", { other_open: true }, "d.edit", "d.edit"),
        nav("nav.b", "A"),
        step("navigate.close", { other_open: false }),
        open,
        email,
        name,
        submit,
      ],
    });
    expect(noisy).toEqual(plain);
  });

  it("keeps a hand-over into the next capability and different places apart", () => {
    const handover = traceSignature({
      goal: "c.created",
      steps: [
        nav("nav.a", "A"),
        step("d.open", { other_open: true }, "d.edit", "d.edit"),
        step(
          "c.open_inside",
          { other_open: false, dialog_open: true },
          "c.create",
          "d.form.create",
        ),
        submit,
      ],
    });
    expect(handover.capabilities).toEqual(["d.edit", "c.create"]);
    const elsewhere = traceSignature({
      goal: "c.created",
      steps: [nav("nav.x", "B"), open, name, email, submit],
    });
    expect(elsewhere.entryRoute).toBe("area=B");
    const clustering = clusterTraces([
      {
        goal: "c.created",
        steps: [nav("nav.a", "A"), open, name, email, submit],
      },
      {
        goal: "c.created",
        steps: [nav("nav.a", "A"), open, email, name, submit],
      },
      {
        goal: "c.created",
        steps: [nav("nav.x", "B"), open, name, email, submit],
      },
    ]);
    expect(clustering.variants.map((item) => item.members)).toEqual([
      [0, 1],
      [2],
    ]);
    expect(clustering.duplicateRate).toBe(0.333);
    expect(clusterTraces([])).toEqual({
      total: 0,
      variants: [],
      duplicateRate: 0,
    });
  });
});

describe("plan enumeration on the fixture", () => {
  let result: PlanEnumerationResult;
  let again: PlanEnumerationResult;
  beforeAll(async () => {
    const project = await readSourceProject(
      fileURLToPath(new URL("../../../fixtures/next-demo/", import.meta.url)),
    );
    const mined = minePlaywrightTests(
      project,
      analyzeNextProject(project).graph,
    );
    const capabilities = discoverCapabilities(mined.graph);
    const model = buildFormalModel(
      capabilities.graph,
      capabilities.report,
      mined.report,
    ).model;
    const solver = await createZ3SolverProvider();
    try {
      const reasoner = createProductReasoner(solver);
      const query = {
        goal: "clients.deactivated",
        context: { role: "editor" },
      };
      result = await reasoner.enumeratePlans(model, query);
      again = await reasoner.enumeratePlans(model, query);
      const limited = await reasoner.enumeratePlans(model, {
        ...query,
        limit: 3,
      });
      expect(
        limited.status === "found" && [limited.plans.length, limited.complete],
      ).toEqual([3, false]);
      expect(
        (
          await reasoner.enumeratePlans(model, {
            ...query,
            context: { role: "unlisted" },
          })
        ).status,
      ).toBe("impossible");
      await expect(
        reasoner.enumeratePlans(model, { ...query, slack: 11 }),
      ).rejects.toThrow("slack must be an integer from 0 to 10.");
    } finally {
      await solver.close();
    }
  }, 300_000);

  it("finds the row button and the Edit Client dialog as the two variants", () => {
    if (result.status !== "found") throw new Error(result.status);
    expect(result).toMatchObject({ shortest: 3, maxLength: 4, complete: true });
    const clustering = clusterTraces(result.plans);
    expect(
      clustering.variants.map((item) => item.signature.majorActions),
    ).toEqual([
      ["clients.deactivate", "client.deactivate.confirm"],
      ["clients.edit", "client.form.deactivate", "client.deactivate.confirm"],
    ]);
    expect(
      clustering.variants.map((item) =>
        result.status === "found"
          ? result.plans[item.representative]?.steps.map(
              (entry) => entry.actionId,
            )
          : [],
      ),
    ).toEqual([
      [
        "navigate.nav_clients",
        "clients.deactivate.open_clients_deactivate",
        "clients.deactivate.confirm",
      ],
      [
        "navigate.nav_clients",
        "clients.edit.open",
        "clients.deactivate.open_client_form_deactivate",
        "clients.deactivate.confirm",
      ],
    ]);
  });

  it("is deterministic, sorted by length, and reaches the goal only at the last step", () => {
    const { stats: _first, ...first } = result;
    const { stats: _second, ...second } = again;
    expect(second).toEqual(first);
    if (result.status !== "found") return;
    const lengths = result.plans.map((plan) => plan.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
    for (const plan of result.plans)
      expect(
        plan.steps.findIndex(
          (entry) => entry.changes.clients_deactivated === true,
        ),
      ).toBe(plan.steps.length - 1);
    expect(
      new Set(
        result.plans.map((plan) =>
          plan.steps.map((entry) => entry.actionId).join(),
        ),
      ).size,
    ).toBe(result.plans.length);
  });
});
