import { describe, expect, it } from "vitest";
import {
  anchorStatus,
  type ContractFile,
  contractDrift,
  extractBehavior,
  fingerprint,
} from "../src/index.js";

const code = `def refund(amount):
    if amount <= 0:
        raise ValueError("positive")
    if amount > 5000:
        raise PermissionError("approval")
`;
const print = fingerprint(code, "2-5") as { digest: string; size: number };
const contract = (overrides: Partial<ContractFile> = {}): ContractFile => ({
  schemaVersion: 1,
  kind: "behavior-contract",
  producer: "harness: t",
  variables: [{ id: "refund.amount", type: "integer", scope: "input" }],
  operations: [
    {
      id: "refund",
      anchors: [{ file: "a.py", lines: "2-5", ...print }],
      parameters: ["refund.amount"],
      preconditions: ["refund.amount > 0"],
      postconditions: [],
      effects: [],
    },
  ],
  ...overrides,
});

describe("anchors", () => {
  const anchor = { file: "a.py", lines: "2-5", ...print };
  it("ignores whitespace and blank lines", () => {
    const reformatted = code
      .replace(/ {4}/g, "\t")
      .replace("\n    if", "\n\n    if");
    expect(anchorStatus(anchor, reformatted).state).toBe("intact");
  });
  it("follows the code when it moves", () => {
    const moved = `# new header\n# another\n${code}`;
    expect(anchorStatus(anchor, moved)).toEqual({
      state: "moved",
      lines: "4-7",
    });
  });
  it("sees an edit, a removal and a missing file", () => {
    expect(anchorStatus(anchor, code.replace("5000", "50000")).state).toBe(
      "changed",
    );
    expect(anchorStatus(anchor, "def other():\n    pass\n").state).toBe(
      "changed",
    );
    expect(anchorStatus(anchor, undefined).state).toBe("file_missing");
    expect(anchorStatus({ file: "a.py", lines: "2-5" }, code).state).toBe(
      "unverified",
    );
  });
  it("lists the operations whose code changed", () => {
    const files = [{ path: "a.py", content: code.replace("5000", "9000") }];
    expect(
      contractDrift(contract(), files).map((item) => item.operation),
    ).toEqual(["refund"]);
    expect(
      contractDrift(contract(), [{ path: "a.py", content: code }]),
    ).toEqual([]);
  });
});

describe("contract extraction", () => {
  const file = (value: ContractFile) => ({
    path: "spec/behavior-contract.json",
    content: JSON.stringify(value),
  });
  it("is inferred and says so until a person approves it", () => {
    const { spec } = extractBehavior([file(contract())]);
    const [operation] = spec.operations;
    expect(operation?.provenance[0]).toMatchObject({
      origin: "INFERRED",
      extractionMethod: "LLM_ASSISTED",
      sourceFile: "a.py",
      sourceLines: "2-5",
    });
    expect(operation?.limitations?.join(" ")).toContain("not approved");
  });
  it("honors an approval only for the facts that were approved", () => {
    const approved = contract({ approvedBy: "pm@example.com" });
    const own = extractBehavior([file(approved)]).spec.operations[0];
    expect(own?.provenance[0]?.origin).toBe("HUMAN_APPROVED");
    // A head that changed the facts and labeled itself approved does not inherit approval.
    const rewritten = contract({
      approvedBy: "pm@example.com",
      operations: [
        {
          ...approved.operations[0],
          preconditions: ["true"],
        } as ContractFile["operations"][number],
      ],
    });
    const head = extractBehavior([file(rewritten)], {
      contractApproval: approved,
    }).spec.operations[0];
    expect(head?.provenance[0]?.origin).toBe("INFERRED");
    const same = extractBehavior([file(approved)], {
      contractApproval: approved,
    }).spec.operations[0];
    expect(same?.provenance[0]?.origin).toBe("HUMAN_APPROVED");
    const none = extractBehavior([file(approved)], { contractApproval: null })
      .spec.operations[0];
    expect(none?.provenance[0]?.origin).toBe("INFERRED");
  });
});
