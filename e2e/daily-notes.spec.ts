import { test, expect, type Page } from "@playwright/test";

/**
 * Plan 4.12 — daily notes: ⌥⌘D (Ctrl+Alt+D) creates and opens
 * journal/<today>.md from the template; pressing it again opens the same
 * note — no second file, no second tab. The calendar marks the day.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
});

const todayIso = (page: Page) =>
  page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

/** The file names in the vault's journal/ folder (empty when there is none). */
const journalFiles = (page: Page) =>
  page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("journal");
      const names: string[] = [];
      for await (const [name] of (dir as unknown as { entries(): AsyncIterable<[string, unknown]> }).entries()) names.push(name);
      return names.sort();
    } catch {
      return [] as string[];
    }
  });

test("today's note is created, opened, and not duplicated when opened again", async ({ page }) => {
  const today = await todayIso(page);
  expect(await journalFiles(page)).toEqual([]);

  await page.keyboard.press("ControlOrMeta+Alt+KeyD");
  const editor = page.locator(".cm-content").first();
  await expect.poll(() => journalFiles(page), { timeout: 10_000 }).toEqual([`${today}.md`]);
  // The default template: "# {{title}}" then "{{weekday}} · {{hebrewDate}}".
  await expect(editor).toContainText(/\d{4}/, { timeout: 10_000 });
  await expect(editor).toContainText("·");
  await expect(editor).not.toContainText("Welcome to");
  await expect(editor).not.toContainText("{{");
  const tabs = page.locator(`.doc-tabs [data-tab-index]`).filter({ hasText: `${today}.md` });
  await expect(tabs).toHaveCount(1);

  // Type something, then open today's note again: same note, edits kept.
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("first entry");
  await page.keyboard.press("ControlOrMeta+Alt+KeyD");
  await page.waitForTimeout(500);
  await expect(editor).toContainText("first entry");
  expect(await journalFiles(page)).toEqual([`${today}.md`]);
  await expect(tabs).toHaveCount(1);

  // The calendar (from the command palette) marks the day; a click opens the same note.
  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.locator('[role="dialog"]').filter({ has: page.locator("input") });
  await expect(palette).toBeVisible();
  await palette.locator("input").first().fill("calendar");
  await page.keyboard.press("Enter");
  const cal = page.getByTestId("calendar");
  await expect(cal).toBeVisible({ timeout: 5000 });
  await expect(cal.locator(`[data-date="${today}"]`)).toHaveAttribute("data-has-note", "true", { timeout: 5000 });
  await expect(cal.locator(`[data-date="${today}"]`)).toHaveAttribute("aria-current", "date");
  await cal.locator(`[data-date="${today}"]`).click();
  await page.waitForTimeout(300);
  expect(await journalFiles(page)).toEqual([`${today}.md`]);
  await expect(tabs).toHaveCount(1);
  await expect(editor).toContainText("first entry");
});
