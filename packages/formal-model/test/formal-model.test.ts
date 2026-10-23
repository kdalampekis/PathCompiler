import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import {
  readSourceProject,
  type SourceProject,
} from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { beforeAll, describe, expect, it } from "vitest";
import {
  collectFormalEvidence,
  type FormalProductModel,
  f,
  formalModelHash,
  normalizeFormalModel,
  parseFormalModel,
  serializeFormalModel,
} from "../src/index.js";
import { nextDemoFormalModel } from "./next-demo-model.js";

let project: SourceProject;
let mined: ReturnType<typeof minePlaywrightTests>;
let commit: string;
beforeAll(async () => {
  project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  commit = project.repository.commit ?? "unbound";
});
const model = () => nextDemoFormalModel(commit);
const evidence = [
  { id: "x", type: "symbol" as const, locator: "x", repositoryCommit: "c" },
];
function tiny(patch: Partial<FormalProductModel> = {}): FormalProductModel {
  return {
    schemaVersion: 1,
    id: "tiny",
    metadata: {
      repositoryCommit: null,
      source: "hand-encoded",
      extractorVersion: "test",
    },
    variables: [
      { id: "flag", type: "boolean", scope: "context", evidence },
      { id: "open", type: "boolean", scope: "state", evidence },
      {
        id: "area",
        type: "enum",
        values: ["A", "B"],
        scope: "state",
        evidence,
      },
      {
        id: "count",
        type: "integer",
        min: 0,
        max: 5,
        scope: "state",
        evidence,
      },
      { id: "name", type: "string", scope: "state", evidence },
    ],
    initial: f.and(f.not(f.var("open")), f.is("area", "A"), f.is("count", 0)),
    actions: [
      {
        id: "go.b",
        precondition: f.and(f.var("flag"), f.is("area", "A")),
        effects: [f.set("area", "B"), f.set("count", 1), f.set("name", "Ada")],
        evidence,
      },
    ],
    invariants: [],
    goals: [
      {
        id: "reached.b",
        condition: f.and(f.is("area", "B"), {
          type: "gte",
          left: f.ref("count"),
          right: f.lit(1),
        }),
        businessMeaning: "B reached",
        evidence,
        confidence: 1,
      },
    ],
    ...patch,
  };
}
function issues(input: unknown): string[] {
  try {
    parseFormalModel(input);
    return [];
  } catch (error) {
    return (error as { issues: { message: string }[] }).issues.map(
      (item) => item.message,
    );
  }
}

describe("formal product model", () => {
  it("validates the hand-encoded fixture model for Create Client and Change Plan Structure", () => {
    const parsed = parseFormalModel(model());
    expect(parsed.metadata).toEqual({
      repositoryCommit: commit,
      source: "hand-encoded",
      extractorVersion: "hand-encoded-r0",
    });
    expect(parsed.goals.map((goal) => goal.id)).toEqual([
      "clients.created",
      "plans.structure_changed",
    ]);
    expect(parsed.actions).toHaveLength(12);
    expect(
      parsed.variables
        .filter((item) => item.scope === "context")
        .map((item) => item.id),
    ).toEqual(["role", "plan_structure_enabled"]);
  });

  it("serializes deterministically regardless of authoring order", () => {
    const original = model();
    const shuffled = {
      ...original,
      variables: [...original.variables].reverse(),
      actions: [...original.actions].reverse(),
      invariants: [...original.invariants].reverse(),
      goals: [...original.goals].reverse(),
    };
    const text = serializeFormalModel(original);
    expect(serializeFormalModel(shuffled)).toBe(text);
    expect(formalModelHash(shuffled)).toBe(formalModelHash(original));
    expect(formalModelHash(original)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(parseFormalModel(JSON.parse(text))).toEqual(
      normalizeFormalModel(original),
    );
    expect(text.endsWith("}\n")).toBe(true);
    const changed = model();
    changed.goals[0] = {
      ...changed.goals[0],
      confidence: 0.5,
    } as (typeof changed.goals)[0];
    expect(formalModelHash(changed)).not.toBe(formalModelHash(original));
    // Operand order is semantic-neutral but preserved, never silently reordered.
    const normalized = normalizeFormalModel(original);
    expect(normalized.initial).toEqual(original.initial);
  });

  it("resolves every evidence reference to a fixture graph node at the scanned commit", () => {
    const nodes = new Map(
      mined.graph.toJSON().nodes.map((node) => [node.id, node]),
    );
    const refs = collectFormalEvidence(model());
    expect(refs.length).toBeGreaterThan(40);
    for (const { owner, ref } of refs) {
      const node = nodes.get(ref.id);
      expect(node, `${owner} cites missing ${ref.id}`).toBeDefined();
      expect(ref.repositoryCommit).toBe(commit);
      const locators = (
        (node?.data?.evidence ?? []) as { locator: string }[]
      ).map((item) => item.locator);
      expect(locators, `${owner} → ${ref.id}`).toContain(ref.locator);
    }
    const owners = new Set(refs.map((item) => item.owner));
    for (const action of model().actions)
      expect(owners).toContain(`action:${action.id}`);
    for (const goal of model().goals)
      expect(owners).toContain(`goal:${goal.id}`);
  });

  it("links actions and goals to real semantic targets and discovered capabilities", () => {
    const nodes = new Set(mined.graph.toJSON().nodes.map((node) => node.id));
    const capabilities = new Set(
      discoverCapabilities(mined.graph).report.capabilities.map(
        (item) => item.id,
      ),
    );
    for (const action of model().actions) {
      if (action.semanticTarget)
        expect(nodes).toContain(`ui:${action.semanticTarget}`);
      if (action.capabilityId)
        expect(capabilities).toContain(action.capabilityId);
    }
    for (const goal of model().goals)
      if (goal.capabilityId) expect(capabilities).toContain(goal.capabilityId);
  });

  it("covers every step target of the discovered fixture workflows", async () => {
    const { discoverWorkflows } = await import(
      "@pathcompiler/workflow-discovery"
    );
    const capabilities = discoverCapabilities(mined.graph);
    const candidates = discoverWorkflows(
      capabilities.graph,
      capabilities.report,
      mined.report,
    ).report.candidates;
    const targets = new Set(
      model().actions.map((action) => action.semanticTarget),
    );
    for (const id of ["clients.create", "plans.change_structure"]) {
      const workflow = candidates.find(
        (item) => item.workflow.id === id,
      )?.workflow;
      expect(workflow, id).toBeDefined();
      for (const step of workflow?.steps ?? [])
        expect(targets, `${id}/${step.id}`).toContain(step.target);
    }
  });

  it("accepts every variable type and typed comparisons", () => {
    expect(issues(tiny())).toEqual([]);
    expect(issues(tiny({ initial: f.is("name", "Ada") }))).toEqual([]);
  });

  it("rejects unknown references and type errors with actionable messages", () => {
    const cases: [Partial<FormalProductModel>, string][] = [
      [{ initial: f.var("missing") }, "Unknown variable: missing"],
      [{ initial: f.var("area") }, "area is enum; compare it with eq instead"],
      [{ initial: f.is("area", "C") }, "C is not a value of area"],
      [
        { initial: { type: "lt", left: f.ref("area"), right: f.lit("A") } },
        "Ordering comparisons need integers",
      ],
      [
        { initial: f.is("count", 9) },
        "9 is outside the variable's integer range",
      ],
      [
        { initial: f.eq(f.ref("open"), f.ref("area")) },
        "Cannot compare boolean with enum",
      ],
      [{ initial: f.is("open", "yes") }, "Cannot compare boolean with string"],
      [
        {
          actions: [
            {
              id: "bad",
              precondition: f.bool(true),
              effects: [f.set("flag", true)],
              evidence,
            },
          ],
        },
        "flag is a context variable and cannot be assigned",
      ],
      [
        {
          actions: [
            {
              id: "bad",
              precondition: f.bool(true),
              effects: [f.set("open", true), f.set("open", false)],
              evidence,
            },
          ],
        },
        "open is assigned more than once by bad",
      ],
      [
        {
          actions: [
            {
              id: "bad",
              precondition: f.bool(true),
              effects: [f.set("area", true)],
              evidence,
            },
          ],
        },
        "Cannot compare enum with boolean",
      ],
      [
        { goals: [...tiny().goals, ...tiny().goals] },
        "Duplicate goals ID: reached.b",
      ],
    ];
    for (const [patch, message] of cases)
      expect(issues(tiny(patch)).join(" | "), message).toContain(message);
  });

  it("requires provenance and bounds expression depth", () => {
    expect(
      issues(
        tiny({
          goals: [
            {
              ...tiny().goals[0],
              evidence: [],
            } as FormalProductModel["goals"][0],
          ],
        }),
      ),
    ).not.toEqual([]);
    let deep = f.var("open");
    for (let index = 0; index < 40; index += 1) deep = f.not(deep);
    expect(issues(tiny({ initial: deep })).join()).toContain(
      "Expression nesting exceeds 32",
    );
    expect(issues({ ...tiny(), extra: true })).not.toEqual([]);
    expect(issues({ ...tiny(), schemaVersion: 2 })).not.toEqual([]);
    expect(
      issues(
        tiny({
          variables: [
            { id: "Bad-Id", type: "boolean", scope: "state", evidence },
          ],
        }),
      ),
    ).not.toEqual([]);
  });
});
