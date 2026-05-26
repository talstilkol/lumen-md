/**
 * Shared init script for e2e specs: nukes all Lumen-owned localStorage
 * keys so each test starts from a deterministic blank state.
 *
 * Persisted prefixes/keys (from a sweep of `localStorage.setItem(...)`
 * calls in src/):
 *   - "lumen-md"             — main Zustand persist bucket
 *   - "lumen-tour-done"      — onboarding tour completion flag
 *   - "lumen.*"              — feature-specific keys (collab, canvas,
 *                              gdrive tokens, dropbox tokens, publish
 *                              mock, search history, template downloads,
 *                              entitlement override, etc.)
 *   - "lumen-*"              — older flat keys (sidebar width, etc.)
 *
 * The dotted "lumen." namespace covers OAuth tokens and collab signaling
 * URLs which previously leaked between test runs. We clear those too so
 * a test box that was logged into gdrive/dropbox manually doesn't taint
 * the suite.
 *
 * Usage:
 *   import { registerLumenStateReset } from "./_clear-state";
 *   test.beforeEach(async ({ page }) => {
 *     await registerLumenStateReset(page);
 *     await page.goto("/");
 *   });
 *
 * The pure function `clearLumenState` is also exported for browser-side
 * use via `page.evaluate(clearLumenState)`. The browser-side body has
 * NO non-browser dependencies so it can be cleanly serialised.
 */

import type { Page } from "@playwright/test";

/**
 * Browser-side cleanup. Runs inside the page; doesn't touch Node.
 * Exported so Playwright can `page.addInitScript(clearLumenState)`
 * and the same function works in `page.evaluate(...)`.
 */
export function clearLumenState(): void {
  try {
    const remove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("lumen-") || k.startsWith("lumen.")) remove.push(k);
    }
    for (const k of remove) localStorage.removeItem(k);
    // Re-set the tour-done flag so the onboarding modal doesn't pop on
    // first paint. Cleared state + tour-done is the canonical "fresh
    // user, second-launch" snapshot.
    localStorage.setItem("lumen-tour-done", "1");
  } catch {
    /* localStorage unavailable — caller still proceeds. */
  }
}

/**
 * Playwright-side helper. Registers the cleanup as an init script so
 * it fires before any page script. Use in `beforeEach`.
 */
export async function registerLumenStateReset(page: Page): Promise<void> {
  await page.addInitScript(clearLumenState);
}

/**
 * Legacy alias kept for any spec that imports the old name.
 * @deprecated Use `clearLumenState` (browser) or `registerLumenStateReset` (Playwright).
 */
export const CLEAR_LUMEN_STATE = clearLumenState;
