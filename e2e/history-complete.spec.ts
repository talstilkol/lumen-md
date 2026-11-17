import { test, expect } from "@playwright/test";
import { opfsWritable, vaultOrSkip } from "./_opfs";

/**
 * Complete history (plan 3.2): versions are kept as compressed deltas and
 * read back intact in the panel, and the panel says whether the browser
 * keeps this storage (navigator.storage.persist).
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
});

test("delta versions read back intact, and the storage state is shown", async ({ page }) => {
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill("# Draft one\n\nfirst body line\n");
  // Hiding the page is a save point.
  const hide = () =>
    page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    });
  await hide();
  await editor.press("ControlOrMeta+a");
  await editor.fill("# Draft one\n\nfirst body line\nsecond body line\n");
  await hide();

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.locator('[role="dialog"]').filter({ has: page.locator("input") });
  await palette.locator("input").first().fill("version history");
  await expect(palette.locator('[role="option"][aria-selected="true"]')).toContainText(/Version History/i);
  await page.keyboard.press("Enter");
  const panel = page.locator('[role="dialog"][aria-label="Version History"]');
  await expect(panel).toBeVisible();

  const status = panel.getByTestId("storage-status");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("data-persisted", /^(true|false|null)$/);
  await expect(status).toContainText(/persistent/);

  // The newest version is a delta on top of the first; it reads back whole.
  const entries = panel.locator("button").filter({ hasText: /chars/ });
  await expect(entries.first()).toBeVisible({ timeout: 5000 });
  let found = false;
  for (let i = 0; i < (await entries.count()) && !found; i++) {
    await entries.nth(i).click();
    found = (await panel.locator("pre").first().textContent()) === "# Draft one\n\nfirst body line\nsecond body line\n";
  }
  expect(found).toBe(true);
});

/**
 * Plan W13.S1: "Deleted and renamed files" — search, Shift+click range,
 * bulk restore to the original place, and the retention setting with the
 * space it frees (a real browser: OPFS, IndexedDB, the real dialog).
 */
test("bulk restore with Shift+click, search, and the retention setting", async ({ page, browserName }) => {
  vaultOrSkip(await opfsWritable(page), browserName);
  const paths = ["notes/א.md", "notes/ב.md", "notes/ג.md", "notes/ד.md", "inbox/Meeting.md"];
  await page.evaluate(async (paths) => {
    const ws = await import("/src/storage/workspace.ts");
    const trash = await import("/src/storage/trash.ts");
    for (const p of paths) await ws.writeWorkspaceFile(p, `body of ${p}`);
    // Oldest first, so the list (newest first) is inbox, ד, ג, ב, א.
    for (const [i, p] of paths.entries()) await trash.moveToTrash([p], {}, Date.now() - (paths.length - i) * 60_000);
  }, paths);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.locator('[role="dialog"]').filter({ has: page.locator("input") });
  await palette.locator("input").first().fill("trash");
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Deleted and renamed files" });
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("trash-item")).toHaveCount(5);

  // Search narrows (niqqud-insensitive search is covered by the unit test).
  await panel.getByTestId("trash-search").fill("notes/");
  await expect(panel.getByTestId("trash-item")).toHaveCount(4);

  // Click the first row, Shift+click the third: three rows selected.
  const boxes = panel.getByTestId("trash-item").locator('input[type="checkbox"]');
  await boxes.nth(0).click();
  await boxes.nth(2).click({ modifiers: ["Shift"] });
  await expect(panel.locator("[data-selected]")).toHaveCount(3);
  await panel.getByTestId("trash-restore-selected").click();
  await expect(panel.getByTestId("trash-item")).toHaveCount(1);
  // Focus stays in the dialog, never on <body>.
  expect(await page.evaluate(() => document.activeElement !== document.body && !!document.activeElement?.closest("dialog"))).toBe(true);

  const back = await page.evaluate(async () => {
    const ws = await import("/src/storage/workspace.ts");
    const out: Record<string, string | null> = {};
    for (const p of ["notes/ד.md", "notes/ג.md", "notes/ב.md", "notes/א.md", "inbox/Meeting.md"]) out[p] = (await ws.workspaceHasEntry(p)) ? await ws.readWorkspaceFile(p) : null;
    return out;
  });
  expect(back).toEqual({ "notes/ד.md": "body of notes/ד.md", "notes/ג.md": "body of notes/ג.md", "notes/ב.md": "body of notes/ב.md", "notes/א.md": null, "inbox/Meeting.md": null });

  // Retention: a month for notes; the line says what it frees (or that nothing is old enough).
  await panel.getByTestId("retention-notes").selectOption("30d");
  await expect(panel.getByTestId("retention-saving")).toContainText(/Frees|Nothing to free/);
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("lumen.history.retention.v1.")))).toBe(true);
});
