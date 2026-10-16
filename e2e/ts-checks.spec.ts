import { test, expect } from "@playwright/test";

/**
 * TypeScript checks in ```ts code blocks (opt-in). Turns the setting on
 * from the command palette, then waits for the real compiler (in a worker)
 * to underline a type error — proving the worker loads under the app's CSP
 * and positions map back into the document.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await page.locator("header").first().waitFor({ state: "visible", timeout: 5000 });
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
});

test("type errors in a ts block are underlined with the compiler's message", async ({ page }) => {
  test.setTimeout(120_000);
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill("```ts\nconst answer: number = 'forty-two';\n```\n");

  await page.keyboard.press("Meta+K");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.type("TypeScript checks");
  await page.getByRole("option", { name: /Enable TypeScript checks/ }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();

  await expect(editor).toContainText("forty-two");
  const mark = page.locator(".cm-ts-error").first();
  await expect(mark).toBeVisible({ timeout: 90_000 });
  await expect(mark).toHaveText("answer");
  await expect(mark).toHaveAttribute("title", /TS2322: Type 'string' is not assignable to type 'number'/);
});
