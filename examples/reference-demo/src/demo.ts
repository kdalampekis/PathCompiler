// The full PathCompiler loop on a Git copy of the reference fixture: every step
// uses the same public CLI and packages a customer would.
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "@pathcompiler/cli";
import {
  createStaticTransport,
  PathCompiler,
  type ProductHelpResult,
  type RuntimeWorkflow,
} from "@pathcompiler/sdk-js";
import {
  ExistingAssistant,
  ScriptedModel,
} from "../../custom-assistant/src/assistant.ts";
import { type Card, toCard } from "../../custom-assistant/src/ui.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(here, "../../..");
export const workDirectory = path.resolve(here, "../.work");
export const appDirectory = path.join(workDirectory, "app");
export const transcriptFile = path.join(workDirectory, "demo.json");
const fixture = path.join(repositoryRoot, "fixtures/next-demo");
const out = path.join(appDirectory, ".pathcompiler");

export type Artifacts = {
  searchIndex: unknown;
  runtimeManifest: { workflows: RuntimeWorkflow[] };
  documentation: unknown;
};
export type DemoTranscript = {
  base: string;
  head: string;
  steps: { number: number; name: string; output: string }[];
  graph: { nodes: number; edges: number; tests: number };
  candidates: string[];
  approved: string[];
  baseArtifacts: Artifacts;
  answers: Record<string, ProductHelpResult>;
  card: Card;
  impact: { workflowId: string; severity: string; reasons: string[] }[];
  proposal: string;
  headArtifacts: Artifacts;
};

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "Reference Demo",
  GIT_AUTHOR_EMAIL: "demo@example.test",
  GIT_COMMITTER_NAME: "Reference Demo",
  GIT_COMMITTER_EMAIL: "demo@example.test",
};
const git = (...args: string[]) =>
  execFileSync("git", ["-C", appDirectory, ...args], {
    env,
    encoding: "utf8",
  }).trim();
const cli = (...args: string[]) =>
  runCli([...args, "--out", out], appDirectory);
const json = async (file: string) =>
  JSON.parse(await readFile(file, "utf8")) as unknown;
async function artifacts(): Promise<Artifacts> {
  const load = (name: string) => json(path.join(out, `generated/${name}.json`));
  return {
    searchIndex: await load("search-index"),
    runtimeManifest: (await load(
      "runtime-manifest",
    )) as Artifacts["runtimeManifest"],
    documentation: await load("documentation"),
  };
}
function client(input: Artifacts) {
  return new PathCompiler({
    project: "reference-demo",
    transport: createStaticTransport(input),
  });
}

/** A Git copy of the fixture inside the workspace, buildable with its dependencies. */
async function copyFixture() {
  await rm(workDirectory, { recursive: true, force: true });
  await mkdir(appDirectory, { recursive: true });
  const tracked = execFileSync(
    "git",
    ["-C", fixture, "ls-files", "-z", "--", "."],
    {
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
  for (const file of tracked) {
    await mkdir(path.dirname(path.join(appDirectory, file)), {
      recursive: true,
    });
    await copyFile(path.join(fixture, file), path.join(appDirectory, file));
  }
  await symlink(
    path.join(fixture, "node_modules"),
    path.join(appDirectory, "node_modules"),
  );
  const tsconfig = path.join(appDirectory, "tsconfig.json");
  const config = JSON.parse(await readFile(tsconfig, "utf8")) as {
    extends: string;
  };
  config.extends = path.relative(
    appDirectory,
    path.join(repositoryRoot, "tsconfig.base.json"),
  );
  await writeFile(tsconfig, `${JSON.stringify(config, null, 2)}\n`);
  // The copy is its own Git repository; tell Turbopack the dependency root.
  await writeFile(
    path.join(appDirectory, "next.config.ts"),
    `import type { NextConfig } from "next";\n\nconst config: NextConfig = {\n  devIndicators: false,\n  turbopack: { root: ${JSON.stringify(repositoryRoot)} },\n};\nexport default config;\n`,
  );
  await writeFile(
    path.join(appDirectory, ".gitignore"),
    ".pathcompiler/\n.next/\nnode_modules\ntest-results/\n*.tsbuildinfo\n",
  );
}

export async function runReferenceDemo(
  log: (line: string) => void = () => {},
): Promise<DemoTranscript> {
  const steps: DemoTranscript["steps"] = [];
  const step = (number: number, name: string, output: string) => {
    steps.push({ number, name, output: output.trim() });
    log(`\n${number}. ${name}\n${output.trim()}`);
  };
  await copyFixture();
  git("init", "--quiet", "--initial-branch=main");
  git("add", ".");
  git("commit", "--quiet", "-m", "Reference fixture");
  const base = git("rev-parse", "HEAD");

  step(1, "Repository scan", await cli("scan", appDirectory));
  step(2, "Product graph", await cli("tests", "mine", appDirectory));
  const testGraph = (await json(path.join(out, "graph/test-graph.json"))) as {
    nodes: { type: string }[];
    edges: unknown[];
  };
  step(
    3,
    "Workflow discovery",
    await cli("workflows", "discover", appDirectory),
  );
  const candidates = [
    "clients.create",
    "plans.change_structure",
    "plans.create",
  ];
  const approvals = [];
  for (const id of candidates)
    approvals.push(
      await cli(
        "workflows",
        "approve",
        id,
        appDirectory,
        "--by",
        "Reference Reviewer",
      ),
    );
  step(
    4,
    "Workflow approval",
    approvals.map((line) => line.split("\n")[0]).join("\n"),
  );
  step(5, "Compile", await cli("build"));
  const baseArtifacts = await artifacts();
  const sdk = client(baseArtifacts);
  const answers: Record<string, ProductHelpResult> = {};
  for (const query of [
    "How do I add a new client?",
    "How do I change the structure of a plan?",
  ])
    answers[query] = await sdk.resolve({ query });
  step(
    6,
    "Query resolver",
    Object.entries(answers)
      .map(
        ([query, answer]) =>
          `${query} → ${answer.type === "workflow_help" ? answer.workflowId : answer.type}`,
      )
      .join("\n"),
  );
  const answer = await new ExistingAssistant(
    new ScriptedModel({ route: "/plans" }),
    sdk,
  ).ask("How do I add a new client?");
  const card = toCard(answer);
  step(
    7,
    "Custom assistant answer",
    [card.heading, ...card.body, card.buttons.join(" | ")].join("\n"),
  );
  step(
    8,
    "Navigate action",
    `The answer offers "${card.buttons[0]}" (verified in the browser).`,
  );
  step(
    9,
    "Interactive guide",
    "The compiled runtime manifest guides a user (verified in the browser).",
  );

  for (const file of ["components/plans.tsx", "tests/workflows.spec.ts"]) {
    const target = path.join(appDirectory, file);
    await writeFile(
      target,
      (await readFile(target, "utf8")).replaceAll(
        '"plans.change_structure"',
        '"plans.restructure"',
      ),
    );
  }
  git("commit", "--quiet", "-am", "Rename the plan structure action");
  const head = git("rev-parse", "HEAD");
  step(
    10,
    "Code change",
    `Renamed semantic target plans.change_structure → plans.restructure at ${head.slice(0, 12)}.`,
  );
  step(
    11,
    "Impacted workflow detected",
    await cli("impact", base, "HEAD", appDirectory),
  );
  const impact = (
    (await json(path.join(out, "reports/workflow-impact.json"))) as {
      impacts: {
        workflowId: string;
        severity: string;
        reasons: { code: string }[];
      }[];
    }
  ).impacts.map((item) => ({
    workflowId: item.workflowId,
    severity: item.severity,
    reasons: item.reasons.map((reason) => reason.code),
  }));
  step(
    12,
    "Update proposal",
    await cli("proposals", "generate", base, "HEAD", appDirectory),
  );
  const proposal = `plans.change_structure.${head}`;
  step(
    13,
    "Approval",
    await cli(
      "proposals",
      "accept",
      proposal,
      appDirectory,
      "--by",
      "Reference Reviewer",
    ),
  );
  step(14, "New runtime output", await cli("build"));
  const transcript: DemoTranscript = {
    base,
    head,
    steps,
    graph: {
      nodes: testGraph.nodes.length,
      edges: testGraph.edges.length,
      tests: testGraph.nodes.filter((node) => node.type === "Test").length,
    },
    candidates,
    approved: candidates,
    baseArtifacts,
    answers,
    card,
    impact,
    proposal,
    headArtifacts: await artifacts(),
  };
  await writeFile(transcriptFile, `${JSON.stringify(transcript, null, 2)}\n`);
  return transcript;
}
