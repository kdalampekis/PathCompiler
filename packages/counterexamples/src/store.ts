import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CounterexampleRecord } from "./record.js";

/**
 * A directory of `cx-<hash>.json` files. Recording the same counterexample
 * twice keeps the first observation: the same finding is one record, not a
 * growing pile.
 */
const NAME = /^cx-[0-9a-f]{12}$/;
const file = (directory: string, id: string) => {
  if (!NAME.test(id)) throw new Error(`"${id}" is not a counterexample ID.`);
  return path.join(directory, `${id}.json`);
};

export async function readCounterexample(
  directory: string,
  id: string,
): Promise<CounterexampleRecord> {
  let text: string;
  try {
    text = await readFile(file(directory, id), "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("not a counterexample")
    )
      throw error;
    throw new Error(`No counterexample ${id} in ${directory}.`, {
      cause: error,
    });
  }
  return JSON.parse(text) as CounterexampleRecord;
}

export async function recordCounterexample(
  directory: string,
  record: CounterexampleRecord,
): Promise<{ record: CounterexampleRecord; created: boolean }> {
  await mkdir(directory, { recursive: true });
  try {
    return {
      record: await readCounterexample(directory, record.id),
      created: false,
    };
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.startsWith("No counterexample")
    )
      throw error;
  }
  await writeFile(
    file(directory, record.id),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return { record, created: true };
}

export async function listCounterexamples(
  directory: string,
): Promise<CounterexampleRecord[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const records: CounterexampleRecord[] = [];
  for (const name of names.sort())
    if (name.endsWith(".json") && NAME.test(name.slice(0, -5)))
      records.push(await readCounterexample(directory, name.slice(0, -5)));
  return records;
}

/** Marks a counterexample fixed once an eval derived from it passes. */
export async function resolveCounterexample(
  directory: string,
  id: string,
  fix: { by: string; at: string },
): Promise<CounterexampleRecord> {
  const record = await readCounterexample(directory, id);
  const fixed: CounterexampleRecord = {
    ...record,
    status: "fixed",
    fixedAt: fix.at,
    fixedBy: fix.by,
  };
  await writeFile(file(directory, id), `${JSON.stringify(fixed, null, 2)}\n`);
  return fixed;
}
