import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import {
  COMPILER_VERSION,
  compileWorkflows,
  type SearchIndex,
  type SearchRecord,
} from "@pathcompiler/workflow-compiler";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import { approveCandidate } from "@pathcompiler/workflow-review";
import { validateWorkflow } from "@pathcompiler/workflow-validator";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createResolver,
  evaluateResolver,
  normalizeTokens,
  ProductHelpResultSchema,
  relatedWorkflows,
  supportedActions,
} from "../src/index.js";

let fixtureIndex: SearchIndex;
beforeAll(async () => {
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  const approved = discoverWorkflows(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).report.candidates.map((candidate) =>
    approveCandidate(candidate, {
      approvedBy: "Test Reviewer",
      approvedAt: "2026-10-22T10:00:00.000Z",
      validation: validateWorkflow(candidate.workflow, {
        graph: mined.graph,
        traces: mined.report,
      }),
      repository: { ...project.repository, dirty: false },
    }),
  );
  fixtureIndex = compileWorkflows(approved).searchIndex;
});

const revision = `sha256:${"a".repeat(64)}`;
function record(overrides: Partial<SearchRecord>): SearchRecord {
  return {
    id: "invoices.send",
    revision,
    title: "Send Invoice",
    domain: "invoices",
    aliases: [],
    action: "send",
    entity: "invoice",
    qualifiers: [],
    roles: [],
    routes: ["/invoices"],
    permissions: [],
    featureFlags: [],
    version: 1,
    steps: [{ id: "step.1", text: "Select send" }],
    capabilities: {
      explain: true,
      checklist: true,
      navigate: true,
      guide: true,
      execute: false,
    },
    ...overrides,
  };
}
function index(...workflows: SearchRecord[]): SearchIndex {
  return {
    schemaVersion: 1,
    compilerVersion: COMPILER_VERSION,
    kind: "search-index",
    workflows,
  };
}

describe("product help resolver", () => {
  it("meets the reviewed paraphrase target on compiled fixture workflows", async () => {
    const dataset = JSON.parse(
      await readFile(
        new URL(
          "../../../fixtures/next-demo/eval/queries.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(dataset.cases.length).toBeGreaterThanOrEqual(20);
    const report = evaluateResolver(createResolver(fixtureIndex), dataset);
    const misses = [...report.cases, ...report.controls]
      .filter((outcome) => !outcome.correct)
      .map((outcome) => `${outcome.query} → ${outcome.actual.type}`);
    expect(
      report.controls.every((outcome) => outcome.correct),
      misses.join("; "),
    ).toBe(true);
    expect(report.accuracy, misses.join("; ")).toBeGreaterThanOrEqual(
      report.targetAccuracy,
    );
    expect(report.passed).toBe(true);
    for (const outcome of [...report.cases, ...report.controls])
      expect(ProductHelpResultSchema.parse(outcome.actual)).toEqual(
        outcome.actual,
      );
  });

  it("matches generic action verbs and entities, requiring compatible actions", () => {
    const resolver = createResolver(
      index(
        record({}),
        record({
          id: "invoices.create",
          title: "Create Invoice",
          action: "create",
        }),
      ),
    );
    expect(
      resolver.resolveProductHelp({ query: "Register an invoice, please" }),
    ).toEqual({
      type: "workflow_help",
      workflowId: "invoices.create",
      workflowVersion: 1,
      revision,
      confidence: 1,
      content: {
        title: "Create Invoice",
        steps: [{ id: "step.1", text: "Select send" }],
      },
      entrypoint: { route: "/invoices" },
      capabilities: {
        explain: true,
        checklist: true,
        navigate: true,
        guide: true,
        execute: false,
      },
      matched: {
        action: "create",
        entity: "invoice",
        alias: null,
        qualifiers: [],
      },
    });
    expect(
      resolver.resolveProductHelp({ query: "send the invoices" }),
    ).toMatchObject({ type: "workflow_help", workflowId: "invoices.send" });
    expect(
      resolver.resolveProductHelp({ query: "remove an invoice" }),
    ).toMatchObject({ type: "unsupported", reason: "no_matching_workflow" });
    expect(resolver.resolveProductHelp({ query: "  " })).toMatchObject({
      type: "unsupported",
      reason: "no_matching_workflow",
    });
    expect(resolver.resolveProductHelp({ query: "invoices" })).toMatchObject({
      type: "ambiguous",
      reason: "multiple-matches",
      candidates: [
        {
          workflowId: "invoices.create",
          workflowVersion: 1,
          title: "Create Invoice",
          confidence: 0.5,
        },
        {
          workflowId: "invoices.send",
          workflowVersion: 1,
          title: "Send Invoice",
          confidence: 0.5,
        },
      ],
    });
  });

  it("uses approved aliases and asks for confirmation when only the entity is named", () => {
    const resolver = createResolver(
      index(record({ aliases: ["bill a customer"] })),
    );
    expect(
      resolver.resolveProductHelp({ query: "How do I bill a customer?" }),
    ).toMatchObject({
      type: "workflow_help",
      matched: { alias: "bill a customer" },
      confidence: 1,
    });
    expect(resolver.resolveProductHelp({ query: "invoice" })).toMatchObject({
      type: "ambiguous",
      reason: "action-unclear",
      candidates: [{ workflowId: "invoices.send" }],
    });
  });

  it("filters by role, permissions and feature flags, and breaks ties by route", () => {
    const resolver = createResolver(
      index(
        record({
          roles: ["accountant"],
          permissions: ["invoices.send"],
          featureFlags: [{ flag: "billing", enabled: true }],
        }),
      ),
    );
    const query = "send invoice";
    expect(resolver.resolveProductHelp({ query }).type).toBe("workflow_help");
    expect(
      resolver.resolveProductHelp({
        query,
        context: {
          role: "accountant",
          permissions: ["invoices.send"],
          featureFlags: { billing: true },
        },
      }).type,
    ).toBe("workflow_help");
    expect(
      resolver.resolveProductHelp({
        query,
        context: {
          role: "viewer",
          permissions: [],
          featureFlags: { billing: false },
        },
      }),
    ).toMatchObject({
      type: "unsupported",
      reason: "not_available_for_context",
      unavailable: [
        {
          workflowId: "invoices.send",
          workflowVersion: 1,
          requires: [
            "role:accountant",
            "permission:invoices.send",
            "feature:billing=true",
          ],
        },
      ],
    });
    const routed = createResolver(
      index(
        record({ id: "invoices.send", routes: ["/invoices"] }),
        record({ id: "invoices.send_draft", routes: ["/drafts"] }),
      ),
    );
    expect(
      routed.resolveProductHelp({ query, context: { route: "/drafts" } }),
    ).toMatchObject({
      type: "workflow_help",
      workflowId: "invoices.send_draft",
    });
    // The full RuntimeContext (spec §75) is accepted; unknown keys are still rejected.
    expect(
      routed.resolveProductHelp({
        query,
        context: {
          route: "/drafts",
          locale: "en-GB",
          tenant: "acme",
          productRelease: "2026.10",
        },
      }).type,
    ).toBe("workflow_help");
    expect(routed.resolveProductHelp({ query }).type).toBe("ambiguous");
  });

  it("normalizes text deterministically and validates boundaries", () => {
    expect(normalizeTokens("Set up the Companies' Café, NOW!")).toEqual([
      "setup",
      "the",
      "company",
      "cafe",
      "now",
    ]);
    expect(normalizeTokens("status class bus")).toEqual([
      "status",
      "class",
      "bus",
    ]);
    const resolver = createResolver(index(record({})));
    expect(resolver.resolveProductHelp({ query: "send invoice" })).toEqual(
      resolver.resolveProductHelp({ query: "send invoice" }),
    );
    expect(() =>
      resolver.resolveProductHelp({ query: "x".repeat(501) }),
    ).toThrow();
    expect(() =>
      resolver.resolveProductHelp({
        query: "x",
        context: { extra: 1 },
      } as never),
    ).toThrow();
    expect(() => createResolver({ workflows: [] })).toThrow();
  });

  it("ranks related workflows by shared entity, then domain", () => {
    const catalog = index(
      record({}),
      record({ id: "invoices.create", action: "create" }),
      record({ id: "invoices.archive_batch", entity: "batch" }),
      record({ id: "billing.refund", domain: "billing", entity: "invoice" }),
      record({ id: "notes.create", domain: "notes", entity: "note" }),
    );
    expect(relatedWorkflows(catalog, "invoices.send")).toEqual([
      expect.objectContaining({
        id: "billing.refund",
        relation: "same-entity",
      }),
      expect.objectContaining({
        id: "invoices.create",
        relation: "same-entity",
      }),
      expect.objectContaining({
        id: "invoices.archive_batch",
        relation: "same-domain",
      }),
    ]);
    expect(relatedWorkflows(catalog, "invoices.send", 1)).toHaveLength(1);
    expect(relatedWorkflows(catalog, "missing.workflow")).toBeNull();
  });

  it("derives supported actions without ever offering execution", () => {
    const base = {
      id: "invoices.send",
      revision,
      version: 1,
      title: "Send Invoice",
      entrypoints: [{ route: "/invoices" }],
      preconditions: [],
      steps: [
        { id: "a", target: "invoice.send", action: { type: "click" as const } },
      ],
      terminal: { type: "explicit_next" as const },
    };
    expect(supportedActions(base)).toEqual({
      explain: true,
      checklist: true,
      navigate: true,
      guide: true,
      execute: false,
    });
    expect(
      supportedActions({
        ...base,
        entrypoints: [{ route: "/invoices/[id]" }],
        steps: [{ id: "a", action: { type: "click" } }],
      }),
    ).toMatchObject({ navigate: false, guide: false, execute: false });
  });
});
