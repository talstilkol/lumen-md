import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { freshApp, setNote, runCommand, axeBlocking } from "./_wave12";

/**
 * Plan W13.R9 — the margins reading mode: footnotes, comments and
 * suggestions as side notes. Acceptance: on 30 golden notes (synthetic,
 * labelled as such: src/__tests__/fixtures/sidenotesGolden.json) no note
 * covers another; the margin is on the left in Hebrew and on the right in
 * English; under 700px the notes sit under their paragraph; axe is clean
 * and the keyboard goes from a mark to its note and back.
 */

const golden = JSON.parse(readFileSync(new URL("../src/__tests__/fixtures/sidenotesGolden.json", import.meta.url), "utf8")) as Array<{ name: string; dir: "rtl" | "ltr"; md: string }>;

const boxes = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-preview-root] .sn-note")).map((n) => {
      const r = n.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }),
  );

async function margins(page: Page, md: string) {
  await setNote(page, md);
  await runCommand(page, "view.preview");
  await runCommand(page, "reading.sidenotes");
  const root = page.locator("[data-preview-root]");
  await expect(root).toHaveAttribute("data-sidenotes", /margin|inline/);
  return root;
}

test("30 golden notes: no side note covers another", async ({ page, browserName }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await freshApp(page, browserName, "en");
  for (const g of golden) {
    const root = await margins(page, g.md);
    await expect(root).toHaveAttribute("data-sidenote-count", /[1-9]/);
    const b = (await boxes(page)).sort((x, y) => x.top - y.top);
    for (let i = 1; i < b.length; i++) expect(b[i].top, `${g.name}: note ${i} overlaps the one above`).toBeGreaterThanOrEqual(b[i - 1].bottom);
    await runCommand(page, "reading.sidenotes"); // off for the next note
  }
});

for (const locale of ["he", "en"] as const) {
  test(`the margin is on the ${locale === "he" ? "left" : "right"} (${locale}); keyboard between mark and note; axe`, async ({ page, browserName }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await freshApp(page, browserName, locale);
    const g = golden.find((x) => x.dir === (locale === "he" ? "rtl" : "ltr"))!;
    const root = await margins(page, g.md);
    await expect(root).toHaveAttribute("data-sidenotes", "margin");
    const text = await root.locator(".prose-lumen p").first().boundingBox();
    const note = await root.locator(".sn-note").first().boundingBox();
    if (locale === "he") expect(note!.x + note!.width).toBeLessThanOrEqual(text!.x + 1);
    else expect(note!.x).toBeGreaterThanOrEqual(text!.x + text!.width - 1);
    await root.locator("a[data-footnote-ref]").first().focus();
    await page.keyboard.press("Enter");
    await expect(root.locator(".sn-note").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(root.locator(".sn-note").nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(root.locator("[data-sn-anchor].sn-active")).toHaveCount(1);
    expect(await axeBlocking(page, "[data-preview-root]")).toEqual([]);
  });
}

test("under 700px the notes go under their paragraph", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await freshApp(page, browserName, "he");
  const root = await margins(page, "פסקה ראשונה[^1].\n\nפסקה שנייה {>>הערה<<}.\n\n[^1]: הערת שוליים.\n");
  await expect(root).toHaveAttribute("data-sidenotes", "inline");
  const p = await root.locator(".prose-lumen > p").first().boundingBox();
  const n = await root.locator(".sn-inline").first().boundingBox();
  expect(n!.y).toBeGreaterThanOrEqual(p!.y + p!.height - 1);
});
