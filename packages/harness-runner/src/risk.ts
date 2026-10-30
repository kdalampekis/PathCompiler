import type { AddedLine, ChangedFile, RemovedLine } from "./git.js";
import { matchesAny } from "./safety.js";

/**
 * Risk signals from a diff, whatever the language. They are heuristics over
 * paths and changed lines: they do not understand the code, they point a
 * reviewer (or a reviewing harness) at what deserves a look. A removed guard,
 * a changed constant or weakened tests make a verdict `review`; where the
 * change is (billing, authorization, data, agent prompts) is context, unless
 * you mark paths sensitive. They never make a verdict `fail`, and never `pass`.
 */
export type RiskFinding = {
  category: string;
  severity: "review" | "info";
  message: string;
  path?: string;
  line?: number;
};

const CATEGORIES: {
  category: string;
  severity: "review" | "info";
  pattern: RegExp;
}[] = [
  {
    category: "authorization",
    severity: "review",
    pattern:
      /(^|\/)(auth|authn|authz|permissions?|rbac|acl|policy|policies|roles?|access[-_]?control)([/._-]|$)/i,
  },
  {
    category: "billing",
    severity: "review",
    pattern:
      /(^|\/)(billing|payments?|invoices?|refunds?|charges?|subscriptions?|pricing|checkout|ledger|tax|payout)s?([/._-]|$)/i,
  },
  {
    category: "security",
    severity: "review",
    pattern:
      /(^|\/)(security|crypto|secrets?|tokens?|sessions?|oauth|jwt|passwords?|encrypt\w*|sanitiz\w*)([/._-]|$)/i,
  },
  {
    category: "data model",
    severity: "review",
    pattern:
      /(^|\/)(migrations?|alembic|flyway|prisma)([/._-]|$)|\.sql$|(^|\/)schema\.[a-z]+$/i,
  },
  {
    category: "public API",
    severity: "review",
    pattern: /openapi|swagger|\.proto$|\.graphql$|(^|\/)schema\.graphql$/i,
  },
  {
    category: "infrastructure",
    severity: "review",
    pattern:
      /(^|\/)(dockerfile|docker-compose[^/]*|terraform|k8s|helm|\.github|\.gitlab-ci\.yml|jenkinsfile)([/._-]|$)|\.tf$/i,
  },
  {
    category: "agent behavior",
    severity: "review",
    pattern:
      /(^|\/)(prompts?|system[-_]?prompts?|agents?|guardrails?|tools?|policies)([/._-]|$)|(system|agent|assistant)[-_]prompt/i,
  },
  {
    category: "dependencies",
    severity: "info",
    pattern:
      /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|requirements[^/]*\.txt|poetry\.lock|pyproject\.toml|go\.(mod|sum)|cargo\.(toml|lock)|pom\.xml|build\.gradle(\.kts)?|gemfile(\.lock)?|composer\.(json|lock))$/i,
  },
];
const GUARD =
  /\b(throw\s+new\b|raise\s+[A-Za-z_]|panic\(|abort\(|assert\b|unauthori[sz]ed|forbidden|permission[ _]denied|PermissionError|ValueError|IllegalArgument\w*|return\s+(?:err|Err|errors?\.New|fmt\.Errorf)\b|http[._]?40[13]\b|status\(40[13]\))/i;
const ASSERTION =
  /\b(expect\s*\(|assert\w*\s*[.(]|assert\s|self\.assert\w*|\.should\b|require\.\w+\(|t\.(Error|Fatal)\w*\()/;
const TEST_FILE =
  /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rb)$/i;

const trimmed = (text: string) => text.trim();
const numbers = (text: string) =>
  text.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
const shape = (text: string) => trimmed(text).replace(/\d+(?:\.\d+)?/g, "#");

export function analyzeRisk(input: {
  files: readonly ChangedFile[];
  added: readonly AddedLine[];
  removed: readonly RemovedLine[];
  extraSensitivePaths?: readonly string[];
}): RiskFinding[] {
  const findings: RiskFinding[] = [];
  const paths = input.files.map((item) => item.path);

  // Which parts of the product the change touches.
  const categoryPaths = new Map<string, string[]>();
  for (const path of paths)
    for (const { category, pattern } of CATEGORIES)
      if (pattern.test(path) && !TEST_FILE.test(path))
        categoryPaths.set(category, [
          ...(categoryPaths.get(category) ?? []),
          path,
        ]);
  for (const path of paths)
    if (matchesAny(path, input.extraSensitivePaths ?? []))
      categoryPaths.set("configured sensitive path", [
        ...(categoryPaths.get("configured sensitive path") ?? []),
        path,
      ]);
  for (const [category, list] of categoryPaths) {
    // Where the change is says what a reviewer should look at; it does not hold a change back
    // by itself. Paths you mark sensitive (harness.risk_paths) do.
    findings.push({
      category,
      severity: category === "configured sensitive path" ? "review" : "info",
      message: `The change touches ${category} code: ${list.slice(0, 3).join(", ")}${list.length > 3 ? ` and ${list.length - 3} more` : ""}.`,
      path: list[0] as string,
    });
  }

  // Guard-like lines that were removed and not just moved or reworded: compare lines with
  // the text of string literals taken out, so a changed error message is not a removed guard.
  const guardShape = (text: string) =>
    trimmed(text).replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "$1$1");
  const addedTexts = new Map<string, number>();
  for (const line of input.added)
    addedTexts.set(
      guardShape(line.text),
      (addedTexts.get(guardShape(line.text)) ?? 0) + 1,
    );
  const dropped = input.removed.filter((line) => {
    const text = trimmed(line.text);
    if (
      !GUARD.test(text) ||
      TEST_FILE.test(line.path) ||
      /^(\/\/|#|\*|--)/.test(text)
    )
      return false;
    const key = guardShape(line.text);
    const left = addedTexts.get(key) ?? 0;
    if (left > 0) {
      addedTexts.set(key, left - 1);
      return false;
    }
    return true;
  });
  if (dropped.length > 0)
    findings.push({
      category: "removed guard",
      severity: "review",
      message: `${dropped.length} line(s) that look like guards or error paths were removed, for example ${dropped[0]?.path}:${dropped[0]?.line} \`${trimmed(dropped[0]?.text ?? "").slice(0, 80)}\`.`,
      path: dropped[0]?.path as string,
      line: dropped[0]?.line as number,
    });

  // A number in an otherwise identical line changed: a threshold, a limit, a price.
  const removedShapes = new Map<string, RemovedLine[]>();
  for (const line of input.removed) {
    if (TEST_FILE.test(line.path)) continue;
    const key = `${line.path}\u0000${shape(line.text)}`;
    removedShapes.set(key, [...(removedShapes.get(key) ?? []), line]);
  }
  for (const line of input.added) {
    if (TEST_FILE.test(line.path)) continue;
    const key = `${line.path}\u0000${shape(line.text)}`;
    const match = removedShapes.get(key)?.shift();
    if (!match || !/#/.test(shape(line.text))) continue;
    const before = numbers(match.text);
    const after = numbers(line.text);
    if (
      before.length !== after.length ||
      before.every((value, index) => value === after[index])
    )
      continue;
    const changed = before.findIndex((value, index) => value !== after[index]);
    const from = before[changed] as number;
    const to = after[changed] as number;
    const sensitive = [...categoryPaths.values()].some((list) =>
      list.includes(line.path),
    );
    findings.push({
      category: "changed constant",
      severity: sensitive || (from !== 0 && to / from >= 2) ? "review" : "info",
      message: `${line.path}:${line.line} changes a number from ${from} to ${to}.`,
      path: line.path,
      line: line.line,
    });
  }

  // Tests weakened: fewer assertions than before.
  const removedAssertions = input.removed.filter(
    (line) => TEST_FILE.test(line.path) && ASSERTION.test(line.text),
  ).length;
  const addedAssertions = input.added.filter(
    (line) => TEST_FILE.test(line.path) && ASSERTION.test(line.text),
  ).length;
  if (removedAssertions - addedAssertions >= 2)
    findings.push({
      category: "weakened tests",
      severity: "review",
      message: `Tests lost ${removedAssertions - addedAssertions} assertion line(s) on balance (${removedAssertions} removed, ${addedAssertions} added).`,
    });
  return findings;
}
