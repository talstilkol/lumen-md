import { test, expect, type Page } from "@playwright/test";
import { freshApp, runCommand, setNote } from "./_wave12";

/**
 * Plan W13.E2 — the ten most-used smart-list behaviours, typed for real in
 * the source editor, in Hebrew (RTL) and English (LTR). The full 60-case
 * golden set runs in src/__tests__/smartListsGolden.test.ts; this proves the
 * keys reach it in a browser, in both directions.
 */

type View = { state: { doc: { toString(): string }; selection: { main: { head: number } } }; dispatch(tr: unknown): void };

async function text(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector(".cm-content") as (HTMLElement & { cmTile?: { root?: { view?: View } } }) | null;
    const v = el?.cmTile?.root?.view;
    if (!v) return "";
    const d = v.state.doc.toString();
    const h = v.state.selection.main.head;
    return d.slice(0, h) + "‸" + d.slice(h);
  });
}

/** Put the note's text and caret ("‸") in place, focus the editor. */
async function start(page: Page, withCaret: string): Promise<void> {
  const at = withCaret.indexOf("‸");
  await setNote(page, withCaret.replace("‸", ""));
  await page.evaluate((pos) => {
    const el = document.querySelector(".cm-content") as (HTMLElement & { cmTile?: { root?: { view?: View } } }) | null;
    el?.cmTile?.root?.view?.dispatch({ selection: { anchor: pos } });
    el?.focus();
  }, at);
}

const CASES = {
  he: [
    ["Enter continues a bullet", "- שלום‸", "Enter", "- שלום\n- ‸"],
    ["Enter continues Hebrew letters", "א. ראשון‸", "Enter", "א. ראשון\nב. ‸"],
    ["Enter renumbers", "1. אחת‸\n2. שתיים", "Enter", "1. אחת\n2. ‸\n3. שתיים"],
    ["Enter on an empty item ends the list", "- אחת\n- ‸", "Enter", "- אחת\n‸"],
    ["Enter on an empty nested item outdents", "- אבא\n  - ‸", "Enter", "- אבא\n- ‸"],
    ["Tab indents under the item above", "- אחת\n- ‸שתיים", "Tab", "- אחת\n  - ‸שתיים"],
    ["Tab on the first item stays", "- ‸אחת\n- שתיים", "Tab", "- ‸אחת\n- שתיים"],
    ["Shift+Tab outdents", "- אחת\n  - ‸שתיים", "Shift+Tab", "- אחת\n- ‸שתיים"],
    ["Alt+↑ moves the item with its children", "- אחת\n- ‸שתיים\n  - משנה", "Alt+ArrowUp", "- ‸שתיים\n  - משנה\n- אחת"],
    ["Enter on a task starts an unchecked one", "- [x] לקנות חלב‸", "Enter", "- [x] לקנות חלב\n- [ ] ‸"],
  ],
  en: [
    ["Enter continues a bullet", "- hello‸", "Enter", "- hello\n- ‸"],
    ["Enter continues a number", "1. one‸", "Enter", "1. one\n2. ‸"],
    ["Enter renumbers", "1. one‸\n2. two", "Enter", "1. one\n2. ‸\n3. two"],
    ["Enter on an empty item ends the list", "- one\n- ‸", "Enter", "- one\n‸"],
    ["Enter on an empty nested item outdents", "- a\n  - ‸", "Enter", "- a\n- ‸"],
    ["Tab indents under the item above", "- a\n- ‸b", "Tab", "- a\n  - ‸b"],
    ["Tab on the first item stays", "- ‸a\n- b", "Tab", "- ‸a\n- b"],
    ["Shift+Tab outdents", "- a\n  - ‸b", "Shift+Tab", "- a\n- ‸b"],
    ["Alt+↑ moves the item with its children", "- a\n- ‸b\n  - b1", "Alt+ArrowUp", "- ‸b\n  - b1\n- a"],
    ["Enter on a task starts an unchecked one", "- [x] done‸", "Enter", "- [x] done\n- [ ] ‸"],
  ],
} as const;

for (const locale of ["he", "en"] as const) {
  test(`smart lists, the ten most used (${locale})`, async ({ page, browserName }) => {
    await freshApp(page, browserName, locale);
    await runCommand(page, "view.source");
    // The smart-list chunk loads after the editor; wait for it to answer a key.
    for (const [name, before, key, after] of CASES[locale]) {
      await test.step(name, async () => {
        await expect(async () => {
          await start(page, before);
          await page.keyboard.press(key);
          expect(await text(page)).toBe(after);
        }).toPass({ timeout: 10_000 });
      });
    }
    // The lines keep their own direction: a Hebrew item reads right to left.
    if (locale === "he") {
      await start(page, "- שלום‸");
      const dir = await page.locator(".cm-line").first().evaluate((el) => getComputedStyle(el).direction);
      expect(dir).toBe("rtl");
    }
  });
}
