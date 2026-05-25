import { test, expect } from "@playwright/test";

/**
 * Full user journey: open a fresh app → type markdown with a dynamic
 * block → flip view modes → switch locale → run the Find command —
 * all in one session, with no JS exceptions.
 *
 * This is the integration that catches regressions across the boundary
 * between editor (CM6) ↔ store (Zustand) ↔ renderer (remark/rehype) ↔
 * palette ↔ overlay system. The unit + smoke specs cover each in
 * isolation; this one proves they cooperate.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await page.locator("header").first().waitFor({ state: "visible", timeout: 5000 });
});

test("user journey: type, render, cycle modes, switch locale, open find — no exceptions", async ({
  page,
}) => {
  const pageErrors: { msg: string; stack?: string }[] = [];
  page.on("pageerror", (e) => {
    const m = e.message;
    // Filter only iframe / sandbox storage-denial noise which fires
    // unconditionally on dynamic blocks that mount sandboxed iframes
    // (HTML preview, live-js, embed). These are environmental, not
    // Lumen bugs.
    if (
      /Storage is disabled inside 'data:'|sandboxed and lacks the 'allow-same-origin'|allow-scripts/i.test(m)
    ) {
      return;
    }
    // ROUND-24 NOTE: the Milkdown lifecycle race that prompted earlier
    // filters here is no longer reproducible — likely fixed by the
    // round-23 fill+aria-selected deflake (no more racing input change
    // events into the editor) or the Mermaid 11.15 bump. Confirmed
    // across 3 isolated runs of this spec without the filter.
    pageErrors.push({ msg: m, stack: e.stack });
  });

  // 1. Default mode is Split. Type a doc with a Mermaid block + heading.
  await page.keyboard.press("Meta+2");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill(
    "# Quarterly Review\n\nKey metrics:\n\n```mermaid\ngraph LR; A --> B; B --> C\n```\n\nDone.\n",
  );
  // Heading should appear in the preview pane.
  await expect(
    page.locator(".markdown-preview h1, [data-preview-root] h1").first(),
  ).toBeVisible({ timeout: 5000 });
  // Mermaid renders.
  const svg = page
    .locator(".chart-block svg, .mermaid-block svg")
    .first();
  await expect(svg).toBeVisible({ timeout: 8_000 });

  // 2. Cycle through view modes: Source → Preview → WYSIWYG → Split.
  // Settle between mode flips so Milkdown's async teardown doesn't race
  // the next mount. (Real users don't press Meta+1/3/4 in <100ms.)
  await page.keyboard.press("Meta+1"); // Source-only
  await expect(page.locator(".cm-content").first()).toBeVisible();
  await page.waitForTimeout(200);
  await page.keyboard.press("Meta+3"); // Preview-only
  await expect(
    page.locator(".markdown-preview h1, [data-preview-root] h1").first(),
  ).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(200);
  await page.keyboard.press("Meta+4"); // WYSIWYG
  await expect(page.locator(".ProseMirror").first()).toBeVisible({
    timeout: 5000,
  });
  await page.waitForTimeout(300);
  await page.keyboard.press("Meta+2"); // Back to split
  await page.waitForTimeout(200);

  // 3. Switch locale to Hebrew via palette.
  await page.keyboard.press("Meta+K");
  const palette = page
    .locator('[role="dialog"][aria-modal="true"]')
    .filter({ has: page.locator("input") });
  await palette.waitFor({ timeout: 8000 });
  await palette.locator("input").first().fill("עברית");
  await expect(
    palette.locator('[role="option"][aria-selected="true"]'),
  ).toContainText(/עברית/, { timeout: 8000 });
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl", {
    timeout: 5000,
  });

  // 4. Open Find & Replace via palette (Hebrew locale). Type the
  // full phrase "חיפוש והחלפה" so we don't accidentally fire the
  // workspace-search command which also starts with "חיפוש".
  await page.keyboard.press("Meta+K");
  await palette.waitFor({ timeout: 8000 });
  await palette.locator("input").first().fill("חיפוש והחלפה");
  await expect(
    palette.locator('[role="option"][aria-selected="true"]'),
  ).toContainText(/חיפוש והחלפה/, { timeout: 8000 });
  await page.keyboard.press("Enter");
  // Find&Replace dialog should appear; its close button has localized
  // aria-label.
  await expect(
    page.locator('button[aria-label="סגור חיפוש והחלפה"]'),
  ).toBeVisible({ timeout: 3000 });

  // Final invariant: no JS exceptions occurred during the entire flow.
  // Include the stack so a regression is debuggable.
  expect(pageErrors.map((e) => ({ msg: e.msg, stack: (e.stack ?? "").split("\n").slice(0, 5).join(" | ") }))).toEqual([]);
});
