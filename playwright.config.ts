import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Lumen end-to-end tests.
 *
 * Tests live in `e2e/` and run against the Vite dev server on port 5173.
 * Locally `npx playwright test` will spin up the server via `npm run dev`.
 * In CI, set `PLAYWRIGHT_BASE_URL` to skip starting a fresh server.
 */
const PORT = 5173;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  // Local runs get 1 retry to absorb the well-documented palette-
  // filter timing race (see e2e/locale-switch.spec.ts deflake notes
  // across rounds 7/13/16). The race fires < 1 % of runs but stacks
  // up across an 80-test suite. CI uses 2 retries.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
