import ts from "typescript";

export function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

export function unwrap(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
    ? unwrap(expression.expression)
    : expression;
}

/** A bounded set of literal alternatives; dynamic template spans remain explicit placeholders. */
export function strings(input: ts.Expression | undefined): string[] {
  if (!input) return [];
  const node = unwrap(input);
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isConditionalExpression(node))
    return [
      ...new Set([...strings(node.whenTrue), ...strings(node.whenFalse)]),
    ].slice(0, 16);
  if (ts.isTemplateExpression(node)) {
    let values = [node.head.text];
    for (const span of node.templateSpans) {
      const choices = strings(span.expression);
      values = values
        .flatMap((prefix) =>
          (choices.length ? choices : ["__dynamic__"]).map(
            (value) => prefix + value + span.literal.text,
          ),
        )
        .slice(0, 16);
    }
    return values;
  }
  return [];
}

export function propertyName(node: ts.Node): string | undefined {
  return ts.isIdentifier(node) || ts.isStringLiteral(node)
    ? node.text
    : undefined;
}

export function objectValue(
  input: ts.Expression | undefined,
  key: string,
): ts.Expression | undefined {
  if (!input) return;
  const node = unwrap(input);
  if (!ts.isObjectLiteralExpression(node)) return;
  for (const member of node.properties) {
    if (member.name && propertyName(member.name) === key) {
      if (ts.isPropertyAssignment(member)) return member.initializer;
      if (ts.isShorthandPropertyAssignment(member)) return member.name;
    }
  }
  return;
}

export function attribute(
  element: ts.JsxOpeningLikeElement,
  name: string,
): ts.Expression | undefined {
  const item = element.attributes.properties.find(
    (prop) => ts.isJsxAttribute(prop) && prop.name.getText() === name,
  );
  if (!item || !ts.isJsxAttribute(item) || !item.initializer) return;
  return ts.isJsxExpression(item.initializer)
    ? item.initializer.expression
    : item.initializer;
}

export function importOrigin(
  node: ts.Node,
  checker: ts.TypeChecker,
): { module: string; name: string } | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  for (const declaration of symbol?.declarations ?? []) {
    if (
      !ts.isImportSpecifier(declaration) &&
      !ts.isImportClause(declaration) &&
      !ts.isNamespaceImport(declaration)
    )
      continue;
    let parent: ts.Node = declaration;
    while (!ts.isImportDeclaration(parent) && parent.parent)
      parent = parent.parent;
    if (
      !ts.isImportDeclaration(parent) ||
      !ts.isStringLiteral(parent.moduleSpecifier)
    )
      continue;
    return {
      module: parent.moduleSpecifier.text,
      name: ts.isImportSpecifier(declaration)
        ? (declaration.propertyName ?? declaration.name).text
        : ts.isNamespaceImport(declaration)
          ? "*"
          : "default",
    };
  }
  return;
}

export function isGlobalFetch(
  node: ts.CallExpression,
  checker: ts.TypeChecker,
): boolean {
  return (
    ts.isIdentifier(node.expression) &&
    node.expression.text === "fetch" &&
    !checker.getSymbolAtLocation(node.expression)?.declarations?.length
  );
}

export function isNavigation(
  node: ts.CallExpression,
  checker: ts.TypeChecker,
): boolean {
  const origin = importOrigin(node.expression, checker);
  if (
    origin?.module === "next/navigation" &&
    ["redirect", "permanentRedirect"].includes(origin.name)
  )
    return true;
  if (
    !ts.isPropertyAccessExpression(node.expression) ||
    !["push", "replace"].includes(node.expression.name.text)
  )
    return false;
  const receiver = checker.getSymbolAtLocation(node.expression.expression);
  return (receiver?.declarations ?? []).some((declaration) => {
    if (
      !ts.isVariableDeclaration(declaration) ||
      !declaration.initializer ||
      !ts.isCallExpression(declaration.initializer)
    )
      return false;
    const hook = importOrigin(declaration.initializer.expression, checker);
    return hook?.module === "next/navigation" && hook.name === "useRouter";
  });
}

export function hasDirective(
  node: ts.SourceFile | ts.Block,
  directive: string,
): boolean {
  for (const statement of node.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    )
      return false;
    if (statement.expression.text === directive) return true;
  }
  return false;
}
