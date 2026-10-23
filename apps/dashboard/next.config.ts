import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  // Run PathCompiler core packages from their built ESM, not the bundler.
  serverExternalPackages: [
    "@pathcompiler/cli",
    "@pathcompiler/workflow-compiler",
    "@pathcompiler/workflow-discovery",
    "@pathcompiler/workflow-proposals",
    "@pathcompiler/workflow-review",
  ],
};
export default config;
