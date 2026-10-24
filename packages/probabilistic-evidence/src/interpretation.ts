import {
  type ConfidenceAssessment,
  type EvidenceClaim,
  type EvidenceItem,
  fuseEvidence,
  RELIABILITY,
} from "./index.js";

/**
 * Probabilistic semantic interpretation, P1 (reasoning spec §48–§49). A
 * subject has several candidate meanings; hard constraints remove the
 * impossible ones; the rest are re-scored and fused. Hard constraints always
 * hold: no amount of soft evidence keeps an impossible candidate.
 */
export type InterpretationCandidate = {
  /** The meaning, e.g. a canonical capability ID. */
  value: string;
  /** Source score in [0, 1]: rule strength or model-stated confidence. */
  prior: number;
  /** Soft evidence for this value; each item's `value` is set to it. */
  items: EvidenceItem[];
  /** Hard-constraint violations; any makes the candidate impossible. */
  violations: string[];
};
export type InterpretedCandidate = {
  value: string;
  prior: number;
  status: "consistent" | "impossible";
  /** Prior renormalized over consistent candidates; 0 when impossible. */
  weight: number;
  weightMeaning: "relative-weight-not-probability";
  /** Highest reliability tier of its evidence for the claim type. */
  tier: number | null;
  evidenceIds: string[];
  violations: string[];
};
export type InterpretationOutcome = {
  claimId: string;
  subject: string;
  /** Consistent first, then by evidence tier, weight and value. */
  candidates: InterpretedCandidate[];
  /** The fused value among consistent candidates; null if none or contested. */
  best: string | null;
  /** Fusion of consistent candidates' evidence only. */
  assessment: ConfidenceAssessment;
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round = (value: number) => Math.round(value * 1000) / 1000;

export function interpretCandidates(
  claim: EvidenceClaim & { categorical: true },
  input: readonly InterpretationCandidate[],
): InterpretationOutcome {
  // The same value from several sources is one candidate: its evidence is
  // pooled (fusion counts each class once), its prior is the strongest one,
  // and every violation stands.
  const byValue = new Map<string, InterpretationCandidate>();
  for (const candidate of input) {
    if (!(candidate.prior >= 0 && candidate.prior <= 1))
      throw new Error(
        `Candidate ${candidate.value} for ${claim.id} needs a prior in [0, 1].`,
      );
    const known = byValue.get(candidate.value);
    byValue.set(candidate.value, {
      value: candidate.value,
      prior: Math.max(known?.prior ?? 0, candidate.prior),
      items: [
        ...(known?.items ?? []),
        ...candidate.items.map((item) => ({ ...item, value: candidate.value })),
      ],
      violations: [
        ...new Set([...(known?.violations ?? []), ...candidate.violations]),
      ].sort(compare),
    });
  }
  const candidates = [...byValue.values()];
  const consistent = candidates.filter(
    (candidate) => candidate.violations.length === 0,
  );
  const total = consistent.reduce((sum, candidate) => sum + candidate.prior, 0);
  const tiers = RELIABILITY[claim.type];
  const interpreted = candidates
    .map((candidate): InterpretedCandidate => {
      const status =
        candidate.violations.length === 0 ? "consistent" : "impossible";
      return {
        value: candidate.value,
        prior: candidate.prior,
        status,
        weight:
          status === "impossible"
            ? 0
            : total === 0
              ? round(1 / consistent.length)
              : round(candidate.prior / total),
        weightMeaning: "relative-weight-not-probability",
        tier: candidate.items.length
          ? Math.max(...candidate.items.map((item) => tiers[item.class]))
          : null,
        evidenceIds: [...new Set(candidate.items.map((item) => item.id))].sort(
          compare,
        ),
        violations: candidate.violations,
      };
    })
    .sort(
      (a, b) =>
        (a.status === b.status ? 0 : a.status === "consistent" ? -1 : 1) ||
        (b.tier ?? 0) - (a.tier ?? 0) ||
        b.weight - a.weight ||
        compare(a.value, b.value),
    );
  const assessment = fuseEvidence(
    claim,
    consistent.flatMap((candidate) => candidate.items),
  );
  return {
    claimId: claim.id,
    subject: claim.subject,
    candidates: interpreted,
    best: assessment.canonical,
    assessment,
  };
}
