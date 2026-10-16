import { test, expect } from "@playwright/test";

/**
 * Suggesting mode (track changes) in the WYSIWYG editor: edits are written
 * to the document as CriticMarkup, shown as <ins>/<del>, and accepting all
 * resolves them.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
});

test("WYSIWYG edits are tracked as suggestions while suggesting is on", async ({ page }) => {
  await page.keyboard.press("Meta+1"); // source
  const source = page.locator(".cm-content").first();
  await source.click();
  await source.press("ControlOrMeta+a");
  await source.fill("Hello world and {++earlier++} text.\n");

  // Suggesting on (status bar), then WYSIWYG.
  await page.getByTestId("status-suggesting").click();
  await expect(page.getByTestId("status-suggesting")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Meta+4");
  const pm = page.locator(".ProseMirror").first();
  await expect(pm).toBeVisible({ timeout: 8_000 });
  // Existing CriticMarkup renders as a suggestion, not as literal braces.
  await expect(pm.locator("ins.critic-ins")).toHaveText("earlier");
  await expect(pm).not.toContainText("{++");

  // Put the caret right after "world" and edit.
  await pm.getByText("Hello world", { exact: false }).click();
  await page.keyboard.press("Home");
  for (let i = 0; i < "Hello world".length; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.type(" big");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.type("Hi");
  await expect(pm.locator("del.critic-del")).toHaveText("Hello");
  await expect(pm.locator("ins.critic-ins").first()).toHaveText("Hi");

  // Back to source: the document holds CriticMarkup.
  await page.keyboard.press("Meta+1");
  await expect(source).toContainText("{~~Hello~>Hi~~}", { timeout: 5_000 });
  await expect(source).toContainText(/\{\+\+[\s\u00a0]?big\+\+\}/);
  await expect(source).toContainText("{++earlier++}");
});
