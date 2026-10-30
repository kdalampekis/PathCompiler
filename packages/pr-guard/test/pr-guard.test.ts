import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SourceFile } from "@pathcompiler/behavior-extraction";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import { createZ3SolverProvider } from "@pathcompiler/solver-z3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as base from "../../../fixtures/refunds/src/refunds.js";
import { scenarios } from "../../../fixtures/refunds/tests/scenarios.js";
import * as benignRefactor from "../../../fixtures/refunds/variants/benign-refactor.js";
import * as doubleProcess from "../../../fixtures/refunds/variants/double-process.js";
import * as ownApproval from "../../../fixtures/refunds/variants/own-approval.js";
import * as stricterLimit from "../../../fixtures/refunds/variants/stricter-limit.js";
import * as supportFastPath from "../../../fixtures/refunds/variants/support-fast-path.js";
import {
  formatPrGuardMarkdown,
  type PrGuardReport,
  verifyPullRequest,
} from "../src/index.js";

let solver: SolverProvider;
beforeAll(async () => {
  solver = await createZ3SolverProvider();
});
afterAll(async () => {
  await solver?.close();
});

const root = resolve(import.meta.dirname, "../../../fixtures/refunds");
const read = (path: string): SourceFile => ({
  path,
  content: readFileSync(resolve(root, path), "utf8"),
});
const BINDINGS = {
  payment: "payments",
  request: "refund_requests",
  createRefund: "refund",
};
const BASE_FILES = [
  "db/schema.sql",
  "src/models.ts",
  "api/openapi.json",
  "spec/approved-rules.json",
  "src/refunds.ts",
].map(read);
/** The repository with `src/refunds.ts` replaced by a candidate. */
const withService = (content: string, files = BASE_FILES): SourceFile[] =>
  files.map((file) =>
    file.path === "src/refunds.ts" ? { ...file, content } : file,
  );
const variant = (name: string) => read(`variants/${name}.ts`).content;
const guard = (
  head: SourceFile[],
  extra: { strict?: boolean; base?: SourceFile[] } = {},
): Promise<PrGuardReport> =>
  verifyPullRequest({
    base: extra.base ?? BASE_FILES,
    head,
    baseRef: "main",
    headRef: "pr",
    options: { bindings: BINDINGS },
    solver,
    ...(extra.strict ? { strict: true } : {}),
  });
const important = (report: PrGuardReport) =>
  report.findings.filter((item) => item.severity !== "info");

describe("PR guard on seeded regressions (RQ3)", () => {
  it("blocks the support-agent fast path with a counterexample and names the change", async () => {
    const report = await guard(withService(variant("support-fast-path")));
    expect(report.verdict).toBe("fail");
    const [finding, ...rest] = important(report);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      kind: "regression",
      severity: "fail",
      rule: { id: "refunds.manager_approval_over_limit", humanBacked: true },
      counterexample: { operation: "refund", replayed: true },
    });
    expect(finding?.counterexample?.context["actor.role"]).toBe(
      "support_agent",
    );
    const change = report.diff.operations.find(
      (item) => item.operation === "refund",
    );
    expect(change?.preconditions.relation).toBe("weakened");
    expect(change?.preconditions.added).toEqual([
      'refund.amount <= 5000 || refund.manager_approval || actor.role == "support_agent"',
    ]);
    expect(report.base.summary.VIOLATED).toBe(0);
    expect(report.head.summary.VIOLATED).toBe(1);
  });

  it("blocks each dropped guard and only that one", async () => {
    for (const [name, rule] of [
      ["own-approval", "refunds.no_self_approval"],
      ["double-process", "refunds.process_once"],
    ] as const) {
      const report = await guard(withService(variant(name)));
      expect(report.verdict, name).toBe("fail");
      expect(
        important(report).map((item) => item.rule?.id),
        name,
      ).toEqual([rule]);
    }
  });

  it("does not flag a behavior-preserving refactor", async () => {
    const report = await guard(withService(variant("benign-refactor")));
    expect(report.verdict).toBe("pass");
    expect(report.findings).toEqual([]);
    expect(report.diff.changed).toBe(false);
  });

  it("passes a stricter limit but reports that the precondition got stricter", async () => {
    const report = await guard(withService(variant("stricter-limit")));
    expect(report.verdict).toBe("pass");
    expect(report.findings).toEqual([]);
    expect(
      report.diff.operations.map((item) => [
        item.operation,
        item.preconditions.relation,
      ]),
    ).toEqual([["refund", "strengthened"]]);
  });

  it("passes an unchanged repository", async () => {
    const report = await guard(BASE_FILES);
    expect(report.verdict).toBe("pass");
    expect(report.diff.changed).toBe(false);
  });
});

describe("tests pass while the rule fails", () => {
  it("runs the example tests against every candidate", () => {
    const services = {
      "src/refunds": base,
      "variants/support-fast-path": supportFastPath,
      "variants/own-approval": ownApproval,
      "variants/double-process": doubleProcess,
      "variants/benign-refactor": benignRefactor,
      "variants/stricter-limit": stricterLimit,
    };
    expect(Object.keys(scenarios).length).toBeGreaterThan(5);
    for (const [name, service] of Object.entries(services))
      for (const [title, scenario] of Object.entries(scenarios))
        expect(() => scenario(service), `${name}: ${title}`).not.toThrow();
  });
});

describe("what the guard refuses to be fooled by", () => {
  it("checks the head against the base's approved rules, not the edited ones", async () => {
    const edited = BASE_FILES.map((file) =>
      file.path === "spec/approved-rules.json"
        ? {
            ...file,
            content: JSON.stringify({
              ...JSON.parse(file.content),
              businessRules: [],
            }),
          }
        : file,
    );
    const report = await guard(
      withService(variant("support-fast-path"), edited),
    );
    expect(report.verdict).toBe("fail");
    expect(report.findings.map((item) => item.kind)).toContain("regression");
    expect(report.findings.map((item) => item.kind)).toContain(
      "approved_rules_changed",
    );
  });

  it("asks for review when a schema rule disappears", async () => {
    const head = BASE_FILES.map((file) =>
      file.path === "db/schema.sql"
        ? {
            ...file,
            content: file.content.replace(
              "  CHECK (refunded_amount <= original_amount)\n",
              "  CHECK (refunded_amount >= 0)\n",
            ),
          }
        : file,
    );
    const report = await guard(head);
    expect(report.verdict).toBe("review");
    expect(report.findings.map((item) => item.message)).toContain(
      "The change removes invariant payments.refunded_amount <= payments.original_amount.",
    );
    // Review findings become failures in strict mode.
    expect((await guard(head, { strict: true })).verdict).toBe("fail");
  });

  it("asks for review when new code cannot be modeled", async () => {
    const content = read("src/refunds.ts").content.replace(
      "  payment.refundedAmount += amount;",
      "  audit(actor);\n  payment.refundedAmount += amount;",
    );
    const report = await guard(withService(content));
    expect(report.verdict).toBe("review");
    expect(report.findings.map((item) => item.kind)).toEqual([
      "limitation_added",
    ]);
    expect(report.findings[0]?.message).toContain("audit(actor)");
  });

  it("does not pass when the guarded function is renamed away", async () => {
    // The API contract still describes `refund`, but the guards now belong to
    // a different operation, so the approved rules are no longer enforced.
    const renamed = read("src/refunds.ts").content.replace(
      "export function refund(",
      "export function issueRefund(",
    );
    const report = await guard(withService(renamed));
    expect(report.verdict).toBe("fail");
    expect(
      important(report).map((item) => [item.kind, item.rule?.id]),
    ).toContainEqual(["regression", "refunds.manager_approval_over_limit"]);
    expect(
      report.diff.operations.map((item) => [item.operation, item.status]),
    ).toContainEqual(["issue_refund", "added"]);
  });

  it("is deterministic", async () => {
    const head = withService(variant("support-fast-path"));
    expect(JSON.stringify(await guard(head))).toBe(
      JSON.stringify(await guard(head)),
    );
  });
});

describe("pull request comment", () => {
  it("shows the verdict, the counterexample, the change and the caveats", async () => {
    const markdown = formatPrGuardMarkdown(
      await guard(withService(variant("support-fast-path"))),
    );
    expect(markdown).toContain("Blocked: a business rule is newly violated");
    expect(markdown).toContain("refunds.manager_approval_over_limit");
    expect(markdown).toContain("confirmed");
    expect(markdown).toContain('actor.role="support_agent"');
    // Only the variables that matter to the violation are shown.
    expect(markdown).toContain("refund.amount=");
    expect(markdown).not.toContain("refund_requests.requester_id");
    expect(markdown).toContain("no longer requires");
    expect(markdown).toContain("not business ground truth");
    expect(formatPrGuardMarkdown(await guard(BASE_FILES))).toContain(
      "No encoded rule is newly violated",
    );
  });
});
