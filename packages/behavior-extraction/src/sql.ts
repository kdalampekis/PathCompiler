import {
  type Expr,
  e,
  formatExpression,
  type Provenance,
  type Variable,
} from "@pathcompiler/behavior-ir";
import {
  dataConstraintText,
  type ExtractedFragment,
  emptyFragment,
  lineOf,
  lineRange,
  provenanceOf,
  type SourceFile,
  snake,
} from "./common.js";

/**
 * SQL DDL extractor. Reads `CREATE TABLE` statements and lifts what they
 * declare verbatim: column types and enum-like `IN` checks become variables,
 * `CHECK` constraints become invariants, and `NOT NULL`, `UNIQUE`, primary
 * and foreign keys become data constraints (the expression language has no
 * null or uniqueness, so they are recorded, not verified). Everything is
 * EXPLICIT; a clause it cannot translate is listed in `unsupported`.
 */
type Token =
  | { kind: "word"; text: string; at: number }
  | { kind: "number"; text: string; at: number }
  | { kind: "string"; text: string; at: number }
  | { kind: "symbol"; text: string; at: number };

function tokenize(sql: string, offset: number): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index] as string;
    if (/\s/.test(char)) index += 1;
    else if (sql.startsWith("--", index)) {
      while (index < sql.length && sql[index] !== "\n") index += 1;
    } else if (/[A-Za-z_"`]/.test(char)) {
      const quoted = char === '"' || char === "`";
      const end = quoted
        ? sql.indexOf(char, index + 1)
        : (() => {
            let at = index;
            while (at < sql.length && /[A-Za-z0-9_$.]/.test(sql[at] as string))
              at += 1;
            return at;
          })();
      const text = quoted
        ? sql.slice(index + 1, end)
        : sql.slice(index, end === -1 ? sql.length : end);
      tokens.push({ kind: "word", text, at: offset + index });
      index = quoted ? end + 1 : index + text.length;
    } else if (/[0-9]/.test(char)) {
      let end = index;
      while (end < sql.length && /[0-9.]/.test(sql[end] as string)) end += 1;
      tokens.push({
        kind: "number",
        text: sql.slice(index, end),
        at: offset + index,
      });
      index = end;
    } else if (char === "'") {
      let end = index + 1;
      let value = "";
      while (end < sql.length) {
        if (sql[end] === "'" && sql[end + 1] === "'") {
          value += "'";
          end += 2;
        } else if (sql[end] === "'") break;
        else {
          value += sql[end];
          end += 1;
        }
      }
      tokens.push({ kind: "string", text: value, at: offset + index });
      index = end + 1;
    } else {
      const two = sql.slice(index, index + 2);
      const symbol = ["<=", ">=", "<>", "!=", "=="].includes(two) ? two : char;
      tokens.push({ kind: "symbol", text: symbol, at: offset + index });
      index += symbol.length;
    }
  }
  return tokens;
}

class Unsupported extends Error {}

type Column = { table: string; name: string; id: string };
type Context = {
  table: string;
  columns: Map<string, Column>;
  enums: Map<string, Set<string>>;
};

/** Recursive-descent translation of a SQL boolean expression to BehaviorIR. */
function translate(tokens: Token[], context: Context): Expr {
  let position = 0;
  const peek = () => tokens[position];
  const upper = (token: Token | undefined) =>
    token?.kind === "word" ? token.text.toUpperCase() : undefined;
  const take = () => {
    const token = tokens[position];
    if (!token) throw new Unsupported("the expression ends unexpectedly");
    position += 1;
    return token;
  };
  const accept = (word: string) => {
    if (upper(peek()) === word || peek()?.text === word) {
      position += 1;
      return true;
    }
    return false;
  };
  const expect = (word: string) => {
    if (!accept(word)) throw new Unsupported(`expected ${word}`);
  };

  function column(token: Token): Expr {
    const name = token.text.includes(".")
      ? (token.text.split(".").pop() as string)
      : token.text;
    const known = context.columns.get(name.toLowerCase());
    if (!known) throw new Unsupported(`unknown column ${token.text}`);
    return e.var(known.id);
  }
  function primary(): Expr {
    const token = take();
    if (token.kind === "number") {
      if (token.text.includes("."))
        throw new Unsupported(`decimal literal ${token.text}`);
      return e.lit(Number(token.text));
    }
    if (token.kind === "string") return e.lit(token.text);
    if (token.kind === "symbol" && token.text === "(") {
      const inner = orExpr();
      expect(")");
      return inner;
    }
    if (token.kind === "symbol" && token.text === "-") {
      const next = take();
      if (next.kind !== "number" || next.text.includes("."))
        throw new Unsupported("negated non-integer");
      return e.lit(-Number(next.text));
    }
    if (token.kind === "word") {
      const word = token.text.toUpperCase();
      if (word === "TRUE") return e.lit(true);
      if (word === "FALSE") return e.lit(false);
      if (peek()?.text === "(")
        throw new Unsupported(`function call ${token.text}(…)`);
      return column(token);
    }
    throw new Unsupported(`unexpected ${token.text}`);
  }
  function product(): Expr {
    let left = primary();
    while (peek()?.text === "*") {
      take();
      left = e.mul(left, primary());
    }
    return left;
  }
  function sum(): Expr {
    let left = product();
    for (;;) {
      if (peek()?.text === "+") {
        take();
        left = e.add(left, product());
      } else if (peek()?.text === "-") {
        take();
        left = e.sub(left, product());
      } else return left;
    }
  }
  function comparison(): Expr {
    const left = sum();
    const token = peek();
    if (!token) return left;
    const symbolOps = {
      "=": e.eq,
      "==": e.eq,
      "<>": e.ne,
      "!=": e.ne,
      "<": e.lt,
      "<=": e.le,
      ">": e.gt,
      ">=": e.ge,
    } as const;
    if (token.kind === "symbol" && token.text in symbolOps) {
      take();
      return symbolOps[token.text as keyof typeof symbolOps](left, sum());
    }
    const negated = upper(token) === "NOT" && upper(tokens[position + 1]);
    if (upper(token) === "IN" || (negated === "IN" && accept("NOT"))) {
      expect("IN");
      expect("(");
      const values: Expr[] = [];
      do values.push(sum());
      while (accept(","));
      expect(")");
      if (left.op === "var") {
        const strings = values.filter(
          (item) => item.op === "lit" && typeof item.value === "string",
        );
        if (strings.length === values.length && !negated) {
          const set = context.enums.get(left.id) ?? new Set<string>();
          for (const item of strings)
            if (item.op === "lit") set.add(String(item.value));
          context.enums.set(left.id, set);
        }
      }
      const members = values.map((item) => e.eq(left, item));
      const any =
        members.length === 1 ? (members[0] as Expr) : e.or(...members);
      return negated ? e.not(any) : any;
    }
    if (upper(token) === "BETWEEN") {
      take();
      const low = sum();
      expect("AND");
      const high = sum();
      return e.and(e.ge(left, low), e.le(left, high));
    }
    if (upper(token) === "IS")
      throw new Unsupported(
        "IS [NOT] NULL (the specification language has no null)",
      );
    if (upper(token) === "LIKE") throw new Unsupported("LIKE patterns");
    return left;
  }
  function notExpr(): Expr {
    if (accept("NOT")) return e.not(notExpr());
    return comparison();
  }
  function andExpr(): Expr {
    const args = [notExpr()];
    while (accept("AND")) args.push(notExpr());
    return args.length === 1 ? (args[0] as Expr) : e.and(...args);
  }
  function orExpr(): Expr {
    const args = [andExpr()];
    while (accept("OR")) args.push(andExpr());
    return args.length === 1 ? (args[0] as Expr) : e.or(...args);
  }
  const result = orExpr();
  if (position < tokens.length)
    throw new Unsupported(`unexpected ${tokens[position]?.text}`);
  return result;
}

const OPERATOR_WORDS: [RegExp, string][] = [
  [/>=/g, " ge "],
  [/<=/g, " le "],
  [/==/g, " eq "],
  [/!=/g, " ne "],
  [/=>/g, " implies "],
  [/&&/g, " and "],
  [/\|\|/g, " or "],
  [/>/g, " gt "],
  [/</g, " lt "],
  [/\+/g, " plus "],
  [/-/g, " minus "],
  [/\*/g, " times "],
  [/!/g, " not "],
];
/** Readable rule-ID fragment for an expression: `refunded_amount_le_original_amount`. */
export function expressionSlug(expr: Expr, drop = ""): string {
  let text = formatExpression(expr);
  if (drop) text = text.split(`${drop}.`).join("");
  for (const [pattern, word] of OPERATOR_WORDS)
    text = text.replace(pattern, word);
  return text
    .replace(/"/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 80)
    .replace(/_+$/, "");
}

/** Splits at top-level commas, keeping offsets into the original text. */
function splitTopLevel(body: string, offset: number) {
  const parts: { text: string; at: number }[] = [];
  let depth = 0;
  let start = 0;
  let quote = "";
  for (let index = 0; index <= body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === "'" || char === '"') quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if ((char === "," && depth === 0) || index === body.length) {
      const text = body.slice(start, index);
      if (text.trim())
        parts.push({
          text: text.trim(),
          at: offset + start + (text.length - text.trimStart().length),
        });
      start = index + 1;
    }
  }
  return parts;
}

const INTEGER_TYPES =
  /^(INT|INTEGER|BIGINT|SMALLINT|TINYINT|SERIAL|BIGSERIAL)$/;
const BOOLEAN_TYPES = /^(BOOL|BOOLEAN)$/;
const STRING_TYPES = /^(TEXT|VARCHAR|CHAR|CHARACTER|UUID|CITEXT)$/;

export function extractSql(file: SourceFile): ExtractedFragment {
  const out = emptyFragment();
  const content = file.content;
  const provenance = (offset: number, endOffset: number) =>
    provenanceOf({
      sourceType: "DATABASE_SCHEMA",
      origin: "EXPLICIT",
      extractionMethod: "SCHEMA_PARSE",
      confidence: "HIGH",
      file: file.path,
      lines: lineRange(lineOf(content, offset), lineOf(content, endOffset)),
    });
  const unsupported = (
    offset: number,
    endOffset: number,
    construct: string,
    reason: string,
  ) =>
    out.unsupported.push({
      file: file.path,
      lines: lineRange(lineOf(content, offset), lineOf(content, endOffset)),
      construct,
      reason,
    });

  const create =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\w+\.)?["`]?(\w+)["`]?\s*\(/gi;
  for (let match = create.exec(content); match; match = create.exec(content)) {
    const table = (match[1] as string).toLowerCase();
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let end = bodyStart;
    while (end < content.length && depth > 0) {
      if (content[end] === "(") depth += 1;
      else if (content[end] === ")") depth -= 1;
      end += 1;
    }
    const body = content.slice(bodyStart, end - 1);
    const items = splitTopLevel(body, bodyStart);
    const context: Context = { table, columns: new Map(), enums: new Map() };
    const constraintWords =
      /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|INDEX|KEY)\b/i;

    // First pass: columns, so constraints can resolve names.
    const columnItems: {
      column: Column;
      type: string;
      tokens: Token[];
      at: number;
      end: number;
    }[] = [];
    for (const item of items) {
      const trimmed = item.text.trim();
      if (constraintWords.test(trimmed)) continue;
      const tokens = tokenize(item.text, item.at);
      const [nameToken, typeToken] = tokens;
      if (nameToken?.kind !== "word" || typeToken?.kind !== "word") {
        unsupported(
          item.at,
          item.at + item.text.length,
          trimmed.slice(0, 60),
          "not a column definition",
        );
        continue;
      }
      const name = nameToken.text.toLowerCase();
      const column = { table, name, id: `${table}.${snake(name)}` };
      context.columns.set(name, column);
      columnItems.push({
        column,
        type: typeToken.text.toUpperCase(),
        tokens,
        at: item.at,
        end: item.at + item.text.length,
      });
    }

    const rules: {
      expr: Expr;
      at: number;
      end: number;
    }[] = [];
    const dataConstraint = (
      kind: "not_null" | "unique" | "primary_key" | "foreign_key",
      subject: string,
      at: number,
      endAt: number,
      references?: string,
    ) => {
      const entry = {
        id: `${table}.${
          kind === "unique" || kind === "primary_key"
            ? `${kind}_${subject
                .split(", ")
                .map((part) => part.slice(table.length + 1))
                .join("_")}`
            : `${subject.slice(table.length + 1)}_${kind}${references ? `_${references.replace(/\./g, "_")}` : ""}`
        }`,
        kind,
        subject,
        ...(references ? { references } : {}),
        provenance: [provenance(at, endAt)],
      };
      out.dataConstraints.push(entry);
      out.ledger.push({
        kind: "data_constraint",
        text: dataConstraintText(entry),
        provenance: entry.provenance[0] as Provenance,
      });
    };
    const checkExpression = (tokens: Token[], at: number, endAt: number) => {
      try {
        rules.push({ expr: translate(tokens, context), at, end: endAt });
      } catch (error) {
        if (!(error instanceof Unsupported)) throw error;
        unsupported(at, endAt, `CHECK ${table}`, error.message);
      }
    };

    // Scans for `CHECK (` and returns the tokens inside the matching paren.
    const checksIn = (tokens: Token[], from: number) => {
      const found: { inner: Token[]; next: number }[] = [];
      for (let index = from; index < tokens.length; index += 1) {
        if (
          tokens[index]?.kind === "word" &&
          tokens[index]?.text.toUpperCase() === "CHECK" &&
          tokens[index + 1]?.text === "("
        ) {
          let nesting = 0;
          let close = index + 1;
          for (; close < tokens.length; close += 1) {
            if (tokens[close]?.text === "(") nesting += 1;
            else if (tokens[close]?.text === ")") {
              nesting -= 1;
              if (nesting === 0) break;
            }
          }
          found.push({ inner: tokens.slice(index + 2, close), next: close });
          index = close;
        }
      }
      return found;
    };
    const wordAt = (tokens: Token[], index: number) =>
      tokens[index]?.kind === "word"
        ? (tokens[index]?.text.toUpperCase() as string)
        : undefined;

    for (const { column, type, tokens, at, end: itemEnd } of columnItems) {
      const variableBase = {
        id: column.id,
        scope: "state" as const,
        description: `Column ${table}.${column.name}`,
      };
      let variable: Variable | undefined;
      if (INTEGER_TYPES.test(type))
        variable = { ...variableBase, type: "integer" };
      else if (BOOLEAN_TYPES.test(type))
        variable = { ...variableBase, type: "boolean" };
      else if (STRING_TYPES.test(type))
        variable = { ...variableBase, type: "string" };
      else
        unsupported(
          at,
          itemEnd,
          `${table}.${column.name} ${type}`,
          `Column type ${type} has no BehaviorIR type; the column and its checks are skipped.`,
        );
      if (!variable) {
        context.columns.delete(column.name);
        continue;
      }
      out.variables.push(variable);

      for (let index = 2; index < tokens.length; index += 1) {
        const word = wordAt(tokens, index);
        if (word === "NOT" && wordAt(tokens, index + 1) === "NULL")
          dataConstraint("not_null", column.id, at, itemEnd);
        else if (word === "PRIMARY" && wordAt(tokens, index + 1) === "KEY")
          dataConstraint("primary_key", column.id, at, itemEnd);
        else if (word === "UNIQUE" && tokens[index + 1]?.text !== "(")
          dataConstraint("unique", column.id, at, itemEnd);
        else if (word === "REFERENCES") {
          const target = tokens[index + 1]?.text
            .toLowerCase()
            .replace(/^\w+\./, "");
          const targetColumn =
            tokens[index + 2]?.text === "("
              ? tokens[index + 3]?.text.toLowerCase()
              : undefined;
          if (target && targetColumn)
            dataConstraint(
              "foreign_key",
              column.id,
              at,
              itemEnd,
              `${target}.${snake(targetColumn)}`,
            );
          else
            unsupported(
              at,
              itemEnd,
              `${column.id} REFERENCES`,
              "a foreign key without an explicit target column",
            );
        }
      }
      for (const check of checksIn(tokens, 2))
        checkExpression(check.inner, at, itemEnd);
    }

    for (const item of items) {
      const trimmed = item.text.trim();
      if (!constraintWords.test(trimmed)) continue;
      const tokens = tokenize(item.text, item.at);
      const endAt = item.at + item.text.length;
      const names = (from: number) => {
        const list: string[] = [];
        let index = from;
        if (tokens[index]?.text !== "(") return list;
        for (
          index += 1;
          index < tokens.length && tokens[index]?.text !== ")";
          index += 1
        )
          if (tokens[index]?.kind === "word")
            list.push(tokens[index]?.text.toLowerCase() as string);
        return list;
      };
      let start = 0;
      if (wordAt(tokens, 0) === "CONSTRAINT") start = 2;
      const word = wordAt(tokens, start);
      const ids = (list: string[]) =>
        list.map((name) => `${table}.${snake(name)}`);
      if (word === "CHECK") {
        for (const check of checksIn(tokens, start))
          checkExpression(check.inner, item.at, endAt);
      } else if (word === "PRIMARY" || word === "UNIQUE") {
        const list = ids(names(word === "PRIMARY" ? start + 2 : start + 1));
        if (list.length > 0)
          dataConstraint(
            word === "PRIMARY" ? "primary_key" : "unique",
            list.join(", "),
            item.at,
            endAt,
          );
      } else if (word === "FOREIGN") {
        const list = ids(names(start + 2));
        const refIndex = tokens.findIndex(
          (token) => token.text.toUpperCase() === "REFERENCES",
        );
        const target = tokens[refIndex + 1]?.text.toLowerCase();
        const targetColumns = names(refIndex + 2);
        if (list.length === 1 && target && targetColumns.length === 1)
          dataConstraint(
            "foreign_key",
            list[0] as string,
            item.at,
            endAt,
            `${target}.${snake(targetColumns[0] as string)}`,
          );
        else
          unsupported(
            item.at,
            endAt,
            trimmed.slice(0, 60),
            "only single-column foreign keys with an explicit target are modeled",
          );
      } else
        unsupported(
          item.at,
          endAt,
          trimmed.slice(0, 60),
          `Table constraint ${word ?? ""} is not modeled`,
        );
    }

    // Enum-like IN checks turn a string column into an enum variable.
    for (const [id, values] of context.enums) {
      const index = out.variables.findIndex((item) => item.id === id);
      const known = out.variables[index];
      if (known?.type === "string")
        out.variables[index] = {
          id: known.id,
          scope: known.scope,
          type: "enum",
          values: [...values].sort(),
          ...(known.description ? { description: known.description } : {}),
        };
    }
    for (const rule of rules) {
      const entry = {
        id: `${table}.check_${expressionSlug(rule.expr, table)}`,
        description: `CHECK ${formatExpression(rule.expr)}`,
        expression: rule.expr,
        provenance: [provenance(rule.at, rule.end)],
      };
      out.invariants.push(entry);
      out.ledger.push({
        kind: "invariant",
        text: formatExpression(rule.expr),
        provenance: entry.provenance[0] as Provenance,
      });
    }
  }
  return out;
}
