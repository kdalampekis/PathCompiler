import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  analyzeNextProject,
  scanNextRepository,
  suggestTargets,
} from "@pathcompiler/adapter-nextjs";

import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";

export const HELP = `PathCompiler — local Next.js source analysis

Usage: pathcompiler scan <directory> [--out <directory>] [--exclude <directory> ...]
       pathcompiler targets suggest [directory] [--json] [--exclude <directory> ...]
       pathcompiler tests mine [directory] [--out <directory>] [--exclude <directory> ...]

Writes .pathcompiler/graph/source-graph.json and .pathcompiler/reports/scan-summary.json
under the current working directory, or under the directory supplied to --out.
--exclude accepts scan-root-relative directory/file paths, not glob patterns.
targets suggest defaults to the current directory and prints candidates without writing files.
--json returns a versioned target report including provenance and scan diagnostics.
tests mine writes reports/test-traces.json and graph/test-graph.json under .pathcompiler
(or --out), preserving source scan artifacts. Traces are evidence, not approved workflows.
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
    },
  });
  if (values.help) return HELP;
  if (
    positionals[0] === "targets" &&
    positionals[1] === "suggest" &&
    positionals.length <= 3
  ) {
    if (values.out !== undefined)
      throw new Error(
        "targets suggest prints to stdout; --out is only supported by scan.",
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
  if (positionals[0] !== "scan" || positionals.length !== 2 || !positionals[1])
    throw new Error(
      "Expected: pathcompiler scan <directory>, pathcompiler targets suggest [directory], or pathcompiler tests mine [directory]. Use --help for options.",
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
