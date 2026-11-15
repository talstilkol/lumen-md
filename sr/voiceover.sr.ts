/**
 * Plan W4.21 — the Hebrew journey under VoiceOver (macOS, Safari's engine).
 * Run on a Mac: see docs editor/screen-reader-automation.
 */
import { voiceOverTest as test } from "@guidepup/playwright";
import { expect } from "@playwright/test";
import { runJourney } from "./runJourney";
import { runProductJourney } from "./runProductJourney";
import { spokeHebrew } from "./productJourney";

test.use({ locale: "he-IL" });

test("VoiceOver: the 10 Hebrew journey tasks", async ({ page, voiceOver }, info) => {
  test.setTimeout(10 * 60_000);
  const results = await runJourney(page, voiceOver, "VoiceOver / macOS", info);
  expect(results.filter((r) => r.missing.length).map((r) => `${r.id} ${r.title}: ${r.missing.join(", ")}`)).toEqual([]);
});

// W11.Q6: the product journey, in Hebrew (the VoiceOver voice for he-IL set to Carmit, LUMEN_SR_VOICE=Carmit) and in English.
for (const locale of ["he", "en"] as const) {
  test.describe(`product journey (${locale})`, () => {
    test.use({ locale: locale === "he" ? "he-IL" : "en-US" });
    test(`VoiceOver: the 10 product journey steps in ${locale === "he" ? "Hebrew" : "English"}`, async ({ page, voiceOver }, info) => {
      test.setTimeout(10 * 60_000);
      const r = await runProductJourney(page, voiceOver, "VoiceOver / macOS", locale, info);
      if (locale === "he") expect(spokeHebrew(r.results.flatMap((x) => x.spoken)), "VoiceOver spoke no Hebrew: is a Hebrew voice (Carmit) set?").toBe(true);
      expect(r.results.filter((x) => x.missing.length).map((x) => `${x.id} ${x.title}: ${x.missing.join(", ")}`)).toEqual([]);
    });
  });
}
