import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/test/**/*.test.ts", "examples/*/test/**/*.test.ts"],
    // Many suites re-analyze the fixture in parallel; 5 s flakes under load.
    testTimeout: 30_000,
  },
});
