"use server";
import { redirect } from "next/navigation";
import { project } from "./store";

/**
 * Review actions call the same CLI commands as the terminal, so validation,
 * commit binding and never-replace rules are identical.
 */
async function run(
  projectName: string,
  back: string,
  args: (root: string) => string[],
): Promise<never> {
  const target = project(projectName);
  if (!target) redirect("/");
  let message: string;
  let failed = false;
  try {
    // Load the CLI at runtime from node_modules instead of bundling its scanners.
    const { runCli } = (await import(
      /* turbopackIgnore: true */ "@pathcompiler/cli"
    )) as typeof import("@pathcompiler/cli");
    message =
      (
        await runCli([...args(target.root), "--out", target.out], target.root)
      ).split("\n")[0] ?? "Done.";
  } catch (error) {
    failed = true;
    message = error instanceof Error ? error.message : "The action failed.";
  }
  redirect(
    `${back}?${new URLSearchParams({ [failed ? "error" : "message"]: message })}`,
  );
}

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};
const reviewer = (form: FormData) =>
  field(form, "reviewer") || process.env.PATHCOMPILER_USER || "";
const reason = (form: FormData) => {
  const value = field(form, "reason");
  return value ? ["--reason", value] : [];
};

export async function approveWorkflow(form: FormData) {
  const projectName = field(form, "project");
  const id = field(form, "id");
  return run(projectName, `/p/${projectName}/workflows/${id}`, (root) => [
    "workflows",
    "approve",
    id,
    root,
    "--by",
    reviewer(form),
  ]);
}

export async function rejectWorkflow(form: FormData) {
  const projectName = field(form, "project");
  const id = field(form, "id");
  return run(projectName, `/p/${projectName}/workflows/${id}`, () => [
    "workflows",
    "reject",
    id,
    "--by",
    reviewer(form),
    ...reason(form),
  ]);
}

export async function decideProposal(form: FormData) {
  const projectName = field(form, "project");
  const name = field(form, "name");
  const decision = field(form, "decision");
  if (!["accept", "reject", "ignore"].includes(decision))
    redirect(`/p/${projectName}/changes`);
  return run(projectName, `/p/${projectName}/changes`, (root) => [
    "proposals",
    decision,
    name,
    ...(decision === "accept" && field(form, "kind") === "update"
      ? [root]
      : []),
    "--by",
    reviewer(form),
    ...reason(form),
  ]);
}
