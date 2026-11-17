import { test, expect, type Page } from "@playwright/test";
import { freshApp, runCommand, setNote } from "./_wave12";
import { testHooks, type LumenTestWindow } from "./_lumen";

/**
 * Plan W12.H7 in a real browser (wave g6, Mac pack L5): in Hebrew (RTL),
 * dragging a time block on the day's timeline rewrites that line of the
 * daily note — and nothing else — in 15-minute steps; ↓ moves it by 15
 * minutes from the keyboard. The timeline's axis is vertical, so a drag
 * down is later in either direction. 32 px per hour (DayTimeline's default).
 * SYNTHETIC note, written here. WebKit: no OPFS (the daily note lives in the vault).
 */

const docText = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(".cm-content") as (HTMLElement & { cmTile?: { root?: { view?: { state: { doc: { toString(): string } } } } } }) | null;
    return el?.cmTile?.root?.view?.state.doc.toString() ?? "";
  });

test("W12.H7 (rtl): a drag and ↓ move the block and rewrite only its line", async ({ page, browserName }) => {
  await freshApp(page, browserName, "he");
  await testHooks(page);
  await page.keyboard.press("ControlOrMeta+Alt+KeyD");
  // The daily note is open once the store names a dated file (journal/<today>.md by default).
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const m = await (window as unknown as LumenTestWindow).__lumenTest.load("store/useStore");
          return (m.useAppStore.getState().doc.workspaceName as string | null) ?? "";
        }),
      { timeout: 15_000 },
    )
    .toMatch(/\d{4}-\d{2}-\d{2}\.md$/);
  await page.locator(".cm-content").first().click();
  await setNote(page, ["# יומן", "", "- 09:00–10:00 כתיבת הפרק", "- 13:00–14:00 פגישה", "", "הערה שלא משתנה."].join("\n"));
  await runCommand(page, "view.calendar");

  const timeline = page.getByTestId("day-timeline");
  await expect(timeline).toBeVisible({ timeout: 15_000 });
  await expect(timeline).toHaveAttribute("aria-label", /.+/);
  const first = timeline.getByTestId("timeline-block").first();
  await expect(first).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).direction)).toBe("rtl");

  // Drag down by one hour: 09:00–10:00 → 10:00–11:00.
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 4 + 16, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2, box.y + 4 + 32, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => docText(page)).toContain("- 10:00–11:00 כתיבת הפרק");

  // The keyboard: ↓ is 15 minutes later.
  await timeline.getByTestId("timeline-block").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => docText(page)).toContain("- 10:15–11:15 כתיבת הפרק");

  // Nothing else in the note moved.
  const text = await docText(page);
  expect(text).toContain("- 13:00–14:00 פגישה");
  expect(text).toContain("הערה שלא משתנה.");
  expect(text.split("\n")).toHaveLength(6);
});
