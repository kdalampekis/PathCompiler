import { readFile } from "node:fs/promises";
import path from "node:path";
import { git } from "./git.js";

/**
 * What a repository offers as checks, whatever its language. This looks at
 * files that tell how a project is tested, linted, type-checked and built,
 * and proposes commands; it never runs them. A person (or the configuration)
 * decides which ones count, because a check is only as trustworthy as the
 * project's own tests.
 */
export type CheckKind = "test" | "lint" | "typecheck" | "build";
export type CheckSuggestion = {
  ecosystem: string;
  kind: CheckKind;
  command: string;
  /** The file that made this suggestion plausible. */
  evidence: string;
  /** Needs installed dependencies or a build; list it under harness.setup. */
  needsSetup?: string;
};
type File = { path: string; content: string };

const has = (files: readonly File[], name: string | RegExp) =>
  files.find((file) =>
    typeof name === "string"
      ? file.path === name || file.path.endsWith(`/${name}`)
      : name.test(file.path),
  );

export function detectChecks(files: readonly File[]): CheckSuggestion[] {
  const out: CheckSuggestion[] = [];
  const add = (item: CheckSuggestion) => out.push(item);

  // JavaScript / TypeScript: the project's own scripts, with its package manager.
  const pkg = files.find((file) => file.path === "package.json");
  if (pkg) {
    let scripts: Record<string, string> = {};
    try {
      scripts =
        (JSON.parse(pkg.content) as { scripts?: Record<string, string> })
          .scripts ?? {};
    } catch {
      scripts = {};
    }
    const manager = has(files, "pnpm-lock.yaml")
      ? "pnpm"
      : has(files, "yarn.lock")
        ? "yarn"
        : has(files, "bun.lockb") || has(files, "bun.lock")
          ? "bun"
          : "npm run";
    const run = (name: string) =>
      manager === "npm run" ? `npm run ${name}` : `${manager} ${name}`;
    const setup =
      manager === "pnpm"
        ? "pnpm install --frozen-lockfile"
        : manager === "yarn"
          ? "yarn install --frozen-lockfile"
          : manager === "bun"
            ? "bun install --frozen-lockfile"
            : "npm ci";
    for (const [kind, names] of [
      ["test", ["test"]],
      ["lint", ["lint"]],
      ["typecheck", ["typecheck", "type-check", "tsc"]],
      ["build", ["build"]],
    ] as const) {
      const name = names.find((candidate) => scripts[candidate]);
      if (name)
        add({
          ecosystem: "javascript",
          kind,
          command:
            manager === "npm run" && name === "test" ? "npm test" : run(name),
          evidence: "package.json",
          needsSetup: setup,
        });
    }
  }
  // Python.
  const python =
    has(files, "pyproject.toml") ??
    has(files, "setup.py") ??
    has(files, "setup.cfg") ??
    has(files, "pytest.ini") ??
    has(files, "tox.ini") ??
    has(files, "requirements.txt");
  const pythonTests = files.some((file) =>
    /(^|\/)(test_[^/]+|[^/]+_test)\.py$/.test(file.path),
  );
  if (python || pythonTests) {
    const usesPytest =
      files.some(
        (file) =>
          /\bpytest\b/.test(file.content) &&
          /(pyproject\.toml|setup\.cfg|tox\.ini|pytest\.ini|requirements[^/]*\.txt)$/.test(
            file.path,
          ),
      ) || has(files, "pytest.ini");
    const evidence =
      (python ?? files.find((file) => /test_[^/]+\.py$/.test(file.path)))
        ?.path ?? "tests";
    add({
      ecosystem: "python",
      kind: "test",
      command: usesPytest
        ? "python3 -m pytest -q"
        : "python3 -m unittest discover",
      evidence,
    });
    if (
      files.some(
        (file) =>
          /\[tool\.ruff\]|\bruff\b/.test(file.content) &&
          /pyproject\.toml|ruff\.toml/.test(file.path),
      ) ||
      has(files, "ruff.toml")
    )
      add({
        ecosystem: "python",
        kind: "lint",
        command: "ruff check .",
        evidence: "ruff configuration",
      });
    if (
      files.some(
        (file) =>
          /\[tool\.mypy\]|\bmypy\b/.test(file.content) &&
          /pyproject\.toml|mypy\.ini|setup\.cfg/.test(file.path),
      ) ||
      has(files, "mypy.ini")
    )
      add({
        ecosystem: "python",
        kind: "typecheck",
        command: "mypy .",
        evidence: "mypy configuration",
      });
  }
  // Go.
  if (has(files, "go.mod")) {
    add({
      ecosystem: "go",
      kind: "test",
      command: "go test ./...",
      evidence: "go.mod",
    });
    add({
      ecosystem: "go",
      kind: "lint",
      command: "go vet ./...",
      evidence: "go.mod",
    });
    add({
      ecosystem: "go",
      kind: "build",
      command: "go build ./...",
      evidence: "go.mod",
    });
  }
  // Rust.
  if (has(files, "Cargo.toml")) {
    add({
      ecosystem: "rust",
      kind: "test",
      command: "cargo test",
      evidence: "Cargo.toml",
    });
    add({
      ecosystem: "rust",
      kind: "lint",
      command: "cargo clippy -- -D warnings",
      evidence: "Cargo.toml",
    });
    add({
      ecosystem: "rust",
      kind: "build",
      command: "cargo build",
      evidence: "Cargo.toml",
    });
  }
  // JVM.
  if (has(files, "pom.xml"))
    add({
      ecosystem: "java",
      kind: "test",
      command: "mvn -q test",
      evidence: "pom.xml",
    });
  const gradle = has(files, /(^|\/)build\.gradle(\.kts)?$/);
  if (gradle)
    add({
      ecosystem: "java",
      kind: "test",
      command: has(files, "gradlew") ? "./gradlew test" : "gradle test",
      evidence: gradle.path,
    });
  // .NET.
  const dotnet = has(files, /\.(sln|csproj|fsproj)$/);
  if (dotnet)
    add({
      ecosystem: "dotnet",
      kind: "test",
      command: "dotnet test",
      evidence: dotnet.path,
    });
  // Ruby.
  if (has(files, "Gemfile")) {
    const rspec = files.some((file) =>
      /(^|\/)spec\/[^/]+_spec\.rb$/.test(file.path),
    );
    add({
      ecosystem: "ruby",
      kind: "test",
      command: rspec ? "bundle exec rspec" : "bundle exec rake test",
      evidence: "Gemfile",
    });
  }
  // PHP.
  if (
    has(files, "composer.json") &&
    (has(files, "phpunit.xml") ?? has(files, "phpunit.xml.dist"))
  )
    add({
      ecosystem: "php",
      kind: "test",
      command: "vendor/bin/phpunit",
      evidence: "phpunit.xml",
    });
  // Elixir, Swift.
  if (has(files, "mix.exs"))
    add({
      ecosystem: "elixir",
      kind: "test",
      command: "mix test",
      evidence: "mix.exs",
    });
  if (has(files, "Package.swift"))
    add({
      ecosystem: "swift",
      kind: "test",
      command: "swift test",
      evidence: "Package.swift",
    });
  // Makefile targets, for projects that wrap their tooling.
  const make = files.find((file) => file.path === "Makefile");
  if (make)
    for (const [kind, target] of [
      ["test", "test"],
      ["lint", "lint"],
      ["build", "build"],
    ] as const)
      if (new RegExp(`^${target}\\s*:`, "m").test(make.content))
        add({
          ecosystem: "make",
          kind,
          command: `make ${target}`,
          evidence: "Makefile",
        });

  const seen = new Set<string>();
  return out.filter((item) => {
    const key = `${item.kind}:${item.command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const MANIFESTS =
  /(^|\/)(package\.json|pyproject\.toml|setup\.(py|cfg)|tox\.ini|pytest\.ini|mypy\.ini|ruff\.toml|requirements[^/]*\.txt|Makefile|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|gradlew|Gemfile|composer\.json|phpunit\.xml(\.dist)?|mix\.exs|Package\.swift|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|[^/]+\.(sln|csproj|fsproj))$/;

/**
 * The files `detectChecks` needs from a repository: the tracked file list (so
 * test files count) and the contents of the small manifests. Reads nothing
 * else.
 */
export async function collectEcosystemFiles(
  repo: string,
): Promise<{ path: string; content: string }[]> {
  const listed = (await git(repo, ["ls-files"]).catch(() => ""))
    .split("\n")
    .filter(Boolean);
  const files: { path: string; content: string }[] = [];
  for (const name of listed.slice(0, 20_000)) {
    let content = "";
    if (MANIFESTS.test(name))
      content = await readFile(path.join(repo, name), "utf8").then(
        (text) => text.slice(0, 200_000),
        () => "",
      );
    files.push({ path: name, content });
  }
  return files;
}
