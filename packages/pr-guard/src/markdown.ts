import type { Finding, PrGuardReport } from "./guard.js";

const ICON = { fail: "✗", review: "⚠", info: "·" } as const;
const TITLE = {
  fail: "Blocked: a business rule is newly violated",
  review: "Needs review",
  pass: "No encoded rule is newly violated",
} as const;

function counterexample(finding: Finding): string[] {
  const cex = finding.counterexample;
  if (!cex) return [];
  const show = (values: Record<string, unknown>) =>
    Object.entries(values)
      .map(([id, value]) => `${id}=${JSON.stringify(value)}`)
      .join(", ") || "-";
  return [
    "",
    `  Counterexample (re-evaluated and ${cex.replayed ? "confirmed" : "not confirmed"}), operation \`${cex.operation}\`:`,
    "",
    "  ```",
    `  inputs:  ${show(cex.inputs)}`,
    `  context: ${show(cex.context)}`,
    `  state:   ${show(cex.state)}`,
    ...(cex.after ? [`  after:   ${show(cex.after)}`] : []),
    "  ```",
  ];
}

/** A pull-request comment: verdict, findings, the behavior that changed, and how far to trust it. */
export function formatPrGuardMarkdown(report: PrGuardReport): string {
  const label = (side: PrGuardReport["base"]) =>
    side.ref ?? (side.commit ? side.commit.slice(0, 12) : "version");
  const lines = [
    `### PathCompiler behavior check: ${TITLE[report.verdict]}`,
    "",
    `${label(report.base)} → ${label(report.head)}: ${report.head.summary.VERIFIED} properties verified, ${report.head.summary.VIOLATED} violated, ${report.head.summary.UNKNOWN} unknown, ${report.head.summary.UNSUPPORTED} unsupported.`,
  ];
  const important = report.findings.filter((item) => item.severity !== "info");
  if (important.length > 0) {
    lines.push("");
    for (const finding of important) {
      lines.push(`- ${ICON[finding.severity]} ${finding.message}`);
      if (finding.rule)
        lines.push(
          `  Rule \`${finding.rule.id}\`: \`${finding.rule.text}\` (${finding.rule.humanBacked ? "human-approved" : "extracted candidate"}, ${finding.rule.confidence} confidence).`,
        );
      lines.push(...counterexample(finding));
    }
  }
  const infos = report.findings.filter((item) => item.severity === "info");
  if (infos.length > 0) {
    lines.push("", ...infos.map((item) => `- ${ICON.info} ${item.message}`));
  }
  if (report.diff.changed) {
    lines.push("", "Behavior that changed:");
    for (const change of report.diff.operations) {
      const relation = change.preconditions.relation
        ? ` (${change.preconditions.relation})`
        : "";
      lines.push(`- \`${change.operation}\` ${change.status}${relation}`);
      for (const item of change.preconditions.removed)
        lines.push(`  - no longer requires \`${item}\``);
      for (const item of change.preconditions.added)
        lines.push(`  - now requires \`${item}\``);
      for (const item of change.effects.removed)
        lines.push(`  - no longer does \`${item}\``);
      for (const item of change.effects.added)
        lines.push(`  - now does \`${item}\``);
    }
    for (const [name, change] of [
      ["invariant", report.diff.invariants],
      ["rule", report.diff.businessRules],
      ["permission", report.diff.permissions],
    ] as const) {
      for (const item of change.removed)
        lines.push(`- removed ${name} \`${item}\``);
      for (const item of change.added)
        lines.push(`- added ${name} \`${item}\``);
    }
  }
  lines.push(
    "",
    "<sub>",
    ...report.caveats.map((item) => `${item}  `),
    "</sub>",
  );
  return `${lines.join("\n")}\n`;
}
