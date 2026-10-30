import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  HarnessTaskSpec,
  MutationResult,
} from "@pathcompiler/harness-contracts";
import type { Assessment } from "./assess.js";
import { runProcess } from "./command.js";
import type { RunRecord } from "./runs.js";

/**
 * Publishing is the one step that leaves the machine, so it is a separate
 * interface: pushing the candidate branch, or pushing it and opening a pull
 * request. It never force-pushes, never targets the base branch, and never
 * merges. The pull request is opened with the `gh` CLI the person already
 * has; PathCompiler stores no token.
 */
export type PublishInput = {
  repo: string;
  branch: string;
  baseBranch: string;
  remote: string;
  title: string;
  body: string;
  draft: boolean;
  target: "branch" | "pull_request";
};
export type PublishOutcome = {
  target: PublishInput["target"];
  remote: string;
  branch: string;
  url?: string;
};
export interface Publisher {
  publish(input: PublishInput): Promise<PublishOutcome>;
}
export type ProcessRunner = (
  argv: readonly string[],
  options: { cwd: string },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

const defaultRunner: ProcessRunner = (argv, options) =>
  runProcess({ argv, cwd: options.cwd, timeoutMs: 120_000 });

export function gitPublisher(run: ProcessRunner = defaultRunner): Publisher {
  return {
    async publish(input) {
      if (input.branch === input.baseBranch)
        throw new Error(
          `Refusing to publish the base branch ${input.baseBranch}.`,
        );
      const push = await run(
        [
          "git",
          "push",
          "--set-upstream",
          input.remote,
          `${input.branch}:${input.branch}`,
        ],
        { cwd: input.repo },
      );
      if (push.code !== 0)
        throw new Error(
          `git push to ${input.remote} failed: ${push.stderr.trim().split("\n").slice(-2).join(" ")}. Nothing was published.`,
        );
      if (input.target === "branch")
        return { target: "branch", remote: input.remote, branch: input.branch };
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "pathcompiler-pr-"),
      );
      try {
        const bodyFile = path.join(directory, "body.md");
        await writeFile(bodyFile, input.body);
        const created = await run(
          [
            "gh",
            "pr",
            "create",
            "--head",
            input.branch,
            "--base",
            input.baseBranch,
            "--title",
            input.title,
            "--body-file",
            bodyFile,
            ...(input.draft ? ["--draft"] : []),
          ],
          { cwd: input.repo },
        );
        if (created.code !== 0)
          throw new Error(
            `The branch ${input.branch} was pushed to ${input.remote}, but opening the pull request with gh failed: ${(created.stderr || created.stdout).trim().split("\n").slice(-2).join(" ")}. Open it by hand, or install and sign in to the GitHub CLI.`,
          );
        const url = created.stdout.trim().split("\n").pop();
        return {
          target: "pull_request",
          remote: input.remote,
          branch: input.branch,
          ...(url ? { url } : {}),
        };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

/** The pull request body: what was asked, what changed, who decided, and what was and was not checked. */
export function pullRequestBody(input: {
  task: HarnessTaskSpec;
  result: MutationResult;
  assessment: Assessment;
  run: RunRecord;
}): string {
  const { task, result, assessment, run } = input;
  const decision = run.decision;
  const lines = [
    `### ${task.objective.summary}`,
    "",
    result.implementationSummary,
    "",
    `Created by a PathCompiler harness run (\`${run.runId}\`, ${run.mode} mode) for task \`${task.id}\`. **It has not been merged or deployed.**`,
    "",
    `**Decision:** ${decision ? `${decision.by === "policy" ? "cleared automatically by policy" : `approved by ${decision.by}`} (${decision.reasons.join(" ")})` : "pending"}`,
    `**Assessment:** ${assessment.verdict}`,
    ...assessment.reasons.map(
      (item) =>
        `- ${item.verdict === "fail" ? "✗" : "⚠"} ${item.source}: ${item.message}`,
    ),
    `**Sources:** ${Object.entries(assessment.signals)
      .map(([source, signal]) => `${source} ${signal.replace("_", " ")}`)
      .join(
        ", ",
      )}${assessment.vouchedBy.length > 0 ? ` (vouched for by: ${assessment.vouchedBy.join(", ")})` : ""}`,
    ...assessment.notes.map((item) => `- ℹ ${item}`),
    "",
    `Changed files (${result.changedFiles.length}): ${result.changedFiles
      .slice(0, 15)
      .map((item) => `\`${item}\``)
      .join(", ")}${result.changedFiles.length > 15 ? ", …" : ""}`,
  ];
  if (result.assumptions.length > 0)
    lines.push(
      "",
      "**Assumptions the harness made**",
      ...result.assumptions.map((item) => `- ${item}`),
    );
  if (result.unresolvedQuestions.length > 0)
    lines.push(
      "",
      "**Open questions**",
      ...result.unresolvedQuestions.map((item) => `- ${item}`),
    );
  if (assessment.behavior.applied)
    lines.push("", assessment.behavior.markdown.trimEnd());
  lines.push(
    "",
    "<sub>The harness's own claims are not trusted: the checks above were computed by PathCompiler. A passing assessment does not mean the change is correct.</sub>",
  );
  return `${lines.join("\n")}\n`;
}
