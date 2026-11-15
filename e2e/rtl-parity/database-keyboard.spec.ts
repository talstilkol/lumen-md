import { test, expect, type Page } from "@playwright/test";
import { vaultOrSkip } from "../_opfs";
import { LOCALES, type Locale } from "./_rtl";

/**
 * Plan 9.9 (W10.E22): keyboard navigation in a database follows what the
 * user sees. The kanban's columns run right to left in Hebrew, so the arrow
 * that points at the next column is ← there and → in English
 * (src/views/databaseViews.tsx, coordinateGetter). The board itself is laid
 * out from the start side.
 */

const NOTES: Record<string, string> = {
  "tasks/א.md": "---\ntype: task\nstatus: todo\n---\nא\n",
  "tasks/ב.md": "---\ntype: task\nstatus: todo\n---\nב\n",
  "tasks/ג.md": "---\ntype: task\nstatus: doing\n---\nג\n",
};
const HUB = ["# לוח", "", "```database", "source: tasks", "type: task", "view: kanban", "groupBy: status", "columns: [todo, doing, done]", "```", ""].join("\n");

async function seed(page: Page): Promise<boolean> {
  return page.evaluate(async (notes) => {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("tasks", { create: true });
      for (const [path, text] of Object.entries(notes)) {
        const f = (await dir.getFileHandle(path.slice("tasks/".length), { create: true })) as FileSystemFileHandle & { createWritable?: () => Promise<FileSystemWritableFileStream> };
        if (typeof f.createWritable !== "function") return false;
        const w = await f.createWritable();
        await w.write(text);
        await w.close();
      }
      return true;
    } catch {
      return false; // why: no OPFS in this engine; vaultOrSkip decides whether that is a skip or a failure
    }
  }, NOTES);
}

async function board(page: Page, locale: Locale, browserName: string) {
  await page.addInitScript((locale) => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { locale }, version: 0 }));
  }, locale);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", locale === "he" ? "rtl" : "ltr");
  vaultOrSkip(await seed(page), browserName);
  const editor = page.locator(".cm-content").first();
  await editor.waitFor({ state: "visible", timeout: 20_000 });
  await editor.click();
  await editor.fill(HUB);
  const b = page.getByTestId("database-block").first().getByTestId("database-kanban");
  await expect(b.locator("[data-note]")).toHaveCount(3, { timeout: 15_000 });
  return b;
}

for (const locale of LOCALES) {
  test.describe(`database keyboard in ${locale}`, () => {
    test("the first column is on the start side", async ({ page, browserName }) => {
      const b = await board(page, locale, browserName);
      const todo = (await b.locator('[data-column="todo"]').boundingBox())!;
      const doing = (await b.locator('[data-column="doing"]').boundingBox())!;
      if (locale === "he") expect(todo.x).toBeGreaterThan(doing.x);
      else expect(todo.x).toBeLessThan(doing.x);
    });

    test("the arrow that points at the next column moves a card there; the other one moves it back", async ({ page, browserName }) => {
      const b = await board(page, locale, browserName);
      const next = locale === "he" ? "ArrowLeft" : "ArrowRight";
      const back = locale === "he" ? "ArrowRight" : "ArrowLeft";
      const handle = b.getByRole("button", { name: /א/ }).first();
      await handle.focus();
      await page.keyboard.press("Space");
      await page.keyboard.press(next);
      await page.keyboard.press("Space");
      await expect(b.locator('[data-column="doing"] [data-note="tasks/א.md"]')).toBeVisible({ timeout: 5_000 });
      await b.getByRole("button", { name: /א/ }).first().focus();
      await page.keyboard.press("Space");
      await page.keyboard.press(back);
      await page.keyboard.press("Space");
      await expect(b.locator('[data-column="todo"] [data-note="tasks/א.md"]')).toBeVisible({ timeout: 5_000 });
    });
  });
}
