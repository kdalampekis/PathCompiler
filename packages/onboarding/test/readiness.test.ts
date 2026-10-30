import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  assessReadiness,
  formatReadiness,
  githubWorkflow,
  mcpConfig,
  suggestBindings,
} from "../src/index.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/${name}/`, import.meta.url));
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => rm(item, { recursive: true, force: true })),
  );
});
const copy = async (name: string) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "pathcompiler-start-"),
  );
  temporary.push(directory);
  await cp(fixture(name), directory, { recursive: true });
  return directory;
};

describe("readiness", () => {
  it("sends a Python repository to the language-neutral contract, not to a parser", async () => {
    const report = await assessReadiness(await copy("pyrefunds"), {
      exclude: ["variants"],
    });
    expect(report.languages[0]).toMatchObject({ language: "Python" });
    expect(report.projectChecks.map((item) => item.kind)).toContain("test");
    expect(report.stage).toBe("describe_the_code");
    expect(report.nextSteps[0]?.command).toContain("contract task");
    expect(report.nextSteps.map((step) => step.command)).toContain(
      "pathcompiler ci --report-only",
    );
  });

  it("moves on once code is described and rules are approved", async () => {
    const directory = await copy("pyrefunds");
    await mkdir(path.join(directory, "spec"));
    await writeFile(
      path.join(directory, "spec", "behavior-contract.json"),
      JSON.stringify({
        schemaVersion: 1,
        kind: "behavior-contract",
        producer: "harness: t",
        variables: [{ id: "refund.amount", type: "integer", scope: "input" }],
        operations: [
          {
            id: "refund",
            anchors: [{ file: "refunds/service.py", lines: "9-17" }],
            parameters: ["refund.amount"],
            preconditions: ["refund.amount > 0"],
          },
        ],
      }),
    );
    const report = await assessReadiness(directory, { exclude: ["variants"] });
    expect(report.specification.operations).toBe(1);
    expect(report.specification.operationSources.contract).toBe(1);
    expect(report.stage).toBe("add_rules");
    expect(report.nextSteps[0]?.command).toContain("rules task");
  });

  it("reads the refund repository as ready to protect", async () => {
    const report = await assessReadiness(fixture("refunds"), {
      exclude: ["variants"],
      bindings: {
        payment: "payments",
        request: "refund_requests",
        createRefund: "refund",
      },
    });
    expect(report.stage).toBe("protecting");
    expect(report.specification.approvedRules).toBeGreaterThan(0);
    expect(formatReadiness(report)).toContain("approved rule(s)");
  });

  it("handles an empty directory", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "pathcompiler-start-"),
    );
    temporary.push(directory);
    const report = await assessReadiness(directory);
    expect(report.stage).toBe("nothing_to_check");
  });

  it("suggests bindings where the code and the schema name the same thing differently", () => {
    expect(
      suggestBindings([
        "payment",
        "payments",
        "refund_requests",
        "request",
        "actor",
      ]),
    ).toEqual(["payment=payments", "request=refund_requests"]);
  });

  it("prints a connection config and a report-only workflow", () => {
    expect(
      mcpConfig(["payment=payments"]).mcpServers.pathcompiler.args,
    ).toEqual(["mcp-agent", ".", "--bind", "payment=payments"]);
    expect(githubWorkflow()).toContain("pathcompiler ci --report-only");
  });
});
