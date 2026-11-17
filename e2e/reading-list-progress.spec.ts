import { test, expect, type Page } from "@playwright/test";
import { vaultOrSkip } from "./_opfs";
import { testHooks, type LumenTestWindow } from "./_lumen";

/**
 * Plan W12.X2 — the reading list moves by itself. Acceptance:
 *   - opening a 60-page PDF and reading to page 50 updates the source note
 *     that names it: page 50, pages 60, progress 83, status to-read → reading;
 *   - nothing outside the frontmatter changes: the note's body is byte for
 *     byte what it was, and no other key of the frontmatter moved.
 * The PDF is made here (60 pages, one line of text each), so the spec needs
 * no binary fixture.
 */

const PAGES = 60;
const TARGET = 50;
const SOURCE = "Sources/long-read.md";
const BODY = "\n# Long read\n\nMy notes on it. ‏הערות שלי.\n";
const NOTE = `---\ntype: source\ntitle: Long read\nfile: "[[long-read.pdf]]"\nstatus: to-read\nauthor: Someone\n---\n${BODY}`;

/** A valid PDF with `n` pages, "Page k" on each (Helvetica, no embedded fonts). */
function makePdf(n: number): string {
  const objs: string[] = [];
  const kids = Array.from({ length: n }, (_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  for (let i = 0; i < n; i++) {
    const stream = `BT /F1 24 Tf 72 720 Td (Page ${i + 1}) Tj ET`;
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let k = 1; k < objs.length; k++) {
    offsets[k] = out.length;
    out += `${k} 0 obj\n${objs[k]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let k = 1; k < objs.length; k++) out += `${String(offsets[k]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

async function seed(page: Page): Promise<boolean> {
  return page.evaluate(
    async ({ pdf, note, source }) => {
      try {
        const ws = await (window as unknown as LumenTestWindow).__lumenTest.load("storage/workspace");
        const root = await navigator.storage.getDirectory();
        const fh = await root.getFileHandle("long-read.pdf", { create: true });
        const h = fh as unknown as { createWritable?: () => Promise<{ write(d: Uint8Array): Promise<void>; close(): Promise<void> }> };
        if (typeof h.createWritable !== "function") return false;
        const wr = await h.createWritable();
        await wr.write(Uint8Array.from(pdf, (c) => c.charCodeAt(0)));
        await wr.close();
        await ws.writeWorkspaceFile(source, note);
        return true;
      } catch {
        return false;
      }
    },
    { pdf: makePdf(PAGES), note: NOTE, source: SOURCE },
  );
}

const readNote = (page: Page) =>
  page.evaluate(async (source) => {
    const ws = await (window as unknown as LumenTestWindow).__lumenTest.load("storage/workspace");
    return ws.readWorkspaceFile(source).catch(() => "");
  }, SOURCE);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
  await testHooks(page);
});

test("reading a PDF to page 50 moves its source note: frontmatter only", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  vaultOrSkip(await seed(page), browserName);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path: "long-read.pdf" } })));
  const reader = page.getByTestId("pdf-reader");
  await expect(reader).toBeVisible({ timeout: 15_000 });
  await expect(reader).toHaveAttribute("data-page-count", String(PAGES), { timeout: 20_000 });

  // Read to page 50: its top at the top of the reader, then let scrolling stop.
  await page.locator(`[data-page-number="${TARGET}"]`).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect.poll(async () => /\npage: 50\n/.test(await readNote(page)), { timeout: 20_000 }).toBe(true);

  const after = await readNote(page);
  const fm = after.slice(0, after.indexOf("\n---\n", 4) + 5);
  expect(fm).toMatch(/\npages: 60\n/);
  expect(fm).toMatch(/\nprogress: 83\n/);
  expect(fm).toMatch(/\nstatus: reading\n/);
  // Every key that was there is still there with its value; only page/pages/progress/status are new or changed.
  for (const kept of ["type: source", "title: Long read", 'file: "[[long-read.pdf]]"', "author: Someone"]) expect(fm).toContain(`\n${kept}\n`);
  expect(fm).not.toMatch(/\nfinished:/);
  // Nothing outside the frontmatter: the body is byte for byte the same.
  expect(after.slice(fm.length)).toBe(BODY);
});
