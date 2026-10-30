import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAgentToolsMcpServer,
  createToolbox,
  TOOLS,
  type Toolbox,
  toAnthropicTools,
  toOpenAITools,
} from "../src/index.js";

const exec = promisify(execFile);
const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/${name}/`, import.meta.url));
const BINDINGS = {
  payment: "payments",
  request: "refund_requests",
  createRefund: "refund",
};
const temporary: string[] = [];

async function repository(name: string): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "pathcompiler-tools-"),
  );
  temporary.push(directory);
  await cp(fixture(name), directory, { recursive: true });
  const git = (...args: string[]) =>
    exec(
      "git",
      [
        "-c",
        "user.email=t@example.com",
        "-c",
        "user.name=T",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: directory },
    );
  await git("init", "-q", "-b", "main");
  await git("add", "-A");
  await git("commit", "-q", "-m", "base");
  return directory;
}
const open = (directory: string, allowWrite = false): Toolbox =>
  createToolbox({
    directory,
    allowWrite,
    bindings: BINDINGS,
    exclude: ["variants"],
    solver: () => createZ3SolverProvider(),
  });

afterAll(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => rm(item, { recursive: true, force: true })),
  );
});

describe("tools for harnesses", () => {
  let refunds: string;
  let tools: Toolbox;
  beforeAll(async () => {
    refunds = await repository("refunds");
    tools = open(refunds);
  });
  afterAll(async () => tools.close());

  it("describes the rules with their provenance", async () => {
    const outcome = await tools.call("pathcompiler_describe", {});
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const data = outcome.data as {
      operations: { id: string }[];
      rules: { id: string; trust: string }[];
    };
    expect(data.operations.map((item) => item.id)).toContain("refund");
    expect(
      data.rules.find(
        (item) => item.id === "refunds.manager_approval_over_limit",
      )?.trust,
    ).toBe("approved");
  });

  it("checks one agent action and explains a block", async () => {
    const outcome = await tools.call("pathcompiler_check_action", {
      operation: "refund",
      inputs: { payment_id: 1, amount: 6000, manager_approval: false },
      context: { "actor.role": "support_agent", "actor.id": "a1" },
      state: {
        "payments.original_amount": 10000,
        "payments.refunded_amount": 0,
      },
    });
    expect(outcome.ok && outcome.summary).toMatch(/^BLOCK refund: /);
  });

  it("verifies the specification", async () => {
    const outcome = await tools.call("pathcompiler_verify", {
      operations: ["refund"],
    });
    expect(outcome.ok).toBe(true);
  }, 60_000);

  it("rejects unknown tools and invalid input with a message the harness can read", async () => {
    const unknown = await tools.call("pathcompiler_nope", {});
    expect(!unknown.ok && unknown.error).toContain("Available:");
    const invalid = await tools.call("pathcompiler_check_action", {
      inputs: { a: 1 },
    });
    expect(!invalid.ok && invalid.error).toContain("operation");
    const extra = await tools.call("pathcompiler_describe", { surprise: true });
    expect(extra.ok).toBe(false);
  });

  it("tells a harness what its uncommitted change breaks, with the values", async () => {
    const work = await repository("refunds");
    const box = open(work);
    try {
      // Nothing changed yet.
      const clean = await box.call("pathcompiler_check_change", {});
      expect(clean.ok && (clean.data as { mustFix: string[] }).mustFix).toEqual(
        [],
      );
      // The support-agent fast path skips manager approval.
      await cp(
        path.join(work, "variants", "support-fast-path.ts"),
        path.join(work, "src", "refunds.ts"),
      );
      const broken = await box.call("pathcompiler_check_change", {});
      expect(broken.ok).toBe(true);
      if (!broken.ok) return;
      const data = broken.data as {
        verdict: string;
        mustFix: string[];
        counterexamples: { rule?: string; values?: Record<string, unknown> }[];
      };
      expect(data.mustFix.join("\n")).toContain("manager_approval_over_limit");
      expect(data.counterexamples[0]?.values).toBeDefined();
      expect(data.verdict).toBe("fail");
    } finally {
      await box.close();
    }
  }, 120_000);

  it("lets the harness submit rules, as a dry run unless writing is allowed", async () => {
    const proposals = {
      proposals: [
        {
          kind: "invariant",
          id: "refunds.processed_implies_approved",
          expression:
            "refund_requests.processed == false || refund_requests.approved == true",
          rationale:
            "The service refuses an unapproved request before it marks it processed.",
          evidence: [
            {
              type: "code",
              file: "src/refunds.ts",
              lines: "40",
              quote: "Not approved.",
            },
          ],
          confidence: "medium",
        },
      ],
    };
    const dry = await tools.call("pathcompiler_submit_rules", proposals);
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect((dry.data as { stored: boolean }).stored).toBe(false);

    const work = await repository("refunds");
    const box = open(work, true);
    try {
      const stored = await box.call("pathcompiler_submit_rules", proposals);
      expect(stored.ok && (stored.data as { stored: boolean }).stored).toBe(
        true,
      );
      const file = JSON.parse(
        await readFile(path.join(work, "spec", "candidate-rules.json"), "utf8"),
      );
      expect(JSON.stringify(file)).toContain(
        "refunds.processed_implies_approved",
      );
      const listed = await box.call("pathcompiler_list_rules", {
        trust: "candidate",
      });
      expect(listed.ok && JSON.stringify(listed.data)).toContain(
        "refunds.processed_implies_approved",
      );
    } finally {
      await box.close();
    }
  }, 120_000);

  it("reads a rule task in any repository, including one with no parser", async () => {
    const outcome = await tools.call("pathcompiler_rule_task", {});
    expect(outcome.ok && outcome.summary).toContain("Task rd-");
  });
});

describe("a repository in another language", () => {
  it("self-checks a Python change without a specification: signals, honestly labeled", async () => {
    const work = await repository("pyrefunds");
    const box = createToolbox({
      directory: work,
      solver: () => createZ3SolverProvider(),
      exclude: ["variants"],
    });
    try {
      await cp(
        path.join(work, "variants", "drops_self_approval_guard.py"),
        path.join(work, "refunds", "service.py"),
      );
      await writeFile(path.join(work, "notes.txt"), "scratch\n");
      const outcome = await box.call("pathcompiler_check_change", {});
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const data = outcome.data as {
        verdict: string;
        consider: string[];
        behaviorCheck: { applied: boolean; reason?: string };
        changed: { paths: string[] };
      };
      expect(data.behaviorCheck.applied).toBe(false);
      expect(data.behaviorCheck.reason).toContain("no behavior specification");
      expect(data.changed.paths).toContain("refunds/service.py");
      expect(data.changed.paths).toContain("notes.txt");
      expect(data.verdict).toBe("review");
      expect(data.consider.join("\n")).toMatch(/guard/i);
    } finally {
      await box.close();
    }
  }, 120_000);
});

describe("adapters", () => {
  it("exposes function-calling schemas for OpenAI and Anthropic", () => {
    const openai = toOpenAITools();
    const anthropic = toAnthropicTools();
    expect(openai.map((item) => item.function.name)).toEqual(
      TOOLS.map((item) => item.name),
    );
    expect(anthropic[0]?.input_schema).toMatchObject({ type: "object" });
    expect(JSON.stringify(openai)).not.toContain("$schema");
  });

  it("serves the tools over MCP", async () => {
    const box = createToolbox({
      directory: fixture("refunds"),
      bindings: BINDINGS,
      exclude: ["variants"],
      solver: () => createZ3SolverProvider(),
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const server = createAgentToolsMcpServer(box);
    const client = new Client({ name: "harness", version: "1.0.0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((item) => item.name).sort()).toEqual(
        TOOLS.map((item) => item.name).sort(),
      );
      const result = await client.callTool({
        name: "pathcompiler_check_action",
        arguments: { operation: "delete_payment" },
      });
      expect(JSON.stringify(result.structuredContent)).toContain("BLOCK");
      const failure = await client.callTool({
        name: "pathcompiler_check_action",
        arguments: {},
      });
      expect(failure.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
      await box.close();
    }
  });
});

const variable = (id: string, type: string, scope: string, extra = {}) => ({
  id,
  type,
  scope,
  ...extra,
});
const PYTHON_VARIABLES = [
  variable("refund.amount", "integer", "input"),
  variable("refund.manager_approval", "boolean", "input"),
  variable("payments.original_amount", "integer", "state"),
  variable("payments.refunded_amount", "integer", "state"),
  variable("actor.role", "enum", "context", {
    values: ["customer", "manager", "support_agent"],
  }),
  variable("actor.id", "string", "context"),
  variable("refund_requests.requester_id", "string", "state"),
  variable("refund_requests.approved", "boolean", "state"),
  variable("refund_requests.processed", "boolean", "state"),
];
const anchor = (lines: string, quote: string) => ({
  file: "refunds/service.py",
  lines,
  quote,
});
const operations = (limitFor: string) => [
  {
    id: "refund",
    description: "Refunds part of a payment.",
    anchors: [anchor("9-17", "if amount > 5000 and not manager_approval")],
    parameters: ["refund.amount", "refund.manager_approval"],
    preconditions: [
      'actor.role == "support_agent" || actor.role == "manager"',
      "refund.amount > 0",
      "refund.amount <= payments.original_amount - payments.refunded_amount",
      limitFor,
    ],
    effects: [
      {
        variable: "payments.refunded_amount",
        value: "payments.refunded_amount + refund.amount",
      },
    ],
  },
  {
    id: "approve_refund",
    anchors: [anchor("22-26", "Nobody approves their own refund request.")],
    parameters: [],
    preconditions: [
      'actor.role == "manager"',
      "actor.id != refund_requests.requester_id",
    ],
    effects: [{ variable: "refund_requests.approved", value: "true" }],
  },
  {
    id: "process_refund",
    anchors: [anchor("31-35", "Already processed.")],
    parameters: [],
    preconditions: ["!refund_requests.processed", "refund_requests.approved"],
    effects: [{ variable: "refund_requests.processed", value: "true" }],
  },
];

describe("a repository no extractor can read: the behavior contract", () => {
  it("describes Python once, then notices when the code changes and checks the rules against the new description", async () => {
    const work = await repository("pyrefunds");
    await mkdir(path.join(work, "spec"), { recursive: true });
    await cp(
      path.join(fixture("refunds"), "spec", "approved-rules.json"),
      path.join(work, "spec", "approved-rules.json"),
    );
    const box = createToolbox({
      directory: work,
      allowWrite: true,
      solver: () => createZ3SolverProvider(),
      exclude: ["variants"],
    });
    const git = (...args: string[]) =>
      exec(
        "git",
        [
          "-c",
          "user.email=t@example.com",
          "-c",
          "user.name=T",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd: work },
      );
    try {
      // 1. A harness reads the Python and describes it.
      const task = await box.call("pathcompiler_contract_task", {});
      expect(task.ok && JSON.stringify(task.data)).toContain(
        "refunds/service.py",
      );
      const submitted = await box.call("pathcompiler_submit_contract", {
        language: "python",
        variables: PYTHON_VARIABLES,
        operations: operations(
          "refund.amount <= 5000 || refund.manager_approval",
        ),
      });
      expect(submitted.ok).toBe(true);
      if (!submitted.ok) return;
      const result = submitted.data as {
        stored: boolean;
        operations: { id: string; status: string; reasons: string[] }[];
      };
      expect(
        result.operations.map((item) => [item.id, item.status, item.reasons]),
      ).toEqual([
        ["refund", "accepted", []],
        ["approve_refund", "accepted", []],
        ["process_refund", "accepted", []],
      ]);
      expect(result.stored).toBe(true);

      // 2. A person approves the facts; the base is committed.
      const file = path.join(work, "spec", "behavior-contract.json");
      const stored = JSON.parse(await readFile(file, "utf8"));
      expect(stored.operations[0].anchors[0].digest).toBeDefined();
      await writeFile(
        file,
        JSON.stringify(
          { ...stored, approvedBy: "pm@example.com", approvedAt: "2026-10-30" },
          null,
          2,
        ),
      );
      await git("add", "-A");
      await git("commit", "-q", "-m", "contract");

      const described = await box.call("pathcompiler_describe", {});
      expect(
        described.ok &&
          (described.data as { contract: { stale: unknown[] } }).contract.stale,
      ).toEqual([]);

      // 3. The business rules now apply to Python. A harmless change is clean.
      const clean = await box.call("pathcompiler_check_change", {});
      expect(clean.ok && (clean.data as { mustFix: string[] }).mustFix).toEqual(
        [],
      );

      // 4. The support-agent fast path passes the project's tests, but the code
      // the contract describes changed and the contract was not re-derived.
      await cp(
        path.join(work, "variants", "support_fast_path.py"),
        path.join(work, "refunds", "service.py"),
      );
      const stale = await box.call("pathcompiler_check_change", {});
      expect(stale.ok).toBe(true);
      if (!stale.ok) return;
      const staleData = stale.data as { verdict: string; consider: string[] };
      expect(staleData.verdict).toBe("review");
      expect(staleData.consider.join("\n")).toContain("behavior contract");
      expect(staleData.consider.join("\n")).toContain("refund");

      // 5. The harness re-derives the operation from the new code; the rule
      // the base approved is now checked against it, with the values that break it.
      const redone = await box.call("pathcompiler_submit_contract", {
        operations: operations(
          'refund.amount <= 5000 || refund.manager_approval || actor.role == "support_agent"',
        ).map((operation) =>
          operation.id === "refund"
            ? {
                ...operation,
                anchors: [
                  anchor("10-18", 'and actor["role"] != "support_agent"'),
                ],
              }
            : operation.id === "approve_refund"
              ? {
                  ...operation,
                  anchors: [
                    anchor(
                      "23-27",
                      "Nobody approves their own refund request.",
                    ),
                  ],
                }
              : {
                  ...operation,
                  anchors: [anchor("32-36", "Already processed.")],
                },
        ),
      });
      expect(redone.ok && JSON.stringify(redone.data)).toContain('"accepted"');
      const checked = await box.call("pathcompiler_check_change", {});
      expect(checked.ok).toBe(true);
      if (!checked.ok) return;
      const data = checked.data as {
        verdict: string;
        consider: string[];
        mustFix: string[];
        counterexamples: { rule?: string; values?: Record<string, unknown> }[];
      };
      expect(data.counterexamples.map((item) => item.rule)).toContain(
        "refunds.manager_approval_over_limit",
      );
      // Facts a harness wrote are not enough to fail a change on their own.
      expect(data.mustFix).toEqual([]);
      expect(data.verdict).toBe("review");
    } finally {
      await box.close();
    }
  }, 180_000);

  it("rejects a description that cites code that is not there", async () => {
    const work = await repository("pyrefunds");
    const box = createToolbox({
      directory: work,
      solver: () => createZ3SolverProvider(),
      exclude: ["variants"],
    });
    try {
      const bad = await box.call("pathcompiler_submit_contract", {
        variables: PYTHON_VARIABLES,
        operations: [
          {
            ...operations("refund.amount > 0")[0],
            anchors: [anchor("9-17", "this text is not in the file")],
          },
        ],
      });
      expect(bad.ok && JSON.stringify(bad.data)).toContain(
        "No anchor could be verified",
      );
      const unknown = await box.call("pathcompiler_submit_contract", {
        operations: operations("refund.amount > 0").slice(0, 1),
      });
      expect(unknown.ok && JSON.stringify(unknown.data)).toContain(
        "Undeclared variable",
      );
    } finally {
      await box.close();
    }
  }, 60_000);
});
