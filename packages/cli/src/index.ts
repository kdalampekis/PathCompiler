import {
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createGitHubProvider } from "@pathcompiler/adapter-github";
import {
  analyzeNextProject,
  scanNextRepository,
  suggestTargets,
} from "@pathcompiler/adapter-nextjs";
import {
  CapabilityExpectationsSchema,
  discoverCapabilities,
  discoverProductSurfaces,
} from "@pathcompiler/capability-engine";
import {
  associatePullRequest,
  enrichNodeHistory,
  openGitRepository,
} from "@pathcompiler/git-intelligence";
import { analyzeCommitRange } from "@pathcompiler/graph-delta";
import { createHttpService } from "@pathcompiler/http-service";
import { serveStdio } from "@pathcompiler/mcp-server";
import { createStaticTransport, PathCompiler } from "@pathcompiler/sdk-js";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import {
  COMPILER_VERSION,
  compileWorkflows,
} from "@pathcompiler/workflow-compiler";
import {
  discoverWorkflows,
  parseCandidateYaml,
  serializeCandidateYaml,
} from "@pathcompiler/workflow-discovery";
import type { WorkflowV1 } from "@pathcompiler/workflow-ir";
import {
  type ApprovedWorkflow,
  approveCandidate,
  parseApprovedWorkflowYaml,
  parseRejectedWorkflowYaml,
  type RejectedWorkflow,
  ReviewError,
  ReviewerSchema,
  rejectCandidate,
  reviewPaths,
  serializeReviewedYaml,
  WorkflowIdSchema,
} from "@pathcompiler/workflow-review";
import { validateWorkflow } from "@pathcompiler/workflow-validator";

export const HELP = `PathCompiler — local Next.js source analysis

Usage: pathcompiler scan <directory> [--out <directory>] [--exclude <directory> ...]
       pathcompiler targets suggest [directory] [--json] [--exclude <directory> ...]
       pathcompiler tests mine [directory] [--out <directory>] [--exclude <directory> ...]
       pathcompiler surfaces discover [directory] [--out <directory>] [--exclude <directory> ...]
       pathcompiler capabilities discover [directory] [--expect <json-file>] [--out <directory>] [--exclude <directory> ...]
       pathcompiler workflows discover [directory] [--out <directory>] [--exclude <directory> ...]
       pathcompiler workflows validate <id> [directory] [--out <directory>] [--exclude <directory> ...]
       pathcompiler workflows list [--out <directory>] [--json]
       pathcompiler workflows show <id> [--out <directory>] [--json]
       pathcompiler workflows approve <id> [directory] [--by <name>] [--out <directory>] [--exclude <directory> ...]
       pathcompiler workflows reject <id> [--by <name>] [--reason <text>] [--out <directory>]
       pathcompiler diff <base> <head> [directory] [--out <directory>] [--exclude <directory> ...]
       pathcompiler build [--out <directory>]
       pathcompiler mcp [--out <directory>]
       pathcompiler serve [--out <directory>] [--port <number>] [--host <address>]
       pathcompiler git inspect [directory] --node <node-id> [--limit <1-100>] [--out <directory>]
       pathcompiler github inspect [directory] --repo <owner/name> (--pr <number> | --commit <sha>) [--out <directory>]

Writes .pathcompiler/graph/source-graph.json and .pathcompiler/reports/scan-summary.json
under the current working directory, or under the directory supplied to --out.
--exclude accepts scan-root-relative directory/file paths, not glob patterns.
targets suggest defaults to the current directory and prints candidates without writing files.
--json returns a versioned target report including provenance and scan diagnostics.
tests mine writes reports/test-traces.json and graph/test-graph.json under .pathcompiler
(or --out), preserving source scan artifacts. Traces are evidence, not approved workflows.
git inspect reads local history for a current source node, writing reports/git-evidence.json
and graph/history-graph.json. Defaults to 20 commits per provenance file; supports --exclude.
github inspect requires GITHUB_TOKEN with Pull requests read permission. It reads GitHub
PR evidence into reports/pr-evidence.json and graph/pr-graph.json; supports --exclude.
surfaces discover writes reports/product-surfaces.json and graph/surface-graph.json.
Surfaces are static candidates requiring review, not approved capabilities or workflows.
capabilities discover mines source/test evidence into reports/capabilities.json and
graph/capability-graph.json. --expect supplies evaluation-only capability IDs;
without ground truth, false positives are reported as not evaluated.
workflows discover writes workflows/candidates/*.yaml, reports/workflow-candidates.json
and graph/workflow-graph.json. Candidates require review; browser validation has not run.
workflows validate reads the candidate under .pathcompiler (or --out), rescans the
repository, and writes reports/validation/<id>.json. Failed checks exit nonzero.
workflows approve re-validates a clean, current candidate and writes workflows/<id>.yaml
with approvedBy/approvedAt/approvedCommit; commit that file. workflows reject writes
workflows/rejected/<id>.yaml. Both take the reviewer from --by or PATHCOMPILER_USER and
never replace an existing review decision. Candidate YAML remains as discovery cache.
diff exports both commits read-only, re-analyzes each and writes reports/graph-delta.json
with changed files, symbols, routes, semantic targets and APIs plus the node/edge delta.
build compiles only approved workflows/<id>.yaml records into generated/search-index.json,
generated/runtime-manifest.json (browser-safe) and generated/documentation.json.
mcp serves the read-only PathCompiler MCP tools over stdio from those generated files.
serve runs the HTTP runtime API on 127.0.0.1:4310 by default from the same files and
requires PATHCOMPILER_API_TOKEN (Authorization: Bearer <token>).
No repository code is executed and no source is sent to a model or network service.
`;

export async function runCli(
  args: string[],
  cwd = process.cwd(),
): Promise<string> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      out: { type: "string" },
      json: { type: "boolean" },
      exclude: { type: "string", multiple: true },
      node: { type: "string" },
      limit: { type: "string" },
      repo: { type: "string" },
      pr: { type: "string" },
      commit: { type: "string" },
      expect: { type: "string" },
      by: { type: "string" },
      reason: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
    },
  });
  if (values.help) return HELP;
  if (
    (values.port !== undefined || values.host !== undefined) &&
    !["serve", "mcp"].includes(positionals[0] ?? "")
  )
    throw new Error("--port and --host are only supported by serve.");
  const review =
    positionals[0] === "workflows" &&
    (positionals[1] === "approve" || positionals[1] === "reject");
  if (values.by !== undefined && !review)
    throw new Error("--by is only supported by workflows approve and reject.");
  if (
    values.reason !== undefined &&
    !(positionals[0] === "workflows" && positionals[1] === "reject")
  )
    throw new Error("--reason is only supported by workflows reject.");
  if (
    positionals[0] === "workflows" &&
    (positionals[1] === "list" || positionals[1] === "show")
  ) {
    if (values.exclude !== undefined)
      throw new Error(
        "workflows list and show read stored artifacts and do not support --exclude.",
      );
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    if (positionals[1] === "list" && positionals.length === 2) {
      const workflows = await listWorkflows(output);
      if (values.json)
        return `${JSON.stringify({ schemaVersion: 1, workflows }, null, 2)}\n`;
      const count = (state: string) =>
        workflows.filter((item) => item.state === state).length;
      return `${workflows.length} workflows: ${count("approved")} approved, ${count("rejected")} rejected, ${count("candidate")} candidates.\n${workflows
        .map(
          (item) =>
            `${item.state.padEnd(9)} ${item.id}  ${item.title}  (commit ${item.commit.slice(0, 12)})`,
        )
        .join("\n")}${workflows.length ? "\n" : ""}`;
    }
    if (positionals[1] === "show" && positionals.length === 3) {
      const id = workflowId(positionals[2]);
      const stored = await readReviewState(output, id);
      const [state, relative, content, artifact] =
        stored.approved !== undefined
          ? ([
              "approved",
              stored.paths.approved,
              stored.approved,
              parseStored(stored.approved, id, parseApprovedWorkflowYaml),
            ] as const)
          : stored.rejected !== undefined
            ? ([
                "rejected",
                stored.paths.rejected,
                stored.rejected,
                parseStored(stored.rejected, id, parseRejectedWorkflowYaml),
              ] as const)
            : stored.candidate !== undefined
              ? ([
                  "candidate",
                  stored.paths.candidate,
                  stored.candidate,
                  parseStored(stored.candidate, id, parseCandidateYaml),
                ] as const)
              : [];
      if (!state)
        throw new Error(
          `No workflow ${id} under ${output}. Run workflows discover, or pass the --out used earlier.`,
        );
      const file = path.join(output, relative);
      if (values.json)
        return `${JSON.stringify({ schemaVersion: 1, state, path: file, artifact }, null, 2)}\n`;
      return `Workflow ${id}: ${state}\nFile: ${file}\n\n${content}`;
    }
    throw new Error(
      "Expected: workflows list, or workflows show <id>. Use --help for arguments and options.",
    );
  }
  if (
    values.expect !== undefined &&
    !(positionals[0] === "capabilities" && positionals[1] === "discover")
  )
    throw new Error("--expect is only supported by capabilities discover.");
  if (
    positionals[0] === "github" &&
    positionals[1] === "inspect" &&
    positionals.length <= 3
  ) {
    if (values.json || values.node !== undefined || values.limit !== undefined)
      throw new Error(
        "github inspect supports --repo, --pr or --commit, --out and --exclude.",
      );
    if (
      !values.repo ||
      (values.pr === undefined) === (values.commit === undefined)
    )
      throw new Error(
        "github inspect requires --repo <owner/name> and exactly one of --pr <number> or --commit <sha>.",
      );
    const [owner, repo, extra] = values.repo.split("/");
    if (!owner || !repo || extra !== undefined)
      throw new Error("--repo must be a GitHub owner/name pair.");
    const token = process.env.GITHUB_TOKEN;
    if (!token)
      throw new Error(
        "Set GITHUB_TOKEN with Pull requests read permission before running github inspect.",
      );
    const provider = createGitHubProvider({ owner, repo, token });
    const directory = path.resolve(cwd, positionals[2] ?? ".");
    const git = await openGitRepository(directory);
    const project = await readSourceProject(directory, {
      exclude: values.exclude ?? [],
    });
    const source = analyzeNextProject(project);
    const pr =
      values.pr !== undefined
        ? await provider.getPullRequest(values.pr)
        : await provider.findPullRequestForCommit(values.commit ?? "");
    if (!pr)
      return "No pull request is associated with that commit. No artifacts written.\n";
    const result = associatePullRequest(source.graph, pr, {
      repositoryPath: git.getRepositoryPath(),
    });
    const after = await git.getSnapshot();
    if (
      after.commit !== project.repository.commit ||
      after.dirty !== project.repository.dirty
    )
      throw new Error(
        "Repository changed while reading PR evidence. Rescan and retry.",
      );
    result.report.diagnostics.push(...source.summary.diagnostics);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    await writeArtifacts(output, [
      [
        "reports/pr-evidence.json",
        `${JSON.stringify(result.report, null, 2)}\n`,
      ],
      ["graph/pr-graph.json", `${result.graph.serialize()}\n`],
    ]);
    return `Associated PR #${pr.number} with ${result.report.associatedNodeIds.length} graph nodes.\nArtifacts: ${output}\nPR context is supporting evidence; it does not establish current product behavior.\n`;
  }
  if (
    values.repo !== undefined ||
    values.pr !== undefined ||
    values.commit !== undefined
  )
    throw new Error(
      "--repo, --pr and --commit are only supported by github inspect.",
    );
  if (
    positionals[0] === "git" &&
    positionals[1] === "inspect" &&
    positionals.length <= 3
  ) {
    if (!values.node)
      throw new Error(
        "git inspect requires --node <node-id>. Run scan to find source graph node IDs.",
      );
    if (values.json)
      throw new Error(
        "git inspect writes JSON artifacts; --json is only supported by targets suggest.",
      );
    const limit = values.limit === undefined ? 20 : Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("--limit must be an integer from 1 to 100.");
    const directory = path.resolve(cwd, positionals[2] ?? ".");
    const project = await readSourceProject(directory, {
      exclude: values.exclude ?? [],
    });
    const source = analyzeNextProject(project);
    const result = await enrichNodeHistory(
      await openGitRepository(directory),
      source.graph,
      values.node,
      { limit },
    );
    result.report.diagnostics.push(...source.summary.diagnostics);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    await writeArtifacts(output, [
      [
        "reports/git-evidence.json",
        `${JSON.stringify(result.report, null, 2)}\n`,
      ],
      ["graph/history-graph.json", `${result.graph.serialize()}\n`],
    ]);
    return `Inspected ${result.report.commits.length} local commits for ${values.node}.\nArtifacts: ${output}\nCommit messages describe intent; component/action links are file associations requiring review.\n`;
  }
  if (values.node !== undefined || values.limit !== undefined)
    throw new Error("--node and --limit are only supported by git inspect.");
  if (
    positionals[0] === "targets" &&
    positionals[1] === "suggest" &&
    positionals.length <= 3
  ) {
    if (values.out !== undefined)
      throw new Error(
        "targets suggest prints to stdout and does not support --out.",
      );
    const report = suggestTargets(
      await scanNextRepository(path.resolve(cwd, positionals[2] ?? "."), {
        exclude: values.exclude ?? [],
      }),
    );
    if (values.json) return `${JSON.stringify(report, null, 2)}\n`;
    const mappings = report.targets
      .map((item) =>
        [
          item.target.semanticId
            ? `Annotated target: ${item.target.semanticId}`
            : item.suggestedTarget
              ? `Suggested target: ${item.suggestedTarget}`
              : "Needs review: no safe target suggestion",
          `File: ${item.file}`,
          `Locator: ${item.locator}`,
          `Confidence: ${item.target.confidence} (${item.target.source})`,
          ...item.target.issues.map((issue) => `Issue: ${issue}`),
        ].join("\n"),
      )
      .join("\n\n");
    const diagnostics = report.diagnostics
      .map(
        (item) =>
          `${item.code}${item.file ? ` (${item.file})` : ""}: ${item.message}`,
      )
      .join("\n");
    return `${mappings || "No UI targets found."}\n\nSuggestions require review. No files changed. Repeated elements require runtime scoping.\n${diagnostics ? `Diagnostics:\n${diagnostics}\n` : ""}`;
  }
  if (
    positionals[0] === "tests" &&
    positionals[1] === "mine" &&
    positionals.length <= 3
  ) {
    if (values.json)
      throw new Error(
        "tests mine writes JSON artifacts; --json is only supported by targets suggest.",
      );
    const project = await readSourceProject(
      path.resolve(cwd, positionals[2] ?? "."),
      { exclude: values.exclude ?? [] },
    );
    const source = analyzeNextProject(project);
    const result = minePlaywrightTests(project, source.graph);
    result.report.diagnostics.push(
      ...source.summary.diagnostics.filter(
        (item) =>
          !result.report.diagnostics.some(
            (existing) => JSON.stringify(existing) === JSON.stringify(item),
          ),
      ),
    );
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    await writeArtifacts(output, [
      [
        "reports/test-traces.json",
        `${JSON.stringify(result.report, null, 2)}\n`,
      ],
      ["graph/test-graph.json", `${result.graph.serialize()}\n`],
    ]);
    const partial = result.report.traces.filter(
      (trace) => trace.partial,
    ).length;
    return `Mined ${result.report.traces.length} Playwright tests (${partial} partial traces).\nArtifacts: ${output}\nStatic evidence only; tests were not executed. See test-traces.json for diagnostics.\n`;
  }
  if (values.json)
    throw new Error(
      "--json is only supported by targets suggest, workflows list and workflows show.",
    );
  if (
    positionals[0] === "workflows" &&
    positionals[1] === "approve" &&
    positionals.length >= 3 &&
    positionals.length <= 4
  ) {
    const id = workflowId(positionals[2]);
    const approvedBy = reviewer(values.by);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const stored = await readReviewState(output, id);
    refuseReviewed(stored, id, output);
    const { candidate, report, project, reportPath } = await validateStored(
      output,
      id,
      path.resolve(cwd, positionals[3] ?? "."),
      values.exclude ?? [],
    );
    let record: ApprovedWorkflow;
    try {
      record = approveCandidate(candidate, {
        approvedBy,
        approvedAt: new Date().toISOString(),
        validation: report,
        repository: project.repository,
      });
    } catch (error) {
      if (error instanceof ReviewError)
        throw new Error(`${error.message} Validation report: ${reportPath}.`, {
          cause: error,
        });
      throw error;
    }
    const file = path.join(output, stored.paths.approved);
    await writeExclusive(file, serializeReviewedYaml(record));
    return `Approved ${id} at commit ${record.approval.approvedCommit} by ${approvedBy}.\nArtifact: ${file}\nValidation warnings reviewed: ${report.warnings.length} (see ${reportPath}).\nCommit the approved file; it is the runtime source of truth. Browser verification is separate.\n`;
  }
  if (
    positionals[0] === "workflows" &&
    positionals[1] === "reject" &&
    positionals.length === 3
  ) {
    if (values.exclude !== undefined)
      throw new Error(
        "workflows reject does not rescan and does not support --exclude.",
      );
    const id = workflowId(positionals[2]);
    const rejectedBy = reviewer(values.by);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const stored = await readReviewState(output, id);
    refuseReviewed(stored, id, output);
    if (stored.candidate === undefined)
      throw new Error(
        `No candidate ${id} under ${output}. Run workflows discover first.`,
      );
    const candidate = parseStored(stored.candidate, id, parseCandidateYaml);
    let record: RejectedWorkflow;
    try {
      record = rejectCandidate(candidate, {
        rejectedBy,
        rejectedAt: new Date().toISOString(),
        ...(values.reason === undefined ? {} : { reason: values.reason }),
      });
    } catch (error) {
      throw new Error(
        "Cannot record the rejection. --reason must be 1–500 characters.",
        { cause: error },
      );
    }
    const file = path.join(output, stored.paths.rejected);
    await writeExclusive(file, serializeReviewedYaml(record));
    return `Rejected ${id} by ${rejectedBy}.\nRecord: ${file}\nThe candidate stays in discovery cache; remove the record to review it again.\n`;
  }
  if (
    (positionals[0] === "mcp" || positionals[0] === "serve") &&
    positionals.length === 1
  ) {
    if (values.exclude !== undefined)
      throw new Error(
        `${positionals[0]} serves generated artifacts and does not support --exclude.`,
      );
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    if (positionals[0] === "mcp") {
      if (values.port !== undefined || values.host !== undefined)
        throw new Error("--port and --host are only supported by serve.");
      await serveStdio(await loadGeneratedClient(output));
      process.stderr.write(
        `PathCompiler MCP server ready on stdio (artifacts: ${output}).\n`,
      );
      return "";
    }
    const token = process.env.PATHCOMPILER_API_TOKEN;
    if (!token || token.length < 16)
      throw new Error(
        "Set PATHCOMPILER_API_TOKEN to a secret of at least 16 characters before running serve.",
      );
    const port = values.port === undefined ? 4310 : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65_535)
      throw new Error("--port must be an integer from 0 to 65535.");
    const host = values.host ?? "127.0.0.1";
    const server = createHttpService({
      client: await loadGeneratedClient(output),
      token,
      onError: (error) =>
        process.stderr.write(
          `PathCompiler HTTP error: ${error instanceof Error ? error.message : String(error)}\n`,
        ),
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
    const address = server.address();
    const bound = address && typeof address === "object" ? address.port : port;
    return `PathCompiler HTTP service listening on http://${host.includes(":") ? `[${host}]` : host}:${bound} (artifacts: ${output}).\n`;
  }
  if (
    positionals[0] === "diff" &&
    positionals.length >= 3 &&
    positionals.length <= 4
  ) {
    const delta = await analyzeCommitRange({
      directory: path.resolve(cwd, positionals[3] ?? "."),
      base: positionals[1] ?? "",
      head: positionals[2] ?? "",
      exclude: values.exclude ?? [],
    });
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const relative = "reports/graph-delta.json";
    await writeArtifacts(output, [
      [relative, `${JSON.stringify(delta, null, 2)}\n`],
    ]);
    const count = (list: {
      added: string[];
      removed: string[];
      changed: string[];
    }) =>
      `+${list.added.length} -${list.removed.length} ~${list.changed.length}`;
    const { summary } = delta;
    return `Graph delta ${delta.base.commit.slice(0, 12)}..${delta.head.commit.slice(0, 12)}: ${summary.files.length} files changed.\nRoutes ${count(summary.routes)}, targets ${count(summary.targets)}, APIs ${count(summary.apis)}, symbols ${count(summary.symbols)}.\nNodes +${delta.addedNodes.length} -${delta.removedNodes.length} ~${delta.changedNodes.length}; edges +${delta.addedEdges.length} -${delta.removedEdges.length}.\nReport: ${path.join(output, relative)}\n`;
  }
  if (positionals[0] === "build" && positionals.length === 1) {
    if (values.exclude !== undefined)
      throw new Error(
        "build compiles stored approved workflows and does not support --exclude.",
      );
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const compiled = compileWorkflows(await readApproved(output));
    await writeArtifacts(output, [
      [
        "generated/search-index.json",
        `${JSON.stringify(compiled.searchIndex, null, 2)}\n`,
      ],
      [
        "generated/runtime-manifest.json",
        `${JSON.stringify(compiled.runtimeManifest, null, 2)}\n`,
      ],
      [
        "generated/documentation.json",
        `${JSON.stringify(compiled.documentation, null, 2)}\n`,
      ],
    ]);
    return `Compiled ${compiled.searchIndex.workflows.length} approved workflows with compiler ${COMPILER_VERSION}.\nArtifacts: ${path.join(output, "generated")}\nCandidates and rejected workflows are excluded. The runtime manifest omits evidence, commits and review data.\n`;
  }
  if (
    positionals[0] === "workflows" &&
    positionals[1] === "validate" &&
    positionals.length >= 3 &&
    positionals.length <= 4
  ) {
    const id = workflowId(positionals[2]);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const { report, reportPath } = await validateStored(
      output,
      id,
      path.resolve(cwd, positionals[3] ?? "."),
      values.exclude ?? [],
    );
    if (!report.valid)
      throw new Error(
        `Workflow ${id} failed validation (${report.errors.length} errors). See ${reportPath}.`,
      );
    return `Workflow ${id} passed static validation (${report.warnings.length} warnings).\nReport: ${reportPath}\nBrowser verification has not run. Review warnings before approval or execution.\n`;
  }
  if (
    positionals[0] === "workflows" &&
    positionals[1] === "discover" &&
    positionals.length <= 3
  ) {
    const project = await readSourceProject(
      path.resolve(cwd, positionals[2] ?? "."),
      { exclude: values.exclude ?? [] },
    );
    const source = analyzeNextProject(project);
    const mined = minePlaywrightTests(project, source.graph);
    const capabilities = discoverCapabilities(mined.graph);
    const result = discoverWorkflows(
      capabilities.graph,
      capabilities.report,
      mined.report,
    );
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    const candidates = result.report.candidates.map(
      (candidate) =>
        [
          `workflows/candidates/${candidate.workflow.id}.yaml`,
          serializeCandidateYaml(candidate),
        ] as const,
    );
    // Preflight every destination before replacing any candidate or report.
    for (const [relative] of candidates) {
      let existing: string;
      try {
        existing = await readFile(path.join(output, relative), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      try {
        parseCandidateYaml(existing);
      } catch (error) {
        throw new Error(
          `Refusing to replace ${relative}: it is not a valid unapproved candidate. Choose a new --out directory or move the existing artifact.`,
          { cause: error },
        );
      }
    }
    await writeArtifacts(output, [
      ...candidates,
      [
        "reports/workflow-candidates.json",
        `${JSON.stringify(result.report, null, 2)}\n`,
      ],
      ["graph/workflow-graph.json", `${result.graph.serialize()}\n`],
    ]);
    return `Discovered ${result.report.candidates.length} workflow candidates; ${result.report.skipped.length} capabilities need more evidence.\nArtifacts: ${output}\nAll candidates require review. Schema passed; repository, evidence, test comparison and browser validation have not run.\n`;
  }
  if (
    positionals[0] === "capabilities" &&
    positionals[1] === "discover" &&
    positionals.length <= 3
  ) {
    let expectedCapabilityIds: string[] | undefined;
    if (values.expect !== undefined) {
      try {
        expectedCapabilityIds = CapabilityExpectationsSchema.parse(
          JSON.parse(await readFile(path.resolve(cwd, values.expect), "utf8")),
        ).capabilityIds;
      } catch (error) {
        throw new Error(
          "Cannot read capability expectations. Provide a JSON file with schemaVersion: 1 and unique capabilityIds (domain.action).",
          { cause: error },
        );
      }
    }
    const project = await readSourceProject(
      path.resolve(cwd, positionals[2] ?? "."),
      { exclude: values.exclude ?? [] },
    );
    const source = analyzeNextProject(project);
    const mined = minePlaywrightTests(project, source.graph);
    const result = discoverCapabilities(
      mined.graph,
      expectedCapabilityIds === undefined ? {} : { expectedCapabilityIds },
    );
    for (const diagnostic of [
      ...source.summary.diagnostics,
      ...mined.report.diagnostics,
    ])
      if (
        !result.report.diagnostics.some(
          (item) => JSON.stringify(item) === JSON.stringify(diagnostic),
        )
      )
        result.report.diagnostics.push(diagnostic);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    await writeArtifacts(output, [
      [
        "reports/capabilities.json",
        `${JSON.stringify(result.report, null, 2)}\n`,
      ],
      ["graph/capability-graph.json", `${result.graph.serialize()}\n`],
    ]);
    const evaluation = result.report.evaluation;
    const measured =
      evaluation.status === "evaluated"
        ? `False positives: ${evaluation.falsePositiveCount}; false negatives: ${evaluation.falseNegativeCount}.`
        : "False positives: not evaluated (supply --expect for measured counts).";
    return `Discovered ${result.report.capabilities.length} candidate capabilities.\n${measured}\nArtifacts: ${output}\nAll candidates require review. Confidence measures rule strength, not probability; tests were not executed.\n`;
  }
  if (
    positionals[0] === "surfaces" &&
    positionals[1] === "discover" &&
    positionals.length <= 3
  ) {
    const source = await scanNextRepository(
      path.resolve(cwd, positionals[2] ?? "."),
      { exclude: values.exclude ?? [] },
    );
    const result = discoverProductSurfaces(source.graph);
    result.report.diagnostics.push(...source.summary.diagnostics);
    const output = path.resolve(cwd, values.out ?? ".pathcompiler");
    await writeArtifacts(output, [
      [
        "reports/product-surfaces.json",
        `${JSON.stringify(result.report, null, 2)}\n`,
      ],
      ["graph/surface-graph.json", `${result.graph.serialize()}\n`],
    ]);
    return `Discovered ${result.report.surfaces.length} candidate product surfaces.\nArtifacts: ${output}\nStatic render relationships require review; they do not establish runtime visibility or approval.\n`;
  }
  if (positionals[0] !== "scan" || positionals.length !== 2 || !positionals[1])
    throw new Error(
      "Expected: pathcompiler scan, targets suggest, tests mine, git inspect, github inspect, surfaces discover, capabilities discover, workflows discover/validate/list/show/approve/reject, diff, build, mcp, or serve. Use --help for arguments and options.",
    );
  const result = await scanNextRepository(path.resolve(cwd, positionals[1]), {
    exclude: values.exclude ?? [],
  });
  const output = path.resolve(cwd, values.out ?? ".pathcompiler");
  const artifacts = [
    ["graph/source-graph.json", `${result.graph.serialize()}\n`],
    [
      "reports/scan-summary.json",
      `${JSON.stringify(result.summary, null, 2)}\n`,
    ],
  ] as const;
  await writeArtifacts(output, artifacts);
  return `Scanned ${result.summary.filesAnalyzed} source files: ${result.summary.nodes} nodes, ${result.summary.edges} edges.\nArtifacts: ${output}\nDiagnostics: ${result.summary.diagnostics.length} (see scan-summary.json).\n`;
}

async function writeArtifacts(
  output: string,
  artifacts: readonly (readonly [string, string])[],
): Promise<void> {
  for (const [relative, content] of artifacts) {
    const target = path.join(output, relative);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, content, "utf8");
    await rename(temporary, target);
  }
}

function workflowId(value: string | undefined): string {
  const parsed = WorkflowIdSchema.safeParse(value ?? "");
  if (!parsed.success)
    throw new Error(
      "Workflow ID must be a discovered domain.action ID, optionally followed by its variant hash.",
    );
  return parsed.data;
}

function reviewer(flag: string | undefined): string {
  const value = flag ?? process.env.PATHCOMPILER_USER;
  if (value === undefined)
    throw new Error(
      "Record who is reviewing: pass --by <name> or set PATHCOMPILER_USER.",
    );
  const parsed = ReviewerSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Reviewer must be 1–120 characters on one line, without leading/trailing whitespace.",
    );
  return parsed.data;
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readReviewState(output: string, id: string) {
  const paths = reviewPaths(id);
  const [candidate, approved, rejected] = await Promise.all([
    readOptional(path.join(output, paths.candidate)),
    readOptional(path.join(output, paths.approved)),
    readOptional(path.join(output, paths.rejected)),
  ]);
  return { paths, candidate, approved, rejected };
}

function refuseReviewed(
  stored: Awaited<ReturnType<typeof readReviewState>>,
  id: string,
  output: string,
): void {
  if (stored.approved !== undefined)
    throw new Error(
      `Workflow ${id} is already approved (${path.join(output, stored.paths.approved)}). Approved workflows change only through reviewed proposals.`,
    );
  if (stored.rejected !== undefined)
    throw new Error(
      `Workflow ${id} was already rejected (${path.join(output, stored.paths.rejected)}). Remove that record to review it again.`,
    );
}

function parseStored<T extends { workflow: { id: string } }>(
  content: string,
  id: string,
  parse: (input: string) => T,
): T {
  const artifact = parse(content);
  if (artifact.workflow.id !== id)
    throw new Error(`Stored workflow filename and ID disagree for ${id}.`);
  return artifact;
}

async function validateStored(
  output: string,
  id: string,
  directory: string,
  exclude: string[],
) {
  const content = await readOptional(
    path.join(output, reviewPaths(id).candidate),
  );
  if (content === undefined)
    throw new Error(
      `No candidate ${id} under ${output}. Run workflows discover first.`,
    );
  const candidate = parseStored(content, id, parseCandidateYaml);
  const project = await readSourceProject(directory, { exclude });
  const source = analyzeNextProject(project);
  const mined = minePlaywrightTests(project, source.graph);
  const report = validateWorkflow(candidate.workflow, {
    graph: mined.graph,
    traces: mined.report,
  });
  const relative = `reports/validation/${id}.json`;
  await writeArtifacts(output, [
    [relative, `${JSON.stringify(report, null, 2)}\n`],
  ]);
  return {
    candidate,
    report,
    project,
    reportPath: path.join(output, relative),
  };
}

async function listWorkflows(output: string) {
  const entries = new Map<
    string,
    {
      id: string;
      state: "candidate" | "approved" | "rejected";
      title: string;
      confidence: number;
      commit: string;
      path: string;
    }
  >();
  const sources: [
    "candidate" | "approved" | "rejected",
    string,
    (input: string) => { workflow: WorkflowV1 },
  ][] = [
    ["candidate", "workflows/candidates", parseCandidateYaml],
    ["rejected", "workflows/rejected", parseRejectedWorkflowYaml],
    ["approved", "workflows", parseApprovedWorkflowYaml],
  ];
  // Later sources take precedence: approved > rejected > candidate.
  for (const [state, relative, parse] of sources) {
    let names: string[];
    try {
      names = (
        await readdir(path.join(output, relative), { withFileTypes: true })
      )
        .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
        .map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const name of names) {
      const file = path.join(output, relative, name);
      const id = workflowId(name.slice(0, -".yaml".length));
      let workflow: WorkflowV1;
      try {
        workflow = parseStored(
          await readFile(file, "utf8"),
          id,
          parse,
        ).workflow;
      } catch (error) {
        throw new Error(
          `Cannot read ${file} as a ${state} workflow. Fix or move it, then retry.`,
          { cause: error },
        );
      }
      entries.set(id, {
        id,
        state,
        title: workflow.title,
        confidence: workflow.confidence.overall,
        commit: workflow.repository.commit,
        path: file,
      });
    }
  }
  return [...entries.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

async function loadGeneratedClient(output: string): Promise<PathCompiler> {
  const [searchIndex, runtimeManifest, documentation] = await Promise.all(
    ["search-index", "runtime-manifest", "documentation"].map(async (name) => {
      const file = path.join(output, `generated/${name}.json`);
      const content = await readOptional(file);
      if (content === undefined)
        throw new Error(`Missing ${file}. Run pathcompiler build first.`);
      try {
        return JSON.parse(content) as unknown;
      } catch (error) {
        throw new Error(
          `Cannot parse ${file}. Rebuild it with pathcompiler build.`,
          { cause: error },
        );
      }
    }),
  );
  return new PathCompiler({
    project: path.basename(path.dirname(output)),
    transport: createStaticTransport({
      searchIndex,
      runtimeManifest,
      documentation,
    }),
  });
}

async function readApproved(output: string) {
  const directory = path.join(output, "workflows");
  let names: string[];
  try {
    names = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const name of names) {
    const file = path.join(directory, name);
    try {
      records.push(
        parseStored(
          await readFile(file, "utf8"),
          workflowId(name.slice(0, -".yaml".length)),
          parseApprovedWorkflowYaml,
        ),
      );
    } catch (error) {
      throw new Error(
        `Cannot read ${file} as an approved workflow. Fix or move it, then rebuild.`,
        { cause: error },
      );
    }
  }
  return records;
}

/** Atomically creates a new file; never replaces an existing review decision. */
async function writeExclusive(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  try {
    await link(temporary, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `Refusing to replace existing review decision ${target}.`,
        { cause: error },
      );
    throw error;
  } finally {
    await unlink(temporary);
  }
}
