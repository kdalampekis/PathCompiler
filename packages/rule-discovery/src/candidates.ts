import {
  type CandidateRule,
  type CandidateRulesFile,
  candidateRuleText,
} from "@pathcompiler/behavior-extraction";
import { formatExpression } from "@pathcompiler/behavior-ir";

/**
 * The candidate file on disk, and the one move a person can make with it:
 * approve a candidate into `approved-rules.json`, or reject it so it is not
 * proposed again. Nothing here runs unless a person asks (CLI `rules approve`
 * and `rules reject`).
 */
export const emptyCandidates = (): CandidateRulesFile => ({
  schemaVersion: 1,
  kind: "candidate-rules",
  rules: [],
  rejected: [],
});

/** Adds new candidates, keeping the existing ones; the same rule text is kept once. */
export function mergeCandidates(
  existing: CandidateRulesFile,
  added: readonly CandidateRule[],
): CandidateRulesFile {
  const seen = new Set(existing.rules.map(candidateRuleText));
  const rules = [...existing.rules];
  for (const rule of added)
    if (!seen.has(candidateRuleText(rule))) {
      seen.add(candidateRuleText(rule));
      rules.push(rule);
    }
  return {
    ...existing,
    rules: rules.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

const exprText = formatExpression;
/** The JSON form of a candidate: expressions as text, as `extractCandidateRules` reads them. */
function ruleJson(rule: CandidateRule): Record<string, unknown> {
  const common = {
    id: rule.id,
    kind: rule.kind,
    ...(rule.description ? { description: rule.description } : {}),
    evidence: rule.evidence,
    rationale: rule.rationale,
    confidence: rule.confidence,
    producer: rule.producer,
    ...(rule.taskId ? { taskId: rule.taskId } : {}),
  };
  if (rule.kind === "business_rule")
    return {
      ...common,
      when: exprText(rule.when),
      must: exprText(rule.must),
      ...(rule.appliesTo ? { appliesTo: rule.appliesTo } : {}),
    };
  if (rule.kind === "invariant")
    return { ...common, expression: exprText(rule.expression) };
  return {
    ...common,
    role: rule.role,
    action: rule.action,
    effect: rule.effect,
    ...(rule.constraint ? { constraint: exprText(rule.constraint) } : {}),
  };
}
export const serializeCandidates = (file: CandidateRulesFile): string =>
  `${JSON.stringify(
    {
      schemaVersion: 1,
      kind: "candidate-rules",
      rules: file.rules.map(ruleJson),
      rejected: file.rejected,
    },
    null,
    2,
  )}\n`;

type ApprovedFile = {
  declaredBy: string;
  reference?: string;
  invariants: Record<string, unknown>[];
  businessRules: Record<string, unknown>[];
  permissions: Record<string, unknown>[];
};

/**
 * Moves one candidate into the approved rules, recording who approved it and
 * what it was derived from. `approved` is the parsed `approved-rules.json`, or
 * null to start one. The person named becomes the rule's `declaredBy`.
 */
export function approveCandidate(input: {
  candidates: CandidateRulesFile;
  approved: ApprovedFile | null;
  id: string;
  by: string;
}): { candidates: CandidateRulesFile; approved: ApprovedFile } {
  const rule = input.candidates.rules.find((item) => item.id === input.id);
  if (!rule)
    throw new Error(
      `No candidate rule ${input.id}. Candidates: ${input.candidates.rules.map((item) => item.id).join(", ") || "none"}.`,
    );
  const approved: ApprovedFile = input.approved ?? {
    declaredBy: input.by,
    invariants: [],
    businessRules: [],
    permissions: [],
  };
  const base = {
    id: rule.id,
    description: rule.description ?? rule.rationale,
    declaredBy: input.by,
    derivedFrom: `${rule.producer}; ${rule.evidence
      .map((item) => item.file ?? item.commit)
      .join(", ")}`,
  };
  if (rule.kind === "business_rule")
    approved.businessRules.push({
      ...base,
      when: exprText(rule.when),
      must: exprText(rule.must),
      ...(rule.appliesTo ? { appliesTo: rule.appliesTo } : {}),
    });
  else if (rule.kind === "invariant")
    approved.invariants.push({
      ...base,
      expression: exprText(rule.expression),
    });
  else
    approved.permissions.push({
      ...base,
      role: rule.role,
      action: rule.action,
      effect: rule.effect,
      ...(rule.constraint ? { constraint: exprText(rule.constraint) } : {}),
    });
  return {
    approved,
    candidates: {
      ...input.candidates,
      rules: input.candidates.rules.filter((item) => item.id !== input.id),
    },
  };
}

export function rejectCandidate(input: {
  candidates: CandidateRulesFile;
  id: string;
  by: string;
  reason: string;
}): CandidateRulesFile {
  const rule = input.candidates.rules.find((item) => item.id === input.id);
  if (!rule)
    throw new Error(
      `No candidate rule ${input.id}. Candidates: ${input.candidates.rules.map((item) => item.id).join(", ") || "none"}.`,
    );
  return {
    ...input.candidates,
    rules: input.candidates.rules.filter((item) => item.id !== input.id),
    rejected: [
      ...input.candidates.rejected,
      {
        id: rule.id,
        text: candidateRuleText(rule),
        by: input.by,
        reason: input.reason,
      },
    ],
  };
}
