import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { analyzeCommitRangeDetailed } from "@pathcompiler/graph-delta";
import {
  analyzeWorkflowImpact,
  type WorkflowImpactReport,
} from "@pathcompiler/impact-analysis";
import { discoverWorkflows } from "@pathcompiler/workflow-discovery";
import {
  detectNewWorkflows,
  type NewWorkflowReport,
} from "@pathcompiler/workflow-proposals";
import {
  parseApprovedWorkflowYaml,
  parseRejectedWorkflowYaml,
} from "@pathcompiler/workflow-review";
import type { AppAuth, CheckSummary, WorkflowCheckJob } from "./index.js";
import { publishCheckRun } from "./index.js";

const exec = promisify(execFile);
const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** GitHub check text in the spec's format; review needs are neutral, not failures. */
export function summarizeWorkflowCheck(
  impact: WorkflowImpactReport,
  detections: NewWorkflowReport,
): CheckSummary {
  const review = impact.impacts.filter(
    (item) => item.severity === "medium" || item.severity === "high",
  );
  const unaffected = impact.impacts.length - review.length;
  const fresh = detections.detections.filter(
    (item) => item.status !== "insufficient-evidence",
  );
  const summary = [
    `✓ ${plural(unaffected, "workflow", "workflows")} unaffected`,
    `⚠ ${plural(review.length, "workflow requires", "workflows require")} review`,
    `+ ${plural(fresh.length, "possible new workflow", "possible new workflows")}`,
  ].join("\n");
  const text = [
    ...review.map(
      (item) =>
        `- ${item.workflowId} (${item.severity}): ${item.reasons
          .slice(0, 3)
          .map((reason) => reason.message)
          .join(" ")}`,
    ),
    ...fresh.map(
      (item) =>
        `- New: ${item.title} (${item.capabilityId}), ${item.status}, confidence ${item.confidence}`,
    ),
  ].join("\n");
  return {
    conclusion: review.length || fresh.length ? "neutral" : "success",
    title: review.length
      ? `${plural(review.length, "workflow requires", "workflows require")} review`
      : fresh.length
        ? `${plural(fresh.length, "possible new workflow", "possible new workflows")}`
        : "Approved workflows unaffected",
    summary,
    text: text || "No approved workflow is affected by this change.",
  };
}

export interface RepositoryProvider {
  /** Makes base and head available locally and returns the analysis inputs. */
  prepare(
    job: WorkflowCheckJob,
    token: string,
  ): Promise<{ directory: string; approved: unknown[]; rejected: unknown[] }>;
}

export type LocalRepositoryConfig = {
  /** Existing clone whose `origin` is the GitHub repository. */
  path: string;
  /** App directory inside the repository, default `.`. */
  appDirectory?: string | undefined;
  /** Committed PathCompiler directory, default `.pathcompiler`. */
  pathcompilerDirectory?: string | undefined;
};

/**
 * Uses configured local clones. Fetches both commits with the installation
 * token passed through GIT_CONFIG_* environment variables (not argv or URLs).
 * Approved workflows are read from the clone's working tree.
 */
export function createLocalRepositoryProvider(
  repositories: Record<string, LocalRepositoryConfig>,
): RepositoryProvider {
  return {
    async prepare(job, token) {
      const config = repositories[`${job.owner}/${job.repo}`];
      if (!config)
        throw new Error(
          `Repository ${job.owner}/${job.repo} is not configured for PathCompiler checks.`,
        );
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
      );
      try {
        await exec(
          "git",
          [
            "-C",
            config.path,
            "fetch",
            "--no-tags",
            "--quiet",
            "origin",
            job.base,
            job.head,
          ],
          {
            timeout: 120_000,
            env: {
              ...env,
              GIT_TERMINAL_PROMPT: "0",
              GIT_CONFIG_COUNT: "1",
              GIT_CONFIG_KEY_0: "http.extraheader",
              GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
            },
          },
        );
      } catch {
        // Git stderr can echo remotes; never relay it.
        throw new Error(
          `Could not fetch ${job.base.slice(0, 12)} and ${job.head.slice(0, 12)} into the local clone. Check the clone's origin and the app's contents:read access.`,
        );
      }
      const store = path.join(
        config.path,
        config.pathcompilerDirectory ?? ".pathcompiler",
      );
      const read = async <T>(relative: string, parse: (input: string) => T) => {
        const directory = path.join(store, relative);
        let names: string[];
        try {
          names = (await readdir(directory))
            .filter((name) => name.endsWith(".yaml"))
            .sort();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw error;
        }
        return Promise.all(
          names.map(async (name) =>
            parse(await readFile(path.join(directory, name), "utf8")),
          ),
        );
      };
      return {
        directory: path.join(config.path, config.appDirectory ?? "."),
        approved: await read("workflows", parseApprovedWorkflowYaml),
        rejected: await read("workflows/rejected", parseRejectedWorkflowYaml),
      };
    },
  };
}

/**
 * Processes one job: token, repository, deterministic impact and new-workflow
 * analysis, then a completed check run. Failures publish a failure check and
 * rethrow so the queue reports them.
 */
export function createWorkflowCheckWorker(options: {
  auth: Pick<AppAuth, "installationToken">;
  repositories: RepositoryProvider;
  fetch?: typeof fetch;
}): (job: WorkflowCheckJob) => Promise<CheckSummary> {
  return async (job) => {
    const token = await options.auth.installationToken(job.installationId);
    const publish = (check: CheckSummary) =>
      publishCheckRun({
        token,
        owner: job.owner,
        repo: job.repo,
        headSha: job.head,
        check,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
    let check: CheckSummary;
    try {
      const prepared = await options.repositories.prepare(job, token);
      const { delta, base, head } = await analyzeCommitRangeDetailed({
        directory: prepared.directory,
        base: job.base,
        head: job.head,
      });
      const impact = analyzeWorkflowImpact(delta, prepared.approved);
      const headCapabilities = discoverCapabilities(head.mined.graph);
      const detections = detectNewWorkflows({
        delta,
        baseCapabilities: discoverCapabilities(base.mined.graph).report
          .capabilities,
        headCapabilities: headCapabilities.report.capabilities,
        candidates: discoverWorkflows(
          headCapabilities.graph,
          headCapabilities.report,
          head.mined.report,
        ).report.candidates,
        approved: prepared.approved,
        rejected: prepared.rejected,
      });
      check = summarizeWorkflowCheck(impact, detections);
    } catch (error) {
      await publish({
        conclusion: "failure",
        title: "PathCompiler could not analyze this change",
        summary: error instanceof Error ? error.message : "Analysis failed.",
        text: "Approved workflows were not changed. Fix the configuration and push again.",
      });
      throw error;
    }
    await publish(check);
    return check;
  };
}
