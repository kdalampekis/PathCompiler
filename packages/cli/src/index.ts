import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import {
  discoverWorkflows,
  parseCandidateYaml,
  serializeCandidateYaml,
} from "@pathcompiler/workflow-discovery";

export const HELP = `PathCompiler — local Next.js source analysis

Usage: pathcompiler scan <directory> [--out <directory>] [--exclude <directory> ...]
       pathcompiler targets suggest [directory] [--json] [--exclude <directory> ...]
       pathcompiler tests mine [directory] [--out <directory>] [--exclude <directory> ...]
       pathcompiler surfaces discover [directory] [--out <directory>] [--exclude <directory> ...]
       pathcompiler capabilities discover [directory] [--expect <json-file>] [--out <directory>] [--exclude <directory> ...]
       pathcompiler workflows discover [directory] [--out <directory>] [--exclude <directory> ...]
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
    },
  });
  if (values.help) return HELP;
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
    throw new Error("--json is only supported by targets suggest.");
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
      "Expected: pathcompiler scan, targets suggest, tests mine, git inspect, github inspect, surfaces discover, capabilities discover, or workflows discover. Use --help for arguments and options.",
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
