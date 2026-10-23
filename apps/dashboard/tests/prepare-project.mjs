// Builds a real PathCompiler project for the dashboard e2e suite using the CLI.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "../../../fixtures/next-demo");
const cli = path.resolve(here, "../../../packages/cli/dist/bin.js");
const root = path.join(os.tmpdir(), "pathcompiler-dashboard-e2e");
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.test",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.test",
};
const git = (...args) =>
  execFileSync("git", ["-C", root, ...args], { env, encoding: "utf8" }).trim();
const run = (...args) =>
  execFileSync(
    process.execPath,
    [cli, ...args, "--out", path.join(root, ".pathcompiler")],
    {
      cwd: root,
      env,
      encoding: "utf8",
    },
  );

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const tracked = execFileSync(
  "git",
  ["-C", fixture, "ls-files", "-z", "--", "."],
  {
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);
for (const file of tracked) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  cpSync(path.join(fixture, file), path.join(root, file));
}
writeFileSync(path.join(root, ".gitignore"), ".pathcompiler/\n");
git("init", "--quiet");
git("add", ".");
git("commit", "--quiet", "-m", "base");
const base = git("rev-parse", "HEAD");
run("workflows", "discover", root);
for (const id of ["clients.create", "plans.change_structure"])
  run("workflows", "approve", id, root, "--by", "Ana");
const plans = path.join(root, "components/plans.tsx");
const tests = path.join(root, "tests/workflows.spec.ts");
for (const file of [plans, tests])
  writeFileSync(
    file,
    readFileSync(file, "utf8").replaceAll(
      '"plans.change_structure"',
      '"plans.restructure"',
    ),
  );
git("commit", "--quiet", "-am", "Rename plan structure action");
run("workflows", "discover", root);
run("workflows", "validate", "clients.create", root);
run("capabilities", "discover", root);
run("tests", "mine", root);
run("impact", base, "HEAD", root);
run("proposals", "generate", base, "HEAD", root);
run("workflows", "detect", base, "HEAD", root);
run("build");
console.log(`Prepared dashboard project at ${root}`);
