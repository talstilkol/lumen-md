import { test, expect, type Page } from "@playwright/test";
import { freshApp, setNote, runCommand } from "./_wave12";
import { makeEpub } from "../src/__tests__/helpers/epubFixture";

/**
 * Plan W13.R6 — book pages (two-page spreads) for notes and EPUB books.
 * Acceptance: in Hebrew and English the page order is right (page 1 on the
 * right of a Hebrew spread, on the left of an English one; ← is "next" in
 * Hebrew), and the reading place is kept when switching between pages and
 * scrolling, and when the note or book is opened again.
 */

const para = (he: boolean, i: number) =>
  he
    ? `פסקה ${i}: הטקסט הזה ארוך מספיק כדי למלא חלק מעמוד, וכך נוצרים כמה עמודים שאפשר לדפדף ביניהם כמו בספר.`
    : `Paragraph ${i}: this text is long enough to fill part of a page, so there are several pages to turn like a book.`;
const note = (he: boolean) => `# ${he ? "ספר" : "Book"}\n\n` + Array.from({ length: 120 }, (_, i) => para(he, i + 1)).join("\n\n") + "\n";

/** The left edge of the paragraph whose text starts with `prefix`. */
const leftOf = (page: Page, prefix: string) =>
  page.evaluate((p) => {
    const el = Array.from(document.querySelectorAll("[data-preview-root] p")).find((x) => x.textContent!.startsWith(p));
    return el ? el.getBoundingClientRect().left : null;
  }, prefix);

const visibleFirst = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector("[data-preview-root]")!.getBoundingClientRect();
    const p = Array.from(document.querySelectorAll("[data-preview-root] p")).find((x) => {
      const r = x.getBoundingClientRect();
      return r.right > root.left + 1 && r.left < root.right - 1 && r.bottom > root.top + 1 && r.top < root.bottom - 1;
    });
    return p?.textContent?.split(":")[0] ?? null;
  });

for (const locale of ["he", "en"] as const) {
  const he = locale === "he";
  test(`a note as a book (${locale}): page order, keys, and the place kept across scrolling`, async ({ page, browserName }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await freshApp(page, browserName, locale);
    await setNote(page, note(he));
    await runCommand(page, "view.preview");
    await runCommand(page, "reading.bookSpread");
    const root = page.locator("[data-preview-root]");
    await expect(root).toHaveAttribute("data-book-spread", "odd");
    await expect(root).toHaveAttribute("data-spread-index", "0");
    const count = Number(await root.getAttribute("data-spread-count"));
    expect(count).toBeGreaterThan(2);
    // Page 1 holds paragraph 1, page 2 a later one: page 1 is on the right in Hebrew.
    const p1 = (await leftOf(page, he ? "פסקה 1:" : "Paragraph 1:"))!;
    const later = await page.evaluate(() => {
      const root = document.querySelector("[data-preview-root]")!.getBoundingClientRect();
      const ps = Array.from(document.querySelectorAll("[data-preview-root] p")).filter((x) => {
        const r = x.getBoundingClientRect();
        return r.left >= root.left - 1 && r.right <= root.right + 1;
      });
      return ps[ps.length - 1].getBoundingClientRect().left;
    });
    if (he) expect(p1).toBeGreaterThan(later);
    else expect(p1).toBeLessThan(later);
    // The next spread: ← in Hebrew, → in English.
    await root.focus();
    await page.keyboard.press(he ? "ArrowLeft" : "ArrowRight");
    await expect(root).toHaveAttribute("data-spread-index", "1");
    await page.keyboard.press(he ? "ArrowLeft" : "ArrowRight");
    await expect(root).toHaveAttribute("data-spread-index", "2");
    const here = await visibleFirst(page);
    // Back to scrolling: the same paragraph is at the top; and into pages again: the same spread.
    await runCommand(page, "reading.bookSpread");
    await expect(root).not.toHaveAttribute("data-book-spread", /./);
    expect(await visibleFirst(page)).toBe(here);
    await expect(page.getByTestId("book-spread-status")).toHaveCount(0);
    await runCommand(page, "reading.bookSpread");
    await expect(root).toHaveAttribute("data-spread-index", "2");
    // Cover alone: page 1 sits by itself.
    await page.getByTestId("book-spread-mode").selectOption("even");
    await expect(root).toHaveAttribute("data-book-spread", "even");
    await expect(page.getByTestId("book-spread-status")).toBeVisible();
  });

  test(`an EPUB book in two pages (${locale}): page order and the place kept on reopening`, async ({ page, browserName }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await freshApp(page, browserName, locale);
    const bytes = await makeEpub({ hebrew: he, paragraphs: 40 });
    await page.evaluate(async (data) => {
      const root = await navigator.storage.getDirectory();
      const w = await (await root.getFileHandle("book.epub", { create: true })).createWritable();
      await w.write(Uint8Array.from(data));
      await w.close();
    }, Array.from(bytes));
    const open = () => page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path: "book.epub" } })));
    await open();
    const reader = page.getByTestId("epub-reader");
    await expect(reader).toHaveAttribute("data-chapter", "1", { timeout: 15_000 });
    await page.getByTestId("epub-layout").selectOption("odd");
    await expect(reader).toHaveAttribute("data-spread", "0");
    const xs = await reader.locator(".epub-chapter p").evaluateAll((ps) => ps.map((p) => p.getBoundingClientRect().left));
    const firstPage = xs[0];
    const secondPage = xs.find((x) => Math.abs(x - firstPage) > 100)!;
    if (he) expect(firstPage).toBeGreaterThan(secondPage);
    else expect(firstPage).toBeLessThan(secondPage);
    await reader.focus();
    await page.keyboard.press(he ? "ArrowLeft" : "ArrowRight");
    await expect(reader).toHaveAttribute("data-spread", "1");
    await page.keyboard.press("Escape");
    await expect(reader).toHaveCount(0);
    await open();
    await expect(page.getByTestId("epub-reader")).toHaveAttribute("data-spread", "1", { timeout: 15_000 });
    await expect(page.getByTestId("epub-layout")).toHaveValue("odd");
  });
}
