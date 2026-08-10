import { defineConfig, devices } from "@playwright/test";

/**
 * Package 19 — Playwright E2E against local API (:8787) + Vite web (:5173).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command:
        "pnpm --filter @cloud-connector/api exec node --experimental-strip-types src/index.ts",
      url: "http://127.0.0.1:8787/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      cwd: "../..",
    },
    {
      command: "pnpm --filter @cloud-connector/web exec vite --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      cwd: "../..",
    },
  ],
});
