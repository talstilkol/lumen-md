import { test, expect } from "@playwright/test";

/**
 * W13.T5: safe mode after a failed start, end to end. The sentinel record
 * of a start that never finished is planted (as a page that crashed on a
 * plugin leaves it); the next start must open in safe mode, and leaving it
 * must not need a restart: the banner goes, focus lands in the editor, and
 * the next start is normal.
 */

const failedStart = (version: string) => JSON.stringify({ v: 1, version, pending: true, failures: 0, good: version, at: 1 });

test.describe("safe mode", () => {
  for (const lang of ["en", "he"] as const) {
    test(`a failed start opens in safe mode, and leaving it needs no restart (${lang})`, async ({ page }) => {
      await page.addInitScript(
        ([l]) => {
          if (sessionStorage.getItem("planted")) return;
          sessionStorage.setItem("planted", "1");
          localStorage.setItem("lumen-tour-done", "1");
          localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: l, theme: "light" }, version: 0 }));
        },
        [lang],
      );
      await page.goto("/");
      // The app's own version, as the sentinel recorded it on this first start.
      const version = await page.evaluate(() => JSON.parse(localStorage.getItem("lumen-boot-sentinel") ?? "{}").version as string);
      expect(version).toBeTruthy();
      await page.evaluate((rec) => localStorage.setItem("lumen-boot-sentinel", rec), failedStart(version));
      await page.reload();

      const banner = page.getByTestId("safe-mode-banner");
      await expect(banner).toBeVisible();
      await expect(banner).toHaveAttribute("data-safe-mode", "crash-loop");
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "he" ? "rtl" : "ltr");

      await page.getByTestId("safe-mode-choose").click();
      await page.getByTestId("safe-mode-leave").click();
      await expect(banner).toHaveCount(0);
      // Focus is somewhere sensible, never <body>.
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
      // Same page, no reload: the marker of the first start is still the one this page wrote.
      // The start counts as good after 5 s of running: wait for that mark, not for a fixed time.
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("lumen-boot-sentinel") ?? "{}").pending), { timeout: 15_000 }).toBe(false);
      await page.reload();
      await expect(page.getByTestId("safe-mode-banner")).toHaveCount(0);
    });
  }
});
