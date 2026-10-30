import type { LedgerEntry } from "./common.js";

/**
 * Extraction quality against a hand-written ground truth (RQ1). A fact is
 * matched by kind and canonical text. For matched facts, provenance is
 * correct when the source type and file agree (and the lines, when the
 * ground truth gives them).
 */
export type GroundTruthFact = {
  kind: LedgerEntry["kind"];
  text: string;
  sourceType: string;
  file: string;
  lines?: string;
};
export type GroundTruth = {
  facts: GroundTruthFact[];
  /** Constructs the extractor must report instead of guessing. */
  unsupported?: { file: string; construct: string }[];
};
export type ExtractionScore = {
  expected: number;
  extracted: number;
  matched: number;
  precision: number;
  recall: number;
  provenanceCorrect: number;
  /** Extracted but not in the ground truth. */
  extra: string[];
  /** In the ground truth but not extracted. */
  missing: string[];
  /** Provenance mismatches, described. */
  provenanceErrors: string[];
  unsupportedReported: number;
  unsupportedExpected: number;
};

const key = (kind: string, text: string) => `${kind}|${text}`;
const ratio = (part: number, whole: number) => (whole === 0 ? 1 : part / whole);

export function scoreExtraction(
  ledger: readonly LedgerEntry[],
  truth: GroundTruth,
  unsupported: readonly { file: string; construct: string }[] = [],
): ExtractionScore {
  const extractedKeys = new Set(
    ledger.map((item) => key(item.kind, item.text)),
  );
  const expectedKeys = new Set(
    truth.facts.map((item) => key(item.kind, item.text)),
  );
  const matched = [...expectedKeys].filter((item) => extractedKeys.has(item));
  const provenanceErrors: string[] = [];
  let provenanceOk = 0;
  for (const fact of truth.facts) {
    const entries = ledger.filter(
      (item) => item.kind === fact.kind && item.text === fact.text,
    );
    if (entries.length === 0) continue;
    const found = entries.some(
      (item) =>
        item.provenance.sourceType === fact.sourceType &&
        item.provenance.sourceFile === fact.file &&
        (fact.lines === undefined ||
          item.provenance.sourceLines === fact.lines),
    );
    if (found) provenanceOk += 1;
    else
      provenanceErrors.push(
        `${fact.kind} ${fact.text}: expected ${fact.sourceType} ${fact.file}${fact.lines ? `:${fact.lines}` : ""}, got ${entries
          .map(
            (item) =>
              `${item.provenance.sourceType} ${item.provenance.sourceFile}:${item.provenance.sourceLines}`,
          )
          .join("; ")}`,
      );
  }
  // Ground-truth facts counted once per (kind, text, source) so a rule two
  // sources agree on is expected twice.
  const reported = (truth.unsupported ?? []).filter((item) =>
    unsupported.some(
      (found) =>
        found.file === item.file && found.construct.includes(item.construct),
    ),
  );
  return {
    expected: truth.facts.length,
    extracted: ledger.length,
    matched: matched.length,
    precision: ratio(
      [...extractedKeys].filter((item) => expectedKeys.has(item)).length,
      extractedKeys.size,
    ),
    recall: ratio(matched.length, expectedKeys.size),
    provenanceCorrect: ratio(provenanceOk, truth.facts.length),
    extra: [...extractedKeys].filter((item) => !expectedKeys.has(item)).sort(),
    missing: [...expectedKeys]
      .filter((item) => !extractedKeys.has(item))
      .sort(),
    provenanceErrors,
    unsupportedReported: reported.length,
    unsupportedExpected: truth.unsupported?.length ?? 0,
  };
}
