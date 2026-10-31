import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  checkOutput,
  createActionGate,
  OUTPUT_POLICIES_FILE,
  parseOutputPolicies,
} from "@pathcompiler/agent-gate";
import { type FeedbackInput, gateEvent } from "@pathcompiler/alignment-data";
import {
  CONTRACT_FILE,
  contractDrift,
  findContract,
  listRepositoryFiles,
  readSourceFiles,
} from "@pathcompiler/behavior-extraction";
import { formatExpression } from "@pathcompiler/behavior-ir";
import { openGitRepository } from "@pathcompiler/git-intelligence";
import type { MutationResult } from "@pathcompiler/harness-contracts";
import {
  analyzeRisk,
  checkSafety,
  type EvaluationSummary,
  mergeAssessment,
  workingTreeDiff,
} from "@pathcompiler/harness-runner";
import { assessReadiness } from "@pathcompiler/onboarding";
import {
  formatPrGuardMarkdown,
  verifyPullRequest,
} from "@pathcompiler/pr-guard";
import {
  assessContract,
  assessProposals,
  buildContractTask,
  buildDiscoveryTask,
  ContractProposalSchema,
  mergeCandidates,
  ProposalListSchema,
  serializeCandidates,
  serializeContract,
} from "@pathcompiler/rule-discovery";
import {
  createSmtVerifier,
  createVerificationRouter,
  verifySpec,
} from "@pathcompiler/verification";
import { z } from "zod";
import {
  CANDIDATE_FILE,
  commitExists,
  loadWorkspace,
  type ToolContext,
  workspaceLoader,
} from "./context.js";

/**
 * The tools a harness calls while it works. Each one is a question a harness
 * with local access to the code would otherwise have to guess at: what are
 * the rules here, does my change break one, may this agent action run, are the
 * rules I found acceptable. They are provider-neutral; adapters (MCP, function
 * calling) only reshape them.
 */
export type ToolResult = {
  summary: string;
  data: unknown;
  /** What to record when feedback capture is on; the toolbox adds who and when. */
  feedback?: FeedbackInput;
};
export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  /** False for the two tools that can write, and only when the context allows it. */
  readOnly: boolean;
  run(context: ToolContext, input: never): Promise<ToolResult>;
};

const literal = z.union([z.boolean(), z.number(), z.string()]);
const valuation = z.record(z.string(), literal);
const define = <I extends z.ZodObject>(
  tool: Omit<ToolDefinition, "input" | "run"> & {
    input: I;
    run(context: ToolContext, input: z.infer<I>): Promise<ToolResult>;
  },
): ToolDefinition => tool as unknown as ToolDefinition;

const take = <T>(items: readonly T[], limit: number) => ({
  items: items.slice(0, limit),
  omitted: Math.max(0, items.length - limit),
});

export const TOOLS: ToolDefinition[] = [
  define({
    name: "pathcompiler_readiness",
    title: "Where does this repository stand?",
    description:
      "Start here in a repository you have not used PathCompiler on. Returns the languages found, how many operations and approved rules are known, whether the code needs describing in the behavior contract, and the next steps in order, with the exact commands. Reads files only; runs nothing.",
    readOnly: true,
    input: z.strictObject({}),
    async run(context) {
      const report = await assessReadiness(context.directory, {
        exclude: context.exclude ?? [],
        bindings: context.bindings ?? {},
      });
      return { summary: report.summary, data: report };
    },
  }),

  define({
    name: "pathcompiler_describe",
    title: "Describe the behavior of this codebase",
    description:
      "What PathCompiler knows about how this code is allowed to behave: its operations (parameters, preconditions, effects), the business rules, invariants and permissions with where each came from and how far to trust it, and the constructs it could not read. Call this first, and again after you learn something, to see what the rules are before you change code.",
    readOnly: true,
    input: z.strictObject({
      operation: z
        .string()
        .optional()
        .describe("Only this operation, for example refund"),
      max_rules: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(60)
        .describe("At most this many rules"),
    }),
    async run(context, input) {
      const { files, extraction, candidates } = await loadWorkspace(context);
      const spec = extraction.spec;
      const task = buildDiscoveryTask({
        spec,
        specHash: extraction.specHash,
        unmodeled: extraction.unsupported,
      });
      const operations = task.operations.filter(
        (item) => !input.operation || item.id === input.operation,
      );
      const rules = take(task.existingRules, input.max_rules);
      return {
        summary: `${operations.length} operation(s), ${task.existingRules.length} rule(s) (${task.existingRules.filter((item) => item.trust === "approved").length} approved), ${extraction.unsupported.length} construct(s) not modeled, ${candidates.rules.length} candidate(s) awaiting approval.`,
        data: {
          specHash: extraction.specHash,
          operations,
          rules: rules.items,
          rulesOmitted: rules.omitted,
          unmodeled: take(extraction.unsupported, 20),
          contract: contractStatus(files, extraction.spec.operations.length),
          note: "Extracted rules are candidates; only 'approved' ones were declared by a person. Constructs under 'unmodeled' are where a harness reading the code adds the most (see pathcompiler_rule_task).",
        },
      };
    },
  }),

  define({
    name: "pathcompiler_verify",
    title: "Verify the rules against the code",
    description:
      "Check, with a solver, that each operation preserves each invariant, enforces each business rule and respects each permission, given the code as it is now. Returns what is violated with a concrete counterexample (the values that break the rule), what could not be checked, and the rule's trust. Use it to find a real bug, or to learn what your change must keep true.",
    readOnly: true,
    input: z.strictObject({
      operations: z
        .array(z.string())
        .optional()
        .describe("Only these operations"),
    }),
    async run(context, input) {
      const { extraction } = await loadWorkspace(context);
      const solver = await context.solver();
      const report = await verifySpec(
        createVerificationRouter([createSmtVerifier(solver)]),
        extraction.spec,
        input.operations ? { operations: input.operations } : {},
      );
      const problems = report.results.filter(
        (item) => item.status !== "VERIFIED",
      );
      const shown = take(problems, 20);
      return {
        summary: `${report.results.length} properties: ${report.summary.VERIFIED} verified, ${report.summary.VIOLATED} violated, ${report.summary.UNKNOWN} unknown, ${report.summary.UNSUPPORTED} unsupported.`,
        data: {
          summary: report.summary,
          problems: shown.items.map((item) => ({
            status: item.status,
            property: item.property,
            rule: item.rule
              ? {
                  id: item.rule.id,
                  text: item.rule.text,
                  approved: item.rule.humanBacked,
                  confidence: item.rule.confidence,
                }
              : undefined,
            reason: item.reason,
            counterexample: item.counterexample
              ? {
                  operation: item.counterexample.operation,
                  values: relevantValues(item.counterexample),
                  violated: item.counterexample.violated,
                }
              : undefined,
            caveats: item.caveats,
          })),
          omitted: shown.omitted,
        },
      };
    },
  }),

  define({
    name: "pathcompiler_check_change",
    title: "Check my change before I finish",
    description:
      "Check the changes in the working tree (committed or not) against a base (default HEAD). Reports what you must fix (a business rule the change newly violates, with the values that break it; a protected file; a secret), what to consider (a removed guard, a changed threshold, weakened tests, reviewer-style concerns) and what was not checked. Approved rules are read from the base, so editing a rule does not make a change pass. Call it before you finish and again after you fix what it lists. It does not run your tests.",
    readOnly: true,
    input: z.strictObject({
      base: z
        .string()
        .default("HEAD")
        .describe("The revision to compare with: HEAD, a branch or a commit"),
    }),
    async run(context, input) {
      const directory = context.directory;
      const { files: head, extraction } = await loadWorkspace(context);
      const diff = await workingTreeDiff(directory, input.base);
      const safety = checkSafety({
        files: diff.files,
        added: diff.added,
        protectedPaths: [],
      });
      const risk = analyzeRisk({
        files: diff.files,
        added: diff.added,
        removed: diff.removed,
      });

      // The behavior check: the base's rules against the files as they are now.
      const scratch = await mkdtemp(
        path.join(os.tmpdir(), "pathcompiler-check-"),
      );
      let behavior: Awaited<ReturnType<typeof verifyPullRequest>> | undefined;
      let behaviorSkipped = "";
      try {
        const git = await openGitRepository(directory);
        await mkdir(path.join(scratch, "base"));
        await git.exportCommit(input.base, path.join(scratch, "base"));
        const baseFiles = await readSourceFiles(
          path.join(scratch, "base"),
          context.exclude ?? [],
        );
        const { extractBehavior } = await import(
          "@pathcompiler/behavior-extraction"
        );
        const baseSpec = extractBehavior(baseFiles, {
          bindings: context.bindings ?? {},
          id: "behavior",
        }).spec;
        if (
          baseSpec.operations.length === 0 &&
          baseSpec.businessRules.length === 0 &&
          baseSpec.invariants.length === 0
        )
          behaviorSkipped =
            "no behavior specification exists for this repository yet (pathcompiler_rule_task asks a harness to discover one)";
        else
          behavior = await verifyPullRequest({
            base: baseFiles,
            head,
            options: { bindings: context.bindings ?? {} },
            solver: await context.solver(),
            baseRef: input.base,
            headRef: "working tree",
          });
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
      const behaviorSummary = behavior
        ? {
            applied: true as const,
            verdict: behavior.verdict,
            findings: behavior.findings
              .filter((item) => item.severity !== "info")
              .map((item) => item.message),
            markdown: formatPrGuardMarkdown(behavior),
            report: behavior,
          }
        : { applied: false as const, reason: behaviorSkipped || "not run" };
      const evaluation: EvaluationSummary = {
        applied: false,
        reason: "not run in a self-check",
      };
      const assessment = mergeAssessment({
        // A self-check has no harness report; only status and open questions are read.
        result: {
          status: "completed",
          unresolvedQuestions: [],
        } as unknown as MutationResult,
        checks: { candidate: [], base: null, comparison: [] },
        safety,
        risk,
        evaluation,
        behavior: behaviorSummary,
        review: { ran: false, reason: "not run in a self-check" },
        needVouching: false,
      });
      const counterexamples = (behavior?.findings ?? [])
        .filter((item) => item.counterexample)
        .map((item) => ({
          rule: item.rule?.id,
          text: item.rule?.text,
          approved: item.rule?.humanBacked,
          operation: item.counterexample?.operation,
          values: item.counterexample
            ? relevantValues(item.counterexample)
            : undefined,
        }));
      const mustFix = assessment.reasons
        .filter((item) => item.verdict === "fail")
        .map((item) => `${item.source}: ${item.message}`);
      const consider = assessment.reasons
        .filter((item) => item.verdict === "review")
        .map((item) => `${item.source}: ${item.message}`);
      return {
        summary:
          mustFix.length > 0
            ? `${mustFix.length} thing(s) to fix before you finish.`
            : consider.length > 0
              ? `Nothing to fix; ${consider.length} thing(s) to consider.`
              : "Nothing flagged.",
        data: {
          verdict: assessment.verdict,
          mustFix,
          consider,
          counterexamples,
          notes: assessment.notes,
          behaviorCheck: behaviorSummary.applied
            ? { applied: true, verdict: behaviorSummary.verdict }
            : behaviorSummary,
          changed: {
            files: diff.files.length,
            lines: diff.changedLines,
            paths: diff.files.slice(0, 30).map((item) => item.path),
          },
          rulesKnown:
            extraction.spec.businessRules.length +
            extraction.spec.invariants.length +
            extraction.spec.permissions.length,
          next:
            mustFix.length > 0
              ? "Fix the items in mustFix, then call pathcompiler_check_change again."
              : "Run your project's own tests, then finish. Items under consider are for you to judge.",
        },
        feedback: {
          kind: "change_check",
          verdict: assessment.verdict,
          subject: {
            summary: `${diff.files.length} file(s), ${diff.changedLines} changed line(s): ${diff.files
              .slice(0, 10)
              .map((item) => item.path)
              .join(", ")}`,
          },
          checks: assessment.reasons.map((item) => ({
            kind: item.source,
            status: item.verdict === "fail" ? "violated" : "flagged",
            explanation: item.message,
          })),
          specHash: extraction.specHash,
        },
      };
    },
  }),

  define({
    name: "pathcompiler_check_action",
    title: "May this agent action run?",
    description:
      "Check one concrete action an agent is about to take (an operation with its inputs, who is acting, and the relevant stored state) against the rules: preconditions, permissions, business rules and invariants. Returns PASS or BLOCK with the violated rule, the values that violate it and what is missing, so the agent can correct itself. Blocks by default when a value is missing.",
    readOnly: true,
    input: z.strictObject({
      operation: z
        .string()
        .describe("The operation or tool, for example refund"),
      inputs: valuation
        .optional()
        .describe("Its parameters, by name or full ID"),
      context: valuation
        .optional()
        .describe("Who is acting and in what setting, by full ID (actor.role)"),
      state: valuation
        .optional()
        .describe(
          "The relevant stored state, by full ID (payments.original_amount)",
        ),
      enforce: z.enum(["all", "approved_only"]).default("all"),
      on_unknown: z.enum(["block", "allow"]).default("block"),
    }),
    async run(context, input) {
      const { extraction } = await loadWorkspace(context);
      const gate = createActionGate(extraction.spec, {
        enforce: input.enforce,
        onUnknown: input.on_unknown,
      });
      const request = {
        operation: input.operation,
        ...(input.inputs ? { inputs: input.inputs } : {}),
        ...(input.context ? { context: input.context } : {}),
        ...(input.state ? { state: input.state } : {}),
      };
      const decision = gate.check(request);
      return {
        summary: decision.summary,
        data: decision,
        feedback: gateEvent(decision, request, {
          specHash: extraction.specHash,
        }),
      };
    },
  }),

  define({
    name: "pathcompiler_check_output",
    title: "May this answer be sent?",
    description:
      'Check what an agent is about to say before it is rendered or returned. List the actions the answer commits the business to ("I refunded 6000", "you are approved") as claims, in the same form as pathcompiler_check_action; each is judged against the rules. The text is also checked against the declared answer policies (forbidden promises, required disclaimers) in spec/output-policies.json. Returns PASS or BLOCK with what is wrong and how to rewrite the answer. You find the claims; the rules decide.',
    readOnly: true,
    input: z.strictObject({
      text: z.string().max(50_000).describe("The answer, as it would be sent"),
      claims: z
        .array(
          z.strictObject({
            operation: z.string(),
            inputs: valuation.optional(),
            context: valuation.optional(),
            state: valuation.optional(),
          }),
        )
        .max(50)
        .optional()
        .describe("Actions the answer says were taken or promises"),
      channel: z.string().optional().describe("chat, email, ..."),
      enforce: z.enum(["all", "approved_only"]).default("all"),
    }),
    async run(context, input) {
      const { extraction } = await loadWorkspace(context);
      const gate = createActionGate(extraction.spec, {
        enforce: input.enforce,
      });
      const raw = await workspaceLoader(context.directory)(
        OUTPUT_POLICIES_FILE,
      );
      const policies = raw === undefined ? undefined : parseOutputPolicies(raw);
      const decision = checkOutput(gate, policies, {
        text: input.text,
        claims: (input.claims ?? []).map((claim) => ({
          operation: claim.operation,
          ...(claim.inputs ? { inputs: claim.inputs } : {}),
          ...(claim.context ? { context: claim.context } : {}),
          ...(claim.state ? { state: claim.state } : {}),
        })),
        ...(input.channel ? { channel: input.channel } : {}),
      });
      const warnings = policies
        ? decision.warnings
        : [
            ...decision.warnings,
            `No answer policies (${OUTPUT_POLICIES_FILE}); only the claims were checked.`,
          ];
      return {
        summary: decision.summary,
        data: { ...decision, warnings },
        feedback: {
          kind: "output_check",
          verdict: decision.decision === "PASS" ? "pass" : "block",
          subject: { text: input.text },
          checks: decision.violations.map((item) => ({
            ...(item.id ? { rule: item.id } : {}),
            kind: item.source,
            status: "violated",
            explanation: item.explanation,
          })),
          specHash: extraction.specHash,
        },
      };
    },
  }),

  define({
    name: "pathcompiler_rule_task",
    title: "What rules should I look for?",
    description:
      "The task for discovering business rules the deterministic extractors could not read: the operations found and where they are in the code, the rules already known (do not repeat them), the constructs that could not be modeled, and the expression syntax. Read the code, the commit history and any business documents, then answer with pathcompiler_submit_rules. Each rule needs evidence (file, lines, a verbatim quote).",
    readOnly: true,
    input: z.strictObject({
      from: z.string().optional().describe("Start of the commit range to read"),
      to: z.string().optional().describe("End of the commit range to read"),
    }),
    async run(context, input) {
      const { extraction, candidates } = await loadWorkspace(context);
      const task = buildDiscoveryTask({
        spec: extraction.spec,
        specHash: extraction.specHash,
        unmodeled: extraction.unsupported,
        commits: { from: input.from ?? null, to: input.to ?? null },
        rejected: candidates.rejected,
        paths: (
          await listRepositoryFiles(context.directory, context.exclude ?? [])
        ).map((item) => item.path),
      });
      return {
        summary: `Task ${task.id}: ${task.operations.length} operation(s) in ${task.readFiles.join(", ") || "no source file"}, ${task.unmodeled.length} construct(s) not modeled.`,
        data: task,
      };
    },
  }),

  define({
    name: "pathcompiler_submit_rules",
    title: "Propose business rules",
    description:
      "Submit business rules you found (business_rule, invariant or permission, in the expression syntax of pathcompiler_rule_task, each with evidence: file, lines and a verbatim quote, or a commit). Each is validated: it must parse, use existing variables, be new, and cite evidence that exists; it is then checked against the code. You get back what was accepted and why the rest was not, so you can correct and resubmit. Accepted rules become inferred candidates; only a person approves them. Without write permission this is a dry run.",
    readOnly: false,
    input: z.strictObject({
      proposals: ProposalListSchema.shape.proposals,
      producer: z
        .string()
        .default("harness")
        .describe("Who is proposing, for the record"),
    }),
    async run(context, input) {
      const workspace = await loadWorkspace(context);
      const task = buildDiscoveryTask({
        spec: workspace.extraction.spec,
        specHash: workspace.extraction.specHash,
        unmodeled: workspace.extraction.unsupported,
        rejected: workspace.candidates.rejected,
      });
      const solver = await context.solver();
      const assessments = await assessProposals({
        task,
        proposals: input.proposals,
        producer: `harness: ${input.producer}`,
        spec: workspace.extraction.spec,
        loadFile: workspaceLoader(context.directory),
        commitExists: (sha) => commitExists(context.directory, sha),
        solver,
      });
      const accepted = assessments.flatMap((item) =>
        item.candidate ? [item.candidate] : [],
      );
      let stored = false;
      if (context.allowWrite && accepted.length > 0) {
        const merged = mergeCandidates(workspace.candidates, accepted);
        const file = path.join(context.directory, CANDIDATE_FILE);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, serializeCandidates(merged));
        stored = true;
      }
      return {
        summary: `${accepted.length} of ${assessments.length} accepted as candidates${stored ? ` and stored in ${CANDIDATE_FILE}` : context.allowWrite ? "" : " (dry run: this server does not allow writes)"}.`,
        data: {
          stored,
          results: assessments.map((item) => ({
            index: item.index,
            status: item.status,
            id: item.candidate?.id,
            confidence: item.candidate?.confidence,
            reasons: item.reasons,
            warnings: item.warnings,
            codeCheck: item.codeCheck
              ? {
                  outcome: item.codeCheck.outcome,
                  counterexample: item.codeCheck.results.find(
                    (entry) => entry.counterexample,
                  )?.counterexample
                    ? relevantValues(
                        item.codeCheck.results.find(
                          (entry) => entry.counterexample,
                        )?.counterexample as never,
                      )
                    : undefined,
                }
              : undefined,
          })),
          next: "Correct the rejected ones using their reasons and resubmit only those. A person approves candidates with 'pathcompiler rules approve'.",
        },
      };
    },
  }),

  define({
    name: "pathcompiler_contract_task",
    title: "How do I describe this code?",
    description:
      "For a repository in any language (Python, Go, Java, Ruby, PHP, Rust, ...): the task of describing what its operations do in PathCompiler's language-neutral behavior contract, so business rules can be checked against them without a parser for the language. Returns the files, the operations already described (and which are stale because their code changed), the variables, and the instructions. Read the code, then answer with pathcompiler_submit_contract.",
    readOnly: true,
    input: z.strictObject({}),
    async run(context) {
      const { files, extraction, commit } = await loadWorkspace(context);
      const found = findContract(files);
      const task = buildContractTask({
        spec: extraction.spec,
        repositoryCommit: commit,
        files: await listRepositoryFiles(
          context.directory,
          context.exclude ?? [],
        ),
        contract: found?.contract ?? null,
        fileContents: new Map(files.map((file) => [file.path, file.content])),
      });
      const stale = task.existing.filter((item) => item.stale).length;
      return {
        summary: `Task ${task.id}: ${task.files.length} file(s), ${task.existing.length} operation(s) described${stale ? `, ${stale} stale` : ""}, ${task.extracted.length} read deterministically.`,
        data: task,
      };
    },
  }),

  define({
    name: "pathcompiler_submit_contract",
    title: "Describe operations in the behavior contract",
    description:
      "Submit descriptions of operations (parameters, preconditions the code enforces, effects on state, and anchors: file, line range and a verbatim quote) in the language-neutral behavior contract. Each is checked: the anchor lines must exist and contain the quote, expressions must parse, variables must be declared, and the result must be a valid specification. Accepted operations are stored (with a fingerprint of their code, so PathCompiler notices when the code changes) as inferred until a person approves them. Without write permission this is a dry run. Resubmit rejected operations after fixing what the reasons say.",
    readOnly: false,
    input: z.strictObject({
      operations: ContractProposalSchema.shape.operations,
      variables: ContractProposalSchema.shape.variables.optional(),
      language: z
        .string()
        .optional()
        .describe("The language of the described code"),
      producer: z
        .string()
        .default("harness")
        .describe("Who is describing, for the record"),
    }),
    async run(context, input) {
      const workspace = await loadWorkspace(context);
      const found = findContract(workspace.files);
      const producer = `harness: ${input.producer}`;
      const assessed = await assessContract({
        proposal: {
          schemaVersion: 1,
          taskId: "tool",
          producer: { kind: "harness", name: input.producer },
          ...(input.language ? { language: input.language } : {}),
          variables: input.variables ?? [],
          operations: input.operations,
        },
        producer,
        spec: workspace.extraction.spec,
        existing: found?.contract ?? null,
        loadFile: workspaceLoader(context.directory),
      });
      const accepted = assessed.operations.filter(
        (item) => item.status === "accepted",
      ).length;
      let stored = false;
      if (context.allowWrite && assessed.contract) {
        const file = path.join(context.directory, CONTRACT_FILE);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, serializeContract(assessed.contract));
        stored = true;
      }
      return {
        summary: `${accepted} of ${assessed.operations.length} operation(s) accepted${stored ? ` and stored in ${CONTRACT_FILE}` : context.allowWrite ? "" : " (dry run: this server does not allow writes)"}.`,
        data: {
          stored,
          operations: assessed.operations,
          next: "Fix the rejected ones using their reasons and resubmit only those. Then propose business rules over these variables with pathcompiler_submit_rules; a person approves the contract and the rules.",
        },
      };
    },
  }),

  define({
    name: "pathcompiler_record_feedback",
    title: "Report what you did after a check",
    description:
      "Tell PathCompiler what happened after one of its checks: you accepted the result, you corrected your work (include the corrected answer or request), or you abandoned the attempt. Pass relatesTo with the eventId a check returned. This is how a blocked attempt and its correction become a preference example in an alignment dataset. Recorded only when the server was started with --record; otherwise nothing is stored.",
    readOnly: false,
    input: z.strictObject({
      outcome: z.enum(["accepted", "corrected", "abandoned"]),
      relatesTo: z
        .string()
        .optional()
        .describe("The eventId of the check this answers"),
      note: z.string().max(2000).optional(),
      text: z.string().max(20000).optional().describe("The corrected answer"),
      request: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("The corrected action request"),
      operation: z.string().optional(),
    }),
    async run(context, input) {
      return {
        summary: context.recorder
          ? `Recorded: ${input.outcome}.`
          : "Not recorded: feedback capture is off (start the server with --record).",
        data: { recorded: context.recorder !== undefined },
        feedback: {
          kind: "outcome",
          verdict: input.outcome,
          ...(input.relatesTo ? { relatesTo: input.relatesTo } : {}),
          ...(input.note ? { note: input.note } : {}),
          subject: {
            ...(input.operation ? { operation: input.operation } : {}),
            ...(input.text ? { text: input.text } : {}),
            ...(input.request ? { request: input.request } : {}),
          },
        },
      };
    },
  }),

  define({
    name: "pathcompiler_list_rules",
    title: "List the known rules",
    description:
      "The rules PathCompiler holds for this codebase, filtered by trust (approved by a person, extracted, candidate awaiting approval, or rejected) and kind.",
    readOnly: true,
    input: z.strictObject({
      trust: z
        .enum(["approved", "extracted", "candidate", "rejected"])
        .optional(),
      kind: z
        .enum(["invariant", "business_rule", "permission", "rejected"])
        .optional(),
    }),
    async run(context, input) {
      const { extraction, candidates } = await loadWorkspace(context);
      const task = buildDiscoveryTask({
        spec: extraction.spec,
        specHash: extraction.specHash,
        unmodeled: [],
        rejected: candidates.rejected,
      });
      const rules = task.existingRules.filter(
        (item) =>
          (!input.trust || item.trust === input.trust) &&
          (!input.kind || item.kind === input.kind),
      );
      const shown = take(rules, 200);
      return {
        summary: `${rules.length} rule(s).`,
        data: { rules: shown.items, omitted: shown.omitted },
      };
    },
  }),
];

function contractStatus(
  files: readonly { path: string; content: string }[],
  operations: number,
) {
  const found = findContract(files);
  if (!found) return { present: false, operationsInSpecification: operations };
  const drift = contractDrift(found.contract, files);
  return {
    present: true,
    operations: found.contract.operations.length,
    approvedBy: found.contract.approvedBy ?? null,
    producer: found.contract.producer,
    stale: drift.map((item) => ({
      operation: item.operation,
      where: item.stale.map(
        (entry) => `${entry.anchor.file}:${entry.anchor.lines}`,
      ),
    })),
  };
}

function relevantValues(counterexample: {
  state: Record<string, unknown>;
  inputs: Record<string, unknown>;
  context: Record<string, unknown>;
  relevant?: string[] | undefined;
}): Record<string, unknown> {
  const keep = new Set(counterexample.relevant ?? []);
  const all = {
    ...counterexample.state,
    ...counterexample.inputs,
    ...counterexample.context,
  };
  return Object.fromEntries(
    Object.entries(all).filter(([id]) => keep.size === 0 || keep.has(id)),
  );
}

export { formatExpression };
