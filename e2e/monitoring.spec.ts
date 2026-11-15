import { test, expect, type Request } from "@playwright/test";

/**
 * 12.4 — monitoring is off by default. A build without `VITE_SENTRY_DSN`
 * (the default, and the one CI tests) makes 0 monitoring requests and
 * never loads the Sentry SDK — in a fresh state, and even after the user
 * turned error reports on. Web vitals are measured and shown locally.
 */
const MONITORING = /sentry|glitchtip|\/api\/\d+\/(envelope|store)\//i;

// W11.S19: error reports and performance reports are separate consents; with either on and no DSN, still 0.
for (const [consent, performance] of [[false, false], [true, false], [false, true], [true, true]] as const) {
  test(`default build: 0 monitoring requests (${consent || performance ? `${[consent && "error reports", performance && "performance reports"].filter(Boolean).join(" and ")} turned on, no DSN` : "fresh state"})`, async ({ page }) => {
    const hits: string[] = [];
    page.on("request", (r: Request) => {
      if (MONITORING.test(r.url())) hits.push(`${r.method()} ${r.url()}`);
    });
    await page.addInitScript(([on, perf]: readonly [boolean, boolean]) => {
      localStorage.setItem("lumen-tour-done", "1");
      if (on) localStorage.setItem("lumen.monitoring.consent", "1");
      else localStorage.removeItem("lumen.monitoring.consent");
      if (perf) localStorage.setItem("lumen.monitoring.performance", "1");
      else localStorage.removeItem("lumen.monitoring.performance");
    }, [consent, performance] as const);
    await page.goto("/");
    await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("status-telemetry")).toHaveAttribute("aria-pressed", String(consent));

    // An uncaught error: what a monitor would report.
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("e2e monitoring probe");
      }, 0);
    });

    // The local web vitals are shown, measured on this device.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "view.runtimeMetrics" } })));
    const vitals = page.getByTestId("local-vitals");
    await expect(vitals).toBeVisible({ timeout: 8000 });
    await expect(vitals.locator('[data-rating]:not([data-rating="none"])').first()).toBeVisible({ timeout: 8000 });

    // A performance report would go when the page is hidden.
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForLoadState("networkidle");
    expect(hits).toEqual([]);
    const ledger = await page.evaluate(() => localStorage.getItem("lumen.privacy.ledger") ?? "[]");
    expect(ledger).not.toContain('"monitoring"');
  });
}
