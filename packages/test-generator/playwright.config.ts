import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Runs the candidates scripts/generate.mjs wrote from the fixture against a
// fresh fixture build.
export default defineConfig({
  testDir: "./browser-test/generated",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3102", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && pnpm start --port 3102",
    cwd: fileURLToPath(new URL("../../fixtures/next-demo", import.meta.url)),
    url: "http://127.0.0.1:3102",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
