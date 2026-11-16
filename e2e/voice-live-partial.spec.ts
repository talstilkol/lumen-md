import { test, expect } from "@playwright/test";
import { chromiumOnlyHere } from "./_engines";
import { testHooks, type LumenTestWindow } from "./_lumen";

/**
 * Plan W10.C8 acceptance 2 (6.1): "the first partial text ≤ 1.5 s from the
 * start of speech (e2e with a mock engine)". The capture box is the real
 * one, with the browser's fake microphone; the live engine is a scripted
 * stand-in registered on the same seam liveDictation uses
 * (capture/voiceCapture.setVoiceTranscriber), which reports its first
 * partial ENGINE_MS after it starts, as a streaming model would after the
 * first words. Measured: press → the partial on screen. The Zipformer model
 * itself is timed on the Mac in models:day (W10.M7), not here.
 */

// skip-reason: Playwright gives a fake microphone only to Chromium (--use-fake-device-for-media-stream); Firefox and WebKit have none | task: W10.C8 | until: 2027-05-16
chromiumOnlyHere("a fake microphone");
test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

const ENGINE_MS = 300;
const BUDGET_MS = 1500;

test("with a live engine registered, the first partial is on screen ≤ 1.5 s after pressing record", async ({ page, browserName }) => {
  test.setTimeout(60_000);
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
    localStorage.setItem("lumen.ai.policy", "local-only");
  });
  await page.goto("/?capture=1");
  const box = page.getByTestId("quick-capture");
  await expect(box).toBeVisible({ timeout: 15_000 });
  await testHooks(page);
  // After the box mounted (liveDictation registers or clears its engine on mount).
  await page.evaluate(async (engineMs) => {
    const vc = await (window as unknown as LumenTestWindow).__lumenTest.load("capture/voiceCapture");
    vc.setVoiceTranscriber(async ({ onPartial }) => {
      const t = setTimeout(() => onPartial("לקנות"), engineMs);
      return { stop: async () => (clearTimeout(t), "לקנות חלב."), cancel: () => clearTimeout(t) };
    });
  }, ENGINE_MS);

  const mic = box.getByTestId("capture-voice");
  const pressed = Date.now();
  await mic.click();
  await expect(box.getByTestId("capture-voice-partial")).toHaveText("לקנות", { timeout: 5_000 });
  const firstPartial = Date.now() - pressed;
  test.info().annotations.push({ type: "W10.C8", description: JSON.stringify({ browser: browserName, engineMs: ENGINE_MS, firstPartialMs: firstPartial, budgetMs: BUDGET_MS }) });
  expect(firstPartial).toBeLessThanOrEqual(BUDGET_MS);
  await mic.click();
  await expect(mic).toHaveAttribute("data-state", /transcribing|idle/);
});
