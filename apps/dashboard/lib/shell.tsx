import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { type Project, project } from "./store";

const sections = [
  ["", "Product map"],
  ["/workflows", "Workflows"],
  ["/changes", "Pending changes"],
  ["/evidence", "Evidence"],
  ["/settings", "Settings"],
] as const;

export function requireProject(name: string): Project {
  const found = project(name);
  if (!found) notFound();
  return found;
}

export function ProjectShell(props: {
  project: Project;
  current: (typeof sections)[number][0];
  title: string;
  notice?: { message?: string | undefined; error?: string | undefined };
  children: ReactNode;
}) {
  return (
    <>
      <nav aria-label="Project sections" className="sections">
        <Link href="/">Projects</Link>
        <span aria-hidden="true">/</span>
        <strong>{props.project.name}</strong>
        {sections.map(([suffix, label]) => (
          <Link
            key={suffix}
            href={`/p/${props.project.name}${suffix}`}
            aria-current={props.current === suffix ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <h1>{props.title}</h1>
      {props.notice?.message && (
        <p role="status" className="notice">
          {props.notice.message}
        </p>
      )}
      {props.notice?.error && (
        <p role="alert" className="error">
          {props.notice.error}
        </p>
      )}
      {props.children}
    </>
  );
}

export function Missing({ command }: { command: string }) {
  return (
    <p className="empty">
      Not generated yet. Run <code>{command}</code>.
    </p>
  );
}

export const short = (commit: string | null | undefined) =>
  commit ? commit.slice(0, 12) : "—";
