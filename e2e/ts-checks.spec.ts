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

test("hover shows the type and completions offer members", async ({ page }) => {
  test.setTimeout(120_000);
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill("```ts\nconst total: number = 40 + 2;\ntotal\n```\n");

  await page.keyboard.press("Meta+K");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.type("TypeScript checks");
  await page.getByRole("option", { name: /Enable TypeScript checks/ }).click();

  // Hover the second `total` (line 3) for its type.
  const usage = page.locator(".cm-line", { hasText: /^total$/ });
  const tip = page.locator(".cm-ts-hover");
  // Point at the word itself (the line box is full width); re-hover until the
  // worker has loaded and answered.
  await expect(async () => {
    const box = (await usage.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.move(box.x + 12, box.y + box.height / 2);
    await expect(tip).toContainText("const total: number", { timeout: 3_000 });
  }).toPass({ timeout: 90_000 });

  // Type a member access and wait for the completion list.
  await usage.click();
  await page.keyboard.press("End");
  await page.keyboard.type(".toF");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("toFixed", { timeout: 30_000 });
});
