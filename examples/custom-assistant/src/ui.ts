// The assistant's own presentation layer; no PathCompiler UI or React package.
import type { Answer } from "./assistant.ts";

export type Card = {
  heading: string;
  body: string[];
  buttons: string[];
};

/** Turns the structured answer into the assistant's own card view model. */
export function toCard(answer: Answer): Card {
  const body = [answer.text];
  if (answer.workflow) {
    body.push(
      ...answer.workflow.steps.map(
        (step, index) => `${index + 1}. ${step.text}`,
      ),
    );
    body.push(`Done when ${answer.workflow.completion}.`);
  }
  if (answer.help?.type === "ambiguous")
    body.push(
      ...answer.help.candidates.map((candidate) => `• ${candidate.title}`),
    );
  const buttons: string[] = [];
  if (answer.actions?.navigate && answer.help?.type === "workflow_help")
    buttons.push(`Open ${answer.help.entrypoint?.route ?? ""}`.trim());
  if (answer.actions?.guide) buttons.push("Show me");
  if (answer.actions?.checklist) buttons.push("Checklist");
  return {
    heading:
      answer.help?.type === "workflow_help"
        ? answer.help.content.title
        : "Assistant",
    body,
    buttons,
  };
}

export function renderTerminal(card: Card): string {
  const width =
    Math.max(card.heading.length, ...card.body.map((line) => line.length)) + 4;
  const rule = `+${"-".repeat(width - 2)}+`;
  const line = (text: string) => `| ${text.padEnd(width - 4)} |`;
  return [
    rule,
    line(card.heading),
    rule,
    ...card.body.map(line),
    ...(card.buttons.length
      ? [rule, line(card.buttons.map((button) => `[${button}]`).join(" "))]
      : []),
    rule,
  ].join("\n");
}
