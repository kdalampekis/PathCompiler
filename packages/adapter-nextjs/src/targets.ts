import type { ProductGraph } from "@pathcompiler/graph-core";
import {
  compareText,
  RelativePathSchema,
  SourceProjectSchema,
} from "@pathcompiler/source-model";
import ts from "typescript";
import { z } from "zod";
import { attribute, unwrap, visit } from "./ast.js";

export const SemanticTargetIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
export const TargetEvidenceSchema = z.strictObject({
  source: z.enum(["annotation", "test-id", "accessible", "unresolved"]),
  semanticId: SemanticTargetIdSchema.optional(),
  testId: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1),
  issues: z.array(z.string()),
});
export type TargetEvidence = z.infer<typeof TargetEvidenceSchema>;
const ProvenanceSchema = z.strictObject({
  file: RelativePathSchema,
  locator: z.string().min(1),
  repositoryCommit: z.string().nullable(),
});
export const TargetReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  repository: SourceProjectSchema.shape.repository,
  diagnostics: SourceProjectSchema.shape.diagnostics,
  targets: z.array(
    z.strictObject({
      nodeId: z.string().min(1),
      file: RelativePathSchema,
      locator: z.string().min(1),
      evidence: z.array(ProvenanceSchema).min(1),
      target: TargetEvidenceSchema,
      suggestedTarget: SemanticTargetIdSchema.nullable(),
    }),
  ),
});
export type TargetReport = z.infer<typeof TargetReportSchema>;

type Element = ts.JsxOpeningLikeElement;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
function literal(node: ts.Expression | undefined): string | undefined {
  const value = node && unwrap(node);
  return value && ts.isStringLiteralLike(value) ? value.text : undefined;
}
function has(element: Element, name: string): boolean {
  return element.attributes.properties.some(
    (prop) => ts.isJsxAttribute(prop) && prop.name.getText() === name,
  );
}
/** Only trust an attribute when no later spread can replace it. */
function value(element: Element, name: string): string | undefined {
  for (const prop of [...element.attributes.properties].reverse()) {
    if (ts.isJsxSpreadAttribute(prop)) return;
    if (ts.isJsxAttribute(prop) && prop.name.getText() === name) {
      const initializer = prop.initializer;
      return literal(
        initializer && ts.isJsxExpression(initializer)
          ? initializer.expression
          : initializer,
      );
    }
  }
  return;
}

// ponytail: conservative source evidence, not a browser accessibility-tree implementation.
// Unknown expressions/custom children invalidate a name; runtime checks belong to guidance.
function content(node: ts.JsxElement, skip?: ts.Node): string | undefined {
  let text = "";
  for (const child of node.children) {
    if (child === skip) continue;
    if (ts.isJsxText(child)) text += child.text;
    else if (ts.isJsxExpression(child)) {
      if (!child.expression) continue;
      const part = literal(child.expression);
      if (part === undefined) return;
      text += part;
    } else if (
      ts.isJsxElement(child) &&
      /^[a-z]/.test(child.openingElement.tagName.getText())
    ) {
      if (
        has(child.openingElement, "aria-hidden") ||
        has(child.openingElement, "hidden")
      )
        return;
      const part = content(child, skip);
      if (part === undefined) return;
      text += part;
    } else return;
  }
  return normalize(text) || undefined;
}
function implicitRole(node: Element, link: boolean): string | undefined {
  const tag = node.tagName.getText();
  if (has(node, "role")) return value(node, "role");
  if (link && attribute(node, "href")) return "link";
  if (tag === "button") return "button";
  if (tag === "textarea") return "textbox";
  if (tag === "dialog") return "dialog";
  if (tag === "select")
    return has(node, "multiple") || has(node, "size") ? undefined : "combobox";
  if (tag !== "input") return;
  const type = has(node, "type") ? value(node, "type") : "text";
  if (["text", "email", "tel", "url"].includes(type ?? "")) return "textbox";
  if (type === "search") return "searchbox";
  if (type === "number") return "spinbutton";
  if (type === "checkbox" || type === "radio") return type;
  if (["button", "submit", "reset"].includes(type ?? "")) return "button";
  return;
}

export function createTargetAnalyzer(sources: ts.SourceFile[]) {
  const annotations = new Map<string, number>();
  const elements = new Map<ts.SourceFile, Element[]>();
  for (const source of sources) {
    const list: Element[] = [];
    visit(source, (node) => {
      if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))
        return;
      list.push(node);
      const id = literal(attribute(node, "data-pathcompiler"));
      if (id !== undefined) annotations.set(id, (annotations.get(id) ?? 0) + 1);
    });
    elements.set(source, list);
  }
  function accessibleName(
    node: Element,
    role: string | undefined,
  ): string | undefined {
    const peers = elements.get(node.getSourceFile()) ?? [];
    if (has(node, "aria-labelledby")) {
      const ids = value(node, "aria-labelledby")?.trim().split(/\s+/);
      if (!ids?.length) return;
      const names: string[] = [];
      for (const id of ids) {
        const matches = peers.filter((peer) => value(peer, "id") === id);
        const label = matches[0];
        if (
          matches.length !== 1 ||
          !label ||
          !ts.isJsxOpeningElement(label) ||
          !ts.isJsxElement(label.parent)
        )
          return;
        const text = content(label.parent);
        if (!text) return;
        names.push(text);
      }
      return normalize(names.join(" "));
    }
    if (has(node, "aria-label"))
      return normalize(value(node, "aria-label") ?? "") || undefined;
    if (["input", "select", "textarea"].includes(node.tagName.getText())) {
      const id = value(node, "id");
      const labels = id
        ? peers.filter(
            (peer) =>
              peer.tagName.getText() === "label" &&
              value(peer, "htmlFor") === id,
          )
        : [];
      if (labels.length) {
        const names = labels.map((label) =>
          ts.isJsxElement(label.parent) ? content(label.parent) : undefined,
        );
        return names.every((name) => name !== undefined)
          ? normalize(names.join(" "))
          : undefined;
      }
      const control = ts.isJsxOpeningElement(node) ? node.parent : node;
      let ancestor = control.parent;
      while (ancestor && !ts.isSourceFile(ancestor)) {
        if (
          ts.isJsxElement(ancestor) &&
          ancestor.openingElement.tagName.getText() === "label"
        )
          return content(ancestor, control);
        ancestor = ancestor.parent;
      }
    }
    if (
      ["button", "link", "checkbox", "radio"].includes(role ?? "") &&
      ts.isJsxOpeningElement(node) &&
      ts.isJsxElement(node.parent)
    )
      return content(node.parent);
    return;
  }
  return (node: Element, link: boolean): TargetEvidence => {
    const issues: string[] = [];
    const raw = literal(attribute(node, "data-pathcompiler"));
    const explicit = value(node, "data-pathcompiler");
    // Native JSX and Next Link forward DOM attributes; arbitrary components may not.
    const dom =
      (ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text)) ||
      link;
    let semanticId: string | undefined;
    if (has(node, "data-pathcompiler")) {
      if (!raw || !SemanticTargetIdSchema.safeParse(raw).success)
        issues.push(
          "Use a literal data-pathcompiler ID starting with a letter and containing only letters, digits, _, ., : or -.",
        );
      else if ((annotations.get(raw) ?? 0) > 1)
        issues.push(
          `Duplicate annotation '${raw}': give distinct source declarations distinct target IDs.`,
        );
      else if (!dom)
        issues.push(
          "Annotate the underlying DOM element; custom component attribute forwarding is not verified.",
        );
      else if (explicit !== raw)
        issues.push(
          "A later JSX spread may override data-pathcompiler; place the annotation after all spreads.",
        );
      else semanticId = raw;
    }
    const testId = dom ? value(node, "data-testid") : undefined;
    const accessible =
      dom && !node.attributes.properties.some(ts.isJsxSpreadAttribute);
    const role = accessible ? implicitRole(node, link) : undefined;
    const name = accessible ? accessibleName(node, role) : undefined;
    const source = semanticId
      ? "annotation"
      : testId
        ? "test-id"
        : role && name
          ? "accessible"
          : "unresolved";
    return TargetEvidenceSchema.parse({
      source,
      ...(semanticId ? { semanticId } : {}),
      ...(testId ? { testId } : {}),
      ...(role ? { role } : {}),
      ...(name ? { name } : {}),
      confidence: semanticId ? 1 : testId ? 0.8 : role && name ? 0.6 : 0,
      issues,
    });
  };
}

function slug(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

/** Suggestions are reviewable build-time evidence, never an automatic source edit. */
export function suggestTargets(result: {
  graph: ProductGraph;
  summary: {
    repository: z.infer<typeof SourceProjectSchema.shape.repository>;
    diagnostics: z.infer<typeof SourceProjectSchema.shape.diagnostics>;
  };
}): TargetReport {
  const targets = result.graph
    .nodesByType("UIAction")
    .filter((node) => node.data?.target !== undefined)
    .map((node) => {
      const target = TargetEvidenceSchema.parse(node.data?.target);
      const evidence = z
        .array(ProvenanceSchema)
        .min(1)
        .parse(node.data?.evidence);
      const first = evidence[0];
      if (!first) throw new Error(`Missing target provenance: ${node.id}`);
      return {
        nodeId: node.id,
        file: first.file,
        locator: first.locator,
        evidence,
        target,
        suggestedTarget: null as string | null,
      };
    })
    .sort((a, b) => compareText(a.nodeId, b.nodeId));
  const used = new Set(
    targets.flatMap((item) =>
      item.target.semanticId ? [item.target.semanticId] : [],
    ),
  );
  for (const item of targets) {
    if (item.target.semanticId || item.target.issues.length) continue;
    const hint = item.target.testId ?? item.target.name;
    if (!hint || item.target.source === "unresolved") continue;
    const owner = item.locator.split("#")[1]?.split(":")[0] ?? "target";
    const base = `${slug(owner) || "target"}.${slug(hint) || "action"}`;
    const validBase = /^[a-z]/.test(base) ? base : `target.${base}`;
    let candidate = validBase;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${validBase}.${suffix++}`;
    used.add(candidate);
    item.suggestedTarget = candidate;
  }
  return TargetReportSchema.parse({
    schemaVersion: 1,
    repository: result.summary.repository,
    diagnostics: result.summary.diagnostics,
    targets,
  });
}
