import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type BehaviorSpec,
  formatExpression,
  toFormalModel,
} from "@pathcompiler/behavior-ir";
import { describe, expect, it } from "vitest";
import {
  classify,
  type ExtractionResult,
  emptyFragment,
  extractAssertions,
  extractBehavior,
  extractOpenApi,
  extractSql,
  extractZod,
  type GroundTruth,
  mergeFragments,
  scoreExtraction,
} from "../src/index.js";

const root = resolve(import.meta.dirname, "../../../fixtures/refunds");
const read = (path: string) => ({
  path: `fixtures/refunds/${path}`,
  content: readFileSync(resolve(root, path), "utf8"),
});
const FIXTURE = [
  "db/schema.sql",
  "src/models.ts",
  "api/openapi.json",
  "tests/refunds.test.ts",
  "spec/approved-rules.json",
  "src/refunds.ts",
].map(read);
const OPTIONS = {
  bindings: {
    payment: "payments",
    createRefund: "refund",
    request: "refund_requests",
  },
};
const invariants = (spec: BehaviorSpec) =>
  spec.invariants.map((item) => formatExpression(item.expression));

describe("refund fixture extraction (RQ1)", () => {
  const result = extractBehavior(FIXTURE, OPTIONS);
  const truth = JSON.parse(
    readFileSync(resolve(root, "spec/ground-truth.json"), "utf8"),
  ) as GroundTruth;

  it("matches the hand-reviewed ground truth with correct provenance", () => {
    const score = scoreExtraction(result.ledger, truth, result.unsupported);
    expect(score.missing).toEqual([]);
    expect(score.extra).toEqual([]);
    expect(score.precision).toBe(1);
    expect(score.recall).toBe(1);
    expect(score.provenanceErrors).toEqual([]);
    expect(score.provenanceCorrect).toBe(1);
    expect(score.unsupportedReported).toBe(score.unsupportedExpected);
  });

  it("scores a wrong extraction below 1 and names what is wrong", () => {
    const damaged = result.ledger
      .filter((item) => item.text !== "payments.original_amount > 0")
      .map((item) =>
        item.text === "payments.refunded_amount >= 0" &&
        item.provenance.sourceType === "TEST"
          ? { ...item, provenance: { ...item.provenance, sourceFile: "x.ts" } }
          : item,
      );
    damaged.push({
      kind: "invariant",
      text: "payments.original_amount < 0",
      provenance: result.ledger[0]?.provenance as never,
    });
    const score = scoreExtraction(damaged, truth);
    expect(score.recall).toBeLessThan(1);
    expect(score.precision).toBeLessThan(1);
    expect(score.missing).toContain("invariant|payments.original_amount > 0");
    expect(score.extra).toContain("invariant|payments.original_amount < 0");
    expect(score.provenanceErrors.join("\n")).toContain(
      "tests/refunds.test.ts",
    );
  });

  it("produces a valid, deterministic specification", () => {
    const again = extractBehavior([...FIXTURE].reverse(), OPTIONS);
    expect(again.specHash).toBe(result.specHash);
    expect(result.conflicts).toEqual([]);
    expect(result.inputs.sql).toEqual(["fixtures/refunds/db/schema.sql"]);
  });

  it("keeps a rule once with every source that states it", () => {
    const nonNegative = result.spec.invariants.find(
      (item) =>
        formatExpression(item.expression) === "payments.refunded_amount >= 0",
    );
    expect(
      nonNegative?.provenance.map((item) => item.sourceType).sort(),
    ).toEqual(["DATABASE_SCHEMA", "TEST", "VALIDATION_MODEL"]);
    expect(
      invariants(result.spec).filter(
        (text) => text === "payments.refunded_amount >= 0",
      ),
    ).toHaveLength(1);
  });

  it("marks only verbatim declarations EXPLICIT; assertions and code guards are INFERRED", () => {
    for (const entry of result.ledger) {
      if (entry.provenance.sourceType === "TEST")
        expect(entry.provenance.origin).toBe("INFERRED");
      else if (entry.provenance.sourceType === "HUMAN_DECLARATION")
        expect(entry.provenance.origin).toBe("HUMAN_APPROVED");
      else if (entry.provenance.sourceType === "SOURCE_CODE")
        expect(entry.provenance.origin).toBe("INFERRED");
      else expect(entry.provenance.origin).toBe("EXPLICIT");
    }
  });

  it("merges the input contract of Zod, OpenAPI and the guards of the code", () => {
    const refund = result.spec.operations.find((item) => item.id === "refund");
    expect(refund?.preconditions.map(formatExpression).sort()).toEqual([
      'actor.role == "support_agent" || actor.role == "manager"',
      "refund.amount <= 100000",
      "refund.amount <= 5000 || refund.manager_approval",
      "refund.amount <= payments.original_amount - payments.refunded_amount",
      "refund.amount > 0",
      "refund.amount >= 1",
      "refund.payment_id > 0",
      "refund.payment_id >= 1",
    ]);
    expect(refund?.provenance.map((item) => item.sourceType).sort()).toEqual([
      "OPENAPI",
      "SOURCE_CODE",
      "VALIDATION_MODEL",
    ]);
  });

  it("carries human-approved rules with who declared them", () => {
    const rule = result.spec.businessRules.find(
      (item) => item.id === "refunds.manager_approval_over_limit",
    );
    expect(rule?.provenance[0]).toMatchObject({
      origin: "HUMAN_APPROVED",
      declaredBy: "finance-policy@example.com",
    });
    expect(rule && formatExpression(rule.must)).toBe(
      "refund.manager_approval == true",
    );
  });

  it("converts to a Formal Product Model with the unsupported parts listed", () => {
    const { omitted } = toFormalModel(result.spec);
    expect(omitted.some((item) => item.kind === "data constraint")).toBe(true);
  });
});

describe("SQL extractor", () => {
  const sql = (content: string) => extractSql({ path: "s.sql", content });
  it("reads checks, enums, keys and reports what it cannot model", () => {
    const out = sql(`CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('open', 'paid')),
  qty INT CHECK (qty BETWEEN 1 AND 10),
  total DECIMAL(10,2),
  note TEXT CHECK (note IS NOT NULL),
  owner_id INT REFERENCES users (id),
  UNIQUE (id, status),
  CONSTRAINT cap CHECK (qty * 2 <= 15 AND NOT (qty = 3))
);`);
    expect(out.variables.map((item) => `${item.type} ${item.id}`)).toEqual([
      "integer orders.id",
      "enum orders.status",
      "integer orders.qty",
      "string orders.note",
      "integer orders.owner_id",
    ]);
    const status = out.variables.find((item) => item.id === "orders.status");
    expect(status?.type === "enum" && status.values).toEqual(["open", "paid"]);
    expect(
      out.invariants.map((item) => formatExpression(item.expression)),
    ).toEqual([
      'orders.status == "open" || orders.status == "paid"',
      "orders.qty >= 1 && orders.qty <= 10",
      "orders.qty * 2 <= 15 && !orders.qty == 3",
    ]);
    expect(
      out.dataConstraints.map((item) => `${item.kind} ${item.subject}`),
    ).toEqual(
      expect.arrayContaining([
        "primary_key orders.id",
        "not_null orders.status",
        "foreign_key orders.owner_id",
        "unique orders.id, orders.status",
      ]),
    );
    expect(out.unsupported.map((item) => item.reason).join("\n")).toContain(
      "Column type DECIMAL",
    );
    expect(out.unsupported.map((item) => item.reason).join("\n")).toContain(
      "IS [NOT] NULL",
    );
  });

  it("reports an unknown column instead of guessing", () => {
    const out = sql("CREATE TABLE t (a INT CHECK (b > 0));");
    expect(out.invariants).toEqual([]);
    expect(out.unsupported[0]?.reason).toContain("unknown column b");
  });
});

describe("Zod extractor", () => {
  const zod = (content: string) =>
    extractZod({
      path: "m.ts",
      content: `import { z } from "zod";\n${content}`,
    });
  it("skips non-integers and optional bounds and says why", () => {
    const out = zod(`export const PriceInput = z.object({
  price: z.number().positive(),
  qty: z.number().int().max(5).optional(),
  tier: z.enum(["gold", "silver"]),
});`);
    expect(out.operations[0]?.preconditions).toEqual([]);
    expect(out.operations[0]?.parameters).toEqual(["price.qty", "price.tier"]);
    expect(out.unsupported.map((item) => item.reason)).toEqual([
      "z.number() without .int() has no exact BehaviorIR type (integers only)",
      "bounds on an optional field apply only when it is present, so they are not applied",
    ]);
  });
  it("lets bindings decide the entity and context overrides", () => {
    const out = extractZod(
      {
        path: "m.ts",
        content: `import { z } from "zod";
export const InvoiceSchema = z.object({ total: z.number().int().min(0) });
export const CallerSchema = z.object({ tier: z.enum(["a", "b"]) });`,
      },
      { bindings: { invoice: "invoices" }, contextParameters: ["caller"] },
    );
    expect(
      out.invariants.map((item) => formatExpression(item.expression)),
    ).toEqual(["invoices.total >= 0"]);
    expect(out.variables.map((item) => `${item.scope} ${item.id}`)).toEqual([
      "state invoices.total",
      "context caller.tier",
    ]);
  });
  it("ignores files that do not import zod", () => {
    expect(extractZod({ path: "x.ts", content: "const a = 1;" })).toEqual(
      emptyFragment(),
    );
  });
});

describe("OpenAPI extractor", () => {
  it("reads YAML with exclusive bounds and global security", () => {
    const out = extractOpenApi({
      path: "openapi.yaml",
      content: `openapi: 3.1.0
security:
  - key: []
paths:
  /pay:
    post:
      operationId: pay
      parameters:
        - { name: limit, in: query, required: true, schema: { type: integer, exclusiveMinimum: 0, maximum: 9 } }
`,
    });
    expect(out.operations[0]?.preconditions.map(formatExpression)).toEqual([
      "pay.limit <= 9",
      "pay.limit > 0",
    ]);
    expect(out.dataConstraints.map((item) => item.kind).sort()).toEqual([
      "authentication_required",
      "required",
    ]);
  });
  it("ignores documents that are not OpenAPI", () => {
    expect(extractOpenApi({ path: "x.json", content: '{"a": 1}' })).toEqual(
      emptyFragment(),
    );
  });
});

describe("assertion extractor", () => {
  const run = (body: string, bindings = { payment: "payments" }) =>
    extractAssertions(
      { path: "a.test.ts", content: `it("x", () => {\n${body}\n});` },
      { bindings },
    );
  it("lifts sign checks and field relations, not test data", () => {
    const out = run(`expect(payment.balance).toBeGreaterThan(0);
expect(payment.paid).toBeLessThanOrEqual(payment.total);
expect(payment.paid).toBeLessThanOrEqual(7);
expect(other.x).toBeGreaterThan(0);
expect(payment.paid).toBe(3);`);
    expect(
      out.invariants.map((item) => formatExpression(item.expression)),
    ).toEqual(["payments.balance > 0", "payments.paid <= payments.total"]);
    expect(out.invariants[0]?.provenance[0]).toMatchObject({
      sourceType: "TEST",
      origin: "INFERRED",
      confidence: "MEDIUM",
    });
    expect(out.unsupported).toHaveLength(3);
  });
});

describe("merge", () => {
  const base = emptyFragment();
  const provenance = {
    sourceType: "TEST" as const,
    origin: "INFERRED" as const,
    extractionMethod: "STATIC_ANALYSIS" as const,
    extractorVersion: "t",
    confidence: "MEDIUM" as const,
    sourceFile: "a.test.ts",
  };
  const merge = (
    ...fragments: ReturnType<typeof emptyFragment>[]
  ): ExtractionResult["spec"] =>
    mergeFragments(fragments, { id: "t", repositoryCommit: null }).spec;
  it("quarantines a rule over an unknown variable instead of failing", () => {
    const result = mergeFragments(
      [
        {
          ...base,
          variables: [{ id: "a.x", type: "integer", scope: "state" }],
          invariants: [
            {
              id: "a.ok",
              expression: {
                op: "ge",
                left: { op: "var", id: "a.x" },
                right: { op: "lit", value: 0 },
              },
              provenance: [provenance],
            },
            {
              id: "a.bad",
              expression: {
                op: "ge",
                left: { op: "var", id: "a.y" },
                right: { op: "lit", value: 0 },
              },
              provenance: [provenance],
            },
          ],
        },
      ],
      { id: "t", repositoryCommit: null },
    );
    expect(result.spec.invariants.map((item) => item.id)).toEqual(["a.ok"]);
    expect(result.unsupported[0]).toMatchObject({
      construct: "invariant a.bad",
      reason: "Unknown variable a.y",
    });
  });
  it("reports conflicting declarations and keeps the first", () => {
    const result = mergeFragments(
      [
        {
          ...base,
          variables: [{ id: "a.x", type: "integer", scope: "state" }],
        },
        {
          ...base,
          variables: [{ id: "a.x", type: "boolean", scope: "state" }],
        },
      ],
      { id: "t", repositoryCommit: null },
    );
    expect(result.conflicts[0]).toContain("a.x is declared as state integer");
    expect(result.spec.variables[0]?.type).toBe("integer");
  });
  it("unions enum values and handles an empty extraction", () => {
    const spec = merge(
      {
        ...base,
        variables: [{ id: "a.s", type: "enum", scope: "state", values: ["b"] }],
      },
      {
        ...base,
        variables: [{ id: "a.s", type: "enum", scope: "state", values: ["a"] }],
      },
    );
    expect(spec.variables[0]).toMatchObject({ values: ["a", "b"] });
    expect(merge().variables).toEqual([]);
  });
});

describe("classify", () => {
  it("routes files to extractors by name and content", () => {
    const file = (path: string, content = "") => classify({ path, content });
    expect(file("db/x.sql")).toEqual(["sql"]);
    expect(file("api/openapi.json")).toEqual(["openapi"]);
    expect(file("spec/approved-rules.json")).toEqual(["approved"]);
    expect(file("a.test.ts")).toEqual(["assertions"]);
    expect(file("m.ts", 'import { z } from "zod"')).toEqual(["zod"]);
    expect(file("node_modules/zod/x.ts", 'import { z } from "zod"')).toEqual(
      [],
    );
    expect(file("readme.md")).toEqual([]);
  });
});
