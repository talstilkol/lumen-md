import { test, expect, type Page } from "@playwright/test";
import { vaultOrSkip } from "./_opfs";

/**
 * Plan W12.F8 — `![[rec.wav]]` with its transcript track beside it
 * (`rec.wav.vtt`, the app's own sidecar name, Z7-M5): the player gets the
 * audio from the vault as a blob URL, the transcript is listed as text, and
 * clicking a line moves the player's currentTime to that cue. The line
 * being played is marked (aria-current). The unit test
 * (webvttTranscript.test.tsx) does this in jsdom with a fake element; this
 * spec does it on a real <audio> in a real browser.
 */

/** Four seconds of 8 kHz, 8-bit mono silence: a WAV every engine plays. */
function silentWav(seconds: number): string {
  const rate = 8000;
  const n = rate * seconds;
  const b = Buffer.alloc(44 + n);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + n, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16); // fmt chunk size
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28); // byte rate = rate × 1 byte
  b.writeUInt16LE(1, 32); // block align
  b.writeUInt16LE(8, 34); // bits per sample
  b.write("data", 36, "ascii");
  b.writeUInt32LE(n, 40);
  b.fill(128, 44); // 8-bit PCM silence is the midpoint
  return b.toString("base64");
}

const VTT = [
  "WEBVTT",
  "",
  "00:00:00.500 --> 00:00:01.800",
  "<v דנה>שלום לכולם, נתחיל.",
  "",
  "00:00:02.000 --> 00:00:03.100",
  "<v יוסי>התקציב עבר בזמן.",
  "",
  "00:00:03.200 --> 00:00:03.900",
  "<v דנה>תודה.",
  "",
].join("\n");

/** Write vault files at the OPFS root; false where this engine can't. Binary content is base64 after "data:". */
async function seed(page: Page, files: Record<string, string>): Promise<boolean> {
  return page.evaluate(async (files) => {
    try {
      const root = await navigator.storage.getDirectory();
      for (const [name, data] of Object.entries(files)) {
        const fh = (await root.getFileHandle(name, { create: true })) as unknown as {
          createWritable?: () => Promise<{ write(d: BufferSource | string): Promise<void>; close(): Promise<void> }>;
        };
        if (typeof fh.createWritable !== "function") return false;
        const w = await fh.createWritable();
        await w.write(data.startsWith("data:") ? Uint8Array.from(atob(data.slice(5)), (c) => c.charCodeAt(0)) : data);
        await w.close();
      }
      return true;
    } catch {
      return false;
    }
  }, files);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toContainText("Welcome to", { timeout: 15_000 });
});

test("a transcript line moves the player to its cue, and the line is marked", async ({ page, browserName }) => {
  const ok = await seed(page, { "rec.wav": `data:${silentWav(4)}`, "rec.wav.vtt": VTT });
  vaultOrSkip(ok, browserName);
  await page.evaluate(() => window.dispatchEvent(new Event("lumen-workspace-changed")));

  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await editor.fill("# Meeting\n\n![[rec.wav]]\n");

  const embed = page.locator('[data-preview-root] .media-embed[data-target="rec.wav"]').first();
  const audio = embed.locator("audio");
  await expect(audio).toHaveAttribute("src", /^blob:/, { timeout: 15_000 });
  const lines = embed.locator(".media-transcript li");
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(1)).toContainText("התקציב עבר בזמן.");

  // The audio has to be loaded before a seek can stick.
  await expect.poll(() => audio.evaluate((el: HTMLMediaElement) => el.readyState), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await embed.getByRole("button", { name: "Play from 0:02" }).click();
  // The click also starts playback, so the time may have moved on a little — but not past the cue.
  await expect.poll(() => audio.evaluate((el: HTMLMediaElement) => el.currentTime), { timeout: 5_000 }).toBeGreaterThanOrEqual(2);
  expect(await audio.evaluate((el: HTMLMediaElement) => el.currentTime)).toBeLessThan(3.2);
  await expect(embed.locator('li[aria-current="true"]')).toContainText("התקציב");

  // A second line seeks back.
  await audio.evaluate((el: HTMLMediaElement) => el.pause());
  await embed.getByRole("button", { name: "Play from 0:00" }).click();
  await expect.poll(() => audio.evaluate((el: HTMLMediaElement) => el.currentTime), { timeout: 5_000 }).toBeLessThan(2);
  await expect(embed.locator('li[aria-current="true"]')).toContainText("שלום לכולם");
});
