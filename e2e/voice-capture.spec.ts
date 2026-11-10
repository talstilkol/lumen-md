import { test, expect } from "@playwright/test";

/**
 * Plan W1.13: a voice note from the capture box, under the local-only AI
 * policy, with the browser's fake microphone. Measured: press → recording
 * started, and requests that leave the device while recording (must be 0).
 * There is no transcription model on this machine (and the test blocks
 * every outside host), so the note is kept as audio with the placeholder —
 * the path a device without a model takes; the transcript path is the
 * vitest seam test and Tal's real-device check.
 */

test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"], firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true } },
});

test("record a voice note into inbox.md with the recording attached; nothing leaves the device while recording", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "no fake microphone in Playwright WebKit");
  // Transcription is attempted (and fails offline) before the note is kept as audio.
  test.setTimeout(90_000);
  const outside: Array<{ url: string; at: number }> = [];
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => {
    outside.push({ url: route.request().url(), at: Date.now() });
    return route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
    localStorage.setItem("lumen.ai.policy", "local-only");
  });
  await page.goto("/?capture=1");
  const box = page.getByTestId("quick-capture");
  await expect(box).toBeVisible({ timeout: 15_000 });
  test.skip(!(await page.evaluate(() => typeof navigator.storage?.getDirectory === "function" && typeof MediaRecorder !== "undefined")), "no OPFS or MediaRecorder");

  const mic = box.getByTestId("capture-voice");
  const pressed = Date.now();
  await mic.click();
  await expect(mic).toHaveAttribute("data-state", "recording");
  const latency = Date.now() - pressed;
  await expect(mic).toContainText(/0:0[1-9]/);
  console.log(`[W1.13] ${browserName}: press → recording ${latency} ms`);
  expect(latency).toBeLessThan(1000);
  const recordingTo = Date.now();
  expect(outside.filter((r) => r.at >= pressed && r.at <= recordingTo)).toEqual([]);

  await mic.click();
  await expect(mic).toHaveAttribute("data-state", "idle", { timeout: 75_000 });
  await expect(box.getByTestId("capture-keep-audio")).toBeChecked();
  await box.getByTestId("capture-save").click();
  await expect(box).toHaveCount(0);

  const files = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const inbox = await (await (await root.getFileHandle("inbox.md")).getFile()).text();
    const names: string[] = [];
    for await (const name of (await root.getDirectoryHandle("attachments")).keys()) names.push(name);
    const size = names[0] ? (await (await (await root.getDirectoryHandle("attachments")).getFileHandle(names[0])).getFile()).size : 0;
    return { inbox, names, size };
  });
  expect(files.names).toHaveLength(1);
  expect(files.names[0]).toMatch(/^voice-\d{4}-\d{2}-\d{2}-\d{4}\.(webm|ogg|m4a)$/);
  expect(files.size).toBeGreaterThan(0);
  expect(files.inbox).toContain("Voice note (not transcribed)");
  expect(files.inbox).toContain(`(<attachments/${files.names[0]}#t=0,`);
  console.log(`[W1.13] requests to outside hosts after recording (transcription attempts, blocked): ${[...new Set(outside.map((r) => new URL(r.url).host))].join(", ") || "none"}`);
});
