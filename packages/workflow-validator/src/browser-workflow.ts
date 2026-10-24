import type { EvidenceItem } from "@pathcompiler/probabilistic-evidence";
import {
  type WorkflowCondition,
  type WorkflowTerminalCondition,
  WorkflowV1Schema,
} from "@pathcompiler/workflow-ir";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";

/**
 * Generalized browser verification (C8). It replays any linear approved or
 * candidate workflow on a loopback, candidate or preview origin: only
 * allowlisted action kinds, only explicitly bound input values, and no
 * destructive-looking control unless the policy names it. Everything is
 * checked before the first action, so a refused workflow touches nothing.
 */
const status = z.enum(["not-run", "passed", "failed"]);
const stage = z.enum([
  "preflight",
  "prepare",
  "open",
  "resolve",
  "action",
  "expected",
  "terminal",
]);
export const BrowserVerificationReportV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    kind: z.literal("browser-verification"),
    /** A distinct evidence class (`browser`) for evidence fusion. */
    evidenceClass: z.literal("browser"),
    workflowId: z.string().nullable(),
    workflowVersion: z.number().int().positive().nullable(),
    candidateCommit: z.string().nullable(),
    origin: z.string().nullable(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    valid: z.boolean(),
    steps: z.array(
      z.strictObject({
        stepId: z.string(),
        target: z.string().nullable(),
        action: z.enum([
          "click",
          "input",
          "select",
          "navigate",
          "explain",
          "wait",
        ]),
        status,
        expected: status,
      }),
    ),
    terminal: status,
    /** Destructive-looking targets the policy allowed for this run. */
    destructiveAllowed: z.array(z.string()),
    failure: z
      .strictObject({
        code: z.string(),
        stage,
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
export type BrowserVerificationReportV2 = z.infer<
  typeof BrowserVerificationReportV2Schema
>;

const SAFE_ACTIONS = ["click", "input", "select", "navigate"] as const;
export type BrowserVerificationPolicy = {
  /** Action kinds the runner may perform. Default: click, input, select, navigate. */
  actions?: (typeof SAFE_ACTIONS)[number][];
  /** Destructive-looking targets (delete, deactivate, archive…) explicitly allowed. */
  allowDestructive?: string[];
  /** Non-loopback origins allowed, e.g. a candidate or preview deployment. */
  origins?: string[];
  timeoutMs?: number;
};
export type WorkflowVerificationOptions = {
  /** Caller-owned Page in a disposable context. */
  page: Page;
  origin: string;
  /** Value per input/select target; selects also accept `{ index }`. */
  inputs?: Record<string, string | { index: number }>;
  policy?: BrowserVerificationPolicy;
  /** Establishes preconditions (records, role, flags) before the workflow starts. */
  prepare?: (page: Page) => Promise<void>;
  /** Approved workflow version, for the report. */
  version?: number;
};
/** Words that mark a control as destructive unless the policy allows it. */
export const DESTRUCTIVE_PATTERN =
  /(?:^|[._\s-])(delete|remove|destroy|deactivate|archive|purge|drop|revoke|disable|terminate)(?:$|[._\s-])/i;

class Refusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function verifyWorkflowInBrowser(
  input: unknown,
  options: WorkflowVerificationOptions,
): Promise<BrowserVerificationReportV2> {
  const report: BrowserVerificationReportV2 = {
    schemaVersion: 2,
    kind: "browser-verification",
    evidenceClass: "browser",
    workflowId: null,
    workflowVersion: options.version ?? null,
    candidateCommit: null,
    origin: null,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    valid: false,
    steps: [],
    terminal: "not-run",
    destructiveAllowed: [],
  };
  let current: BrowserVerificationReportV2["steps"][number] | undefined;
  let at: z.infer<typeof stage> = "preflight";
  const policy = options.policy ?? {};
  const timeout = policy.timeoutMs ?? 5_000;
  try {
    // --- Preflight: everything is decided before the first action. ---
    const parsed = WorkflowV1Schema.safeParse(input);
    if (!parsed.success)
      throw new Refusal(
        "invalid-workflow",
        "Provide a schema-valid Workflow V1; run static validation first.",
      );
    const workflow = parsed.data;
    report.workflowId = workflow.id;
    report.candidateCommit = workflow.repository.commit;
    if (!["candidate", "approved"].includes(workflow.status))
      throw new Refusal(
        "unsupported-status",
        `Only candidate or approved workflows are verified; ${workflow.id} is ${workflow.status}.`,
      );
    let origin: URL;
    try {
      origin = new URL(options.origin);
    } catch {
      throw new Refusal(
        "unsupported-origin",
        `${options.origin} is not a URL.`,
      );
    }
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
      origin.hostname,
    );
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      !(loopback || (policy.origins ?? []).includes(origin.origin))
    )
      throw new Refusal(
        "unsupported-origin",
        `Use a loopback HTTP(S) origin, or list ${origin.origin} in policy.origins (candidate or preview deployments). No credentials, path, query or fragment.`,
      );
    report.origin = origin.origin;
    const [entry, ...more] = workflow.entrypoints;
    if (!entry?.route || more.length > 0)
      throw new Refusal(
        "unsupported-entrypoint",
        "The runner needs exactly one route entrypoint.",
      );
    const allowed = new Set(policy.actions ?? SAFE_ACTIONS);
    const allowDestructive = new Set(policy.allowDestructive ?? []);
    for (const [index, step] of workflow.steps.entries()) {
      const next = workflow.steps[index + 1]?.id;
      if (step.branches?.length || step.optional || step.next !== next)
        throw new Refusal(
          "unsupported-branch",
          `Step ${step.id} branches or is optional; only linear workflows are replayed.`,
        );
      const action = step.action.type;
      if (action === "wait")
        throw new Refusal(
          "unsupported-action",
          `Step ${step.id} waits for an unspecified condition; give it an expected condition instead.`,
        );
      if (action !== "explain" && !allowed.has(action))
        throw new Refusal(
          "action-not-allowed",
          `Step ${step.id} needs a ${action} action, which the policy does not allow.`,
        );
      if (
        (action === "click" || action === "input" || action === "select") &&
        !step.target
      )
        throw new Refusal(
          "missing-target",
          `Step ${step.id} has no semantic target to act on.`,
        );
      if (
        (action === "input" || action === "select") &&
        options.inputs?.[step.target as string] === undefined
      )
        throw new Refusal(
          "missing-input-binding",
          `Step ${step.id} enters ${step.target}; bind a value in options.inputs. Values are never taken from evidence.`,
        );
      const words = `${step.target ?? ""} ${step.instruction?.text ?? ""}`;
      if (action === "click" && DESTRUCTIVE_PATTERN.test(words)) {
        if (!allowDestructive.has(step.target as string))
          throw new Refusal(
            "destructive-action-not-allowed",
            `Step ${step.id} clicks ${step.target}, which looks destructive. Add it to policy.allowDestructive to run it on this origin.`,
          );
        report.destructiveAllowed.push(step.target as string);
      }
    }
    checkable(workflow.terminal);
    report.steps = workflow.steps.map((step) => ({
      stepId: step.id,
      target: step.target ?? null,
      action: step.action.type,
      status: "not-run",
      expected: "not-run",
    }));

    // --- Run. ---
    const page = options.page;
    const locator = (target: string) =>
      page.locator(`[data-pathcompiler=${JSON.stringify(target)}]`);
    const stayed = () => {
      if (new URL(page.url()).origin !== origin.origin)
        throw new Refusal(
          "unexpected-navigation",
          `The browser left ${origin.origin}; no further actions were performed.`,
        );
    };
    const assert = async (condition: WorkflowTerminalCondition) => {
      if ("all" in condition) {
        for (const item of condition.all) await assert(item);
        return;
      }
      if ("any" in condition) {
        const failures: string[] = [];
        for (const item of condition.any)
          try {
            await assert(item);
            return;
          } catch (error) {
            failures.push(
              error instanceof Error
                ? (error.message.split("\n")[0] ?? "")
                : String(error),
            );
          }
        throw new Refusal(
          "condition-failed",
          `None of the alternative conditions held: ${failures.join("; ")}`,
        );
      }
      await one(condition);
    };
    const one = async (condition: WorkflowCondition) => {
      if (condition.type === "route_matches")
        return expect(page).toHaveURL(new RegExp(condition.pattern), {
          timeout,
        });
      if (condition.type === "url_changed")
        return condition.url
          ? expect(page).toHaveURL(new URL(condition.url, origin).href, {
              timeout,
            })
          : undefined;
      if (!("target" in condition))
        throw new Refusal(
          "unsupported-condition",
          `${condition.type} cannot be checked in a browser.`,
        );
      const target = locator(condition.target);
      if (condition.type === "element_count")
        return expect(target).toHaveCount(condition.count, { timeout });
      if (condition.type === "element_state" && condition.state === "hidden")
        return expect(target).toBeHidden({ timeout });
      await expect(target).toHaveCount(1, { timeout });
      if (condition.type === "element_text")
        return condition.match === "exact"
          ? expect(target).toHaveText(condition.text, { timeout })
          : expect(target).toContainText(condition.text, { timeout });
      if (condition.type === "element_state")
        return condition.state === "visible"
          ? expect(target).toBeVisible({ timeout })
          : condition.state === "enabled"
            ? expect(target).toBeEnabled({ timeout })
            : condition.state === "disabled"
              ? expect(target).toBeDisabled({ timeout })
              : expect(target).toBeChecked({
                  checked: condition.state === "checked",
                  timeout,
                });
      return expect(target).toBeVisible({ timeout });
    };
    if (options.prepare) {
      at = "prepare";
      await options.prepare(page);
    }
    at = "open";
    const response = await page.goto(new URL(entry.route, origin).href, {
      timeout,
      waitUntil: "domcontentloaded",
    });
    if (!response?.ok())
      throw new Refusal(
        "origin-unavailable",
        `${entry.route} did not return a successful response on ${origin.origin}.`,
      );
    stayed();
    for (const [index, step] of workflow.steps.entries()) {
      current = report.steps[
        index
      ] as BrowserVerificationReportV2["steps"][number];
      const action = step.action;
      if (action.type === "explain") {
        current.status = "passed";
        continue;
      }
      at = "action";
      if (action.type === "navigate") {
        await page.goto(new URL(action.route, origin).href, { timeout });
      } else {
        at = "resolve";
        const target = locator(step.target as string);
        try {
          await expect(target).toHaveCount(1, { timeout });
        } catch {
          const count = await target.count();
          throw new Refusal(
            count === 0 ? "target-not-found" : "ambiguous-target",
            `Semantic target ${step.target} resolved to ${count} elements at ${step.id}. Check stale annotations or repeated elements; no action was performed on it.`,
          );
        }
        at = "action";
        const value = options.inputs?.[step.target as string];
        if (action.type === "click") await target.click({ timeout });
        else if (action.type === "input")
          await target.fill(String(value), { timeout });
        else
          await target.selectOption(
            typeof value === "object" ? { index: value.index } : String(value),
            { timeout },
          );
      }
      stayed();
      if (step.expected) {
        at = "expected";
        await one(step.expected);
        current.expected = "passed";
      }
      current.status = "passed";
    }
    current = undefined;
    at = "terminal";
    await assert(workflow.terminal);
    report.terminal = "passed";
    report.valid = true;
  } catch (error) {
    if (current) {
      current.status = "failed";
      if (at === "expected") current.expected = "failed";
    }
    if (at === "terminal") report.terminal = "failed";
    report.failure = {
      stage: at,
      code: error instanceof Refusal ? error.code : `${at}-failed`,
      message:
        error instanceof Refusal
          ? error.message
          : `Browser verification failed during ${at}${current ? ` at ${current.stepId} (${current.target})` : ""}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      ...(current
        ? {
            stepId: current.stepId,
            ...(current.target ? { target: current.target } : {}),
          }
        : {}),
    };
  }
  report.finishedAt = new Date().toISOString();
  return BrowserVerificationReportV2Schema.parse(report);
}

function checkable(condition: WorkflowTerminalCondition): void {
  if ("all" in condition || "any" in condition) {
    for (const item of "all" in condition ? condition.all : condition.any)
      checkable(item);
    return;
  }
  if (
    ["explicit_next", "event_emitted", "permission", "feature_flag"].includes(
      condition.type,
    )
  )
    throw new Refusal(
      "unsupported-terminal",
      `A ${condition.type} completion cannot be observed in a browser; give the workflow a visible completion condition.`,
    );
}

/** The report as `browser` evidence for evidence fusion (P0). */
export function browserEvidenceItem(
  report: BrowserVerificationReportV2,
): EvidenceItem {
  return {
    id: `browser:${report.workflowId ?? "unknown"}:${report.finishedAt}`,
    class: "browser",
    stance: report.valid ? "supports" : "contradicts",
    current: true,
    summary: report.valid
      ? `Browser verification of ${report.workflowId} passed on ${report.origin}.`
      : `Browser verification of ${report.workflowId} failed (${report.failure?.code}).`,
  };
}
