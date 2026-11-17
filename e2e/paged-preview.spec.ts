import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { testHooks, type LumenTestWindow } from "./_lumen";
import { axeBlocking, freshApp, runCommand, setNote } from "./_wave12";

/**
 * W13.R10: the page view shows as many pages as the PDF export prints. Ten
 * notes (e2e/fixtures/paged: Hebrew, English, tables, code, footnotes,
 * \newpage, Letter + narrow, Hebrew numbering + wide, a table of contents,
 * mixed bidi). Each is shown in the page view, then the export's own
 * document (PrintExport.buildPrintHtml) is printed to PDF by the same
 * Chromium and its pages counted. PDF printing is Chromium-only.
 */
const FIXTURES = join(__dirname, "fixtures", "paged");
const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".md")).sort();

const pdfPages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

test.describe("page view = PDF pages (W13.R10)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "page.pdf() is Chromium-only");

  test("ten notes: the page view's count is the PDF's", async ({ page, browser, browserName }) => {
    test.setTimeout(240_000);
    expect(files).toHaveLength(10);
    await freshApp(page, browserName, "en");
    await testHooks(page);
    const requests: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.origin !== new URL(page.url()).origin && !/^(data|blob|about):/.test(r.url())) requests.push(r.url());
    });
    await runCommand(page, "view.preview");
    await runCommand(page, "view.pageView");
    const rows: { file: string; view: number; pdf: number }[] = [];
    for (const file of files) {
      const md = readFileSync(join(FIXTURES, file), "utf8");
      await setNote(page, md);
      const view = page.getByTestId("page-view");
      // Ready for this note: the pages were laid out from a text of its length.
      await expect(view).toHaveAttribute("data-laid", String(md.length), { timeout: 20_000 });
      await expect(view).toHaveAttribute("data-ready", "true");
      const shown = Number(await view.getAttribute("data-pages"));
      const html = await page.evaluate(async ([text, name]) => {
        const m = await (window as unknown as LumenTestWindow).__lumenTest.load("ui/PrintExport");
        return m.buildPrintHtml(text, name);
      }, [md, file.replace(/\.md$/, "")] as const);
      const printer = await browser.newPage();
      await printer.setContent(html, { waitUntil: "load" });
      const pdf = await printer.pdf({ preferCSSPageSize: true, printBackground: true });
      await printer.close();
      rows.push({ file, view: shown, pdf: pdfPages(pdf) });
    }
    console.table(rows);
    expect(rows.filter((r) => r.view !== r.pdf)).toEqual([]);
    expect(requests).toEqual([]);
  });

  test("Hebrew: keyboard paging in the reading direction, Hebrew numerals, axe clean", async ({ page, browserName }) => {
    await freshApp(page, browserName, "he");
    await runCommand(page, "view.preview");
    await runCommand(page, "view.pageView");
    await setNote(page, readFileSync(join(FIXTURES, "08-hebrew-numbering-wide.md"), "utf8"));
    const view = page.getByTestId("page-view");
    await expect(view).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await expect(page.getByTestId("paged-indicator")).toContainText("1");
    const frame = page.frameLocator("[data-testid=paged-frame]");
    await expect(frame.locator(".paged-foot").first()).toHaveClass(/num-hebrew/);
    await expect(frame.locator(".paged-head")).not.toHaveCount(0);
    await page.getByTestId("paged-frame").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("paged-indicator")).toContainText("2");
    await page.keyboard.press("End");
    const total = Number(await view.getAttribute("data-pages"));
    await expect(page.getByTestId("paged-indicator")).toContainText(String(total));
    expect(await axeBlocking(page, "[data-testid=page-view]")).toEqual([]);
  });
});
