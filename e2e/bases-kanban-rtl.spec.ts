import { test, expect, type Page } from "@playwright/test";
import { vaultOrSkip } from "./_opfs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VAULT } from "../src/__tests__/fixtures/bases/vault";

/**
 * Plan W12.T5 — the kanban view of a `.base` in a right-to-left UI (Hebrew),
 * the half e2e/bases-kanban.spec.ts (LTR, keyboard) leaves: the columns run
 * from the right, a card dragged with the mouse into the next column (to its
 * left) writes the new status into that note's front matter on disk and
 * nothing else, and Alt+ArrowLeft — forward in RTL — moves a card into the
 * next column too. Golden 10-kanban.base: Projects grouped by `status`
 * ("active" 1, "done" 2).
 */

const FIXTURES = join(process.cwd(), "src", "__tests__", "fixtures", "bases");
const BOARD = readFileSync(join(FIXTURES, "10-kanban.base"), "utf8");
const original = (path: string) => VAULT.find((v) => v.path === path)!.text!;

async function seed(page: Page, files: Record<string, string>): Promise<boolean> {
  return page.evaluate(async (all) => {
    try {
      const root = await navigator.storage.getDirectory();
      const probe = (await root.getFileHandle("__probe", { create: true })) as FileSystemFileHandle & { createWritable?: unknown };
      await root.removeEntry("__probe");
      if (typeof probe.createWritable !== "function") return false;
      for (const [path, text] of Object.entries(all)) {
        const parts = path.split("/");
        const name = parts.pop()!;
        let dir = root;
        for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
        const w = await (await dir.getFileHandle(name, { create: true }) as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
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
    localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: "he" }, version: 0 }));
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

async function openBoard(page: Page, browserName: string) {
  const files: Record<string, string> = { "Board.base": BOARD };
  for (const v of VAULT) if (v.text !== null) files[v.path] = v.text;
  vaultOrSkip(await seed(page, files), browserName);
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill(["# פרויקטים", "", "![[Board.base]]", ""].join("\n"));
  const board = page.getByTestId("base-kanban").first();
  await expect(board).toBeVisible({ timeout: 15_000 });
  return board;
}

test("RTL: the columns run from the right, and a card dragged with the mouse to the next column changes only its status on disk", async ({ page, browserName }) => {
  test.setTimeout(60_000);
  const board = await openBoard(page, browserName);
  const active = board.locator('[data-column="active"]');
  const done = board.locator('[data-column="done"]');
  await expect(active.locator("[data-path]")).toHaveCount(1);
  await expect(done.locator("[data-path]")).toHaveCount(2);
  // The first column is on the right in RTL.
  const [a, d] = [(await active.boundingBox())!, (await done.boundingBox())!];
  expect(a.x).toBeGreaterThan(d.x);

  const card = active.locator('[data-path="Projects/Website.md"]');
  await card.dragTo(done);
  await expect(done.locator("[data-path]")).toHaveCount(3, { timeout: 5_000 });
  await expect(active.locator("[data-path]")).toHaveCount(0);
  const website = original("Projects/Website.md");
  await expect.poll(() => readFile(page, "Projects/Website.md"), { timeout: 5_000 }).toBe(website.replace("status: active", "status: done"));
  // The board file itself is untouched.
  expect(await readFile(page, "Board.base")).toBe(BOARD);
});

test("RTL: Alt+ArrowLeft (forward as the text runs) moves a card into the next column; Alt+ArrowRight moves it back", async ({ page, browserName }) => {
  test.setTimeout(60_000);
  const board = await openBoard(page, browserName);
  const website = original("Projects/Website.md");
  await board.locator('[data-column="active"] [data-path="Projects/Website.md"]').focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(board.locator('[data-column="done"] [data-path]')).toHaveCount(3, { timeout: 5_000 });
  await expect.poll(() => readFile(page, "Projects/Website.md"), { timeout: 5_000 }).toBe(website.replace("status: active", "status: done"));
  await board.locator('[data-column="done"] [data-path="Projects/Website.md"]').focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(board.locator('[data-column="active"] [data-path]')).toHaveCount(1, { timeout: 5_000 });
  // Back where it started: the file is byte for byte what it was.
  await expect.poll(() => readFile(page, "Projects/Website.md"), { timeout: 5_000 }).toBe(website);
});
