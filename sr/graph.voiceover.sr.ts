/**
 * Plan W13.G11 — the entity graph's list mode under VoiceOver (macOS), in
 * Hebrew: the six steps of ./graphJourney.ts. Needs a Mac set up with
 * `npx @guidepup/setup` and a Hebrew voice (Carmit).
 *
 *   npm run test:sr -- graph --project=voiceover
 */
import { voiceOverTest as test } from "@guidepup/playwright";
import { expect } from "@playwright/test";
import { BASE_URL } from "./runJourney";
import { GRAPH_STEPS, missing, openGraphVault } from "./graphJourney";

test.use({ locale: "he-IL" });

test("VoiceOver: the entity graph as a list, 6 steps in Hebrew", async ({ page, voiceOver }, info) => {
  test.setTimeout(6 * 60_000);
  await openGraphVault(page, BASE_URL);
  await voiceOver.navigateToWebContent();
  const results: Array<{ id: number; title: string; spoken: string[]; missing: string[] }> = [];
  for (const step of GRAPH_STEPS) {
    await voiceOver.clearSpokenPhraseLog();
    for (const a of step.actions) {
      if (a.startsWith("type:")) await page.keyboard.type(a.slice(5));
      else if (a.startsWith("focus:")) await page.locator(a.slice(6)).first().focus();
      else await page.keyboard.press(a);
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(1200);
    const spoken = await voiceOver.spokenPhraseLog();
    results.push({ id: step.id, title: step.title, spoken, missing: missing(step, spoken) });
  }
  await info.attach("VoiceOver graph he.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  console.log(`graph journey (VoiceOver / he): ${results.filter((r) => !r.missing.length).length}/${results.length} steps`);
  expect(results.filter((r) => r.missing.length).map((r) => `${r.id} ${r.title}: ${r.missing.join(", ")}`)).toEqual([]);
});
