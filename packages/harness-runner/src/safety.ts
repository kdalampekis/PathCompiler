import type { AddedLine, ChangedFile } from "./git.js";

/**
 * The harness safety rules (handoff §47) that can be enforced mechanically on
 * a candidate's diff. A harness cannot reach secrets, the evaluation
 * contracts, CI or the PathCompiler configuration through a change, and a
 * candidate that adds a secret is discarded, not committed.
 *
 * What a diff cannot show — a billing rule changed without a task asking for
 * it, a security check weakened — is covered by the behavior check (approved
 * rules still hold) and by the evaluation's permission-boundary comparison,
 * not here.
 */
export const BUILTIN_PROTECTED_PATHS = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa*",
  "**/secrets/**",
  "pathcompiler.yaml",
  ".pathcompiler/**",
  ".github/workflows/**",
  "**/approved-rules*.json",
];

/** `**` crosses directories, `*` and `?` do not. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] as string;
    if (char === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        if (glob[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else source += ".*";
      } else source += "[^/]*";
    } else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}
export const matchesAny = (path: string, globs: readonly string[]) =>
  globs.some((glob) => globToRegExp(glob).test(path));

const SECRET_PATTERNS: [string, RegExp][] = [
  ["a private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["an AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["an API key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/],
  [
    "a hard-coded credential",
    /\b(?:api[_-]?key|secret|token|passwd|password)\b\s*[:=]\s*["'][^"'\s]{12,}["']/i,
  ],
];
/** Text with anything secret-looking replaced, for logs. */
export function redactSecretsInText(text: string): string {
  let result = text;
  for (const [, pattern] of SECRET_PATTERNS)
    result = result.replace(
      new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`),
      "[redacted]",
    );
  return result;
}

export type SafetyFinding = {
  rule: "protected_path" | "secret" | "tests_deleted";
  /** `block`: the candidate is discarded. `warn`: it goes to review. */
  severity: "block" | "warn";
  path: string;
  line?: number;
  detail: string;
};

export function checkSafety(input: {
  files: readonly ChangedFile[];
  added: readonly AddedLine[];
  protectedPaths: readonly string[];
}): SafetyFinding[] {
  const protectedGlobs = [...BUILTIN_PROTECTED_PATHS, ...input.protectedPaths];
  const findings: SafetyFinding[] = [];
  for (const file of input.files) {
    if (matchesAny(file.path, protectedGlobs))
      findings.push({
        rule: "protected_path",
        severity: "block",
        path: file.path,
        detail: `${file.path} is protected: a harness may not change secrets, CI, the evaluation contracts or PathCompiler's configuration.`,
      });
    if (
      file.status === "D" &&
      /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(file.path)
    )
      findings.push({
        rule: "tests_deleted",
        severity: "warn",
        path: file.path,
        detail: `${file.path}, a test file, was deleted.`,
      });
  }
  for (const line of input.added)
    for (const [name, pattern] of SECRET_PATTERNS)
      if (pattern.test(line.text)) {
        findings.push({
          rule: "secret",
          severity: "block",
          path: line.path,
          line: line.line,
          detail: `${line.path}:${line.line} adds ${name}.`,
        });
        break;
      }
  return findings;
}
