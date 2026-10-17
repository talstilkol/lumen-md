import { test, expect } from "@playwright/test";

/**
 * Data safety (MASTER_PLAN v3 §14) — part A, the history store (T35):
 * what the user typed shows up in Version History without them saving,
 * a restore brings it back, and the restore itself can be undone.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
});

async function openHistory(page: import("@playwright/test").Page) {
  await page.keyboard.press("Meta+K");
  const palette = page.locator('[role="dialog"]').filter({ has: page.locator("input") });
  await expect(palette).toBeVisible();
  await palette.locator("input").first().fill("version history");
  await expect(palette.locator('[role="option"][aria-selected="true"]')).toContainText(/Version History/i);
  await page.keyboard.press("Enter");
  const panel = page.locator('[role="dialog"][aria-label="Version History"]');
  await expect(panel).toBeVisible({ timeout: 5000 });
  return panel;
}

test("a version is kept without saving, restores, and the restore is undoable", async ({ page }) => {
  await page.keyboard.press("Meta+1");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill("# First draft\n\nwritten without pressing save");
  // Hiding the page is a save point (pagehide / visibilitychange flush).
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  await editor.press("ControlOrMeta+a");
  await editor.fill("# Second draft");

  const panel = await openHistory(page);
  const entries = panel.locator("button").filter({ hasText: /chars/ });
  await expect(entries.first()).toBeVisible({ timeout: 5000 });
  // Pick the version that holds the first draft and restore it.
  const count = await entries.count();
  let restored = false;
  for (let i = 0; i < count && !restored; i++) {
    await entries.nth(i).click();
    if ((await panel.locator("pre").first().textContent())?.includes("First draft")) {
      await panel.getByRole("button", { name: /Restore this version/i }).click();
      restored = true;
    }
  }
  expect(restored).toBe(true);
  await expect(panel).toBeHidden();
  await expect(editor).toContainText("First draft");

  // The text the restore replaced is itself in the history now.
  const again = await openHistory(page);
  await expect(again.locator("button").filter({ hasText: /before restore/i }).first()).toBeVisible();
});

test("auto-backups no longer create files in the vault", async ({ page }) => {
  // Let the auto-backup run once (it fires 30 s after the last edit; the
  // pagehide flush forces it now).
  await page.locator(".cm-content").first().click();
  await page.keyboard.type(" edit");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  const names = await page.evaluate(async () => {
    try {
      const root = (await navigator.storage.getDirectory()) as unknown as { keys?: () => AsyncIterable<string>; entries?: () => AsyncIterable<[string, unknown]> };
      const out: string[] = [];
      if (root.keys) for await (const name of root.keys()) out.push(name);
      else if (root.entries) for await (const [name] of root.entries()) out.push(name);
      return out;
    } catch {
      // No OPFS in this engine: nothing can be written there either.
      return [];
    }
  });
  expect(names).not.toContain("backups");
});
