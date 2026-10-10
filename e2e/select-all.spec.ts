import { test, expect } from "@playwright/test";
import { WELCOME_DOC } from "../src/welcome";

test("source editor selects all after welcome document hydration", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await page.locator("header").first().waitFor({ state: "visible" });
  await page.keyboard.press("Meta+2");

  const editor = page.locator(".cm-content").first();
  await expect(editor).toBeVisible();
  const browserReportsMac = await page.evaluate(() => /Mac/.test(navigator.platform));
  console.log(`select_all_browser_mac=${browserReportsMac}`);

  const savedContent = () => page.evaluate(() => {
    const raw = localStorage.getItem("lumen-md");
    if (!raw) return null;
    try {
      return JSON.parse(raw)?.state?.doc?.content ?? null;
    } catch {
      return null;
    }
  });

  await expect.poll(savedContent, { timeout: 15_000 }).toBe(WELCOME_DOC);
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await expect.poll(savedContent).toBe(WELCOME_DOC);

  const code = "SELECT 1000 + 763";
  await editor.pressSequentially(code);
  await expect.poll(savedContent).toBe(code);
  await expect(editor).toHaveText(code);
});
