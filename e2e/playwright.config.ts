import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { APP_URL } from "./env";

const root = fileURLToPath(new URL("..", import.meta.url));

// Real Chromium + a real wallet extension + the e2e-testable web app + local KERIA. See README "End-to-end tests".
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]],
  outputDir: "../test-results",
  webServer: {
    command: "npm --prefix e2e/e2e-testable-web-app run dev",
    cwd: root,
    url: APP_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
