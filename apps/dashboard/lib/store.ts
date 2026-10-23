import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { COMPILER_VERSION } from "@pathcompiler/workflow-compiler";
import {
  parseCandidateYaml,
  type WorkflowCandidate,
} from "@pathcompiler/workflow-discovery";
import {
  type Proposal,
  parseProposalYaml,
} from "@pathcompiler/workflow-proposals";
import {
  type ApprovedWorkflow,
  type DeprecatedWorkflow,
  parseApprovedWorkflowYaml,
  parseDeprecatedWorkflowYaml,
  parseRejectedWorkflowYaml,
  type RejectedWorkflow,
  WorkflowIdSchema,
} from "@pathcompiler/workflow-review";
import { z } from "zod";

export type Project = { name: string; root: string; out: string };

const ProjectsSchema = z.record(
  z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  z.strictObject({
    root: z.string().min(1),
    out: z.string().min(1).optional(),
  }),
);

/**
 * Projects come from PATHCOMPILER_PROJECTS (JSON `{name: {root, out?}}`), or a
 * single `default` project rooted at the server's working directory.
 */
export function projects(): Project[] {
  const configured = process.env.PATHCOMPILER_PROJECTS;
  const parsed = configured
    ? ProjectsSchema.parse(JSON.parse(configured))
    : { default: { root: process.cwd() } };
  return Object.entries(parsed)
    .map(([name, value]) => ({
      name,
      root: path.resolve(value.root),
      out: path.resolve(value.root, value.out ?? ".pathcompiler"),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}
export function project(name: string): Project | null {
  return projects().find((item) => item.name === name) ?? null;
}

async function optional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function yamlFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export type WorkflowState =
  | "approved"
  | "candidate"
  | "rejected"
  | "deprecated";
export type WorkflowEntry = {
  id: string;
  state: WorkflowState;
  title: string;
  commit: string;
  confidence: number;
};

/** One entry per ID: approved > deprecated > rejected > candidate. */
export async function workflows(target: Project): Promise<WorkflowEntry[]> {
  const entries = new Map<string, WorkflowEntry>();
  const sources: [
    WorkflowState,
    string,
    (input: string) => {
      workflow: {
        id: string;
        title: string;
        repository: { commit: string };
        confidence: { overall: number };
      };
    },
  ][] = [
    ["candidate", "workflows/candidates", parseCandidateYaml],
    ["rejected", "workflows/rejected", parseRejectedWorkflowYaml],
    ["deprecated", "workflows/deprecated", parseDeprecatedWorkflowYaml],
    ["approved", "workflows", parseApprovedWorkflowYaml],
  ];
  for (const [state, relative, parse] of sources)
    for (const name of await yamlFiles(
      path.join(/* turbopackIgnore: true */ target.out, relative),
    )) {
      const content = await readFile(
        path.join(/* turbopackIgnore: true */ target.out, relative, name),
        "utf8",
      );
      const { workflow } = parse(content);
      entries.set(workflow.id, {
        id: workflow.id,
        state,
        title: workflow.title,
        commit: workflow.repository.commit,
        confidence: workflow.confidence.overall,
      });
    }
  return [...entries.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

export type WorkflowDetail = {
  state: WorkflowState;
  approved?: ApprovedWorkflow;
  candidate?: WorkflowCandidate;
  rejected?: RejectedWorkflow;
  deprecated?: DeprecatedWorkflow;
  validation?: ValidationSummary;
  proposals: { name: string; proposal: Proposal }[];
};
export type ValidationSummary = {
  valid: boolean;
  repositoryCommit: string | null;
  errors: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
  checks: { name: string; status: string; details: string }[];
};

export async function workflow(
  target: Project,
  id: string,
): Promise<WorkflowDetail | null> {
  if (!WorkflowIdSchema.safeParse(id).success) return null;
  const read = (relative: string) =>
    optional(path.join(/* turbopackIgnore: true */ target.out, relative));
  const [approved, candidate, rejected, deprecated, validation] =
    await Promise.all([
      read(`workflows/${id}.yaml`),
      read(`workflows/candidates/${id}.yaml`),
      read(`workflows/rejected/${id}.yaml`),
      read(`workflows/deprecated/${id}.yaml`),
      read(`reports/validation/${id}.json`),
    ]);
  const detail: WorkflowDetail = {
    state: approved
      ? "approved"
      : deprecated
        ? "deprecated"
        : rejected
          ? "rejected"
          : "candidate",
    proposals: (await proposals(target)).filter(
      (item) => item.proposal.workflowId === id,
    ),
    ...(approved ? { approved: parseApprovedWorkflowYaml(approved) } : {}),
    ...(candidate ? { candidate: parseCandidateYaml(candidate) } : {}),
    ...(rejected ? { rejected: parseRejectedWorkflowYaml(rejected) } : {}),
    ...(deprecated
      ? { deprecated: parseDeprecatedWorkflowYaml(deprecated) }
      : {}),
    ...(validation
      ? { validation: JSON.parse(validation) as ValidationSummary }
      : {}),
  };
  if (!approved && !candidate && !rejected && !deprecated) return null;
  return detail;
}

export async function proposals(
  target: Project,
): Promise<{ name: string; proposal: Proposal }[]> {
  const directory = path.join(
    /* turbopackIgnore: true */ target.out,
    "proposals",
  );
  return Promise.all(
    (await yamlFiles(directory)).map(async (file) => ({
      name: file.slice(0, -".yaml".length),
      proposal: parseProposalYaml(
        await readFile(
          path.join(/* turbopackIgnore: true */ directory, file),
          "utf8",
        ),
      ),
    })),
  );
}

/** Reads a JSON report written by the CLI; `null` when it has not been generated. */
export async function report<T = Record<string, unknown>>(
  target: Project,
  name:
    | "capabilities"
    | "product-surfaces"
    | "workflow-impact"
    | "new-workflows"
    | "test-traces"
    | "graph-delta",
): Promise<T | null> {
  const content = await optional(
    path.join(/* turbopackIgnore: true */ target.out, `reports/${name}.json`),
  );
  return content === undefined ? null : (JSON.parse(content) as T);
}

export async function settings(target: Project) {
  const generated = await Promise.all(
    ["search-index", "runtime-manifest", "documentation"].map(async (name) => {
      try {
        const info = await stat(
          path.join(
            /* turbopackIgnore: true */ target.out,
            `generated/${name}.json`,
          ),
        );
        return { name, updated: info.mtime.toISOString() };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return { name, updated: null };
        throw error;
      }
    }),
  );
  return {
    root: target.root,
    out: target.out,
    compilerVersion: COMPILER_VERSION,
    generated,
    reviewerConfigured: Boolean(process.env.PATHCOMPILER_USER),
    githubTokenConfigured: Boolean(process.env.GITHUB_TOKEN),
  };
}
