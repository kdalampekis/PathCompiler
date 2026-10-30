import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type CandidateRulesFile,
  CandidateRulesFileSchema,
  contractDrift,
  extractBehavior,
  findContract,
  listRepositoryFiles,
  readSourceFiles,
} from "@pathcompiler/behavior-extraction";
import { isHumanBacked } from "@pathcompiler/behavior-ir";
import {
  type CheckSuggestion,
  collectEcosystemFiles,
  detectChecks,
} from "@pathcompiler/harness-runner";

/**
 * Where a repository stands with PathCompiler and what to do next, for any
 * language. It reads files and runs nothing: no tests, no model, no network.
 * The same report serves a person (`pathcompiler start`) and a harness
 * (`pathcompiler_readiness`), so either can ask "what should I do first?".
 */
export type Step = { title: string; command?: string; why: string };
export type Readiness = {
  directory: string;
  languages: { language: string; files: number }[];
  projectChecks: Pick<CheckSuggestion, "ecosystem" | "kind" | "command">[];
  specification: {
    operations: number;
    businessRules: number;
    invariants: number;
    permissions: number;
    /** Rules a person approved (they can fail a change). */
    approvedRules: number;
    /** Rules and facts found but not approved (they warn). */
    unapprovedRules: number;
    /** Constructs the deterministic extractors saw and could not model. */
    unmodeled: number;
    /** Where the operations come from. */
    operationSources: { deterministic: number; contract: number };
  };
  contract: {
    present: boolean;
    operations: number;
    approvedBy: string | null;
    stale: string[];
  };
  candidateRules: number;
  suggestedBindings: string[];
  /** The one-line state: what the product can do for this repository today. */
  stage:
    | "nothing_to_check"
    | "describe_the_code"
    | "add_rules"
    | "approve"
    | "refresh"
    | "protecting";
  summary: string;
  nextSteps: Step[];
};

const LANGUAGES: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  scala: "Scala",
  cs: "C#",
  rb: "Ruby",
  php: "PHP",
  swift: "Swift",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  clj: "Clojure",
  dart: "Dart",
  c: "C",
  cc: "C++",
  cpp: "C++",
  sql: "SQL",
};

const singular = (word: string) =>
  word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.replace(/s$/, "");

/** `request=refund_requests` when the code says `request` and the schema says `refund_requests`. */
export function suggestBindings(prefixes: readonly string[]): string[] {
  const known = new Set(prefixes);
  const suggestions: string[] = [];
  for (const entity of prefixes) {
    const words = singular(entity).split("_");
    const names = new Set([singular(entity), words[words.length - 1] ?? ""]);
    for (const name of names)
      if (name && name !== entity && known.has(name))
        suggestions.push(`${name}=${entity}`);
  }
  return [...new Set(suggestions)].sort();
}

export const mcpConfig = (bindings: readonly string[] = []) => ({
  mcpServers: {
    pathcompiler: {
      command: "pathcompiler",
      args: ["mcp-agent", ".", ...bindings.flatMap((item) => ["--bind", item])],
    },
  },
});

export async function assessReadiness(
  directory: string,
  options: {
    exclude?: readonly string[];
    bindings?: Record<string, string>;
  } = {},
): Promise<Readiness> {
  const root = path.resolve(directory);
  const exclude = options.exclude ?? [];
  const [tree, files, ecosystem] = await Promise.all([
    listRepositoryFiles(root, exclude),
    readSourceFiles(root, exclude),
    collectEcosystemFiles(root).catch(
      (): { path: string; content: string }[] => [],
    ),
  ]);
  // Outside a git checkout the tracked-file list is empty; use the files found.
  if (ecosystem.length === 0)
    for (const item of tree)
      ecosystem.push({
        path: item.path,
        content: await readFile(path.join(root, item.path), "utf8").then(
          (text) => (item.bytes < 200_000 ? text : ""),
          () => "",
        ),
      });
  const counts = new Map<string, number>();
  for (const item of tree) {
    const language = LANGUAGES[item.path.split(".").pop() ?? ""];
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const languages = [...counts]
    .map(([language, count]) => ({ language, files: count }))
    .sort((a, b) => b.files - a.files || (a.language < b.language ? -1 : 1));

  const extraction = extractBehavior(files, {
    bindings: options.bindings ?? {},
    id: "behavior",
  });
  const spec = extraction.spec;
  const found = findContract(files);
  const stale = found
    ? contractDrift(found.contract, files).map((item) => item.operation)
    : [];
  let candidates: CandidateRulesFile | null = null;
  const candidateFile = files.find((file) =>
    /(^|\/)candidate-rules[^/]*\.json$/.test(file.path),
  );
  if (candidateFile)
    try {
      candidates = CandidateRulesFileSchema.parse(
        JSON.parse(candidateFile.content),
      );
    } catch {
      candidates = null;
    }
  const rules = [
    ...spec.businessRules,
    ...spec.invariants,
    ...spec.permissions,
  ];
  const approvedRules = rules.filter((rule) =>
    isHumanBacked(rule.provenance),
  ).length;
  const contractOperations = new Set(
    found?.contract.operations.map((o) => o.id),
  );
  const specification = {
    operations: spec.operations.length,
    businessRules: spec.businessRules.length,
    invariants: spec.invariants.length,
    permissions: spec.permissions.length,
    approvedRules,
    unapprovedRules: rules.length - approvedRules,
    unmodeled: extraction.unsupported.length,
    operationSources: {
      deterministic: spec.operations.filter(
        (o) => !contractOperations.has(o.id),
      ).length,
      contract: spec.operations.filter((o) => contractOperations.has(o.id))
        .length,
    },
  };
  const prefixes = [
    ...new Set(spec.variables.map((item) => item.id.split(".")[0] ?? "")),
  ].filter(Boolean);
  const suggestedBindings = suggestBindings(prefixes);

  const steps: Step[] = [];
  const dir = directory === "." ? "." : directory;
  let stage: Readiness["stage"];
  let summary: string;
  if (specification.operations === 0) {
    stage = tree.length === 0 ? "nothing_to_check" : "describe_the_code";
    summary =
      tree.length === 0
        ? "No source files were found."
        : `No operations could be read deterministically (${
            languages
              .slice(0, 3)
              .map((item) => item.language)
              .join(", ") || "unrecognised language"
          }). A harness can describe them in the language-neutral contract.`;
    if (tree.length > 0)
      steps.push({
        title: "Have a harness describe what the code does",
        command: `pathcompiler contract task ${dir}`,
        why: "Works in any language: the harness reads the code and fills in a contract PathCompiler validates and keeps in sync with the code. Or connect your harness over MCP (below) and it will call pathcompiler_contract_task itself.",
      });
  } else if (found && stale.length > 0) {
    stage = "refresh";
    summary = `${stale.length} described operation(s) have changed code: ${stale.join(", ")}.`;
    steps.push({
      title: "Re-describe the operations whose code changed",
      command: `pathcompiler contract task ${dir}`,
      why: "Rules for these operations are being checked against an out-of-date description.",
    });
  } else if (specification.approvedRules === 0 && !candidates?.rules.length) {
    stage = "add_rules";
    summary = `${specification.operations} operation(s) known, but no business rule is approved yet, so nothing can be violated.`;
    steps.push({
      title: "Have a harness find the business rules",
      command: `pathcompiler rules task ${dir}`,
      why: "The harness reads the code, the commit history and your documents and proposes rules with evidence. You approve the ones that are true.",
    });
    steps.push({
      title: "Or write the rules you already know",
      why: "Copy examples/rule-discovery or fixtures/refunds/spec/approved-rules.json to spec/approved-rules.json and edit.",
    });
  } else if (
    (candidates?.rules.length ?? 0) > 0 ||
    (found && !found.contract.approvedBy)
  ) {
    stage = "approve";
    summary = `${candidates?.rules.length ?? 0} proposed rule(s)${found && !found.contract.approvedBy ? " and an unapproved contract" : ""} wait for a person. Until approved they warn, never fail a change.`;
    if ((candidates?.rules.length ?? 0) > 0)
      steps.push({
        title: "Review the proposed rules",
        command: `pathcompiler rules list ${dir}`,
        why: "Approve what is true (rules approve <id> --by <you>); reject what is not.",
      });
    if (found && !found.contract.approvedBy)
      steps.push({
        title: "Check the code description, then approve it",
        command: `pathcompiler contract approve --by <you> ${dir}`,
        why: "A person confirms the harness read the code correctly; only then can a violation fail a change.",
      });
  } else {
    stage = "protecting";
    summary = `${specification.approvedRules} approved rule(s) are checked against ${specification.operations} operation(s).`;
  }

  if (suggestedBindings.length > 0)
    steps.push({
      title: "Connect code identifiers to the schema",
      command: `pathcompiler behavior extract ${dir} ${suggestedBindings.map((item) => `--bind ${item}`).join(" ")}`,
      why: `The code and the schema seem to name the same thing differently (${suggestedBindings.join(", ")}); binding them lets a schema rule apply to the code.`,
    });
  steps.push({
    title: "Let your harness call PathCompiler while it works",
    command: `pathcompiler mcp-agent ${dir}`,
    why: "Add the server to your harness's MCP settings (see mcpConfig); it can then ask for the rules, check its change before finishing, and propose rules.",
  });
  steps.push({
    title: "Check every pull request",
    command: "pathcompiler ci --report-only",
    why: "Starts in report-only mode: it comments what it would block and never fails the build until you trust it. `pathcompiler ci --print-workflow` prints a GitHub Actions file.",
  });

  return {
    directory: root,
    languages,
    projectChecks: detectChecks(ecosystem).map((item) => ({
      ecosystem: item.ecosystem,
      kind: item.kind,
      command: item.command,
    })),
    specification,
    contract: {
      present: found !== undefined,
      operations: found?.contract.operations.length ?? 0,
      approvedBy: found?.contract.approvedBy ?? null,
      stale,
    },
    candidateRules: candidates?.rules.length ?? 0,
    suggestedBindings,
    stage,
    summary,
    nextSteps: steps,
  };
}

export function formatReadiness(report: Readiness): string {
  const lines = [
    `PathCompiler in ${report.directory}`,
    report.languages.length > 0
      ? `  languages: ${report.languages
          .slice(0, 5)
          .map((item) => `${item.language} (${item.files})`)
          .join(", ")}`
      : "  languages: none recognised",
    report.projectChecks.length > 0
      ? `  project checks found: ${
          report.projectChecks
            .filter((item) => item.kind === "test")
            .map((item) => item.command)
            .join(", ") ||
          report.projectChecks.map((item) => item.command).join(", ")
        }`
      : "  project checks found: none",
    `  known: ${report.specification.operations} operation(s) (${report.specification.operationSources.deterministic} read from code, ${report.specification.operationSources.contract} described in the contract), ${report.specification.approvedRules} approved rule(s), ${report.specification.unapprovedRules} unapproved`,
    "",
    report.summary,
    "",
    "Next:",
    ...report.nextSteps.map(
      (step, index) =>
        `  ${index + 1}. ${step.title}${step.command ? `\n       ${step.command}` : ""}\n       ${step.why}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

/** A GitHub Actions workflow that checks pull requests in report-only mode. */
export function githubWorkflow(): string {
  return `name: PathCompiler
on:
  pull_request:
permissions:
  contents: read
jobs:
  behavior:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      # Install the pathcompiler CLI here (Node 22 or newer); see docs/QUICKSTART.md.
      - name: Check business rules
        # Report-only: the summary lists what would be blocked, the build never fails.
        # Remove --report-only once the findings have earned your trust.
        run: pathcompiler ci --report-only
`;
}
