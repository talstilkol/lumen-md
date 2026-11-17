import { test, expect } from "@playwright/test";

/**
 * Plan W13.V3: a search with thousands of matches in the real app — the
 * results stream into a virtual list (a few dozen rows in the DOM), and the
 * list does not jump while the user types: no layout shift inside the
 * dialog from the first keystroke to the last page.
 */
test("thousands of results: virtual rows, and CLS 0 while typing", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
  // 3,000 notes that all mention the word, written through the app's own vault.
  await page.evaluate(async () => {
    const ws = (await import("/src/storage/workspace.ts")) as { writeWorkspaceFile(p: string, s: string): Promise<void> };
    for (let i = 0; i < 3000; i++) await ws.writeWorkspaceFile(`bulk/n${i}.md`, `# פתק ${i}\n\nפרויקט ${"מילה ".repeat(i % 40)}\n`);
  });
  await page.evaluate(() => {
    (window as unknown as { __shifts: number }).__shifts = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] }[]) {
        const inDialog = e.sources?.some((s) => s.node instanceof Element && s.node.closest('[data-testid="search-dialog"]'));
        if (inDialog) (window as unknown as { __shifts: number }).__shifts += e.value;
      }
    }).observe({ type: "layout-shift", buffered: false });
    window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "view.search" } }));
  });
  const dialog = page.getByTestId("search-dialog");
  await expect(dialog).toBeVisible();
  for (const ch of "פרויקט") await page.keyboard.type(ch, { delay: 60 });
  const list = dialog.getByTestId("search-hit-list");
  await expect.poll(async () => Number(await list.getAttribute("data-count")), { timeout: 20_000 }).toBeGreaterThanOrEqual(3000);
  expect(await dialog.locator("[data-search-index]").count()).toBeLessThan(80);
  expect(await page.evaluate(() => (window as unknown as { __shifts: number }).__shifts)).toBe(0);
});
