import { createHash } from "node:crypto";
import {
  type CandidateRule,
  candidateFragment,
  candidateRuleText,
  type Evidence,
} from "@pathcompiler/behavior-extraction";
import {
  type BehaviorSpec,
  BehaviorSpecSchema,
  type Expr,
  ExprSchema,
  IDENTIFIER,
  parseExpression,
} from "@pathcompiler/behavior-ir";
import type { SolverProvider } from "@pathcompiler/solver-provider";
import {
  type Counterexample,
  createSmtVerifier,
  createVerificationRouter,
  propertiesOf,
  type VerificationStatus,
} from "@pathcompiler/verification";
import type { Proposal } from "./proposals.js";
import type { DiscoveryTask } from "./task.js";

/**
 * The gate every proposal passes before it becomes a candidate. A proposal is
 * a claim by something that may be wrong or may have invented its evidence, so
 * it is accepted only if it parses, uses variables the specification has,
 * does not repeat a known (or rejected) rule, and cites evidence that can be
 * found. It is then checked against the code, and a rule the code
 * contradicts is flagged for triage rather than discarded: it is either a bug
 * or a wrong rule, and only a person can say which.
 */
export type EvidenceCheck = {
  evidence: Evidence;
  verified: boolean;
  /** The quote was found in the cited text. */
  quoteVerified: boolean;
  note: string;
};
export type CodeCheck = {
  outcome: "holds" | "contradicted" | "unknown" | "not_checked";
  results: {
    operation: string;
    status: VerificationStatus;
    reason?: string;
    counterexample?: Counterexample;
  }[];
};
export type Assessment = {
  index: number;
  status: "accepted" | "rejected";
  reasons: string[];
  warnings: string[];
  candidate?: CandidateRule;
  evidence: EvidenceCheck[];
  codeCheck?: CodeCheck;
};

export type AssessInput = {
  task: DiscoveryTask;
  proposals: readonly Proposal[];
  /** `harness: <name>` or `model: <name>`. */
  producer: string;
  spec: BehaviorSpec;
  /** Text of a repository file, or undefined if it is not there. */
  loadFile: (path: string) => Promise<string | undefined>;
  /** Whether a commit exists in the repository; omit when there is none. */
  commitExists?: ((sha: string) => Promise<boolean>) | undefined;
  /** Without a solver the code check is skipped. */
  solver?: SolverProvider | undefined;
};

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

async function checkEvidence(
  item: Evidence,
  input: AssessInput,
): Promise<EvidenceCheck> {
  const result = (verified: boolean, note: string, quoteVerified = false) => ({
    evidence: item,
    verified,
    quoteVerified,
    note,
  });
  if (item.type === "commit") {
    if (!input.commitExists)
      return result(false, "there is no repository to check the commit in");
    return (await input.commitExists(item.commit as string))
      ? result(true, "the commit exists")
      : result(false, `commit ${item.commit} does not exist`);
  }
  const content = await input.loadFile(
    (item.file as string).replace(/^\.\//, ""),
  );
  if (content === undefined)
    return result(
      false,
      `${item.file} is not in the repository version analyzed`,
    );
  const lines = content.split("\n");
  let cited = content;
  if (item.lines) {
    const [first, last = first] = item.lines.split("-").map(Number) as [
      number,
      number?,
    ];
    if (
      !first ||
      first < 1 ||
      (last as number) < first ||
      (last as number) > lines.length
    )
      return result(
        false,
        `${item.file} has ${lines.length} lines; ${item.lines} is out of range`,
      );
    cited = lines.slice(first - 1, last as number).join("\n");
  }
  if (!item.quote)
    return result(true, "the lines exist; no quote was given to check");
  return squash(cited).includes(squash(item.quote))
    ? result(true, "the quote is in the cited lines", true)
    : result(false, "the quote is not in the cited lines", false);
}

const knownIds = (spec: BehaviorSpec) =>
  new Set([
    ...spec.invariants.map((item) => item.id),
    ...spec.permissions.map((item) => item.id),
    ...spec.temporalRules.map((item) => item.id),
    ...spec.dataPolicies.map((item) => item.id),
    ...spec.businessRules.map((item) => item.id),
    ...(spec.dataConstraints ?? []).map((item) => item.id),
  ]);

const parse = (source: string): Expr =>
  ExprSchema.parse(parseExpression(source));

export async function assessProposals(
  input: AssessInput,
): Promise<Assessment[]> {
  const taken = knownIds(input.spec);
  const known = input.task.existingRules;
  const router = input.solver
    ? createVerificationRouter([createSmtVerifier(input.solver)])
    : undefined;
  const assessments: Assessment[] = [];
  /** Rules accepted so far in this batch, so a repeat is caught too. */
  const acceptedHere = new Map<string, string>();

  for (const [index, proposal] of input.proposals.entries()) {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const reject = (evidence: EvidenceCheck[] = []): Assessment => ({
      index,
      status: "rejected",
      reasons,
      warnings,
      evidence,
    });

    // 1. Evidence: find what can be found; drop what cannot.
    const checks: EvidenceCheck[] = [];
    for (const item of proposal.evidence)
      checks.push(await checkEvidence(item, input));
    const verified = checks.filter((item) => item.verified);
    for (const item of checks.filter((entry) => !entry.verified))
      warnings.push(`Evidence dropped: ${item.note}.`);
    if (verified.length === 0) {
      reasons.push(
        "No evidence could be verified, so the rule has no support.",
      );
      assessments.push(reject(checks));
      continue;
    }

    // 2. The rule must parse.
    let rule: CandidateRule;
    try {
      const base = {
        description: proposal.description,
        rationale: proposal.rationale,
        evidence: verified.map((item) => item.evidence),
        producer: input.producer,
        taskId: input.task.id,
        confidence:
          verified.some((item) => item.quoteVerified) &&
          proposal.confidence !== "low"
            ? ("MEDIUM" as const)
            : ("LOW" as const),
      };
      const text =
        proposal.kind === "business_rule"
          ? `${proposal.when} => ${proposal.must}`
          : proposal.kind === "invariant"
            ? proposal.expression
            : `${proposal.role} ${proposal.effect} ${proposal.action} ${proposal.constraint ?? ""}`;
      const generated = `candidate.${proposal.kind}_${createHash("sha256").update(text).digest("hex").slice(0, 8)}`;
      let id = proposal.id ?? generated;
      if (!IDENTIFIER.test(id)) {
        warnings.push(
          `The ID "${id}" is not a valid rule ID; ${generated} was used.`,
        );
        id = generated;
      }
      for (let n = 2; taken.has(id); n += 1)
        id = `${proposal.id ?? generated}_${n}`;
      if (proposal.kind === "business_rule")
        rule = {
          ...base,
          id,
          kind: "business_rule",
          when: parse(proposal.when),
          must: parse(proposal.must),
          ...(proposal.appliesTo ? { appliesTo: proposal.appliesTo } : {}),
        };
      else if (proposal.kind === "invariant")
        rule = {
          ...base,
          id,
          kind: "invariant",
          expression: parse(proposal.expression),
        };
      else
        rule = {
          ...base,
          id,
          kind: "permission",
          role: proposal.role,
          action: proposal.action,
          effect: proposal.effect,
          ...(proposal.constraint
            ? { constraint: parse(proposal.constraint) }
            : {}),
        };
    } catch (error) {
      reasons.push(
        `The rule does not parse: ${(error as Error).message.split("\n")[0]}`,
      );
      assessments.push(reject(checks));
      continue;
    }

    // 3. It must make sense in the specification: variables, types, operations.
    const fragment = candidateFragment([rule]);
    const merged = BehaviorSpecSchema.safeParse({
      ...input.spec,
      invariants: [...input.spec.invariants, ...fragment.invariants],
      businessRules: [...input.spec.businessRules, ...fragment.businessRules],
      permissions: [...input.spec.permissions, ...fragment.permissions],
    });
    if (!merged.success) {
      for (const issue of merged.error.issues) reasons.push(issue.message);
      assessments.push(reject(checks));
      continue;
    }

    // 4. It must be new.
    const text = candidateRuleText(rule);
    const duplicate = known.find((item) => item.text === text);
    if (duplicate) {
      reasons.push(
        duplicate.trust === "rejected"
          ? `A person already rejected this rule (${duplicate.id}).`
          : `The specification already has this rule as ${duplicate.id} (${duplicate.trust}).`,
      );
      assessments.push(reject(checks));
      continue;
    }
    const repeated = acceptedHere.get(text);
    if (repeated) {
      reasons.push(
        `The same rule was already proposed in this batch (${repeated}).`,
      );
      assessments.push(reject(checks));
      continue;
    }
    acceptedHere.set(text, rule.id);
    if (
      rule.kind === "permission" &&
      !input.spec.operations.some((item) => item.id === rule.action)
    )
      warnings.push(
        `${rule.action} is not an operation of the specification, so no code is checked against this permission.`,
      );
    taken.add(rule.id);

    // 5. What the code says about it.
    let codeCheck: CodeCheck | undefined;
    if (router) {
      const spec = merged.data;
      const properties = propertiesOf(spec).filter((property) =>
        property.kind === "rule_enforced"
          ? property.rule === rule.id
          : property.kind === "invariant_preserved"
            ? property.invariant === rule.id
            : property.kind === "permission_enforced"
              ? property.permission === rule.id
              : false,
      );
      const results: CodeCheck["results"] = [];
      for (const property of properties) {
        const result = await router.verify(property, spec);
        results.push({
          operation: property.operation,
          status: result.status,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.counterexample
            ? { counterexample: result.counterexample }
            : {}),
        });
      }
      codeCheck = {
        outcome:
          results.length === 0
            ? "not_checked"
            : results.some((item) => item.status === "VIOLATED")
              ? "contradicted"
              : results.every((item) => item.status === "VERIFIED")
                ? "holds"
                : "unknown",
        results,
      };
      if (codeCheck.outcome === "contradicted")
        warnings.push(
          "The code contradicts this rule: either it has a bug or the rule is wrong. Decide which before approving.",
        );
    }
    assessments.push({
      index,
      status: "accepted",
      reasons,
      warnings,
      candidate: rule,
      evidence: checks,
      ...(codeCheck ? { codeCheck } : {}),
    });
  }
  return assessments;
}
