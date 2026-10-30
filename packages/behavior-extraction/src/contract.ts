import { createHash } from "node:crypto";
import {
  ExprSchema,
  formatExpression,
  IDENTIFIER,
  type Operation,
  type Provenance,
  parseExpression,
  type Variable,
  VariableSchema,
} from "@pathcompiler/behavior-ir";
import { z } from "zod";
import {
  type ExtractedFragment,
  emptyFragment,
  type SourceFile,
} from "./common.js";

/**
 * The behavior contract: one language-neutral format for what the code of an
 * operation does, so nothing downstream needs a parser for the language.
 * Whoever can read the code (a harness, a model, a person, a language-specific
 * tool) writes it once; PathCompiler validates it, verifies business rules
 * against it, and notices when the code it describes changes.
 *
 * It carries *facts about code* (parameters, preconditions, effects and where
 * they come from), never business rules: those stay in the approved and
 * candidate rule files. Facts are INFERRED until a person approves the
 * contract, because whoever wrote them may have read the code wrongly.
 */
const text = z.string().trim().min(1);
const range = z.string().regex(/^\d+(?:-\d+)?$/, 'Use "12" or "32-47"');

/** Where in the code a fact comes from, and a fingerprint of that code. */
export const ContractAnchorSchema = z.strictObject({
  file: text,
  lines: range,
  /** A short verbatim passage from those lines. */
  quote: text.max(400).optional(),
  /** Fingerprint of the normalized lines; PathCompiler computes it on import. */
  digest: z
    .string()
    .regex(/^[0-9a-f]{16,64}$/)
    .optional(),
  /** How many non-blank lines the fingerprint covers. */
  size: z.number().int().min(1).optional(),
});
export type ContractAnchor = z.infer<typeof ContractAnchorSchema>;

const effect = z.strictObject({ variable: text, value: text });
export const ContractOperationSchema = z.strictObject({
  id: text,
  description: text.optional(),
  anchors: z.array(ContractAnchorSchema).min(1),
  /** IDs of input variables. */
  parameters: z.array(text).default([]),
  /** Expressions that must hold for the operation to run (the guards). */
  preconditions: z.array(text).default([]),
  postconditions: z.array(text).default([]),
  /** The state it changes: `payments.refunded_amount := payments.refunded_amount + refund.amount`. */
  effects: z.array(effect).default([]),
  /** Parts of the operation the contract does not describe. */
  limitations: z.array(text).optional(),
});
export type ContractOperation = z.infer<typeof ContractOperationSchema>;

export const ContractFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("behavior-contract"),
  /** Informational: the language the described code is written in. */
  language: text.optional(),
  /** Who wrote the facts: `harness: <name>`, `model: <name>` or `human: <name>`. */
  producer: text,
  /** Set by `contract approve`: a person checked the facts against the code. */
  approvedBy: text.optional(),
  approvedAt: text.optional(),
  variables: z.array(VariableSchema).default([]),
  operations: z.array(ContractOperationSchema).default([]),
});
export type ContractFile = z.infer<typeof ContractFileSchema>;

export const CONTRACT_FILE = "spec/behavior-contract.json";
export const CONTRACT_PATH = /(^|\/)behavior-contract[^/]*\.json$/;
export const CONTRACT_VERSION = "contract@1";

const normalizeLine = (line: string) => line.replace(/\s+/g, " ").trim();
const significant = (lines: readonly string[]) =>
  lines.map(normalizeLine).filter((line) => line.length > 0);
const hash = (lines: readonly string[]) =>
  createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 32);
const bounds = (value: string): [number, number] => {
  const [first, last = first] = value.split("-").map(Number) as [
    number,
    number?,
  ];
  return [first, last as number];
};

/** Fingerprint of a line range; undefined when the range is outside the file. */
export function fingerprint(
  content: string,
  lines: string,
): { digest: string; size: number } | undefined {
  const [first, last] = bounds(lines);
  const all = content.split("\n");
  if (first < 1 || last < first || last > all.length) return undefined;
  const region = significant(all.slice(first - 1, last));
  if (region.length === 0) return undefined;
  return { digest: hash(region), size: region.length };
}

export type AnchorStatus =
  /** The cited lines are what they were. */
  | { state: "intact" }
  /** The same code is now at other lines. */
  | { state: "moved"; lines: string }
  /** The code the fact describes was edited or removed. */
  | { state: "changed" }
  | { state: "file_missing" }
  /** The anchor has no fingerprint, so drift cannot be judged. */
  | { state: "unverified" };

/** Compares an anchor with the file as it is now. */
export function anchorStatus(
  anchor: ContractAnchor,
  content: string | undefined,
): AnchorStatus {
  if (content === undefined) return { state: "file_missing" };
  if (!anchor.digest || !anchor.size) return { state: "unverified" };
  if (fingerprint(content, anchor.lines)?.digest === anchor.digest)
    return { state: "intact" };
  // Find the same significant lines anywhere in the file.
  const lines = content.split("\n");
  const kept: { text: string; line: number }[] = [];
  lines.forEach((line, index) => {
    const normalized = normalizeLine(line);
    if (normalized) kept.push({ text: normalized, line: index + 1 });
  });
  for (let start = 0; start + anchor.size <= kept.length; start += 1) {
    const window = kept.slice(start, start + anchor.size);
    if (hash(window.map((item) => item.text)) === anchor.digest) {
      const first = window[0]?.line as number;
      const last = window[window.length - 1]?.line as number;
      return {
        state: "moved",
        lines: last > first ? `${first}-${last}` : String(first),
      };
    }
  }
  return { state: "changed" };
}

export type OperationDrift = {
  operation: string;
  /** Anchors whose code changed or whose file is gone. */
  stale: { anchor: ContractAnchor; state: AnchorStatus["state"] }[];
};

/** Operations of `contract` whose described code no longer matches `files`. */
export function contractDrift(
  contract: ContractFile,
  files: ReadonlyMap<string, string> | readonly SourceFile[],
): OperationDrift[] {
  const byPath = Array.isArray(files)
    ? new Map((files as readonly SourceFile[]).map((f) => [f.path, f.content]))
    : (files as ReadonlyMap<string, string>);
  const drifted: OperationDrift[] = [];
  for (const operation of contract.operations) {
    const stale = operation.anchors.flatMap((anchor) => {
      const status = anchorStatus(anchor, byPath.get(anchor.file));
      return status.state === "changed" || status.state === "file_missing"
        ? [{ anchor, state: status.state }]
        : [];
    });
    if (stale.length > 0) drifted.push({ operation: operation.id, stale });
  }
  return drifted;
}

/** Parses a contract file's text, or says why not. */
export function parseContract(
  content: string,
): { contract: ContractFile } | { error: string } {
  try {
    return { contract: ContractFileSchema.parse(JSON.parse(content)) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** The contract among `files`, if there is exactly one at the usual path. */
export function findContract(
  files: readonly SourceFile[],
): { file: SourceFile; contract: ContractFile } | undefined {
  for (const file of files) {
    if (!CONTRACT_PATH.test(file.path)) continue;
    const parsed = parseContract(file.content);
    if ("contract" in parsed) return { file, contract: parsed.contract };
  }
  return undefined;
}

const sameOperation = (a: ContractOperation, b: ContractOperation) =>
  JSON.stringify(a) === JSON.stringify(b);

export type ContractExtractionOptions = {
  /**
   * Whose approval to honor. By default the file's own `approvedBy`. A pull
   * request check passes the **base** contract: only facts identical to the
   * ones a person approved stay approved; anything the change wrote is
   * inferred, however the file labels itself.
   */
  contractApproval?: "self" | ContractFile | null;
};

const expressionOf = (source: string) =>
  ExprSchema.parse(parseExpression(source));

/** Specification fragment for a contract: variables and operations with provenance. */
export function extractContract(
  file: SourceFile,
  options: ContractExtractionOptions = {},
): ExtractedFragment {
  const out = emptyFragment();
  const contract = ContractFileSchema.parse(JSON.parse(file.content));
  // null means "no approved contract exists": nothing is approved.
  const approval =
    options.contractApproval === undefined ? "self" : options.contractApproval;
  const approvedBy =
    approval === "self"
      ? contract.approvedBy
      : (approval?.approvedBy ?? undefined);
  const approvedOperations =
    approval === "self" ? contract.operations : (approval?.operations ?? []);
  const method = contract.producer.startsWith("human:")
    ? ("HUMAN" as const)
    : ("LLM_ASSISTED" as const);
  out.variables.push(...contract.variables);
  for (const operation of contract.operations) {
    const approved =
      approvedBy !== undefined &&
      approvedOperations.some((item) => sameOperation(item, operation));
    const provenance: Provenance[] = operation.anchors.map((anchor) => ({
      sourceType: "SOURCE_CODE",
      origin: approved ? "HUMAN_APPROVED" : "INFERRED",
      extractionMethod: method,
      extractorVersion: `${CONTRACT_VERSION} (${contract.producer})`,
      confidence: approved ? "HIGH" : "MEDIUM",
      sourceFile: anchor.file,
      sourceLines: anchor.lines,
      ...(approved ? { declaredBy: approvedBy } : {}),
    }));
    const preconditions = operation.preconditions.map(expressionOf);
    const built: Operation = {
      id: operation.id,
      ...(operation.description ? { description: operation.description } : {}),
      parameters: operation.parameters,
      preconditions,
      postconditions: operation.postconditions.map(expressionOf),
      effects: operation.effects.map((item) => ({
        variable: item.variable,
        value: expressionOf(item.value),
      })),
      limitations: [
        ...(operation.limitations ?? []),
        ...(approved
          ? []
          : [
              `Described by ${contract.producer} from the code, not extracted deterministically; a person has not approved these facts.`,
            ]),
      ],
      provenance,
    };
    if (built.limitations?.length === 0) delete built.limitations;
    out.operations.push(built);
    for (const [index, expression] of preconditions.entries())
      out.ledger.push({
        kind: "precondition",
        text: `${operation.id}: ${formatExpression(expression)}`,
        provenance: provenance[index % provenance.length] as Provenance,
      });
  }
  return out;
}

/** Variables the file declares, by ID. */
export const contractVariables = (contract: ContractFile): Variable[] =>
  contract.variables;

export const isContractId = (value: string) => IDENTIFIER.test(value);

/** Paths of the code files a contract is anchored to. */
export const anchoredPaths = (contract: ContractFile): string[] => [
  ...new Set(
    contract.operations.flatMap((operation) =>
      operation.anchors.map((anchor) => anchor.file),
    ),
  ),
];
