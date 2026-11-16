import { test, expect } from "@playwright/test";

/**
 * Jewish sources from Sefaria in the whole app (plan W5.1): typing
 * references sends nothing; "My notes on this verse" opens the side panel
 * on the verse under the cursor and closes. Sefaria itself is routed to a
 * stand-in, so the run needs no network and counts what would be sent.
 * src/__tests__/sefariaAppFlow.test.ts is the same flow on a real vault
 * (OPFS) through the app's modules.
 */

const run = (page: import("@playwright/test").Page, id: string) => page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
});

test("typing references sends nothing; My notes on this verse opens on the verse and closes", async ({ page }) => {
  const sent: string[] = [];
  await page.route(/sefaria\.org/, (route) => {
    sent.push(route.request().url());
    return route.fulfill({ status: 503, body: "" });
  });
  await page.goto("/");
  const editor = page.locator(".cm-content").first();
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  for (const ref of ["בראשית א ג", "שמות כ׳ ג׳", "Genesis 1:1", "ב״ר א, א"]) {
    await page.keyboard.type(`ראה ${ref}`);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("על [[בראשית א:א]]");
  expect(sent).toEqual([]);

  await run(page, "sources.notesOnVerse");
  const panel = page.getByTestId("verse-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("בראשית");
  await page.getByTestId("verse-panel-close").click();
  await expect(panel).toHaveCount(0);
  expect(sent).toEqual([]);
});
