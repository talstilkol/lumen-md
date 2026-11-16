import { test, expect, type Page } from "@playwright/test";

/**
 * Plan W11.P13 — "Install Lumen as an app" picks the browser's own way in
 * the order src/pwa/install.ts sets: the `<install>` element, then
 * `navigator.install()`, then the kept `beforeinstallprompt`, else the
 * steps for this browser. Each way is faked here at the browser's surface
 * (before the app loads), so the dialog's choice and its click are tested on
 * the real page in every engine. The real Chrome 148+ path needs the
 * origin-trial token (or Chrome's flag) and is the Mac run's last test,
 * which only reports what the browser offers.
 */

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:148.0) Gecko/20100101 Firefox/148.0";

async function open(page: Page, init?: () => void): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen.install.count");
  });
  if (init) await page.addInitScript(init);
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new Event("lumen-open-install")));
  await expect(page.getByTestId("install-dialog")).toBeVisible();
}

test("navigator.install(): the button calls it in the click, says done and counts locally", async ({ page }) => {
  await open(page, () => {
    (window as unknown as { __installCalls: number }).__installCalls = 0;
    Object.defineProperty(Navigator.prototype, "install", {
      configurable: true,
      value: async () => {
        (window as unknown as { __installCalls: number }).__installCalls++;
        if (navigator.userActivation && !navigator.userActivation.isActive) throw new DOMException("no activation", "NotAllowedError");
      },
    });
  });
  await page.getByTestId("install-button").click();
  await expect(page.getByTestId("install-done")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __installCalls: number }).__installCalls)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("lumen.install.count"))).toBe("1");
});

test("navigator.install() refused by the user (AbortError): the dialog says so and counts nothing", async ({ page }) => {
  await open(page, () => {
    Object.defineProperty(Navigator.prototype, "install", {
      configurable: true,
      value: async () => {
        throw new DOMException("dismissed", "AbortError");
      },
    });
  });
  await page.getByTestId("install-button").click();
  await expect(page.getByTestId("install-dismissed")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("lumen.install.count"))).toBeNull();
});

test("the <install> element wins over navigator.install() when the browser has both", async ({ page }) => {
  await open(page, () => {
    (window as unknown as Record<string, unknown>).HTMLInstallElement = class extends HTMLElement {};
    Object.defineProperty(Navigator.prototype, "install", { configurable: true, value: async () => undefined });
  });
  await expect(page.getByTestId("install-element")).toBeAttached();
  await expect(page.getByTestId("install-button")).toHaveCount(0);
});

test.describe("no install API: this browser's steps", () => {
  test.describe("iOS Safari", () => {
    test.use({ userAgent: IPHONE });
    test("shows Share → Add to Home Screen", async ({ page }) => {
      await open(page);
      await expect(page.getByTestId("install-guide-ios")).toBeVisible();
      await expect(page.getByTestId("install-button")).toHaveCount(0);
    });
  });
  test.describe("Firefox on the desktop", () => {
    test.use({ userAgent: FIREFOX });
    test("says it can't install web apps", async ({ page }) => {
      await open(page);
      await expect(page.getByTestId("install-guide-firefoxDesktop")).toBeVisible();
    });
  });
});

test("the real browser, unfaked: the dialog offers exactly one way (reported for the Mac run)", async ({ page, browserName }) => {
  await open(page);
  const ways = {
    element: await page.getByTestId("install-element").count(),
    button: await page.getByTestId("install-button").count(),
    guide: await page.locator('[data-testid^="install-guide-"]').count(),
    already: await page.getByTestId("install-already").count(),
  };
  const api = await page.evaluate(() => ({ element: "HTMLInstallElement" in window, install: typeof (navigator as Navigator & { install?: unknown }).install === "function", ua: navigator.userAgent }));
  test.info().annotations.push({ type: "install-way", description: JSON.stringify({ browserName, ...api, ways }) });
  // <install> renders the "other" guide inside itself as its fallback content, so count it as one way.
  const offered = (ways.element ? 1 : 0) + ways.button + (ways.element ? 0 : ways.guide) + ways.already;
  expect(offered).toBe(1);
  if (api.element) expect(ways.element).toBe(1);
  else if (api.install) expect(ways.button).toBe(1);
});
