import { test, expect } from "@playwright/test";
import { opfsWritable } from "./_opfs";

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

/**
 * Safari before 26 (and Playwright WebKit) has no createWritable on the main
 * thread: vault writes go through a sync-access-handle worker. Remove the
 * method here so every engine exercises that path.
 */
test("saving to the vault works without createWritable (Safari path)", async ({ page }) => {
  await page.addInitScript(() => {
    const proto = (globalThis as { FileSystemFileHandle?: { prototype: Record<string, unknown> } }).FileSystemFileHandle?.prototype;
    if (proto) delete proto.createWritable;
  });
  await page.reload();
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
  test.skip(!(await opfsWritable(page)), "OPFS writes are unavailable in this engine's test context");
  const run = (id: string) => page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);
  await page.keyboard.press("Meta+1");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill("# Written by the worker");
  await run("file.saveToWorkspace");
  await expect(page.locator("aside.file-tree .file-tree-name", { hasText: "Welcome.md" })).toBeVisible({ timeout: 10_000 });
  const text = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle("Welcome.md")).getFile();
    return file.text();
  });
  expect(text).toBe("# Written by the worker");
});

/** Part B — safe files (T46): rename keeps links, delete is undoable. */
test("renaming a note rewrites links to it; deleting it goes to the trash with Undo", async ({ page }) => {
  test.skip(!(await opfsWritable(page)), "OPFS writes are unavailable in this engine's test context");
  const run = (id: string) => page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);
  await page.keyboard.press("Meta+1");
  const editor = page.locator(".cm-content").first();

  // Note 1: "Welcome.md" saved into the vault.
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill("# Target note");
  await run("file.saveToWorkspace");
  const tree = page.locator("aside.file-tree");
  await expect(tree.locator(".file-tree-name", { hasText: "Welcome.md" })).toBeVisible({ timeout: 10_000 });

  // Note 2 links to it.
  await run("file.new");
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill("see [[Welcome]] and [[Welcome#Target note|this]]");
  await run("file.saveToWorkspace");
  await expect(tree.locator(".file-tree-name")).toHaveCount(2, { timeout: 10_000 });

  // Rename Welcome.md → Renamed.md in the tree.
  const row = tree.locator(".file-tree-item", { has: page.locator(".file-tree-name", { hasText: "Welcome.md" }) });
  await row.hover();
  await row.getByRole("button", { name: /rename/i }).click();
  const input = tree.locator("input.file-tree-input");
  await input.fill("Renamed");
  await input.press("Enter");
  await expect(tree.locator(".file-tree-name", { hasText: "Renamed.md" })).toBeVisible({ timeout: 10_000 });

  // The other note's links follow (it is the open note).
  await expect(page.getByText(/Links updated in 1 notes/i)).toBeVisible({ timeout: 10_000 });
  const other = tree.locator(".file-tree-name").filter({ hasNotText: "Renamed.md" }).first();
  await other.click();
  await expect(editor).toContainText("[[Renamed]] and [[Renamed#Target note|this]]", { timeout: 10_000 });

  // Delete → trash, Undo brings it back.
  const renamed = tree.locator(".file-tree-item", { has: page.locator(".file-tree-name", { hasText: "Renamed.md" }) });
  await renamed.hover();
  await renamed.getByRole("button", { name: /delete/i }).click();
  await expect(tree.locator(".file-tree-name", { hasText: "Renamed.md" })).toHaveCount(0, { timeout: 10_000 });
  const toastEl = page.getByRole("status").filter({ hasText: /moved to the trash/i });
  await expect(toastEl).toBeVisible({ timeout: 5000 });
  await toastEl.getByRole("button", { name: "Undo" }).click();
  await expect(tree.locator(".file-tree-name", { hasText: "Renamed.md" })).toBeVisible({ timeout: 10_000 });
});

/** Part C — export everything (T47): the vault comes out as a .zip with paths. */
test("the whole vault exports as a zip", async ({ page }) => {
  // Save, a lazy export chunk, a dialog and a download: more than the default 30 s budget on a cold runner.
  test.slow();
  test.skip(!(await opfsWritable(page)), "OPFS writes are unavailable in this engine's test context");
  const run = (id: string) => page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);
  await page.keyboard.press("Meta+1");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill("# שלום מהכספת");
  await run("file.saveToWorkspace");
  await expect(page.locator("aside.file-tree .file-tree-name", { hasText: "Welcome.md" })).toBeVisible({ timeout: 10_000 });

  // An engine with showDirectoryPicker (Chromium) asks "zip or folder" first
  // and downloads nothing until it is answered; the others go straight to the
  // zip. Decide which from the engine, not from a race: the old race gave the
  // dialog 10 s, and when the lazy export chunk took longer on a cold runner
  // the test stopped looking for it and waited for a download that the
  // unanswered dialog was holding back (plan 0.5).
  const asksWhere = await page.evaluate(() => "showDirectoryPicker" in window);
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await run("vault.export");
  if (asksWhere) {
    // The zip is the default choice.
    const dialog = page.getByRole("dialog").filter({ has: page.locator("select") });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole("button", { name: /^(OK|Confirm)$/i }).click();
  }
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^lumen-vault-\d{4}-\d{2}-\d{2}\.zip$/);
  const stream = await d.createReadStream();
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
  // A real zip: local header signature, and the note's name inside.
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
  expect(bytes.includes(Buffer.from("Welcome.md"))).toBe(true);
});
