import type { SourceFile } from "@pathcompiler/behavior-extraction";
import type {
  Counterexample,
  RuleBasis,
  VerificationProperty,
} from "@pathcompiler/verification";
import { z } from "zod";

/**
 * The boundary to whatever proposes a repair: a model behind a vendor adapter,
 * a person, or a fixture. The loop depends only on this interface, never on a
 * vendor. A provider receives the violated rule, the counterexample and the
 * source file of the operation — not the repository — and answers with new
 * contents for those files. Its answer is untrusted: it is validated here and
 * then checked against the specification before anything is reported.
 */
export type AttemptSummary = {
  iteration: number;
  rationale: string;
  /** Why the attempt was rejected, in words the provider can act on. */
  rejectedBecause: string[];
};
export type RepairRequest = {
  iteration: number;
  maxIterations: number;
  violation: {
    property: VerificationProperty;
    rule: RuleBasis;
    counterexample: Counterexample;
    explanation: string;
    caveats: string[];
  };
  /** The only files that may be changed, with their current contents. */
  files: SourceFile[];
  /** Rules that hold today and must still hold after the change. */
  mustKeep: string[];
  /** What the repair must not do. */
  constraints: string[];
  previousAttempts: AttemptSummary[];
};

export const RepairProposalSchema = z.strictObject({
  edits: z
    .array(
      z.strictObject({
        path: z.string().min(1),
        /** The complete new content of the file. */
        content: z.string().max(200_000),
      }),
    )
    .min(1)
    .max(5),
  rationale: z.string().trim().min(1).max(2_000),
});
export type RepairProposal = z.infer<typeof RepairProposalSchema>;

export interface RepairProvider {
  readonly id: string;
  /** The response is validated by the loop; a provider need not trust itself. */
  proposeRepair(request: RepairRequest): Promise<unknown>;
}

/**
 * Deterministic provider for tests and demonstrations: answers attempt N with
 * the Nth prepared proposal. It is not a repair strategy; it replays what a
 * person or a model produced earlier.
 */
export function fixtureRepairProvider(
  proposals: readonly unknown[],
  id = "fixture",
): RepairProvider {
  return {
    id,
    async proposeRepair(request) {
      const proposal = proposals[request.iteration - 1];
      if (proposal === undefined)
        throw new Error(
          `The fixture has no proposal for attempt ${request.iteration}.`,
        );
      return proposal;
    },
  };
}
