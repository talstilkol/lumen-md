/**
 * Plan W7.6 acceptance 3, the PDF half: a note with a data.gov.il and a CBS
 * block goes through the app's print path (buildPrintHtml: the same render,
 * layout and @page CSS that "Export PDF" prints from), and the document it
 * prints keeps each attribution line whole: the publisher, the dataset's
 * title, the retrieval date, the data link and (CBS) the licence's "as is"
 * clause and terms link, in a right-to-left paragraph. The DOCX half is
 * datagovExportDocx.test.ts; printing that document to a PDF and reading
 * its text layer back is e2e/datagov-pdf.spec.ts (Mac pack FC3-W7.6-pdf).
 */
import { describe, expect, it } from "vitest";
import { attribution, dataUrl } from "../sources/datagov/snapshot";
import { datasetNote } from "./fixtures/datagov/note";

const norm = (s: string) => s.replace(/[‎‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim();

describe("W7.6 attribution survives the PDF export (the print path)", () => {
  it("the printed document has each attribution line whole, right to left, with its data link", async () => {
    const { a, b, md } = await datasetNote();
    const { buildPrintHtml } = await import("../ui/PrintExport");
    const html = await buildPrintHtml(md, "נתונים");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const content = doc.getElementById("lumen-print-content") ?? doc.body;
    const text = norm(content.textContent ?? "");
    for (const block of [a.block, b.block]) {
      const line = norm(attribution(block).replace(/\*\*|__|\\/g, ""));
      expect(text, `${block.source}: the attribution line`).toContain(line);
      // The paragraph that carries it prints right to left.
      const para = [...content.querySelectorAll("p")].find((p) => norm(p.textContent ?? "").includes(line.slice(0, 40)));
      expect(para, `${block.source}: a paragraph of its own`).toBeTruthy();
      // dir="rtl", or dir="auto" on a paragraph whose first strong letter is Hebrew (the browser then lays it out RTL).
      const dir = para!.closest("[dir]")?.getAttribute("dir");
      const resolved = dir === "auto" ? (/^[^A-Za-z\u0590-\u05FF]*[\u0590-\u05FF]/.test(para!.textContent ?? "") ? "rtl" : "ltr") : dir;
      expect(resolved, `${block.source}: direction (dir=${dir})`).toBe("rtl");
      expect(text).toContain(dataUrl(block));
    }
    for (const part of ["data.gov.il", a.block.title, "נשלף 14.11.2026", 'הלשכה המרכזית לסטטיסטיקה (הלמ"ס)', b.block.title, "(14.11.2026)", "as is"]) expect(text, part).toContain(part);
    // Print, not screen: the document carries its @page rules.
    expect(html).toMatch(/@page/);
  });
});
