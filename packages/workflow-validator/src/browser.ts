import {
  type WorkflowCondition,
  WorkflowV1Schema,
} from "@pathcompiler/workflow-ir";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";

export * from "./browser-workflow.js";

const status = z.enum(["not-run", "passed", "failed"]);
export const BrowserVerificationReportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("fixture-browser-verification"),
    workflowId: z.string().nullable(),
    candidateCommit: z.string().nullable(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    origin: z.string().nullable(),
    valid: z.boolean(),
    steps: z.array(
      z.strictObject({
        stepId: z.string(),
        target: z.string(),
        action: z.enum(["click", "input"]),
        status,
        expected: status,
      }),
    ),
    terminal: status,
    failure: z
      .strictObject({
        code: z.string(),
        stage: z.enum([
          "preflight",
          "open",
          "resolve",
          "action",
          "expected",
          "terminal",
        ]),
        message: z.string(),
        stepId: z.string().optional(),
        target: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((report, context) => {
    const valid =
      !report.failure &&
      report.terminal === "passed" &&
      report.steps.length > 0 &&
      report.steps.every(
        (step) => step.status === "passed" && step.expected !== "failed",
      );
    if (report.valid !== valid)
      context.addIssue({
        code: "custom",
        message: "Browser result must agree with observed steps and terminal",
      });
  });
export type BrowserVerificationReport = z.infer<
  typeof BrowserVerificationReportSchema
>;
export type FixtureVerificationOptions = {
  /** Caller-owned Page in a disposable context, with the intended test user/session. */
  page: Page;
  baseURL: string;
  inputs: { "client.form.name": string; "client.form.email": string };
  timeoutMs?: number;
};
const optionsSchema = z.strictObject({
  baseURL: z.url(),
  timeoutMs: z.number().int().min(100).max(10_000),
  inputs: z.strictObject({
    "client.form.name": z.string().min(1).max(80),
    "client.form.email": z.string().min(1).max(160),
  }),
});
class VerificationFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const fixtureSteps = [
  { target: "clients.create", action: "click" },
  { target: "client.form.name", action: "input" },
  { target: "client.form.email", action: "input" },
  { target: "client.form.submit", action: "click" },
] as const;
const observationTargets = new Set([
  ...fixtureSteps.map((step) => step.target),
  "clients.feedback",
  "dialog.container",
]);
function supported(condition: WorkflowCondition): boolean {
  return (
    "target" in condition &&
    observationTargets.has(condition.target) &&
    [
      "target_appears",
      "element_text",
      "element_count",
      "element_state",
    ].includes(condition.type)
  );
}

/** Intentionally limited to the fixture's Create Client path. Never reads test input values from evidence. */
export async function verifyFixtureWorkflow(
  input: unknown,
  options: FixtureVerificationOptions,
): Promise<BrowserVerificationReport> {
  const report: BrowserVerificationReport = {
    schemaVersion: 1,
    kind: "fixture-browser-verification",
    workflowId: null,
    candidateCommit: null,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    origin: null,
    valid: false,
    steps: [],
    terminal: "not-run",
  };
  let stage: NonNullable<BrowserVerificationReport["failure"]>["stage"] =
    "preflight";
  let current: BrowserVerificationReport["steps"][number] | undefined;
  try {
    const parsed = WorkflowV1Schema.safeParse(input);
    if (!parsed.success)
      throw new VerificationFailure(
        "invalid-workflow",
        "Provide a schema-valid Workflow V1 candidate; run static validation first.",
      );
    const workflow = parsed.data;
    report.workflowId = workflow.id;
    report.candidateCommit = workflow.repository.commit;
    const parsedOptions = optionsSchema.safeParse({
      baseURL: options.baseURL,
      inputs: options.inputs,
      timeoutMs: options.timeoutMs ?? 5_000,
    });
    if (!parsedOptions.success)
      throw new VerificationFailure(
        "invalid-options",
        "Provide the local fixture URL, explicit name/email input bindings and a 100–10000 ms timeout.",
      );
    const { baseURL, inputs, timeoutMs } = parsedOptions.data;
    const url = new URL(baseURL);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new VerificationFailure(
        "unsupported-fixture-url",
        "Use a loopback HTTP(S) fixture origin without credentials, path, query or fragment.",
      );
    report.origin = url.origin;
    if (
      !/^clients\.create(?:--[a-f0-9]{12})?$/.test(workflow.id) ||
      !["candidate", "approved"].includes(workflow.status) ||
      workflow.entrypoints.length !== 1 ||
      workflow.entrypoints[0]?.route !== "/clients" ||
      workflow.entrypoints[0]?.state ||
      workflow.preconditions?.length ||
      workflow.steps.length !== fixtureSteps.length
    )
      throw new VerificationFailure(
        "unsupported-fixture-workflow",
        "This runner supports only the four-step Create Client fixture workflow at /clients, without inferred preconditions or branches.",
      );
    for (const [index, step] of workflow.steps.entries()) {
      const allowed = fixtureSteps[index];
      if (
        !allowed ||
        step.target !== allowed?.target ||
        step.action.type !== allowed.action ||
        step.optional ||
        step.branches?.length ||
        step.next !== workflow.steps[index + 1]?.id ||
        (step.expected && !supported(step.expected))
      )
        throw new VerificationFailure(
          "unsupported-fixture-step",
          `Step ${step.id} (${step.target ?? "no target"}) differs from the allowed Create Client path. Review stale targets, order and conditions before retrying.`,
        );
    }
    if (
      !("type" in workflow.terminal) ||
      workflow.terminal.type !== "element_text" ||
      workflow.terminal.target !== "clients.feedback"
    )
      throw new VerificationFailure(
        "unsupported-fixture-terminal",
        "Create Client requires an explicit text completion assertion on clients.feedback.",
      );
    report.steps = workflow.steps.map((step, index) => ({
      stepId: step.id,
      target: fixtureSteps[index]?.target ?? "",
      action: step.action.type as "click" | "input",
      status: "not-run",
      expected: "not-run",
    }));
    const page = options.page;
    const locator = (target: string) =>
      page.locator(`[data-pathcompiler=${JSON.stringify(target)}]`);
    function onFixture() {
      const location = new URL(page.url());
      if (location.origin !== url.origin || location.pathname !== "/clients")
        throw new VerificationFailure(
          "unexpected-navigation",
          "Browser left the fixture's /clients route. No further actions were performed.",
        );
    }
    async function assertCondition(condition: WorkflowCondition) {
      if (!("target" in condition))
        throw new VerificationFailure(
          "unsupported-condition",
          "Condition cannot be checked by the fixture runner.",
        );
      const target = locator(condition.target);
      if (condition.type === "element_count")
        return expect(target).toHaveCount(condition.count, {
          timeout: timeoutMs,
        });
      if (condition.type === "element_state" && condition.state === "hidden")
        return expect(target).toBeHidden({ timeout: timeoutMs });
      await expect(target).toHaveCount(1, { timeout: timeoutMs });
      if (condition.type === "element_text")
        return condition.match === "exact"
          ? expect(target).toHaveText(condition.text, { timeout: timeoutMs })
          : expect(target).toContainText(condition.text, {
              timeout: timeoutMs,
            });
      if (
        condition.type === "target_appears" ||
        (condition.type === "element_state" && condition.state === "visible")
      )
        return expect(target).toBeVisible({ timeout: timeoutMs });
      if (condition.type === "element_state") {
        if (condition.state === "enabled")
          return expect(target).toBeEnabled({ timeout: timeoutMs });
        if (condition.state === "disabled")
          return expect(target).toBeDisabled({ timeout: timeoutMs });
        return expect(target).toBeChecked({
          checked: condition.state === "checked",
          timeout: timeoutMs,
        });
      }
    }
    stage = "open";
    const response = await page.goto(new URL("/clients", url.origin).href, {
      timeout: timeoutMs,
      waitUntil: "domcontentloaded",
    });
    if (!response?.ok())
      throw new VerificationFailure(
        "fixture-unavailable",
        "The fixture /clients page did not return a successful response. Start the local fixture server.",
      );
    onFixture();
    for (const [index, step] of workflow.steps.entries()) {
      current = report.steps[index];
      if (!current) throw new Error("Missing verification step");
      stage = "resolve";
      onFixture();
      const target = locator(current.target);
      try {
        await expect(target).toHaveCount(1, { timeout: timeoutMs });
      } catch {
        const count = await target.count();
        throw new VerificationFailure(
          count === 0 ? "target-not-found" : "ambiguous-target",
          `Semantic target ${current.target} resolved to ${count} elements at step ${current.stepId}. Check stale annotations or repeated elements; no action was performed on this target.`,
        );
      }
      stage = "action";
      if (current.action === "click")
        await target.click({ timeout: timeoutMs });
      else
        await target.fill(inputs[current.target as keyof typeof inputs], {
          timeout: timeoutMs,
        });
      onFixture();
      if (step.expected) {
        stage = "expected";
        await assertCondition(step.expected);
        current.expected = "passed";
      }
      current.status = "passed";
    }
    current = undefined;
    stage = "terminal";
    onFixture();
    await assertCondition(workflow.terminal);
    report.terminal = "passed";
    report.valid = true;
  } catch (error) {
    if (current) {
      current.status = "failed";
      if (stage === "expected") current.expected = "failed";
    }
    if (stage === "terminal") report.terminal = "failed";
    report.failure = {
      stage,
      code:
        error instanceof VerificationFailure ? error.code : `${stage}-failed`,
      message:
        error instanceof VerificationFailure
          ? error.message
          : `Fixture verification failed during ${stage}${current ? ` at ${current.stepId} (${current.target})` : ""}. Check app readiness, test-session permissions and the expected condition.`,
      ...(current ? { stepId: current.stepId, target: current.target } : {}),
    };
  }
  report.finishedAt = new Date().toISOString();
  return BrowserVerificationReportSchema.parse(report);
}
