import { expect, test, type Page } from "@playwright/test";
import { testHooks, type LumenTestWindow } from "./_lumen";
import { axeBlocking, freshApp, runCommand, seed } from "./_wave12";
import { READING_MODES, readingModeSelector, type ReadingModeEntry } from "../src/reading/modes";

/**
 * W13.R13: the reading-modes gate. Every mode registered in
 * src/reading/modes.ts, in Hebrew (RTL) and English (LTR):
 *  - it opens (its command or shortcut) and its root appears;
 *  - axe finds no serious or critical violation in it;
 *  - the keyboard reaches it (Tab lands inside) and closes it (Escape, or
 *    its toggle command);
 *  - no request leaves the app's origin while it is open;
 *  - the note's file is byte-for-byte unchanged (SHA-256 before and after);
 *  - the reading position — the cursor in the note — is where it was.
 * A mode that is not registered fails src/__tests__/readingModesGate.test.ts.
 * Runs in Chromium and WebKit (both are the DoD).
 */
const PATH = "reading-gate/note.md";

function note(locale: "he" | "en"): string {
  const para = locale === "he" ? "זוהי פסקה לבדיקת מצבי הקריאה, עם משפט שני שממשיך אותה. " : "This is a paragraph for the reading-modes gate, with a second sentence that goes on. ";
  const body = Array.from({ length: 24 }, (_, i) => `${para.repeat(3)}${i + 1}.`).join("\n\n");
  const title = locale === "he" ? "# פתק לבדיקה" : "# A note for the gate";
  return `${title}\n\n${body}\n\n\`\`\`commentary inner\n${para.repeat(6)}\n\`\`\`\n\n\`\`\`commentary outer\n${para.repeat(5)}\n\`\`\`\n`;
}

async function fileHash(page: Page): Promise<string> {
  return page.evaluate(async (p) => {
    const ws = await (window as unknown as LumenTestWindow).__lumenTest.load("storage/workspace");
    const text = await ws.readWorkspaceFile(p);
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  }, PATH);
}

type View = { state: { selection: { main: { head: number } } }; dispatch(tr: unknown): void };
const cursor = (page: Page, set?: number) =>
  page.evaluate((at) => {
    const el = document.querySelector(".cm-content") as (HTMLElement & { cmTile?: { root?: { view?: View } } }) | null;
    const view = el?.cmTile?.root?.view;
    if (!view) return -1;
    if (at !== undefined) view.dispatch({ selection: { anchor: at } });
    return view.state.selection.main.head;
  }, set);

async function open(page: Page, mode: ReadingModeEntry) {
  if ("command" in mode.open) await runCommand(page, mode.open.command);
  else await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+KeyF" : "Control+Shift+KeyF");
}

for (const locale of ["he", "en"] as const) {
  for (const mode of READING_MODES) {
    test(`${mode.id} (${locale === "he" ? "RTL" : "LTR"}): axe, keyboard, 0 requests, file unchanged, position kept`, async ({ page, browserName }) => {
      await freshApp(page, browserName, locale);
      await testHooks(page);
      await seed(page, { [PATH]: note(locale) });
      await page.evaluate((path) => window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path } })), PATH);
      await expect(page.locator(".cm-content").first()).toContainText(locale === "he" ? "פתק לבדיקה" : "A note for the gate", { timeout: 15_000 });
      const before = await fileHash(page);
      const at = await cursor(page, 400);
      expect(at).toBe(400);

      const requests: string[] = [];
      const origin = new URL(page.url()).origin;
      page.on("request", (r) => {
        if (!/^(data|blob|about):/.test(r.url()) && new URL(r.url()).origin !== origin) requests.push(r.url());
      });

      if (mode.preview) await runCommand(page, "view.preview");
      await page.locator(".cm-content").first().focus().catch(() => undefined);
      await open(page, mode);
      const root = page.locator(readingModeSelector(mode.id)).first();
      await expect(root).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(`${readingModeSelector(mode.id)}[data-ready="false"], ${readingModeSelector(mode.id)} [data-ready="false"]`)).toHaveCount(0, { timeout: 15_000 });

      expect(await axeBlocking(page, readingModeSelector(mode.id))).toEqual([]);

      // The keyboard reaches it.
      let inside = false;
      for (let i = 0; i < 8 && !inside; i++) {
        await page.keyboard.press("Tab");
        inside = await page.evaluate((sel) => !!document.activeElement?.closest(sel), readingModeSelector(mode.id));
      }
      expect(inside).toBe(true);

      // …and closes it.
      if (mode.close === "Escape") await page.keyboard.press("Escape");
      else if ("command" in mode.open) await runCommand(page, mode.open.command);
      await expect(page.locator(readingModeSelector(mode.id))).toHaveCount(0);
      if (mode.preview) await runCommand(page, "view.source");

      expect(requests).toEqual([]);
      expect(await fileHash(page)).toBe(before);
      expect(await cursor(page)).toBe(400);
    });
  }
}
