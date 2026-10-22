import { createNodeId, ProductGraph } from "@pathcompiler/graph-core";
import {
  type AnalysisDiagnostic,
  compareText,
  SourceProjectSchema,
} from "@pathcompiler/source-model";
import ts from "typescript";
import { addTraceEvidence, mapTarget, stringValue } from "./mapping.js";
import {
  type TargetHint,
  type TestAction,
  type TestTrace,
  TestTraceReportSchema,
  type TestValue,
} from "./schema.js";

export * from "./schema.js";

type Fn = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
type Location = TestAction["evidence"]["callSites"][number];
type Frame = {
  phase: TestAction["phase"];
  conditional: boolean;
  callSites: Location[];
  stack: Fn[];
};
type Bound =
  | { kind: "value"; value: TestValue }
  | {
      kind:
        | "page"
        | "context"
        | "browser"
        | "request"
        | "response"
        | "keyboard";
      name: string;
    }
  | { kind: "locator"; name: string; hints: TargetHint[] }
  | { kind: "expect"; subject: Bound; negated: boolean; soft: boolean };
type Env = Map<ts.Symbol, Bound>;
const dynamic: TestValue = { kind: "dynamic" };
const unknown: Bound = { kind: "value", value: dynamic };
const empty: TestValue = { kind: "literal", value: null };
function unwrap(node: ts.Expression): ts.Expression {
  return ts.isAwaitExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
    ? unwrap(node.expression)
    : node;
}
function isFunction(node: ts.Node | undefined): node is Fn {
  return (
    !!node &&
    (ts.isFunctionDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node))
  );
}
function location(node: ts.Node): Location {
  const source = node.getSourceFile();
  const position = source.getLineAndCharacterOfPosition(node.getStart());
  return {
    file: source.fileName,
    line: position.line + 1,
    column: position.character + 1,
  };
}

/** Static extraction only: no imports, config, tests, callbacks or app code are executed. */
export function minePlaywrightTests(
  input: unknown,
  sourceGraph = new ProductGraph(),
) {
  const project = SourceProjectSchema.parse(input);
  const graph = ProductGraph.fromJSON(sourceGraph.toJSON());
  const repository = graph.nodesByType("Repository")[0]?.data;
  if (
    repository &&
    (repository.commit !== project.repository.commit ||
      repository.dirty !== project.repository.dirty)
  )
    throw new Error(
      "Test and source graph repository snapshots differ; scan and mine the same source snapshot.",
    );
  const contents = new Map(
    project.files.map((file) => [file.path, file.content]),
  );
  const host: ts.CompilerHost = {
    getSourceFile: (file, version) =>
      contents.has(file)
        ? ts.createSourceFile(file, contents.get(file) ?? "", version, true)
        : undefined,
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    getCanonicalFileName: (file) => file,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (file) => contents.has(file),
    readFile: (file) => contents.get(file),
  };
  const program = ts.createProgram(
    [...contents.keys()].sort(compareText),
    {
      noLib: true,
      noResolve: true,
      types: [],
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.Latest,
    },
    host,
  );
  const errors = program.getSyntacticDiagnostics();
  if (errors.length)
    throw new Error(
      errors
        .map(
          (error) =>
            `${error.file?.fileName}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`,
        )
        .join("\n"),
    );
  const checker = program.getTypeChecker();
  const traces: TestTrace[] = [];
  const diagnostics: AnalysisDiagnostic[] = [...project.diagnostics];
  const symbol = (node: ts.Node) => checker.getSymbolAtLocation(node);

  function imported(node: ts.Expression): string | undefined {
    if (ts.isPropertyAccessExpression(node)) {
      const parent = imported(node.expression);
      return parent
        ? `${parent === "namespace" ? "" : `${parent}.`}${node.name.text}`
        : undefined;
    }
    if (!ts.isIdentifier(node)) return;
    for (const decl of symbol(node)?.declarations ?? []) {
      if (!ts.isImportSpecifier(decl) && !ts.isNamespaceImport(decl)) continue;
      let root: ts.Node = decl;
      while (!ts.isImportDeclaration(root) && root.parent) root = root.parent;
      if (
        ts.isImportDeclaration(root) &&
        ts.isStringLiteral(root.moduleSpecifier) &&
        root.moduleSpecifier.text === "@playwright/test"
      )
        return ts.isImportSpecifier(decl)
          ? (decl.propertyName ?? decl.name).text
          : "namespace";
    }
    return;
  }
  function value(
    input: ts.Expression | undefined,
    env: Env,
    seen = new Set<ts.Symbol>(),
  ): TestValue {
    if (!input) return empty;
    const node = unwrap(input);
    if (ts.isStringLiteralLike(node))
      return { kind: "literal", value: node.text };
    if (ts.isNumericLiteral(node))
      return { kind: "literal", value: Number(node.text) };
    if (
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword
    )
      return {
        kind: "literal",
        value: node.kind === ts.SyntaxKind.TrueKeyword,
      };
    if (node.kind === ts.SyntaxKind.NullKeyword) return empty;
    if (ts.isRegularExpressionLiteral(node)) {
      const end = node.text.lastIndexOf("/");
      return {
        kind: "regex",
        pattern: node.text.slice(1, end),
        flags: node.text.slice(end + 1),
      };
    }
    if (ts.isIdentifier(node)) {
      const key = symbol(node);
      const binding = key && env.get(key);
      if (binding) return binding.kind === "value" ? binding.value : dynamic;
      if (!key || seen.has(key)) return dynamic;
      seen.add(key);
      const decl = key.valueDeclaration;
      if (
        decl &&
        ts.isVariableDeclaration(decl) &&
        ts.isVariableDeclarationList(decl.parent) &&
        decl.parent.flags & ts.NodeFlags.Const
      )
        return value(decl.initializer, env, seen);
      return dynamic;
    }
    if (ts.isArrayLiteralExpression(node)) {
      const items = node.elements.map((item) =>
        value(item, env, new Set(seen)),
      );
      return items.every((item) => item.kind === "literal")
        ? {
            kind: "literal",
            value: items.map((item) =>
              item.kind === "literal" ? item.value : null,
            ),
          }
        : dynamic;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const entries: [
        string,
        Extract<TestValue, { kind: "literal" }>["value"],
      ][] = [];
      for (const prop of node.properties) {
        if (
          (!ts.isPropertyAssignment(prop) &&
            !ts.isShorthandPropertyAssignment(prop)) ||
          (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name))
        )
          return dynamic;
        const member = ts.isShorthandPropertyAssignment(prop)
          ? checker.getShorthandAssignmentValueSymbol(prop)
          : undefined;
        const bound = member && env.get(member);
        const item =
          bound?.kind === "value"
            ? bound.value
            : value(
                ts.isPropertyAssignment(prop) ? prop.initializer : prop.name,
                env,
                new Set(seen),
              );
        if (item.kind !== "literal") return dynamic;
        entries.push([prop.name.text, item.value]);
      }
      return { kind: "literal", value: Object.fromEntries(entries) };
    }
    return dynamic;
  }
  function fixtureEnv(fn: Fn): Env {
    const env: Env = new Map();
    const parameter = fn.parameters[0]?.name;
    if (parameter && ts.isObjectBindingPattern(parameter)) {
      for (const element of parameter.elements) {
        if (!ts.isIdentifier(element.name) || element.dotDotDotToken) continue;
        const kind = element.propertyName?.getText() ?? element.name.text;
        if (!["page", "context", "browser", "request"].includes(kind)) continue;
        const key = symbol(element.name);
        if (key)
          env.set(key, {
            kind: kind as "page" | "context" | "browser" | "request",
            name: kind,
          });
      }
    }
    return env;
  }

  for (const source of [...program.getSourceFiles()].sort((a, b) =>
    compareText(a.fileName, b.fileName),
  )) {
    const occurrences = new Map<string, number>();
    type Hooks = { before: Fn[]; after: Fn[]; unsupported: boolean };
    function discover(
      statements: ts.NodeArray<ts.Statement>,
      names: string[] = [],
      inherited: Hooks = { before: [], after: [], unsupported: false },
      mode: TestTrace["mode"] = "normal",
    ) {
      const hooks: Hooks = {
        before: [...inherited.before],
        after: [],
        unsupported: inherited.unsupported,
      };
      for (const statement of statements) {
        if (
          !ts.isExpressionStatement(statement) ||
          !ts.isCallExpression(statement.expression)
        )
          continue;
        const call = statement.expression;
        const name = imported(call.expression);
        const fn = call.arguments.at(-1);
        if (
          (name === "test.beforeEach" || name === "test.afterEach") &&
          isFunction(fn)
        )
          (name === "test.beforeEach" ? hooks.before : hooks.after).push(fn);
        else if (
          name &&
          ["test.beforeAll", "test.afterAll", "test.use"].includes(name)
        )
          hooks.unsupported = true;
      }
      hooks.after.push(...inherited.after);
      for (const statement of statements) {
        if (
          !ts.isExpressionStatement(statement) ||
          !ts.isCallExpression(statement.expression)
        ) {
          if (
            ts.isForStatement(statement) ||
            ts.isForOfStatement(statement) ||
            ts.isIfStatement(statement)
          )
            diagnostics.push({
              code: "test-registration",
              file: source.fileName,
              message:
                "Conditional or generated test registration is not expanded.",
            });
          continue;
        }
        const call = statement.expression;
        const name = imported(call.expression);
        const callback = call.arguments.at(-1);
        if (!name?.startsWith("test")) continue;
        if (
          name.startsWith("test.describe") &&
          isFunction(callback) &&
          callback.body &&
          ts.isBlock(callback.body)
        ) {
          const title = stringValue(value(call.arguments[0], new Map()));
          if (title === undefined) {
            diagnostics.push({
              code: "test-title",
              file: source.fileName,
              message: "Suite title must be a literal string.",
            });
            continue;
          }
          const modifier = name.split(".").at(-1);
          const nextMode =
            mode === "skip" || mode === "fixme"
              ? mode
              : modifier === "skip" ||
                  modifier === "fixme" ||
                  modifier === "only"
                ? modifier
                : mode;
          discover(
            callback.body.statements,
            [...names, title],
            hooks,
            nextMode,
          );
        } else if (
          ["test", "test.only", "test.skip", "test.fixme"].includes(name) &&
          isFunction(callback)
        ) {
          const title = stringValue(value(call.arguments[0], new Map()));
          if (title === undefined) {
            diagnostics.push({
              code: "test-title",
              file: source.fileName,
              message: "Test title must be a literal string.",
            });
            continue;
          }
          const testName = [...names, title].join(" › ");
          const occurrence = (occurrences.get(testName) ?? 0) + 1;
          occurrences.set(testName, occurrence);
          const modifier = name.split(".")[1];
          const trace: TestTrace = {
            id: createNodeId(
              "Test",
              `${source.fileName}#${JSON.stringify([...names, title])}[${occurrence}]`,
            ),
            testName,
            sourceFile: source.fileName,
            mode:
              mode === "skip" || mode === "fixme"
                ? mode
                : modifier === "skip" ||
                    modifier === "fixme" ||
                    modifier === "only"
                  ? modifier
                  : mode,
            startRoute: null,
            actions: [],
            assertions: [],
            terminalAssertion: null,
            partial: false,
            diagnostics: [],
          };
          let order = 0;
          const baseFrame: Frame = {
            phase: "test",
            conditional: false,
            callSites: [],
            stack: [],
          };
          const event = (node: ts.Node, frame: Frame) => ({
            order: order++,
            phase: frame.phase,
            conditional: frame.conditional,
            evidence: {
              ...location(node),
              repositoryCommit: project.repository.commit,
              callSites: frame.callSites,
            },
          });
          function warn(node: ts.Node, code: string, message: string) {
            trace.partial = true;
            trace.diagnostics.push({
              code,
              file: source.fileName,
              message: `${location(node).line}:${location(node).column}: ${message}`,
            });
          }
          function target(bound: Bound) {
            return bound.kind === "page" || bound.kind === "locator"
              ? mapTarget(
                  graph,
                  bound.name,
                  bound.kind === "locator" ? bound.hints : [],
                )
              : null;
          }
          function action(
            node: ts.Node,
            frame: Frame,
            kind: TestAction["kind"],
            operation: string,
            input: TestValue,
            subject: Bound,
          ) {
            trace.actions.push({
              ...event(node, frame),
              kind,
              operation,
              value: input,
              target: target(subject),
            });
          }
          function evaluate(
            input: ts.Expression | undefined,
            env: Env,
            frame: Frame,
          ): Bound {
            if (!input) return unknown;
            const node = unwrap(input);
            if (ts.isIdentifier(node)) {
              const key = symbol(node);
              return (
                (key && env.get(key)) ?? {
                  kind: "value",
                  value: value(node, env),
                }
              );
            }
            if (ts.isPropertyAccessExpression(node)) {
              const receiver = evaluate(node.expression, env, frame);
              if (receiver.kind === "context" && node.name.text === "request")
                return { kind: "request", name: `${receiver.name}.request` };
              if (receiver.kind === "page" && node.name.text === "keyboard")
                return { kind: "keyboard", name: receiver.name };
              if (receiver.kind === "expect" && node.name.text === "not")
                return { ...receiver, negated: !receiver.negated };
              return unknown;
            }
            if (ts.isCallExpression(node)) {
              const origin = imported(node.expression);
              if (origin === "expect" || origin === "expect.soft")
                return {
                  kind: "expect",
                  subject: evaluate(node.arguments[0], env, frame),
                  negated: false,
                  soft: origin === "expect.soft",
                };
              if (origin === "test.step") {
                const fn = node.arguments[1];
                if (isFunction(fn) && fn.body && ts.isBlock(fn.body))
                  return block(fn.body.statements, new Map(env), frame);
              }
              const property = ts.isPropertyAccessExpression(node.expression)
                ? node.expression
                : undefined;
              const method = property?.name.text ?? "call";
              const receiver = property
                ? evaluate(property.expression, env, frame)
                : unknown;
              if (receiver.kind === "expect" && /^to[A-Z]/.test(method)) {
                trace.assertions.push({
                  ...event(node, frame),
                  matcher: method,
                  expected: value(node.arguments[0], env),
                  negated: receiver.negated,
                  soft: receiver.soft,
                  subject:
                    receiver.subject.kind === "locator"
                      ? "locator"
                      : receiver.subject.kind === "page"
                        ? "page"
                        : "value",
                  target: target(receiver.subject),
                });
                return unknown;
              }
              const locatorMethods = [
                "locator",
                "getByRole",
                "getByLabel",
                "getByText",
                "getByTestId",
                "getByPlaceholder",
                "getByTitle",
                "getByAltText",
              ];
              if (
                (receiver.kind === "page" || receiver.kind === "locator") &&
                (locatorMethods.includes(method) ||
                  (receiver.kind === "locator" &&
                    ["filter", "first", "last", "nth"].includes(method)))
              ) {
                return {
                  kind: "locator",
                  name: receiver.name,
                  hints: [
                    ...(receiver.kind === "locator" ? receiver.hints : []),
                    {
                      method,
                      argument: value(node.arguments[0], env),
                      options: value(node.arguments[1], env),
                    },
                  ],
                };
              }
              if (receiver.kind === "page" && method === "goto") {
                const route = value(node.arguments[0], env);
                const routeTarget: Bound = {
                  kind: "locator",
                  name: receiver.name,
                  hints: [{ method: "goto", argument: route, options: empty }],
                };
                action(node, frame, "navigate", method, route, routeTarget);
                if (
                  frame.phase !== "teardown" &&
                  trace.actions.filter(
                    (item) =>
                      item.kind === "navigate" && item.phase !== "teardown",
                  ).length === 1
                )
                  trace.startRoute = stringValue(route) ?? null;
                return unknown;
              }
              if (
                receiver.kind === "locator" &&
                [
                  "click",
                  "dblclick",
                  "fill",
                  "type",
                  "press",
                  "check",
                  "uncheck",
                  "selectOption",
                  "hover",
                  "focus",
                  "setInputFiles",
                ].includes(method)
              ) {
                action(
                  node,
                  frame,
                  "ui",
                  method,
                  value(node.arguments[0], env),
                  receiver,
                );
                return unknown;
              }
              if (
                (receiver.kind === "page" &&
                  ["reload", "goBack", "goForward", "close"].includes(
                    method,
                  )) ||
                (receiver.kind === "keyboard" && method === "press")
              ) {
                action(
                  node,
                  frame,
                  "page",
                  method,
                  value(node.arguments[0], env),
                  { kind: "page", name: receiver.name },
                );
                return unknown;
              }
              if (
                receiver.kind === "request" &&
                [
                  "get",
                  "post",
                  "put",
                  "patch",
                  "delete",
                  "head",
                  "fetch",
                ].includes(method)
              ) {
                action(
                  node,
                  frame,
                  "request",
                  method,
                  value(node.arguments[0], env),
                  receiver,
                );
                return { kind: "response", name: receiver.name };
              }
              if (
                receiver.kind === "response" &&
                ["status", "ok", "json", "text", "body"].includes(method)
              )
                return unknown;
              if (
                (receiver.kind === "browser" && method === "newContext") ||
                (receiver.kind === "context" && method === "newPage")
              ) {
                action(node, frame, "page", method, empty, receiver);
                return {
                  kind: method === "newPage" ? "page" : "context",
                  name: `${receiver.name}.${method}@${location(node).line}`,
                };
              }
              if (receiver.kind === "context" && method === "close") {
                action(node, frame, "page", method, empty, receiver);
                return unknown;
              }
              const decl = ts.isIdentifier(node.expression)
                ? symbol(node.expression)?.valueDeclaration
                : undefined;
              const fn =
                decl && ts.isVariableDeclaration(decl)
                  ? decl.initializer
                  : decl;
              if (
                isFunction(fn) &&
                fn.getSourceFile() === source &&
                fn.body &&
                ts.isBlock(fn.body)
              ) {
                if (frame.stack.includes(fn) || frame.stack.length >= 8) {
                  warn(
                    node,
                    "helper-limit",
                    "Recursive or deeply nested helper was not expanded.",
                  );
                  action(
                    node,
                    frame,
                    "unsupported",
                    "helper",
                    dynamic,
                    unknown,
                  );
                  return unknown;
                }
                const helperEnv = new Map(env);
                fn.parameters.forEach((parameter, index) => {
                  const key = symbol(parameter.name);
                  if (key && ts.isIdentifier(parameter.name))
                    helperEnv.set(
                      key,
                      node.arguments[index]
                        ? evaluate(node.arguments[index], env, frame)
                        : {
                            kind: "value",
                            value: value(parameter.initializer, helperEnv),
                          },
                    );
                });
                return block(fn.body.statements, helperEnv, {
                  ...frame,
                  stack: [...frame.stack, fn],
                  callSites: [...frame.callSites, location(node)],
                });
              }
              // Inspect argument effects, but never enter unknown callbacks or execute calls.
              for (const arg of node.arguments)
                if (!isFunction(arg)) evaluate(arg, env, frame);
              warn(
                node,
                "unsupported-call",
                "Call is outside the supported Playwright/local-helper subset.",
              );
              action(node, frame, "unsupported", method, dynamic, receiver);
              return unknown;
            }
            if (
              ts.isBinaryExpression(node) ||
              ts.isConditionalExpression(node)
            ) {
              if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left)) {
                const key = symbol(node.left);
                if (key) env.set(key, unknown);
              }
              warn(
                node,
                "unsupported-expression",
                "Assignment, branching or compound expression was not evaluated.",
              );
              return unknown;
            }
            return { kind: "value", value: value(node, env) };
          }
          function block(
            statements: ts.NodeArray<ts.Statement>,
            env: Env,
            frame: Frame,
          ): Bound {
            for (const statement of statements) {
              if (order >= 2000) {
                warn(
                  statement,
                  "trace-limit",
                  "Trace expansion stopped at 2,000 events.",
                );
                return unknown;
              }
              if (ts.isExpressionStatement(statement))
                evaluate(statement.expression, env, frame);
              else if (ts.isVariableStatement(statement)) {
                for (const decl of statement.declarationList.declarations) {
                  const binding = evaluate(decl.initializer, env, frame);
                  const key = symbol(decl.name);
                  if (key && ts.isIdentifier(decl.name))
                    env.set(
                      key,
                      statement.declarationList.flags & ts.NodeFlags.Const
                        ? binding
                        : unknown,
                    );
                  else
                    warn(
                      decl,
                      "unsupported-binding",
                      "Only simple const aliases are resolved.",
                    );
                }
              } else if (ts.isReturnStatement(statement))
                return evaluate(statement.expression, env, frame);
              else if (
                ts.isFunctionDeclaration(statement) ||
                ts.isEmptyStatement(statement)
              )
                continue;
              else if (ts.isTryStatement(statement)) {
                warn(
                  statement,
                  "control-flow",
                  "Try body is conditional evidence; catch/finally are not expanded.",
                );
                block(statement.tryBlock.statements, new Map(env), {
                  ...frame,
                  conditional: true,
                });
                frame = { ...frame, conditional: true };
              } else {
                warn(
                  statement,
                  "control-flow",
                  "Loop, branch or unsupported statement omitted; subsequent events are conditional evidence.",
                );
                action(
                  statement,
                  frame,
                  "unsupported",
                  "control-flow",
                  dynamic,
                  unknown,
                );
                frame = { ...frame, conditional: true };
              }
            }
            return unknown;
          }
          if (hooks.unsupported)
            warn(
              call,
              "test-setup",
              "beforeAll/afterAll/test.use configuration is not expanded; setup may be incomplete.",
            );
          for (const hook of hooks.before)
            if (hook.body && ts.isBlock(hook.body))
              block(hook.body.statements, fixtureEnv(hook), {
                ...baseFrame,
                phase: "setup",
              });
          if (callback.body && ts.isBlock(callback.body))
            block(callback.body.statements, fixtureEnv(callback), baseFrame);
          else
            warn(
              callback,
              "test-body",
              "Expected a block-bodied test callback.",
            );
          const lastEvent = [...trace.actions, ...trace.assertions]
            .filter((item) => item.phase === "test")
            .sort((a, b) => a.order - b.order)
            .at(-1);
          trace.terminalAssertion =
            lastEvent && "matcher" in lastEvent ? lastEvent : null;
          for (const hook of hooks.after)
            if (hook.body && ts.isBlock(hook.body))
              block(hook.body.statements, fixtureEnv(hook), {
                ...baseFrame,
                phase: "teardown",
              });
          trace.diagnostics = [
            ...new Map(
              trace.diagnostics.map((item) => [JSON.stringify(item), item]),
            ).values(),
          ];
          traces.push(trace);
        } else if (
          !name.startsWith("test.before") &&
          !name.startsWith("test.after") &&
          name !== "test.use"
        )
          diagnostics.push({
            code: "test-registration",
            file: source.fileName,
            message: `Unsupported registration: ${name}.`,
          });
      }
    }
    // Avoid treating unrelated application branches as test registrations.
    if (
      source.statements.some(
        (statement) =>
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === "@playwright/test",
      )
    )
      discover(source.statements);
  }
  const report = TestTraceReportSchema.parse({
    schemaVersion: 1,
    evidenceOnly: true,
    execution: "not-run",
    repository: project.repository,
    diagnostics,
    traces,
  });
  for (const trace of report.traces)
    addTraceEvidence(graph, trace, project.repository.commit);
  return { report, graph };
}
