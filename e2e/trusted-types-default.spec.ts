/**
 * Plan W11.S17 (research R3.12): no string may reach the `default` Trusted
 * Types policy. src/lib/trustedTypes.ts records every sink that does
 * (`window.__lumenTrustedTypesDefaultHits`: sink, where from, how often);
 * this spec walks the app and must end with none. Each hit it lists is a
 * sink to make explicit (`lumen` or `dompurify`); when a full run is clean,
 * `default` comes out of security/policy.json.
 *
 * Run against a production build with its headers (PLAYWRIGHT_BASE_URL), as
 * csp-violations.spec.ts is. Chromium has Trusted Types without the header
 * too, so the policies (and the record) exist on the dev server as well.
 */
import { test, expect } from "@playwright/test";

type Hit = { kind: string; sink: string; from: string; count: number };

test("no sink reaches the default Trusted Types policy (W11.S17)", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.locator(".prose-lumen h1").first()).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  // Every block of the welcome note mounts (diagrams, charts, math, embeds).
  await page.mouse.wheel(0, 20000);
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  const hits = await page.evaluate(() => (window as unknown as { __lumenTrustedTypesDefaultHits?: Hit[] }).__lumenTrustedTypesDefaultHits ?? []);
  await info.attach("trusted-types-default-hits.json", { body: JSON.stringify(hits, null, 2), contentType: "application/json" });
  expect(hits, hits.map((h) => `${h.count}× ${h.kind} ${h.sink} ← ${h.from}`).join("\n")).toEqual([]);
});
