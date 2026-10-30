import {
  type Proposal,
  ProposalListSchema,
  proposalListJsonSchema,
} from "./proposals.js";
import type { DiscoveryTask } from "./task.js";

/**
 * The model route. A `RuleDiscoveryProvider` receives the task plus bounded
 * excerpts — the source files the operations come from and the messages of the
 * commits that touched them, never the repository — and answers with
 * proposals. The vendor adapters implement the same structured-task primitive
 * used elsewhere (`createAnthropicCompletion`, `createOpenAICompatibleCompletion`),
 * so no vendor SDK is imported here.
 */
export type Excerpt = { file: string; content: string; truncated: boolean };
export type CommitNote = { sha: string; subject: string; body: string };
export type DiscoveryRequest = {
  task: DiscoveryTask;
  excerpts: Excerpt[];
  commits: CommitNote[];
};
export interface RuleDiscoveryProvider {
  readonly id: string;
  /** The answer is validated by the caller; a provider need not trust itself. */
  discoverRules(request: DiscoveryRequest): Promise<unknown>;
}

export const MAX_EXCERPT_CHARS = 60_000;
export const MAX_COMMITS = 30;
const MAX_BODY_CHARS = 400;

/** Builds the excerpts a model may see: the operations' source files, capped. */
export function buildExcerpts(
  task: DiscoveryTask,
  load: (file: string) => string | undefined,
  limit = MAX_EXCERPT_CHARS,
): Excerpt[] {
  const excerpts: Excerpt[] = [];
  let remaining = limit;
  for (const file of task.readFiles) {
    const content = load(file);
    if (content === undefined || remaining <= 0) continue;
    const truncated = content.length > remaining;
    excerpts.push({
      file,
      content: truncated ? content.slice(0, remaining) : content,
      truncated,
    });
    remaining -= content.length;
  }
  return excerpts;
}

export const trimCommits = (commits: readonly CommitNote[]): CommitNote[] =>
  commits.slice(0, MAX_COMMITS).map((item) => ({
    sha: item.sha,
    subject: item.subject.slice(0, 200),
    body: item.body.slice(0, MAX_BODY_CHARS),
  }));

/** Exactly what would be sent to a model, for a dry run. */
export function describeContext(request: DiscoveryRequest) {
  const json = JSON.stringify(request);
  return {
    json,
    bytes: json.length,
    files: request.excerpts.map((item) => ({
      file: item.file,
      chars: item.content.length,
      truncated: item.truncated,
    })),
    commits: request.commits.length,
  };
}

export type CompletionTask = {
  kind: "discoverRules";
  instructions: string;
  input: string;
  outputSchema: Record<string, unknown>;
};
export type Completion = (task: CompletionTask) => Promise<unknown>;

export function completionRuleProvider(
  id: string,
  complete: Completion,
): RuleDiscoveryProvider {
  return {
    id,
    discoverRules: (request) =>
      complete({
        kind: "discoverRules",
        instructions: request.task.instructions,
        input: JSON.stringify(request),
        outputSchema: proposalListJsonSchema(),
      }),
  };
}

/** Replays a prepared answer; for tests and demonstrations. */
export function fixtureRuleProvider(
  answer: unknown,
  id = "fixture",
): RuleDiscoveryProvider {
  return { id, discoverRules: async () => answer };
}

/** Validates a model's answer at the boundary. */
export function parseProposalList(answer: unknown): Proposal[] {
  return ProposalListSchema.parse(answer).proposals;
}
