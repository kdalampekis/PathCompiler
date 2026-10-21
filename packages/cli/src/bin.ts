#!/usr/bin/env node
import { runCli } from "./index.js";

try {
  process.stdout.write(await runCli(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(
    `PathCompiler: ${error instanceof Error ? error.message : "Scan failed"}\n`,
  );
  process.exitCode = 1;
}
