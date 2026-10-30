import {
  type BehaviorSpec,
  BehaviorSpecSchema,
  type BusinessRule,
  type DataConstraint,
  formatExpression,
  type Invariant,
  type Operation,
  type Permission,
  type Provenance,
  type Variable,
} from "@pathcompiler/behavior-ir";

/**
 * Deterministic extractors read declared structure (schemas, validation
 * models, contracts, guard clauses, assertions) and produce BehaviorIR
 * fragments with provenance. They never guess: a construct they cannot model
 * is returned in `unsupported`, not dropped. Rules lifted from assertions and
 * conditions are INFERRED; only verbatim declarations are EXPLICIT.
 */
export const EXTRACTOR_VERSION = "1.0.0";
export type SourceFile = { path: string; content: string };
export type Unsupported = {
  file: string;
  /** "12" or "32-47". */
  lines?: string;
  construct: string;
  reason: string;
};
/**
 * One extracted fact with its own provenance. Operation preconditions are
 * merged into one contract, so this ledger is how a reviewer (and the
 * evaluation) can still see which source each individual rule came from.
 */
export type LedgerEntry = {
  kind:
    | "invariant"
    | "precondition"
    | "permission"
    | "business_rule"
    | "data_constraint";
  /** Canonical text: the expression, or `operation: expression`. */
  text: string;
  provenance: Provenance;
};
export type ExtractedFragment = {
  variables: Variable[];
  invariants: Invariant[];
  operations: Operation[];
  permissions: Permission[];
  businessRules: BusinessRule[];
  dataConstraints: DataConstraint[];
  ledger: LedgerEntry[];
  unsupported: Unsupported[];
};
export type ExtractionOptions = {
  /**
   * Code identifiers mapped to the entity prefix of their variables, e.g.
   * `{ payment: "payments" }` makes `payment.refundedAmount` the variable
   * `payments.refunded_amount`, the same one the SQL schema declares.
   */
  bindings?: Readonly<Record<string, string>>;
  /** Parameter names whose properties are execution context (default: actor, ctx, context, session, user). */
  contextParameters?: readonly string[];
  /** Property names that hold a role (default: role). */
  roleProperties?: readonly string[];
};

export const emptyFragment = (): ExtractedFragment => ({
  variables: [],
  invariants: [],
  operations: [],
  permissions: [],
  businessRules: [],
  dataConstraints: [],
  ledger: [],
  unsupported: [],
});

/** `RefundInput` → `refund_input`, `managerApproval` → `manager_approval`. */
export function snake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}
/** 1-based line of a character offset. */
export function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < content.length; index += 1)
    if (content[index] === "\n") line += 1;
  return line;
}
export const lineRange = (first: number, last: number) =>
  last > first ? `${first}-${last}` : String(first);
/** Number for use in a rule ID: `-5` → `m5`. */
export const numberId = (value: number) =>
  value < 0 ? `m${-value}` : String(value);

export function provenanceOf(
  input: Pick<
    Provenance,
    "sourceType" | "origin" | "extractionMethod" | "confidence"
  > & {
    file: string;
    lines?: string | undefined;
  },
): Provenance {
  return {
    sourceType: input.sourceType,
    origin: input.origin,
    extractionMethod: input.extractionMethod,
    extractorVersion: EXTRACTOR_VERSION,
    confidence: input.confidence,
    sourceFile: input.file,
    ...(input.lines ? { sourceLines: input.lines } : {}),
  };
}

/** Canonical ledger text of a permission and of a data constraint. */
export const permissionText = (item: Permission) =>
  `${item.role} ${item.effect} ${item.action}${item.constraint ? ` if ${formatExpression(item.constraint)}` : ""}`;
export const dataConstraintText = (item: DataConstraint) =>
  `${item.kind} ${item.subject}${item.references ? ` -> ${item.references}` : ""}`;

export type MergeResult = {
  spec: BehaviorSpec;
  ledger: LedgerEntry[];
  unsupported: Unsupported[];
  /** Variables declared twice with different types or scopes, and renamed duplicates. */
  conflicts: string[];
};

const sameProvenance = (a: Provenance, b: Provenance) =>
  JSON.stringify(a) === JSON.stringify(b);
const withProvenance = (
  into: readonly Provenance[],
  more: readonly Provenance[],
): Provenance[] => [
  ...into,
  ...more.filter((item) => !into.some((known) => sameProvenance(known, item))),
];

/**
 * Combines fragments into one specification.
 * - Variables merge by ID (enum values are unioned; a type or scope clash
 *   keeps the first declaration and is reported).
 * - The same operation from several sources becomes one contract: parameters
 *   and preconditions are unioned, provenance is concatenated.
 * - The same rule from several sources (an invariant a schema declares and a
 *   test asserts) is kept once with every provenance record: agreement
 *   between independent sources is the point of keeping them.
 * - A rule that does not validate (an unknown variable, a type error) is
 *   quarantined into `unsupported` with the validator's reason instead of
 *   failing the whole extraction.
 */
export function mergeFragments(
  fragments: readonly ExtractedFragment[],
  meta: { id: string; repositoryCommit: string | null },
): MergeResult {
  const conflicts: string[] = [];
  const variables = new Map<string, Variable>();
  for (const variable of fragments.flatMap((item) => item.variables)) {
    const known = variables.get(variable.id);
    if (!known) {
      variables.set(variable.id, variable);
      continue;
    }
    if (known.type !== variable.type || known.scope !== variable.scope)
      conflicts.push(
        `${variable.id} is declared as ${known.scope} ${known.type} and as ${variable.scope} ${variable.type}; the first declaration is kept.`,
      );
    else if (known.type === "enum" && variable.type === "enum") {
      const values = [...new Set([...known.values, ...variable.values])].sort();
      variables.set(variable.id, { ...known, values });
    }
  }

  const operations = new Map<string, Operation>();
  for (const operation of fragments.flatMap((item) => item.operations)) {
    const known = operations.get(operation.id);
    if (!known) {
      operations.set(operation.id, operation);
      continue;
    }
    const codeFiles = new Set(
      [...known.provenance, ...operation.provenance]
        .filter((item) => item.sourceType === "SOURCE_CODE")
        .map((item) => item.sourceFile),
    );
    if (codeFiles.size > 1)
      conflicts.push(
        `Operation ${operation.id} is defined in more than one source file (${[...codeFiles].join(", ")}); their guards were combined, which is rarely what was meant. Analyze one version at a time (--exclude).`,
      );
    const seen = new Set(known.preconditions.map(formatExpression));
    const limitations = [
      ...new Set([
        ...(known.limitations ?? []),
        ...(operation.limitations ?? []),
      ]),
    ];
    operations.set(operation.id, {
      ...known,
      description: known.description ?? operation.description,
      parameters: [...new Set([...known.parameters, ...operation.parameters])],
      preconditions: [
        ...known.preconditions,
        ...operation.preconditions.filter((item) => {
          const key = formatExpression(item);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      ],
      postconditions: [...known.postconditions, ...operation.postconditions],
      effects: known.effects.length > 0 ? known.effects : operation.effects,
      ...(limitations.length > 0 ? { limitations } : {}),
      provenance: withProvenance(known.provenance, operation.provenance),
    });
  }

  /** Same key → one rule with all provenance; different keys sharing an ID are renamed. */
  const taken = new Set<string>();
  const dedupe = <T extends { id: string; provenance: Provenance[] }>(
    items: readonly T[],
    key: (item: T) => string,
  ): T[] => {
    const byKey = new Map<string, T>();
    const result: T[] = [];
    for (const item of items) {
      const k = key(item);
      const known = byKey.get(k);
      if (known) {
        known.provenance = withProvenance(known.provenance, item.provenance);
        continue;
      }
      let id = item.id;
      for (let n = 2; taken.has(id); n += 1) id = `${item.id}_${n}`;
      if (id !== item.id)
        conflicts.push(`Rule ID ${item.id} was reused; renamed ${id}.`);
      taken.add(id);
      const copy = { ...item, id, provenance: [...item.provenance] };
      byKey.set(k, copy);
      result.push(copy);
    }
    return result;
  };
  for (const operation of operations.values()) taken.add(operation.id);
  const collections = {
    invariants: dedupe(
      fragments.flatMap((item) => item.invariants),
      (item) => formatExpression(item.expression),
    ),
    permissions: dedupe(
      fragments.flatMap((item) => item.permissions),
      (item) =>
        `${item.role}|${item.action}|${item.resource ?? ""}|${item.effect}|${item.constraint ? formatExpression(item.constraint) : ""}`,
    ),
    businessRules: dedupe(
      fragments.flatMap((item) => item.businessRules),
      (item) =>
        `${formatExpression(item.when)}|${formatExpression(item.must)}|${(item.appliesTo ?? []).join(",")}`,
    ),
    dataConstraints: dedupe(
      fragments.flatMap((item) => item.dataConstraints),
      (item) => `${item.kind}|${item.subject}|${item.references ?? ""}`,
    ),
  };
  const unsupported = fragments.flatMap((item) => item.unsupported);
  type Collection = keyof typeof collections;
  const operationList = () => [...operations.values()];
  const build = () => ({
    schemaVersion: 1 as const,
    kind: "behavior-spec" as const,
    id: meta.id,
    metadata: {
      repositoryCommit: meta.repositoryCommit,
      producer: "pathcompiler-behavior-extraction",
      producerVersion: EXTRACTOR_VERSION,
    },
    variables: [...variables.values()],
    workflows: [],
    transitions: [],
    operations: operationList(),
    invariants: collections.invariants,
    permissions: collections.permissions,
    temporalRules: [],
    dataPolicies: [],
    businessRules: collections.businessRules,
    dataConstraints: collections.dataConstraints,
  });

  const quarantined = new Set<string>();
  const ledgerKey = (key: Collection, item: object) => {
    const rule = item as Invariant & Permission & BusinessRule & DataConstraint;
    switch (key) {
      case "invariants":
        return `invariant|${formatExpression(rule.expression)}`;
      case "businessRules":
        return `business_rule|${formatExpression(rule.when)} => ${formatExpression(rule.must)}`;
      case "permissions":
        return `permission|${permissionText(rule)}`;
      case "dataConstraints":
        return `data_constraint|${dataConstraintText(rule)}`;
    }
  };
  for (let round = 0; round < 50; round += 1) {
    const result = BehaviorSpecSchema.safeParse(build());
    if (result.success) {
      const ledger = fragments
        .flatMap((item) => item.ledger)
        .filter((entry) => !quarantined.has(`${entry.kind}|${entry.text}`));
      return { spec: result.data, ledger, unsupported, conflicts };
    }
    const dropped = new Map<Collection, Set<number>>();
    for (const issue of result.error.issues) {
      const [key, index, field, position] = issue.path;
      if (typeof key !== "string" || typeof index !== "number")
        throw new Error(
          `The extracted specification is invalid: ${issue.path.join(".")}: ${issue.message}`,
        );
      if (key === "operations") {
        const operation = operationList()[index];
        if (!operation) continue;
        const first = operation.provenance[0];
        const precondition =
          field === "preconditions" && typeof position === "number"
            ? operation.preconditions[position]
            : undefined;
        // A bad precondition costs only itself; the operation stays, flagged.
        if (precondition) {
          const text = formatExpression(precondition);
          quarantined.add(`precondition|${operation.id}: ${text}`);
          unsupported.push({
            file: first?.sourceFile ?? "(unknown)",
            construct: `precondition of ${operation.id}: ${text}`,
            reason: issue.message,
          });
          operations.set(operation.id, {
            ...operation,
            preconditions: operation.preconditions.filter(
              (item) => item !== precondition,
            ),
            limitations: [
              ...(operation.limitations ?? []),
              `Precondition ${text} was dropped: ${issue.message}`,
            ],
          });
        } else
          throw new Error(
            `The extracted operation ${operation.id} is invalid: ${issue.path.join(".")}: ${issue.message}`,
          );
        continue;
      }
      if (!(key in collections))
        throw new Error(
          `The extracted specification is invalid: ${issue.path.join(".")}: ${issue.message}`,
        );
      const set = dropped.get(key as Collection) ?? new Set<number>();
      set.add(index);
      dropped.set(key as Collection, set);
      const item = collections[key as Collection][index] as {
        id: string;
        provenance: Provenance[];
      };
      quarantined.add(ledgerKey(key as Collection, item));
      const first = item.provenance[0];
      unsupported.push({
        file: first?.sourceFile ?? "(unknown)",
        ...(first?.sourceLines ? { lines: first.sourceLines } : {}),
        construct: `${key.replace(/s$/, "")} ${item.id}`,
        reason: issue.message,
      });
    }
    for (const [key, indexes] of dropped)
      (collections[key] as unknown[]) = collections[key].filter(
        (_, index) => !indexes.has(index),
      );
  }
  throw new Error("Too many invalid extracted rules to quarantine.");
}
