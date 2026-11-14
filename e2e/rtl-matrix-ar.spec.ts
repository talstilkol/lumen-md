import { test, expect, type Page } from "@playwright/test";
import { onPhones } from "./_phones";

/**
 * Plan W4.18 / W5.17 (W10.E75): the full RTL matrix of 9.5 in Arabic, the
 * same matrix e2e/rtl-matrix.spec.ts runs in Hebrew.
 *
 * One note in Arabic, Hebrew and English:
 * - a heading, and paragraphs in each language;
 * - a pointed (tashkeel) line;
 * - a table whose header and body rows hold cells in all three;
 * - lists (bulleted, numbered, nested, tasks), one per language, with
 *   different markers so each is its own list;
 * - quotes;
 * - code with an Arabic comment.
 *
 * Each runs on every surface that shows it (preview, WYSIWYG, the HTML
 * export), with the interface in Arabic and in English. Then the chrome
 * mirroring and overflow check, and the same note on two phones (iPhone 14,
 * Pixel 7).
 *
 * The rules under test (renderer/rehypeDirAuto.ts, editor/wysiwygBidi.ts):
 * - a leaf block takes the direction of its own first strong character;
 * - a container gets the direction of its text;
 * - code is always left-to-right;
 * - in the preview and the export a table as a whole is left-to-right,
 *   while each cell resolves on its own.
 *
 * Every check is on the real browser's computed direction or on the
 * exported HTML. Arabic stays "beta" in the language picker (W4.18) until
 * a native speaker reviews the interface strings.
 */
const NOTE = [
  "# مقدمة الدراسة",
  "",
  "هذه فقرة عربية مع some English words في الوسط.",
  "",
  "זו פסקה בעברית באותו פתק.",
  "",
  "An English paragraph.",
  "",
  "مَدْرَسَةٌ جَمِيلَةٌ فِي المَدِينَةِ.",
  "",
  "| الاسم | שם | Name |",
  "| --- | --- | --- |",
  "| تفاح | תפוחים | apples |",
  "| Pears | אגסים | كمثرى |",
  "",
  "- العنصر الأول",
  "  - عنصر متداخل",
  "- العنصر الثاني",
  "",
  "1. الخطوة الأولى",
  "2. الخطوة الثانية",
  "",
  "+ פריט בעברית",
  "",
  "* An English item",
  "* Second English item",
  "",
  "- [ ] مهمة مفتوحة",
  "- [x] مهمة منجزة",
  "",
  "> اقتباس بالعربية.",
  "",
  "> ציטוט בעברית.",
  "",
  "> A quote in English.",
  "",
  "```js",
  "const total = 1; // تعليق بالعربية",
  "```",
  "",
].join("\n");

type Locale = "ar" | "en";

async function open(page: Page, locale: Locale, mode: "preview" | "wysiwyg" | "split" = "preview") {
  await page.addInitScript(
    ({ locale, content, mode }) => {
      localStorage.clear();
      localStorage.setItem("lumen-tour-done", "1");
      localStorage.setItem("lumen-md", JSON.stringify({ state: { locale, mode, doc: { name: "عربي.md", content, dirty: false, workspaceName: null } }, version: 0 }));
    },
    { locale, content: NOTE, mode },
  );
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

/** [first text, computed direction] for each element matched under `root`. */
async function dirs(page: Page, root: string, selector: string) {
  return page.locator(root).first().locator(selector).evaluateAll((els) => els.map((el) => [(el.textContent ?? "").trim().slice(0, 14), getComputedStyle(el).direction] as const));
}
const dirOf = (rows: ReadonlyArray<readonly [string, string]>, prefix: string) => rows.find(([t]) => t.startsWith(prefix))?.[1];

async function checkPreviewBlocks(page: Page) {
  const preview = page.locator(".prose-lumen").first();
  await expect(preview.locator("h1")).toContainText("مقدمة", { timeout: 15_000 });
  const root = ".prose-lumen";

  // Paragraphs and headings: their own text decides; the tashkeel is rendered, not dropped.
  const blocks = await dirs(page, root, "h1, p");
  expect(dirOf(blocks, "مقدمة")).toBe("rtl");
  expect(dirOf(blocks, "هذه فقرة")).toBe("rtl");
  expect(dirOf(blocks, "זו פסקה")).toBe("rtl");
  expect(dirOf(blocks, "An English")).toBe("ltr");
  expect(dirOf(blocks, "مَدْرَسَةٌ")).toBe("rtl");
  await expect(preview.locator("p", { hasText: "جَمِيلَةٌ" })).toHaveCount(1);

  // Tables: the table itself left-to-right, each cell by its own text, header and body.
  await expect(preview.locator("table").first()).toHaveAttribute("dir", "ltr");
  const cells = await dirs(page, root, "th, td");
  expect(dirOf(cells, "الاسم")).toBe("rtl");
  expect(dirOf(cells, "שם")).toBe("rtl");
  expect(dirOf(cells, "Name")).toBe("ltr");
  expect(dirOf(cells, "تفاح")).toBe("rtl");
  expect(dirOf(cells, "apples")).toBe("ltr");
  expect(dirOf(cells, "Pears")).toBe("ltr");
  expect(dirOf(cells, "كمثرى")).toBe("rtl");

  // Lists: Arabic and Hebrew right-to-left (markers and indent on the right), the English one left-to-right.
  const lists = await dirs(page, root, "ul, ol");
  expect(dirOf(lists, "العنصر الأول")).toBe("rtl");
  expect(dirOf(lists, "الخطوة الأولى")).toBe("rtl");
  expect(dirOf(lists, "פריט בעברית")).toBe("rtl");
  expect(dirOf(lists, "An English")).toBe("ltr");
  expect(dirOf(lists, "مهمة مفتوحة")).toBe("rtl");
  const items = await dirs(page, root, "li");
  expect(dirOf(items, "عنصر متداخل")).toBe("rtl");
  expect(dirOf(items, "Second English")).toBe("ltr");
  const pad = await preview
    .locator("ul")
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { left: parseFloat(s.paddingLeft), right: parseFloat(s.paddingRight) };
    });
  expect(pad.right).toBeGreaterThan(pad.left);

  // Quotes: the bar on the side the text starts from.
  const quotes = await dirs(page, root, "blockquote");
  expect(dirOf(quotes, "اقتباس")).toBe("rtl");
  expect(dirOf(quotes, "ציטוט")).toBe("rtl");
  expect(dirOf(quotes, "A quote in")).toBe("ltr");

  // Code: always left-to-right, Arabic comment or not.
  expect(await preview.locator(".code-block, pre").first().evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
}

for (const locale of ["ar", "en"] as const) {
  test.describe(`interface in ${locale === "ar" ? "Arabic" : "English"}`, () => {
    test("preview: tables, lists, quotes, code", async ({ page }) => {
      await open(page, locale, "preview");
      await checkPreviewBlocks(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    });

    test("wysiwyg: tables, lists, quotes, code", async ({ page }) => {
      await open(page, locale, "wysiwyg");
      const pm = page.locator(".ProseMirror").first();
      await expect(pm.locator("h1")).toContainText("مقدمة", { timeout: 15_000 });
      const root = ".ProseMirror";
      const blocks = await dirs(page, root, "h1, p");
      expect(dirOf(blocks, "مقدمة")).toBe("rtl");
      expect(dirOf(blocks, "هذه فقرة")).toBe("rtl");
      expect(dirOf(blocks, "זו פסקה")).toBe("rtl");
      expect(dirOf(blocks, "An English")).toBe("ltr");
      // Cells hold paragraphs, which take their own direction.
      expect(dirOf(blocks, "تفاح")).toBe("rtl");
      expect(dirOf(blocks, "apples")).toBe("ltr");
      expect(dirOf(blocks, "كمثرى")).toBe("rtl");
      const lists = await dirs(page, root, "ul, ol");
      expect(dirOf(lists, "العنصر الأول")).toBe("rtl");
      expect(dirOf(lists, "الخطوة الأولى")).toBe("rtl");
      expect(dirOf(lists, "פריט בעברית")).toBe("rtl");
      expect(dirOf(lists, "An English")).toBe("ltr");
      const quotes = await dirs(page, root, "blockquote");
      expect(dirOf(quotes, "اقتباس")).toBe("rtl");
      expect(dirOf(quotes, "ציטוט")).toBe("rtl");
      expect(dirOf(quotes, "A quote in")).toBe("ltr");
      expect(await pm.locator("pre").first().evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
    });

    test("HTML export: the same directions are written into the file", async ({ page }) => {
      await open(page, locale, "preview");
      await expect(page.locator(".prose-lumen h1").first()).toContainText("مقدمة", { timeout: 15_000 });
      const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "file.exportHtml" } })));
      const download = await downloadPromise;
      const stream = await download.createReadStream();
      const html = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        stream.on("error", reject);
      });
      // The note's first strong character is Arabic, whatever the interface.
      expect(html).toMatch(/<html lang="ar" dir="rtl"/);
      expect(html).toMatch(/<table[^>]*dir="ltr"/);
      expect(html).toMatch(/<td[^>]*dir="auto"[^>]*>تفاح/);
      expect(html).toMatch(/<ul[^>]*dir="rtl"[^>]*>\s*<li[^>]*>\s*(<p[^>]*>)?العنصر الأول/);
      expect(html).toMatch(/<ol[^>]*dir="rtl"[^>]*>\s*<li[^>]*>\s*(<p[^>]*>)?الخطوة الأولى/);
      expect(html).toMatch(/<ul[^>]*dir="ltr"[^>]*>\s*<li[^>]*>\s*(<p[^>]*>)?An English/);
      expect(html).toMatch(/<blockquote[^>]*dir="rtl"[^>]*>\s*<p[^>]*>اقتباس/);
      expect(html).toMatch(/<blockquote[^>]*dir="ltr"[^>]*>\s*<p[^>]*>A quote/);
      expect(html).toMatch(/<pre[^>]*dir="ltr"|class="code-block"[^>]*dir="ltr"|dir="ltr"[^>]*class="code-block"/);
    });
  });
}

test("Arabic interface: the chrome is mirrored and nothing overflows", async ({ page }) => {
  await open(page, "ar", "split");
  await expect(page.locator(".prose-lumen h1").first()).toContainText("مقدمة", { timeout: 15_000 });
  expect(await page.locator("header").first().evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

// ── Phones ──────────────────────────────────────────────────────────────
onPhones(() => {
  for (const locale of ["ar", "en"] as const) {
    test(`preview in ${locale}: the matrix holds and nothing overflows`, async ({ page }) => {
      await open(page, locale, "preview");
      await checkPreviewBlocks(page);
      // A wide table scrolls inside its own box, not the page.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    });
  }
});
