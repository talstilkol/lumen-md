import { test, expect, type Page } from "@playwright/test";

/**
 * W13.M6 @mobile: the vault screen on a phone, in Hebrew (right to left).
 * Two vaults are planted in the screen's cache (IndexedDB, as the app
 * writes it); one never finished opening. The screen shows both without
 * opening either, marks that one, moves it to Recently deleted and back,
 * and the change survives a reload.
 */

const card = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, where: "On this iPhone", location: { kind: "opfs" }, files: 1234, bytes: 2_500_000, sync: "off", plugins: 2, openedAt: 1, failedLastOpen: false, ...extra });

async function plant(page: Page, registry: unknown) {
  await page.evaluate(
    (r) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("keyval-store");
        open.onupgradeneeded = () => open.result.createObjectStore("keyval");
        open.onsuccess = () => {
          const tx = open.result.transaction("keyval", "readwrite");
          tx.objectStore("keyval").put(r, "lumen-vault-registry");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    registry,
  );
}

test.describe("vault screen @mobile", () => {
  test("cards from the cache, the failed vault marked, delete to Recently deleted and restore (RTL)", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("lumen-tour-done", "1");
      localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: "he", theme: "light" }, version: 0 }));
    });
    await page.goto("/");
    await plant(page, { v: 1, vaults: [card("home", "בית"), card("work", "עבודה", { failedLastOpen: true, openedAt: 0 })], trash: [], opening: null });
    await page.goto("/?action=vaults");
    const screen = page.getByTestId("vault-picker");
    await expect(screen).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // (the vault this page opened adds its own card after 5 s: only the planted two are checked)
    await expect(screen.locator('[data-card="home"]')).toContainText(/1,234|1234/);
    await expect(screen.locator('[data-card="work"] [data-testid="vault-failed"]')).toBeVisible();

    await screen.locator('[data-card="work"] .vault-menu-button').click();
    await expect(page.getByRole("menuitem").first()).toBeFocused();
    await page.getByTestId("vault-trash").click();
    await expect(screen.locator('[data-card="work"]')).toHaveCount(0);
    await expect(screen.locator('[data-trashed="work"]')).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");

    await page.reload();
    await page.goto("/?action=vaults");
    await expect(page.getByTestId("vault-picker").locator('[data-trashed="work"]')).toBeVisible();
    await page.getByTestId("vault-restore").click();
    await expect(page.getByTestId("vault-picker").locator('[data-card="work"]')).toHaveCount(1);
  });
});
