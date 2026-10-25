import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("review", () => {
  it("queues pending candidates by explained priority and records feedback", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pathcompiler-review-"));
    temporary.push(cwd);
    const run = (args: string[]) => runCli([...args, "--out", "out"], cwd);
    await run(["workflows", "discover", fixture]);
    await writeFile(
      path.join(cwd, "impact.json"),
      JSON.stringify({ plans: 1, "clients.create": 0.2 }),
    );
    const queue = await run(["review", "queue", "--impact", "impact.json"]);
    expect(queue).toMatch(/^Review queue: \d+ pending items/);
    const json = JSON.parse(
      await run(["review", "queue", "--impact", "impact.json", "--json"]),
    );
    const ids = json.items.map((item: { id: string }) => item.id);
    expect(ids).toContain("clients.create");
    // Impact 1 for plans versus 0.2 for clients.create, all else similar.
    expect(ids.indexOf("plans.create")).toBeLessThan(
      ids.indexOf("clients.create"),
    );
    await run(["workflows", "reject", "clients.create", "--by", "reviewer"]);
    const after = JSON.parse(await run(["review", "queue", "--json"]));
    expect(after.items.map((item: { id: string }) => item.id)).not.toContain(
      "clients.create",
    );
    expect(await run(["review", "feedback"])).toContain(
      "Review feedback: 1 decisions (1 rejected).",
    );
    await expect(run(["review", "other"])).rejects.toThrow(
      "Expected: pathcompiler review queue",
    );
    await expect(run(["build", "--impact", "impact.json"])).rejects.toThrow(
      "--impact is only supported by review queue.",
    );
  });
});
