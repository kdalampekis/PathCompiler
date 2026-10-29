import { fileURLToPath } from "node:url";
import { analyzeNextProject } from "@pathcompiler/adapter-nextjs";
import { discoverCapabilities } from "@pathcompiler/capability-engine";
import { buildFormalModel } from "@pathcompiler/formal-abstraction";
import {
  type FormalProductModel,
  normalizeFormalModel,
  serializeFormalModel,
} from "@pathcompiler/formal-model";
import { readSourceProject } from "@pathcompiler/source-model";
import { minePlaywrightTests } from "@pathcompiler/test-miner-playwright";
import { beforeAll, describe, expect, it } from "vitest";
import { nextDemoFormalModel } from "../../formal-model/test/next-demo-model.js";
import {
  fromFormalModel,
  isHumanBacked,
  parseBehaviorSpec,
  parseExpression,
  serializeBehaviorSpec,
  toFormalModel,
} from "../src/index.js";

let extracted: FormalProductModel;
beforeAll(async () => {
  const project = await readSourceProject(
    fileURLToPath(new URL("../../../fixtures/next-demo", import.meta.url)),
  );
  const mined = minePlaywrightTests(project, analyzeNextProject(project).graph);
  const capabilities = discoverCapabilities(mined.graph);
  extracted = buildFormalModel(
    capabilities.graph,
    capabilities.report,
    mined.report,
  ).model;
}, 120_000);

describe("Formal Product Model ↔ BehaviorIR", () => {
  it("maps the hand-encoded model and back without loss", () => {
    const model = nextDemoFormalModel("a".repeat(40));
    const spec = fromFormalModel(model);
    expect(parseBehaviorSpec(JSON.parse(serializeBehaviorSpec(spec)))).toEqual(
      parseBehaviorSpec(spec),
    );
    const { model: back, omitted } = toFormalModel(spec);
    expect(omitted).toEqual([]);
    expect(serializeFormalModel(back)).toBe(serializeFormalModel(model));
    // Hand-encoded rules are explicit human declarations.
    expect(spec.transitions[0]?.provenance[0]).toMatchObject({
      sourceType: "HUMAN_DECLARATION",
      origin: "EXPLICIT",
      declaredBy: "hand-encoded formal model",
    });
    expect(isHumanBacked(spec.transitions[0]?.provenance ?? [])).toBe(true);
  });

  it("maps the model extracted from the Next.js fixture and back without loss", () => {
    const spec = fromFormalModel(extracted);
    expect(spec.transitions.length).toBe(extracted.actions.length);
    expect(spec.workflows.length).toBe(extracted.goals.length);
    // Extracted rules are inferred, with the graph evidence kept.
    for (const transition of spec.transitions.slice(0, 5))
      expect(transition.provenance[0]).toMatchObject({
        sourceType: "SOURCE_CODE",
        origin: "INFERRED",
        extractionMethod: "FORMAL_MODEL",
      });
    const { model: back, omitted } = toFormalModel(spec);
    expect(omitted).toEqual([]);
    expect(serializeFormalModel(back)).toBe(
      serializeFormalModel(normalizeFormalModel(extracted)),
    );
  });

  it("reports what the transition system cannot represent instead of dropping it silently", () => {
    const spec = fromFormalModel(nextDemoFormalModel("a".repeat(40)));
    const provenance = {
      sourceType: "HUMAN_DECLARATION" as const,
      origin: "EXPLICIT" as const,
      extractionMethod: "HUMAN" as const,
      extractorVersion: "test",
      confidence: "HIGH" as const,
      declaredBy: "test",
    };
    const extended = parseBehaviorSpec({
      ...spec,
      variables: [
        ...spec.variables,
        { id: "refund", type: "integer", scope: "input" },
      ],
      invariants: [
        ...spec.invariants,
        {
          id: "refund_bounded",
          expression: parseExpression("refund + 1 <= 10"),
          provenance: [provenance],
        },
      ],
      businessRules: [
        {
          id: "large_refund_review",
          when: parseExpression("refund > 5000"),
          must: parseExpression("refund < 6000"),
          provenance: [provenance],
        },
      ],
    });
    const { omitted, model } = toFormalModel(extended);
    expect(omitted).toEqual([
      {
        kind: "variable",
        id: "refund",
        reason: "input variables have no formal counterpart",
      },
      {
        kind: "invariant",
        id: "refund_bounded",
        reason: "arithmetic is outside the Formal Product Model",
      },
      {
        kind: "business rule",
        id: "large_refund_review",
        reason: "verified by the verification layer, not the transition system",
      },
    ]);
    // Everything representable is kept.
    expect(model.actions.length).toBe(spec.transitions.length);
  });
});
