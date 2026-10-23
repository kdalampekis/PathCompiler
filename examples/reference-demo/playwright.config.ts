import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-test",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // The unchanged reference fixture (the "base" product).
      command: "pnpm build && pnpm start --port 3104",
      cwd: fileURLToPath(new URL("../../fixtures/next-demo", import.meta.url)),
      url: "http://127.0.0.1:3104",
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // Runs the demo, then serves the changed ("head") product.
      command:
        "node src/prepare.ts && cd .work/app && ./node_modules/.bin/next build && ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3105",
      url: "http://127.0.0.1:3105",
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
