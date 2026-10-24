import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/next-demo/", import.meta.url),
);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => rm(item, { recursive: true, force: true })),
  );
});
async function directory() {
  const result = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-context-"));
  temporary.push(result);
  return result;
}

describe("scan --explain-model-context", () => {
  it("lists exactly what would be sent, without file contents", async () => {
    const cwd = await directory();
    const output = await runCli(
      ["scan", fixture, "--explain-model-context"],
      cwd,
    );
    expect(output).toMatch(
      /^Model context dry run \(provider: none; nothing sent\)\.\ninferCapabilities: \d+ bytes, \d+ surfaces, evidence /,
    );
    expect(output).toContain("components/clients.tsx");
    const context = JSON.parse(
      await readFile(
        path.join(cwd, ".pathcompiler", "reports", "model-context.json"),
        "utf8",
      ),
    );
    expect(context).toMatchObject({
      kind: "model-context",
      sent: false,
      provider: "none",
    });
    const payload = JSON.stringify(context.requests[0].payload);
    expect(context.requests[0].bytes).toBe(Buffer.byteLength(payload));
    // Evidence locators, never source text.
    expect(payload).not.toContain("export default function");
    expect(payload).not.toContain("useState");
  });

  it("redacts secrets and never reads hidden files", async () => {
    const root = await directory();
    await mkdir(path.join(root, "app"));
    await writeFile(
      path.join(root, ".env"),
      "SECRET_TOKEN=do-not-send-123456\n",
    );
    await writeFile(
      path.join(root, "app", "page.tsx"),
      'export default function Page() { return <button data-pathcompiler="keys.rotate" aria-label="Rotate sk-abcdefghijklmnopqrstuv">Rotate</button>; }\n',
    );
    const cwd = await directory();
    const output = await runCli(
      ["scan", root, "--explain-model-context", "--json"],
      cwd,
    );
    expect(output).not.toContain("do-not-send");
    expect(output).not.toContain("sk-abcdefghijklmnopqrstuv");
    const context = JSON.parse(output);
    expect(context.requests[0].redactions).toEqual({
      "provider-key": expect.any(Number),
    });
    await expect(
      runCli(["diff", "a", "b", "--explain-model-context"], cwd),
    ).rejects.toThrow("--explain-model-context is only supported by scan.");
  });
});
