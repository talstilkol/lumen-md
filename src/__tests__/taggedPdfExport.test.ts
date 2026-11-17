/**
 * Plan W13.F3 — the accessible PDF export: the print HTML made ready for a
 * tagged PDF (src/print/accessiblePdf.ts) and the PDF/UA-1 finishing and
 * first-gate check (src/print/pdfUa.ts).
 *
 * The PDFs in src/__tests__/fixtures/pdf-ua were printed by headless Chromium
 * (Page.printToPDF, generateTaggedPDF + generateDocumentOutline) from Lumen's
 * own print HTML of 10 Hebrew notes, then finished here
 * (`node scripts/verapdf-check.mjs --print`). veraPDF's
 * PDF/UA-1 run is the owner's (Mac); these tests are the first gate.
 */
import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePrintAccessible, pdfLang } from "../print/accessiblePdf";
import { finishPdfUa, inspectPdfUa, pdfString, readPdfString, PROBLEM_TEXT } from "../print/pdfUa";

const GOLDEN = "src/__tests__/fixtures/pdf-ua";
const pdfs = readdirSync(GOLDEN).filter((f) => f.endsWith(".pdf")).sort();
const read = (f: string) => new Uint8Array(readFileSync(`${GOLDEN}/${f}`));

function dom(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("the print HTML, made ready for a tagged PDF", () => {
  it("a skipped heading level is closed up; the original level stays as a class", () => {
    const root = dom("<h1>א</h1><h3 id='x'>ב</h3><h5>ג</h5><h2>ד</h2>");
    const r = makePrintAccessible(root, { lang: "he" });
    expect(r.headingsRenumbered).toBe(2);
    expect([...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => h.tagName)).toEqual(["H1", "H2", "H3", "H2"]);
    expect(root.querySelector("#x")?.className).toBe("lumen-print-h3");
  });

  it("every image gets a description: its own, its title or caption, its file name; decorative ones stay empty; the missing ones are listed", () => {
    const root = dom(
      "<img src='a.png' alt='חתול'><img src='files/נוף_הגליל.jpg'><figure><img src='c.png'><figcaption>מפה</figcaption></figure><img src='d.png' role='presentation'><img src='data:image/png;base64,AA'>",
    );
    const r = makePrintAccessible(root, { lang: "he", fallbackAlt: "תמונה" });
    expect([...root.querySelectorAll("img")].map((i) => i.getAttribute("alt"))).toEqual(["חתול", "נוף הגליל", "מפה", "", "תמונה"]);
    expect(r.imagesWithoutAlt).toEqual(["files/נוף_הגליל.jpg", "c.png", "(embedded image)"]);
  });

  it("table header cells get a scope; a table without any gets its first row as the header", () => {
    const root = dom("<table><thead><tr><th>שם</th></tr></thead><tbody><tr><th>א</th><td>1</td></tr></tbody></table><table><tr><td>x</td><td>y</td></tr><tr><td>1</td><td>2</td></tr></table>");
    const r = makePrintAccessible(root, { lang: "he" });
    const [a, b] = [...root.querySelectorAll("table")];
    expect([...a.querySelectorAll("th")].map((t) => t.getAttribute("scope"))).toEqual(["col", "row"]);
    expect(r.tablesWithoutHeaders).toBe(1);
    expect([...b.querySelectorAll("th")].map((t) => [t.textContent, t.getAttribute("scope")])).toEqual([
      ["x", "col"],
      ["y", "col"],
    ]);
  });

  it("English inside a Hebrew note gets lang=en (and Hebrew inside English lang=he); code is left alone", () => {
    const root = dom("<p>הפרויקט משתמש ב-React Native ו<code>npm run</code>.</p>");
    makePrintAccessible(root, { lang: "he" });
    expect([...root.querySelectorAll("[lang]")].map((e) => [e.getAttribute("lang"), e.textContent])).toEqual([["en", "React Native"]]);
    const en = dom("<p>The word שלום means peace.</p>");
    makePrintAccessible(en, { lang: "en" });
    expect(en.querySelector("[lang]")?.outerHTML).toBe('<span lang="he">שלום</span>');
  });

  it("the PDF's language: he → he-IL", () => {
    expect(pdfLang("he")).toBe("he-IL");
    expect(pdfLang("en-US")).toBe("en-US");
  });
});

describe("PDF strings", () => {
  it("Hebrew round-trips as UTF-16BE; ASCII stays a literal, parentheses escaped", () => {
    expect(readPdfString(pdfString("מסמך (טיוטה)"))).toBe("מסמך (טיוטה)");
    expect(pdfString("a (b)")).toBe("(a \\(b\\))");
  });
});

describe("finishing a tagged PDF as PDF/UA-1", () => {
  // A minimal tagged PDF in the shape Chromium writes (classic xref, uncompressed structure).
  function tiny(): Uint8Array {
    const objs = [
      "<</Type /Catalog /Pages 2 0 R /MarkInfo <</Type /MarkInfo /Marked true>> /StructTreeRoot 4 0 R /Lang (he)>>",
      "<</Type /Pages /Kids [3 0 R] /Count 1>>",
      "<</Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Annots [6 0 R] /Tabs /S>>",
      "<</Type /StructTreeRoot /K 5 0 R>>",
      "<</Type /StructElem /S /H1 /P 4 0 R>>",
      "<</Type /Annot /Subtype /Link /Rect [0 0 10 10] /A <</S /URI /URI (https://example.org)>>>>",
      "<</Title <FEFF05DE05E105DE05DA> /Producer (Skia/PDF)>>",
    ];
    let s = "%PDF-1.4\n";
    const offs: number[] = [];
    objs.forEach((o, i) => {
      offs.push(s.length);
      s += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = s.length;
    s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<</Size ${objs.length + 1} /Root 1 0 R /Info 7 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }

  it("before: the first gate names what PDF/UA-1 lacks (identification, the title shown, the link's text)", () => {
    expect(inspectPdfUa(tiny()).problems).toEqual(["noDisplayDocTitle", "noPdfUaId", "linkWithoutText"]);
  });

  it("after: an incremental update — the original bytes untouched — with XMP pdfuaid:part 1, he-IL, DisplayDocTitle, the link's address as its text", () => {
    const before = tiny();
    const after = finishPdfUa(before, { lang: "he-IL", date: new Date("2026-01-01T00:00:00Z") });
    expect(after.subarray(0, before.length)).toEqual(before);
    const r = inspectPdfUa(after);
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({ lang: "he-IL", title: "מסמך", pdfUaPart: 1, displayDocTitle: true, links: 1, linksWithoutText: 0 });
    const tail = new TextDecoder().decode(after.subarray(before.length));
    expect(tail).toContain("<pdfuaid:part>1</pdfuaid:part>");
    expect(tail).toContain('<rdf:li xml:lang="x-default">מסמך</rdf:li>');
    expect(tail).toContain("<pdf:Producer>Skia/PDF</pdf:Producer>");
    expect(tail).toMatch(/\/Prev \d+>>\nstartxref\n\d+\n%%EOF\n$/);
    // The new xref points at the objects it lists.
    const at = Number(/startxref\n(\d+)/.exec(tail.slice(tail.lastIndexOf("startxref")))![1]);
    const xref = new TextDecoder("latin1").decode(after.subarray(at, at + 200));
    for (const m of xref.matchAll(/(\d+) 1\n(\d{10}) 00000 n/g)) expect(new TextDecoder("latin1").decode(after.subarray(Number(m[2]), Number(m[2]) + 12))).toMatch(new RegExp(`^${m[1]} 0 obj`));
  });

  it("an untagged PDF is returned as it is (it cannot be PDF/UA); bytes that are not a PDF throw", () => {
    const plain = Uint8Array.from("%PDF-1.4\n1 0 obj\n<</Type /Catalog>>\nendobj\ntrailer\n<</Size 2 /Root 1 0 R>>\nstartxref\n0\n%%EOF\n", (c) => c.charCodeAt(0));
    expect(finishPdfUa(plain, { lang: "he-IL" })).toBe(plain);
    expect(() => finishPdfUa(new TextEncoder().encode("hello"), { lang: "he" })).toThrow();
  });

  it("every problem has its words", () => {
    for (const p of ["notTagged", "noStructTree", "noLang", "noDisplayDocTitle", "noTitle", "noPdfUaId", "figureWithoutAlt", "headingSkipped", "tableWithoutHeaders", "linkWithoutText"] as const) expect(PROBLEM_TEXT[p]).toBeTruthy();
  });
});

describe("golden: 10 Hebrew notes printed by Chromium and finished (fixtures/pdf-ua)", () => {
  it("there are 10 PDFs, each with its note and print HTML", () => {
    expect(pdfs.length).toBe(10);
    for (const f of pdfs) {
      expect(readdirSync(GOLDEN)).toContain(f.replace(/\.pdf$/, ".md"));
      expect(readdirSync(GOLDEN)).toContain(f.replace(/\.pdf$/, ".html"));
    }
  });

  it.each(pdfs)("%s passes the first gate: tagged, structure, language, title shown, PDF/UA id, bookmarks", (f) => {
    const r = inspectPdfUa(read(f));
    expect(r.problems, r.problems.map((p) => PROBLEM_TEXT[p]).join("; ")).toEqual([]);
    expect(r.outline).toBe(true);
    expect(r.structure.filter((s) => /^H[1-6]$/.test(s)).length).toBeGreaterThanOrEqual(1);
  });

  it("Hebrew notes are he-IL; the figures carry the description (written, or the fallback); the table has TH; the skipped levels were closed up; links have text", () => {
    expect(inspectPdfUa(read("01-מכתב.pdf")).lang).toBe("he-IL");
    expect(inspectPdfUa(read("04-תמונות.pdf"))).toMatchObject({ figures: 2, figuresWithoutAlt: 0 });
    expect(inspectPdfUa(read("03-טבלה.pdf"))).toMatchObject({ tables: 1, tablesWithoutTH: 0 });
    const skips = inspectPdfUa(read("08-כותרות-מדלגות.pdf"));
    expect(skips.structure.filter((s) => /^H\d$/.test(s))).toEqual(["H1", "H2", "H3"]);
    expect(inspectPdfUa(read("09-קישורים.pdf"))).toMatchObject({ links: 2, linksWithoutText: 0 });
  });
});

describe("scripts/verapdf-check.mjs", () => {
  const run = (...a: string[]) => spawnSync(process.execPath, [join(process.cwd(), "scripts/verapdf-check.mjs"), ...a], { encoding: "utf8" });
  const stub = (compliant: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), "verapdf-"));
    const bin = join(dir, "verapdf");
    // A stand-in with veraPDF's CLI shape (--version; --flavour ua1 --format json <files>).
    writeFileSync(
      bin,
      `#!${process.execPath}\nconst a = process.argv.slice(2);\nif (a[0] === "--version") { console.log("veraPDF stub"); process.exit(0); }\nconst files = a.filter((x) => x.endsWith(".pdf"));\nconsole.log(JSON.stringify({ report: { jobs: files.map((f) => ({ itemDetails: { name: f }, validationResult: [{ compliant: ${compliant}, details: { failedRules: ${compliant ? 0 : 1}, ruleSummaries: ${compliant ? "[]" : '[{ clause: "7.18.1", testNumber: 2, description: "stub" }]'} } }] })) } }));\n`,
    );
    chmodSync(bin, 0o755);
    return bin;
  };

  it("veraPDF not installed: the first gate runs on all 10 and the exit says the PDF/UA-1 run is owed (3, not 0)", () => {
    const r = run("--json", "--verapdf", "/nonexistent/verapdf");
    expect(r.status, r.stderr).toBe(3);
    const out = JSON.parse(r.stdout);
    expect(out.pdfs).toBe(10);
    expect(out.firstGate.pass).toBe(true);
    expect(out.verapdf).toBeNull();
  });

  it("with veraPDF: 0 when every PDF is compliant, 1 when one is not; an empty folder is not a pass", () => {
    expect(run("--verapdf", stub(true)).status).toBe(0);
    const bad = run("--verapdf", stub(false));
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("7.18.1-2: stub");
    expect(run(mkdtempSync(join(tmpdir(), "empty-"))).status).toBe(2);
  });
});
