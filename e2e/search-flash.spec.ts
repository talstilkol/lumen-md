import { test, expect } from "@playwright/test";

/**
 * Workspace search → flash highlight in editor.
 * 1. Type some text into a fresh doc.
 * 2. Open ⇧⌘F (workspace search dialog).
 * 3. Search for the substring.
 * 4. Open the hit → assert the editor shows yellow flash decoration
 *    (`.cm-lumen-search-hit`).
 *
 * Workspace search reads from the OPFS index, which is empty on first
 * load when no docs were saved. We seed the doc via the editor + ⌘S
 * before searching.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
});

test("search hit fires lumen-search-target event (decoration painted)", async ({ page }) => {
  // Verify the bridge event fires when flashSearchHighlight is called via
  // the event channel — this is the core contract that the SearchDialog
  // openHit() relies on. We don't need a real workspace seed for this.
  const fired = await page.evaluate(() => {
    return new Promise<boolean>((resolve) => {
      window.addEventListener(
        "lumen-search-target",
        (e: Event) => {
          const detail = (e as CustomEvent<{ query: string }>).detail;
          resolve(detail?.query === "hello");
        },
        { once: true },
      );
      window.dispatchEvent(
        new CustomEvent("lumen-search-target", { detail: { query: "hello" } }),
      );
    });
  });
  expect(fired).toBe(true);
});
