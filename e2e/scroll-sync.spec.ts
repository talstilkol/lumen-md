import { test, expect, type Page } from "@playwright/test";
import { freshApp, setNote, runCommand, axeBlocking } from "./_wave12";

/**
 * Plan W13.R7 — scroll sync and the triple view (source + preview +
 * outline), anchored to the blocks' source lines (data-sl from the render
 * pipeline), with the preview marking the caret's block.
 *
 * Acceptance: on a 2 MB note the preview's top is within one line of the
 * editor's top line, scrolling either pane; in Hebrew (RTL) and English
 * (LTR); the columns are mirrored in RTL and Ctrl+Alt+Shift+←/→ moves
 * between them by what is on screen.
 *
 * The note is synthetic (labelled as such): headings, Hebrew and English
 * prose, lists, quotes, tables and code, about 2 MB.
 */

function syntheticNote(targetBytes: number): string {
  const parts: string[] = [];
  let size = 0;
  for (let i = 0; size < targetBytes; i++) {
    const s = [
      `## Section ${i}`,
      i % 2 ? `פסקה ${i} בעברית עם **הדגשה** ו-English in the middle, ארוכה מספיק כדי להישבר לשתי שורות בתצוגה המקדימה.\nשורה שנייה.` : `Paragraph ${i} with _emphasis_ and עברית, long enough to wrap onto a second line in the preview pane.\nA second line.`,
      `- item ${i}.a\n- item ${i}.b`,
      i % 7 === 0 ? "| a | b |\n|---|---|\n| 1 | 2 |" : `> quote ${i}`,
      i % 5 === 0 ? "```ts\nconst x = " + i + ";\nconst y = x;\n```" : `Closing line ${i}.`,
    ].join("\n\n");
    parts.push(s);
    size += s.length + 2;
  }
  return "# A long note\n\n" + parts.join("\n\n") + "\n";
}

type View = {
  scrollDOM: HTMLElement;
  documentTop: number;
  state: { doc: { lines: number; line(n: number): { from: number }; lineAt(p: number): { number: number } } };
  lineBlockAt(p: number): { top: number; height: number };
  lineBlockAtHeight(h: number): { top: number; height: number; from: number };
};

/** Scroll the source editor so `line` is at its top (as the reader would: wheel over it). */
async function scrollEditorTo(page: Page, line: number) {
  await page.locator(".cm-scroller").first().hover();
  await page.evaluate((n) => {
    const v = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: View } } }).cmTile.root.view;
    const pad = v.documentTop - v.scrollDOM.getBoundingClientRect().top + v.scrollDOM.scrollTop;
    v.scrollDOM.scrollTop = v.lineBlockAt(v.state.doc.line(n).from).top + pad;
    v.scrollDOM.dispatchEvent(new Event("scroll"));
  }, line);
}

/** The editor's top line (fractional). */
const editorTopLine = (page: Page) =>
  page.evaluate(() => {
    const v = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: View } } }).cmTile.root.view;
    const pad = v.documentTop - v.scrollDOM.getBoundingClientRect().top + v.scrollDOM.scrollTop;
    const h = v.scrollDOM.scrollTop - pad;
    const b = v.lineBlockAtHeight(h);
    return v.state.doc.lineAt(b.from).number + (h - b.top) / b.height;
  });

/** A key that names a block of the synthetic note in the source and in the rendered text alike. */
const KEY = /(Section|Paragraph|פסקה|item|quote|Closing line|const x =) (\d+)(\.[ab])?/;

/** Source line of each keyed line of the note (the ground truth, independent of the data-sl stamps). */
function keyLines(note: string): Record<string, number> {
  const out: Record<string, number> = {};
  note.split("\n").forEach((l, i) => {
    const m = KEY.exec(l);
    if (m && !(m[0] in out)) out[m[0]] = i + 1;
  });
  return out;
}

/**
 * The preview's top line, from what is on screen: the innermost block at the
 * preview's top edge, found by its text in the source, interpolated inside
 * it by its own source lines.
 */
const previewTopLine = (page: Page, keys: Record<string, number>) =>
  page.evaluate(
    ({ keys, key }) => {
      const re = new RegExp(key);
      const root = document.querySelector("[data-preview-root]") as HTMLElement;
      const top = root.getBoundingClientRect().top;
      let best: { line: number; span: number; t: number; b: number } | null = null;
      for (const el of root.querySelectorAll<HTMLElement>("h2, p, li, pre, tr")) {
        const r = el.getBoundingClientRect();
        if (r.bottom <= top || r.top > top + 1 || !r.height) continue;
        const m = re.exec(el.textContent ?? "");
        if (!m || !(m[0] in keys)) continue;
        // Source lines of the block, by the synthetic note's shape: a paragraph has two, a code block four.
        const span = el.tagName === "PRE" ? 4 : m[1] === "Paragraph" || m[1] === "פסקה" ? 2 : 1;
        if (!best || r.height < best.b - best.t) best = { line: keys[m[0]] - (el.tagName === "PRE" ? 1 : 0), span, t: r.top, b: r.bottom };
      }
      if (!best) return null;
      return best.line + ((top - best.t) / (best.b - best.t)) * best.span;
    },
    { keys, key: KEY.source },
  );

for (const locale of ["he", "en"] as const) {
  test.describe(`scroll sync (${locale === "he" ? "RTL" : "LTR"})`, () => {
    test("triple view: the columns, mirrored in RTL, and the keyboard between them", async ({ page, browserName }) => {
      await freshApp(page, browserName, locale);
      await setNote(page, "# כותרת\n\nפסקה.\n\n## Second\n\ntext\n");
      await runCommand(page, "view.tripleLinked");
      const editor = page.locator(".cm-editor").first();
      const preview = page.locator("[data-preview-root]");
      const outline = page.locator(".outline-aside");
      await expect(preview).toBeVisible();
      await expect(outline).toBeVisible();
      const x = async (l: typeof editor) => (await l.boundingBox())!.x;
      if (locale === "he") {
        expect(await x(editor)).toBeGreaterThan(await x(preview));
        expect(await x(preview)).toBeGreaterThan(await x(outline));
      } else {
        expect(await x(editor)).toBeLessThan(await x(preview));
        expect(await x(preview)).toBeLessThan(await x(outline));
      }
      await page.locator(".cm-content").first().click();
      const towardsPreview = locale === "he" ? "ArrowLeft" : "ArrowRight";
      await page.keyboard.press(`Control+Alt+Shift+${towardsPreview}`);
      await expect(preview).toBeFocused();
      await page.keyboard.press(`Control+Alt+Shift+${towardsPreview}`);
      await expect(page.locator(".outline-aside :focus")).toHaveCount(1);
      await page.keyboard.press(`Control+Alt+Shift+${locale === "he" ? "ArrowRight" : "ArrowLeft"}`);
      await expect(preview).toBeFocused();
      expect(await axeBlocking(page, "main")).toEqual([]);
    });

    test("a 2 MB note: the preview stays within one line of the source, both ways", async ({ page, browserName }) => {
      test.setTimeout(180_000);
      await freshApp(page, browserName, locale);
      const note = syntheticNote(2_000_000);
      await setNote(page, note);
      await runCommand(page, "view.tripleLinked");
      const preview = page.locator("[data-preview-root]");
      await expect(preview).not.toHaveAttribute("data-preview-pending", "", { timeout: 120_000 });
      await expect(preview.locator("[data-sl]").first()).toBeAttached({ timeout: 60_000 });
      const lines = note.split("\n").length;
      const keys = keyLines(note);
      for (const target of [40, Math.floor(lines * 0.3), Math.floor(lines * 0.71), lines - 200]) {
        await scrollEditorTo(page, target);
        await expect.poll(async () => {
          const p = await previewTopLine(page, keys);
          return p === null ? 99 : Math.abs(p - (await editorTopLine(page)));
        }, { timeout: 10_000 }).toBeLessThanOrEqual(1);
      }
      // And from the preview back to the source.
      await preview.hover();
      await page.mouse.wheel(0, 3000);
      await expect.poll(async () => {
        const p = await previewTopLine(page, keys);
        return p === null ? 99 : Math.abs(p - (await editorTopLine(page)));
      }, { timeout: 10_000 }).toBeLessThanOrEqual(1);
    });

    test("the preview marks the block that holds the caret", async ({ page, browserName }) => {
      await freshApp(page, browserName, locale);
      await setNote(page, "# One\n\nfirst paragraph\n\n## Two\n\nsecond paragraph\n");
      await runCommand(page, "view.tripleLinked");
      await page.locator(".cm-line", { hasText: "second paragraph" }).click();
      await expect(page.locator("[data-preview-root] [data-sync-caret]")).toHaveText("second paragraph");
    });
  });
}
