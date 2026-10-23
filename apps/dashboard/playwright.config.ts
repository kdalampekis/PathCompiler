import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const project = path.join(os.tmpdir(), "pathcompiler-dashboard-e2e");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Review actions change the shared project; run in order.
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3103", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "node tests/prepare-project.mjs && pnpm build && pnpm start --port 3103",
    url: "http://127.0.0.1:3103",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PATHCOMPILER_PROJECTS: JSON.stringify({ demo: { root: project } }),
    },
  },
});
