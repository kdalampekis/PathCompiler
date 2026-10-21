import path from "node:path";
import type {
  AnalysisDiagnostic,
  SourceProject,
} from "@pathcompiler/source-model";
import ts from "typescript";
import { z } from "zod";

const root = "/__pathcompiler__/";
const CompilerOptionsSchema = z.object({
  baseUrl: z.string().optional(),
  paths: z.record(z.string(), z.array(z.string())).optional(),
});
const ManifestSchema = z.object({
  name: z.string().optional(),
  main: z.string().optional(),
  exports: z.unknown().optional(),
});

export function createSourceProgram(
  project: SourceProject,
  diagnostics: AnalysisDiagnostic[],
) {
  const contents = new Map(
    project.files.map((file) => [root + file.path, file.content]),
  );
  for (const [name, content] of Object.entries(project.configs))
    contents.set(root + name, content);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    allowJs: true,
    noLib: true,
    types: [],
    noEmit: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
  };
  const configName = project.configs["tsconfig.json"]
    ? "tsconfig.json"
    : "jsconfig.json";
  const config = project.configs[configName];
  if (config) {
    const parsed = ts.parseConfigFileTextToJson(configName, config);
    if (parsed.error)
      throw new Error(
        `${configName}: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, " ")}`,
      );
    const configObject = z
      .object({
        compilerOptions: CompilerOptionsSchema.optional(),
        extends: z.unknown().optional(),
      })
      .parse(parsed.config);
    const compiler = configObject.compilerOptions;
    if (compiler?.baseUrl !== undefined)
      options.baseUrl = path.posix.resolve(root, compiler.baseUrl);
    if (compiler?.paths !== undefined) {
      options.paths = compiler.paths;
      options.baseUrl ??= root;
    }
    if (configObject.extends !== undefined)
      diagnostics.push({
        code: "config-extends",
        file: configName,
        message:
          "Only root compilerOptions.baseUrl/paths are used; inherited aliases are not expanded in Phase 1.",
      });
  }
  const packages = new Map<string, string>();
  for (const [file, content] of Object.entries(project.configs)) {
    if (!file.endsWith("package.json")) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new Error(`Invalid JSON in ${file}`);
    }
    const manifest = ManifestSchema.parse(raw);
    if (!manifest.name) continue;
    const exports = manifest.exports;
    const entry =
      typeof exports === "string"
        ? exports
        : exports &&
            typeof exports === "object" &&
            "." in exports &&
            typeof exports["."] === "string"
          ? exports["."]
          : manifest.main;
    if (entry)
      packages.set(
        manifest.name,
        path.posix.resolve(root, path.posix.dirname(file), entry),
      );
  }
  const host: ts.CompilerHost = {
    getSourceFile: (file, languageVersion) => {
      const content = contents.get(file);
      return content === undefined
        ? undefined
        : ts.createSourceFile(file, content, languageVersion, true);
    },
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => root,
    getDirectories: () => [],
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (file) => contents.has(file),
    readFile: (file) => contents.get(file),
    directoryExists: (directory) =>
      [...contents.keys()].some((file) =>
        file.startsWith(`${directory.replace(/\/$/, "")}/`),
      ),
  };
  const resolve = (
    name: string,
    containingFile: string,
  ): ts.ResolvedModuleFull | undefined => {
    const target = packages.get(name);
    const resolved = ts.resolveModuleName(
      target ?? name,
      containingFile,
      options,
      host,
    ).resolvedModule;
    return target && resolved
      ? { ...resolved, resolvedUsingTsExtension: false }
      : resolved;
  };
  host.resolveModuleNames = (names, containingFile) =>
    names.map((name) => resolve(name, containingFile));
  const program = ts.createProgram(
    project.files.map((file) => root + file.path),
    options,
    host,
  );
  const errors = program.getSyntacticDiagnostics();
  if (errors.length > 0)
    throw new Error(
      errors
        .map(
          (error) =>
            `${error.file?.fileName.replace(root, "") ?? "source"}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`,
        )
        .join("\n"),
    );
  return {
    program,
    resolve,
    relative: (file: string) => file.slice(root.length),
  };
}
