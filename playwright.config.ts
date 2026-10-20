import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Lumen end-to-end tests.
 *
 * Tests live in `e2e/` and run against the Vite dev server on port 5173.
 * Locally `npx playwright test` will spin up the server via `npm run dev`.
 * In CI, set `PLAYWRIGHT_BASE_URL` to skip starting a fresh server.
 */
const PORT = 5173;
/**
 * Tests tagged @nightly (e2e/perf-vault.spec.ts: typing in a 2 MB note)
 * run only in the "perf" project, which the nightly workflow runs against
 * the production build — never in the per-browser PR jobs.
 */
const NIGHTLY = /@nightly/;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  // Every wait in e2e/ is a condition now (T23), so CI gets one retry,
  // not two; a test that needs it shows up in `npm run e2e:flake` and is
  // fixed there. Goes to 0 once e2e:flake --times 10 is green on CI.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", grepInvert: NIGHTLY, use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      grepInvert: NIGHTLY,
      use: {
        ...devices["Desktop Firefox"],
        // Headless Firefox on CI runners (no GPU) blocks WebGL by default,
        // so live-glsl rendered its "WebGL is not available" error view.
        // Force the software WebGL path the way Chromium's SwiftShader
        // gives one to the chromium project.
        // Headless Firefox still found no GL driver on CI even with Mesa
        // installed (FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS), so CI runs it
        // headed under Xvfb (PW_FIREFOX_HEADED=1), where Mesa's llvmpipe
        // provides GLX.
        headless: !process.env.PW_FIREFOX_HEADED,
        launchOptions: {
          firefoxUserPrefs: { "webgl.force-enabled": true, "webgl.disabled": false, "webgl.out-of-process": false },
        },
      },
    },
    { name: "webkit", grepInvert: NIGHTLY, use: { ...devices["Desktop Safari"] } },
    // `npx playwright test --project=perf` (.github/workflows/nightly-perf.yml).
    { name: "perf", grep: NIGHTLY, use: { ...devices["Desktop Chrome"] } },
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
