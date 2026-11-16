import { test, expect, type Page } from "@playwright/test";
import { vaultOrSkip } from "./_opfs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VAULT } from "../src/__tests__/fixtures/bases/vault";

/**
 * Plan W12.T5 / W12.M2 (wave g6, lane L3): the kanban view of a `.base` in
 * the running app, in every browser. The golden 10-kanban.base groups the
 * Projects notes by `status` (expected.json: "active" 1, "done" 2); moving
 * a card with the keyboard (Alt+ArrowRight in LTR, basesKanbanDrag.test.tsx
 * is the unit half) writes the new status into that note's front matter on
 * disk, and nothing else in it.
 */

const FIXTURES = join(process.cwd(), "src", "__tests__", "fixtures", "bases");
const BOARD = readFileSync(join(FIXTURES, "10-kanban.base"), "utf8");
const WEBSITE = VAULT.find((v) => v.path === "Projects/Website.md")!.text!;

async function seed(page: Page, files: Record<string, string>): Promise<boolean> {
  return page.evaluate(async (all) => {
    const storage = navigator.storage as StorageManager | undefined;
    try {
      if (!storage?.getDirectory) return false;
      const root = await storage.getDirectory();
      const probe = (await root.getFileHandle("__probe", { create: true })) as FileSystemFileHandle & { createWritable?: unknown };
      await root.removeEntry("__probe");
      if (typeof probe.createWritable !== "function") return false;
      for (const [path, text] of Object.entries(all)) {
        const parts = path.split("/");
        const name = parts.pop()!;
        let dir = root;
        for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await w.write(text);
        await w.close();
      }
      return true;
    } catch {
      return false;
    }
  }, files);
}

async function readFile(page: Page, path: string): Promise<string> {
  return page.evaluate(async (p) => {
    const parts = p.split("/");
    const name = parts.pop()!;
    let dir = await navigator.storage.getDirectory();
    for (const x of parts) dir = await dir.getDirectoryHandle(x);
    return (await (await dir.getFileHandle(name)).getFile()).text();
  }, path);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
});

test("a kanban .base shows its golden columns, and Alt+ArrowRight moves a card into the next column on disk", async ({ page, browserName }) => {
  test.setTimeout(60_000);
  const files: Record<string, string> = { "Board.base": BOARD };
  for (const v of VAULT) if (v.text !== null) files[v.path] = v.text;
  vaultOrSkip(await seed(page, files), browserName);

  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill(["# Projects", "", "![[Board.base]]", ""].join("\n"));

  const board = page.getByTestId("base-kanban").first();
  await expect(board).toBeVisible({ timeout: 15_000 });
  const columns = board.locator("[data-column]");
  expect(await columns.evaluateAll((els) => els.map((e) => e.getAttribute("data-column")))).toEqual(["active", "done"]);
  await expect(board.locator('[data-column="active"] [data-path]')).toHaveCount(1);
  await expect(board.locator('[data-column="done"] [data-path]')).toHaveCount(2);

  const card = board.locator('[data-column="active"] [data-path="Projects/Website.md"]');
  await card.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(board.locator('[data-column="done"] [data-path]')).toHaveCount(3, { timeout: 5_000 });
  await expect.poll(async () => readFile(page, "Projects/Website.md"), { timeout: 5_000 }).toContain("status: done");
  // Only the status changed: every other line of the note is as it was.
  expect(await readFile(page, "Projects/Website.md")).toBe(WEBSITE.replace("status: active", "status: done"));
});
