import {
  createEdgeId,
  createNodeId,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
  type NodeType,
  ProductGraph,
} from "@pathcompiler/graph-core";
import {
  type AnalysisDiagnostic,
  compareText,
  readSourceProject,
  SourceProjectSchema,
} from "@pathcompiler/source-model";
import ts from "typescript";
import { z } from "zod";
import {
  attribute,
  hasDirective,
  importOrigin,
  isGlobalFetch,
  isNavigation,
  objectValue,
  strings,
  visit,
} from "./ast.js";
import { createSourceProgram } from "./program.js";
import { discoverRoute, matchesRoute } from "./routes.js";
import { createTargetAnalyzer } from "./targets.js";

export { discoverRoute } from "./routes.js";
export {
  SemanticTargetIdSchema,
  suggestTargets,
  type TargetEvidence,
  TargetEvidenceSchema,
  type TargetReport,
  TargetReportSchema,
} from "./targets.js";

export const ScanSummarySchema = z.strictObject({
  schemaVersion: z.literal(1),
  framework: z.literal("nextjs-app-router"),
  repository: SourceProjectSchema.shape.repository,
  filesAnalyzed: z.number().int().nonnegative(),
  nodes: z.number().int().nonnegative(),
  edges: z.number().int().nonnegative(),
  nodeCounts: z.record(z.string(), z.number().int().nonnegative()),
  diagnostics: SourceProjectSchema.shape.diagnostics,
});
export type ScanSummary = z.infer<typeof ScanSummarySchema>;
export type ScanResult = { graph: ProductGraph; summary: ScanSummary };

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction;
type FunctionRecord = {
  node: FunctionNode;
  id: string;
  name: string;
  file: string;
  symbol: ts.Symbol | undefined;
  component: string | undefined;
  exported: boolean;
  serverAction: boolean;
};
type Transport = { url: number; method: number | string };
const methods = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

/** Framework-specific deterministic facts. No model calls, execution, source retention or timestamps. */
export function analyzeNextProject(input: unknown): ScanResult {
  const project = SourceProjectSchema.parse(input);
  project.files.sort((a, b) => compareText(a.path, b.path));
  const diagnostics: AnalysisDiagnostic[] = [...project.diagnostics];
  const appDirectory = project.files.some((file) =>
    file.path.startsWith("app/"),
  )
    ? "app"
    : "src/app";
  if (!project.files.some((file) => discoverRoute(file.path, appDirectory)))
    throw new Error(
      "No supported Next.js App Router page or route files found in app/ or src/app/",
    );
  const { program, resolve, relative } = createSourceProgram(
    project,
    diagnostics,
  );
  const checker = program.getTypeChecker();
  const sourceFiles = project.files
    .map((file) =>
      program
        .getSourceFiles()
        .find((source) => relative(source.fileName) === file.path),
    )
    .filter((file): file is ts.SourceFile => file !== undefined);
  const analyzeTarget = createTargetAnalyzer(sourceFiles);
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const records: FunctionRecord[] = [];
  const byNode = new Map<ts.Node, FunctionRecord>();
  const bySymbol = new Map<ts.Symbol, FunctionRecord>();
  const exportsByFile = new Map<string, Map<string, FunctionRecord>>();
  const routes = new Map<string, string>();
  const apis: { path: string; method: string; id: string }[] = [];
  const evidence = (file: string, locator = file) => ({
    file,
    locator,
    repositoryCommit: project.repository.commit,
  });

  function addNode(
    type: NodeType,
    locator: string,
    data: NonNullable<GraphNode["data"]>,
  ): string {
    const id = createNodeId(type, locator);
    const existing = nodes.get(id);
    if (existing) {
      const oldEvidence = Array.isArray(existing.data?.evidence)
        ? existing.data.evidence
        : [];
      const newEvidence = Array.isArray(data.evidence) ? data.evidence : [];
      const merged = [
        ...new Map(
          [...oldEvidence, ...newEvidence].map((item) => [
            JSON.stringify(item),
            item,
          ]),
        ).values(),
      ];
      existing.data = { ...existing.data, ...data, evidence: merged };
    } else nodes.set(id, { id, type, data });
    return id;
  }
  function edge(
    type: EdgeType,
    source: string,
    target: string,
    file: string,
    confidence = 1,
  ): void {
    const id = createEdgeId(type, source, target);
    const previous = edges.get(id);
    const sources = Array.isArray(previous?.data?.evidence)
      ? previous.data.evidence
      : [];
    const item = evidence(file, source);
    if (
      !sources.some((value) => JSON.stringify(value) === JSON.stringify(item))
    )
      sources.push(item);
    edges.set(id, {
      id,
      type,
      source,
      target,
      data: { evidence: sources, confidence, heuristic: confidence < 1 },
    });
  }
  function warn(code: string, file: string, message: string): void {
    diagnostics.push({ code, file, message });
  }
  function target(node: ts.Node): FunctionRecord | undefined {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    return symbol
      ? (bySymbol.get(symbol) ??
          symbol.declarations
            ?.map((declaration) => byNode.get(declaration))
            .find((record) => record !== undefined))
      : undefined;
  }

  const repository = addNode("Repository", ".", {
    ...project.repository,
    framework: "nextjs-app-router",
  });
  for (const source of sourceFiles) {
    const file = relative(source.fileName);
    const fileId = addNode("File", file, {
      path: file,
      evidence: [evidence(file)],
      confidence: 1,
    });
    edge("CONTAINS", repository, fileId, file);
    const names = new Map<string, number>();
    function discover(node: ts.Node, parentName = ""): void {
      let scope = parentName;
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isArrowFunction(node) ||
          ts.isFunctionExpression(node)) &&
        node.body
      ) {
        const declaration =
          ts.isVariableDeclaration(node.parent) ||
          ts.isExportAssignment(node.parent)
            ? node.parent
            : node;
        const identifier = "name" in declaration ? declaration.name : undefined;
        let name =
          identifier && ts.isIdentifier(identifier)
            ? identifier.text
            : undefined;
        if (
          !name &&
          ts.isExportAssignment(declaration) &&
          !declaration.isExportEquals
        )
          name = "default";
        if (
          !name &&
          ts.isFunctionDeclaration(node) &&
          node.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
          )
        )
          name = "default";
        if (name) {
          const base = parentName ? `${parentName}.${name}` : name;
          const occurrence = (names.get(base) ?? 0) + 1;
          names.set(base, occurrence);
          scope = occurrence === 1 ? base : `${base}[${occurrence}]`;
          const symbol = identifier
            ? checker.getSymbolAtLocation(identifier)
            : checker.getSymbolAtLocation(node);
          let jsx = false;
          visit(node.body, (child) => {
            if (
              ts.isJsxElement(child) ||
              ts.isJsxSelfClosingElement(child) ||
              ts.isJsxFragment(child)
            )
              jsx = true;
          });
          const component =
            jsx && (/^[A-Z]/.test(name) || name === "default")
              ? createNodeId("Component", `${file}#${scope}`)
              : undefined;
          const record = {
            node,
            id: createNodeId("Symbol", `${file}#${scope}`),
            name: scope,
            file,
            symbol,
            component,
            exported: false,
            serverAction:
              ts.isBlock(node.body) && hasDirective(node.body, "use server"),
          };
          records.push(record);
          byNode.set(node, record);
          byNode.set(declaration, record);
          if (symbol) bySymbol.set(symbol, record);
        }
      }
      ts.forEachChild(node, (child) => discover(child, scope));
    }
    discover(source);
  }
  for (const source of sourceFiles) {
    const file = relative(source.fileName);
    const module = checker.getSymbolAtLocation(source);
    const exports = new Map<string, FunctionRecord>();
    for (const symbol of module ? checker.getExportsOfModule(module) : []) {
      const actual =
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const record =
        bySymbol.get(actual) ??
        actual.declarations
          ?.map((declaration) => byNode.get(declaration))
          .find((item) => item !== undefined);
      if (!record) continue;
      record.exported = true;
      record.serverAction ||= hasDirective(source, "use server");
      exports.set(symbol.name, record);
    }
    exportsByFile.set(file, exports);
  }
  for (const record of records) {
    const data = {
      name: record.name,
      file: record.file,
      exported: record.exported,
      kind: /^use[A-Z0-9]/.test(record.name.split(".").at(-1) ?? "")
        ? "hook"
        : "function",
      serverAction: record.serverAction,
      evidence: [evidence(record.file, `${record.file}#${record.name}`)],
      confidence: 1,
    };
    addNode("Symbol", `${record.file}#${record.name}`, data);
    edge("CONTAINS", createNodeId("File", record.file), record.id, record.file);
    if (record.component) {
      addNode("Component", `${record.file}#${record.name}`, {
        ...data,
        confidence: 0.9,
        heuristic: true,
      });
      edge("IMPLEMENTS", record.id, record.component, record.file, 0.9);
    }
    if (record.serverAction) {
      const endpoint = addNode(
        "APIEndpoint",
        `ACTION:${record.file}#${record.name}`,
        { method: "ACTION", ...data },
      );
      edge("HANDLES", record.id, endpoint, record.file);
    }
  }
  for (const source of sourceFiles) {
    const file = relative(source.fileName);
    if (/\/\(\.{1,3}\)/.test(file))
      warn(
        "intercepted-route",
        file,
        "Intercepting route semantics are not resolved in Phase 1.",
      );
    const route = discoverRoute(file, appDirectory);
    if (!route) continue;
    const exports = exportsByFile.get(file);
    if (route.kind === "page") {
      const id = addNode("Route", route.path, {
        path: route.path,
        evidence: [evidence(file)],
        confidence: 1,
      });
      routes.set(route.path, id);
      edge("CONTAINS", createNodeId("File", file), id, file);
      const component = exports?.get("default")?.component;
      if (component) edge("RENDERS", id, component, file);
    } else {
      for (const [method, handler] of exports ?? []) {
        if (!methods.has(method)) continue;
        const id = addNode("APIEndpoint", `${method}:${route.path}`, {
          method,
          path: route.path,
          evidence: [evidence(file)],
          confidence: 1,
        });
        apis.push({ path: route.path, method, id });
        edge("CONTAINS", createNodeId("File", file), id, file);
        edge("HANDLES", handler.id, id, file);
      }
    }
  }

  const transports = new Map<FunctionRecord, Transport>();
  for (const record of records) {
    const calls: ts.CallExpression[] = [];
    if (record.node.body)
      visit(record.node.body, (node) => {
        if (ts.isCallExpression(node) && isGlobalFetch(node, checker))
          calls.push(node);
      });
    const call = calls[0];
    if (calls.length !== 1 || !call) continue;
    const valueSymbol = (expression: ts.Node) =>
      ts.isShorthandPropertyAssignment(expression.parent)
        ? checker.getShorthandAssignmentValueSymbol(expression.parent)
        : checker.getSymbolAtLocation(expression);
    const parameterIndex = (expression: ts.Expression | undefined) =>
      record.node.parameters.findIndex(
        (parameter) =>
          expression !== undefined &&
          checker.getSymbolAtLocation(parameter.name) ===
            valueSymbol(expression),
      );
    const url = parameterIndex(call.arguments[0]);
    if (url < 0) continue;
    const options = call.arguments[1];
    if (
      options &&
      (!ts.isObjectLiteralExpression(options) ||
        options.properties.some(ts.isSpreadAssignment))
    )
      continue;
    const methodExpression = objectValue(call.arguments[1], "method");
    const methodIndex = parameterIndex(methodExpression);
    const literalMethods = strings(methodExpression);
    const method =
      methodIndex >= 0
        ? methodIndex
        : methodExpression
          ? literalMethods.length === 1
            ? literalMethods[0]
            : undefined
          : "GET";
    if (method !== undefined) transports.set(record, { url, method });
  }

  function navigate(
    expression: ts.Expression | undefined,
    owner: string,
    file: string,
  ): void {
    const urls = strings(expression);
    if (!urls.length) {
      warn(
        "dynamic-navigation",
        file,
        "Navigation destination is not a literal or supported template.",
      );
      return;
    }
    for (const url of urls) {
      if (!url.startsWith("/") || url.startsWith("//")) continue;
      const matches = [...routes].filter(([route]) => matchesRoute(url, route));
      if (!matches.length)
        warn(
          "unresolved-navigation",
          file,
          "A local navigation destination has no discovered page route.",
        );
      for (const [, id] of matches)
        edge(
          "NAVIGATES_TO",
          owner,
          id,
          file,
          url.includes("__dynamic__") || matches.length > 1 ? 0.75 : 1,
        );
    }
  }
  function apiCalls(
    urlExpression: ts.Expression | undefined,
    methodNames: string[],
    owner: string,
    file: string,
    viaWrapper: boolean,
  ): void {
    const urls = strings(urlExpression);
    if (!urls.length || !methodNames.length) {
      warn(
        "dynamic-api-call",
        file,
        "Request URL or HTTP method cannot be resolved statically.",
      );
      return;
    }
    for (const url of urls) {
      if (!url.startsWith("/") || url.startsWith("//")) continue;
      const matches = apis.filter(
        (api) =>
          methodNames
            .map((method) => method.toUpperCase())
            .includes(api.method) && matchesRoute(url, api.path),
      );
      if (!matches.length)
        warn(
          "unresolved-api-call",
          file,
          "A local request has no matching discovered API handler.",
        );
      for (const api of matches)
        edge(
          "CALLS_API",
          owner,
          api.id,
          file,
          viaWrapper || url.includes("__dynamic__") || matches.length > 1
            ? 0.75
            : 1,
        );
    }
  }

  for (const source of sourceFiles) {
    const file = relative(source.fileName);
    const fileId = createNodeId("File", file);
    const occurrences = new Map<string, number>();
    for (const statement of source.statements) {
      if (
        (!ts.isImportDeclaration(statement) &&
          !ts.isExportDeclaration(statement)) ||
        !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const name = statement.moduleSpecifier.text;
      const resolved = resolve(name, source.fileName);
      if (
        resolved &&
        nodes.has(createNodeId("File", relative(resolved.resolvedFileName)))
      )
        edge(
          "IMPORTS",
          fileId,
          createNodeId("File", relative(resolved.resolvedFileName)),
          file,
        );
      else if (
        (name.startsWith(".") || name.startsWith("@/")) &&
        !/\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|ico|woff2?)$/.test(
          name,
        )
      )
        warn(
          "unresolved-import",
          file,
          "A local import is excluded, unsupported, or outside the scan root.",
        );
    }
    function extract(node: ts.Node, owner?: FunctionRecord): void {
      const current = byNode.get(node) ?? owner;
      const ownerId = current?.component ?? current?.id ?? fileId;
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source).replace(/\s/g, "");
        const rendered = target(node.tagName);
        if (rendered?.component)
          edge("RENDERS", ownerId, rendered.component, file);
        const events = node.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((prop) => prop.name.getText())
          .filter((name) => /^on[A-Z]/.test(name) || name === "action")
          .sort(compareText);
        const link =
          tag === "a" ||
          importOrigin(node.tagName, checker)?.module === "next/link";
        if (
          ["button", "form", "input", "select", "textarea"].includes(tag) ||
          link ||
          events.length ||
          attribute(node, "role") ||
          node.attributes.properties.some(
            (prop) =>
              ts.isJsxAttribute(prop) &&
              ["data-pathcompiler", "data-testid"].includes(
                prop.name.getText(),
              ),
          )
        ) {
          const base = `${current?.name ?? "module"}:${tag}`;
          const index = (occurrences.get(base) ?? 0) + 1;
          occurrences.set(base, index);
          const locator = `${file}#${base}[${index}]`;
          const targetEvidence = analyzeTarget(node, link);
          for (const issue of targetEvidence.issues)
            warn("semantic-target", file, `${locator}: ${issue}`);
          const label = targetEvidence.name;
          const action = addNode(
            "UIAction",
            targetEvidence.semanticId ?? locator,
            {
              target: z.json().parse(targetEvidence),
              tag,
              events,
              kind: link
                ? "navigate"
                : tag === "form"
                  ? "submit"
                  : ["input", "select", "textarea"].includes(tag)
                    ? "input"
                    : tag === "button" || events.length
                      ? "click"
                      : "observe",
              ...(label ? { label } : {}),
              evidence: [evidence(file, locator)],
              confidence: 1,
            },
          );
          edge("EXPOSES_ACTION", ownerId, action, file);
          for (const event of events) {
            const expression = attribute(node, event);
            const handler = expression ? target(expression) : undefined;
            if (handler) edge("HANDLES", handler.id, action, file);
          }
          if (link) navigate(attribute(node, "href"), action, file);
        }
      }
      if (ts.isCallExpression(node)) {
        const called = target(node.expression);
        if (called) {
          edge("CALLS", current?.id ?? fileId, called.id, file);
          if (called.serverAction)
            edge(
              "CALLS_API",
              ownerId,
              createNodeId(
                "APIEndpoint",
                `ACTION:${called.file}#${called.name}`,
              ),
              file,
            );
          const transport = transports.get(called);
          if (transport)
            apiCalls(
              node.arguments[transport.url],
              typeof transport.method === "number"
                ? strings(node.arguments[transport.method])
                : [transport.method],
              ownerId,
              file,
              true,
            );
        }
        if (
          isGlobalFetch(node, checker) &&
          !(current && transports.has(current))
        ) {
          const options = node.arguments[1];
          const method = objectValue(options, "method");
          const uncertainOptions =
            options &&
            (!ts.isObjectLiteralExpression(options) ||
              options.properties.some(ts.isSpreadAssignment));
          const names = uncertainOptions
            ? []
            : method
              ? strings(method)
              : ["GET"];
          apiCalls(node.arguments[0], names, ownerId, file, false);
        }
        if (isNavigation(node, checker))
          navigate(node.arguments[0], ownerId, file);
        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === "can"
        ) {
          for (const permission of strings(node.arguments[0])) {
            const id = addNode("Permission", permission, {
              name: permission,
              evidence: [evidence(file, current?.name)],
              confidence: 0.5,
              heuristic: true,
            });
            edge("REQUIRES_PERMISSION", ownerId, id, file, 0.5);
          }
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        [
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ].includes(node.operatorToken.kind)
      ) {
        for (const [subject, value] of [
          [node.left, node.right],
          [node.right, node.left],
        ] as const) {
          const key = ts.isPropertyAccessExpression(subject)
            ? subject.name.text
            : ts.isIdentifier(subject)
              ? subject.text
              : "";
          if (key !== "role") continue;
          for (const role of strings(value)) {
            const id = addNode("Permission", `role:${role}`, {
              role,
              evidence: [evidence(file, current?.name)],
              confidence: 0.5,
              heuristic: true,
            });
            edge("REQUIRES_PERMISSION", ownerId, id, file, 0.5);
          }
        }
      }
      if (ts.isPropertyAccessExpression(node)) {
        const subject = node.expression;
        const name = ts.isIdentifier(subject)
          ? subject.text
          : ts.isPropertyAccessExpression(subject)
            ? subject.name.text
            : "";
        if (name === "featureFlags") {
          const id = addNode("FeatureFlag", node.name.text, {
            name: node.name.text,
            evidence: [evidence(file, current?.name)],
            confidence: 0.5,
            heuristic: true,
          });
          edge("GUARDED_BY_FLAG", ownerId, id, file, 0.5);
        }
      }
      ts.forEachChild(node, (child) => extract(child, current));
    }
    extract(source);
  }
  const graph = new ProductGraph();
  for (const node of nodes.values()) graph.addNode(node);
  for (const relation of edges.values()) graph.addEdge(relation);
  const nodeCounts: Record<string, number> = {};
  for (const node of [...nodes.values()].sort((a, b) =>
    compareText(a.type, b.type),
  ))
    nodeCounts[node.type] = (nodeCounts[node.type] ?? 0) + 1;
  const uniqueDiagnostics = [
    ...new Map(
      diagnostics.map((item) => [JSON.stringify(item), item]),
    ).values(),
  ].sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
  const summary = ScanSummarySchema.parse({
    schemaVersion: 1,
    framework: "nextjs-app-router",
    repository: project.repository,
    filesAnalyzed: project.files.length,
    nodes: nodes.size,
    edges: edges.size,
    nodeCounts,
    diagnostics: uniqueDiagnostics,
  });
  return { graph, summary };
}

export async function scanNextRepository(
  directory: string,
  options: { exclude?: string[] } = {},
): Promise<ScanResult> {
  return analyzeNextProject(await readSourceProject(directory, options));
}
