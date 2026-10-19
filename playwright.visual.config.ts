import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression in CI (plan 10.3): e2e-visual/visual-matrix.spec.ts
 * screenshots every main surface in English and Hebrew, dark and light,
 * and compares each with the baseline committed under
 * e2e-visual/baselines/. Chromium only: one engine, one OS (the CI runner),
 * one deterministic rasteriser.
 *
 *   npm run visual            compare (what CI does; a missing baseline fails)
 *   npm run visual:update     rewrite the baselines on purpose
 *
 * Baselines are rendered by CI's own chromium and fonts, so they are
 * refreshed by the "visual baselines" workflow (workflow_dispatch), not by
 * a local run — see CONTRIBUTING.md.
 */
const PORT = 5173;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e-visual",
  // One flat baseline name per shot: the matrix is chromium on linux only,
  // so the platform suffix Playwright would add carries nothing.
  snapshotPathTemplate: "{testDir}/baselines/{arg}{ext}",
  // CI compares and never writes: a missing baseline is a failure. A local
  // run writes a missing one (and still fails), so it can be looked at.
  updateSnapshots: process.env.CI ? "none" : "missing",
  timeout: 60_000,
  // toHaveScreenshot retries until two consecutive shots are identical, so
  // a surface that is still settling (status probes, lazy chunks) waits
  // here instead of producing a different picture each run.
  // Shots are taken at half resolution (deviceScaleFactor 0.5, scale
  // "device"): the layout is the real 1280×800 desktop one, the PNG is
  // 640×400 and ~80 KB instead of ~250 KB, and a layout or colour change
  // still moves far more pixels than the tolerance.
  expect: { timeout: 15_000, toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "device" } },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["line"], ["github"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results/visual",
  use: {
    baseURL: BASE_URL,
    trace: "off",
    video: "off",
    screenshot: "off",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 0.5,
    reducedMotion: "reduce",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 0.5 } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
