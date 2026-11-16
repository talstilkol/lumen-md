import { test, devices } from "@playwright/test";
import { chromiumOnlyHere } from "./_engines";

/**
 * The phones the RTL matrices run on (plan 9.5): iPhone 14 and Pixel 7,
 * emulated on Chromium (viewport, touch, mobile UA), like e2e/touch.spec.ts.
 * One helper for both matrices (Hebrew and Arabic), so the engine gap is
 * skipped in one place (the e2e skip cap, scripts/lib/skipAudit.mjs).
 */
export const PHONES = ["iPhone 14", "Pixel 7"] as const;

/** A describe block per phone, with the device in use; `body` declares the tests. */
export function onPhones(body: (phone: (typeof PHONES)[number]) => void): void {
  for (const name of PHONES) {
    test.describe(name, () => {
      // WebKit's engine itself is covered by the desktop webkit project.
      const { defaultBrowserType: _engine, ...device } = devices[name];
      test.use(device);
      // Firefox has no mobile emulation (isMobile) in Playwright (9.2).
      chromiumOnlyHere("phone emulation");
      body(name);
    });
  }
}
