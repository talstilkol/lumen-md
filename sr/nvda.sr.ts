/**
 * Plan W4.21 — the Hebrew journey under NVDA (Windows, Chrome or Firefox).
 * Run on Windows (a VM is fine): see docs editor/screen-reader-automation.
 */
import { nvdaTest as test } from "@guidepup/playwright";
import { expect } from "@playwright/test";
import { runJourney } from "./runJourney";
import { runProductJourney } from "./runProductJourney";

test.use({ locale: "he-IL" });

test("NVDA: the 10 Hebrew journey tasks", async ({ page, nvda, browserName }, info) => {
  test.setTimeout(10 * 60_000);
  const results = await runJourney(page, nvda, `NVDA / Windows / ${browserName}`, info);
  expect(results.filter((r) => r.missing.length).map((r) => `${r.id} ${r.title}: ${r.missing.join(", ")}`)).toEqual([]);
});

// W11.Q6: the product journey, in Hebrew and in English (owner, once, on a Windows host).
for (const locale of ["he", "en"] as const) {
  test.describe(`product journey (${locale})`, () => {
    test.use({ locale: locale === "he" ? "he-IL" : "en-US" });
    test(`NVDA: the 10 product journey steps in ${locale === "he" ? "Hebrew" : "English"}`, async ({ page, nvda, browserName }, info) => {
      test.setTimeout(10 * 60_000);
      const r = await runProductJourney(page, nvda, `NVDA / Windows / ${browserName}`, locale, info);
      expect(r.results.filter((x) => x.missing.length).map((x) => `${x.id} ${x.title}: ${x.missing.join(", ")}`)).toEqual([]);
    });
  });
}
