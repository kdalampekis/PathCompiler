/**
 * A unified diff of two texts (line-based LCS, three lines of context). Small
 * and dependency-free: source files, not megabytes, go through it.
 */
export function unifiedDiff(
  path: string,
  before: string,
  after: string,
): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  // lengths[i][j]: longest common subsequence of a[i..] and b[j..].
  const lengths: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i -= 1)
    for (let j = m - 1; j >= 0; j -= 1)
      (lengths[i] as number[])[j] =
        a[i] === b[j]
          ? ((lengths[i + 1] as number[])[j + 1] as number) + 1
          : Math.max(
              (lengths[i + 1] as number[])[j] as number,
              (lengths[i] as number[])[j + 1] as number,
            );
  type Line = { kind: " " | "-" | "+"; text: string };
  const lines: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      lines.push({ kind: " ", text: a[i] as string });
      i += 1;
      j += 1;
    } else if (
      j < m &&
      (i === n ||
        ((lengths[i] as number[])[j + 1] as number) >
          ((lengths[i + 1] as number[])[j] as number))
    ) {
      lines.push({ kind: "+", text: b[j] as string });
      j += 1;
    } else {
      lines.push({ kind: "-", text: a[i] as string });
      i += 1;
    }
  }
  const changed = lines.flatMap((line, index) =>
    line.kind === " " ? [] : [index],
  );
  if (changed.length === 0) return "";
  const CONTEXT = 3;
  // Merge changes whose context overlaps into hunks.
  const hunks: [number, number][] = [];
  for (const index of changed) {
    const start = Math.max(0, index - CONTEXT);
    const end = Math.min(lines.length, index + CONTEXT + 1);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1]) last[1] = end;
    else hunks.push([start, end]);
  }
  const out = [`--- a/${path}`, `+++ b/${path}`];
  for (const [start, end] of hunks) {
    const slice = lines.slice(start, end);
    const before = lines.slice(0, start).filter((l) => l.kind !== "+").length;
    const after = lines.slice(0, start).filter((l) => l.kind !== "-").length;
    const oldCount = slice.filter((l) => l.kind !== "+").length;
    const newCount = slice.filter((l) => l.kind !== "-").length;
    out.push(
      `@@ -${before + 1},${oldCount} +${after + 1},${newCount} @@`,
      ...slice.map((l) => `${l.kind}${l.text}`),
    );
  }
  return `${out.join("\n")}\n`;
}
