/**
 * Plan W13.H5 — Hebrew list numbering (א. ב. ג.) in the preview, the PDF and
 * DOCX, while the Markdown keeps 1. 2. 3.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COUNTER_STYLE, hebrewListCss, hebrewNumeral, listNumberingOf, listNumberingOfMarkdown } from "../lib/hebrewListNumbering";
import { toggleHebrewListNumbering } from "../editor/listNumberingCommand";
import { docxPartsForTest } from "../storage/exportDocx";

const ROOT = resolve(__dirname, "..", "..");
const VALUE: Record<string, number> = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ל: 30, מ: 40, נ: 50, ס: 60, ע: 70, פ: 80, צ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };

describe("gematria for list markers, 1–999", () => {
  it("the acceptance numbers", () => {
    expect(hebrewNumeral(15)).toBe("טו");
    expect(hebrewNumeral(16)).toBe("טז");
    expect(hebrewNumeral(270)).toBe("ער");
    expect(hebrewNumeral(275)).toBe("ערה");
    expect(hebrewNumeral(344)).toBe("שדמ");
    expect(hebrewNumeral(744)).toBe("תשדמ");
  });

  it("the other traditional reorderings, and plain numbers", () => {
    expect(hebrewNumeral(272)).toBe("ערב");
    expect(hebrewNumeral(298)).toBe("רחצ");
    expect(hebrewNumeral(304)).toBe("דש");
    expect(hebrewNumeral(698)).toBe("תרחצ");
    expect(hebrewNumeral(115)).toBe("קטו");
    expect(hebrewNumeral(916)).toBe("תתקטז");
    expect([1, 9, 10, 11, 14, 17, 19, 20, 99, 100, 101, 400, 500, 999].map(hebrewNumeral)).toEqual(["א", "ט", "י", "יא", "יד", "יז", "יט", "כ", "צט", "ק", "קא", "ת", "תק", "תתקצט"]);
  });

  it("every one of 1–999: the letters add up to the number, are unique, never end in יה / יו, and carry no geresh", () => {
    const seen = new Set<string>();
    for (let n = 1; n <= 999; n++) {
      const s = hebrewNumeral(n);
      expect([...s].reduce((a, c) => a + (VALUE[c] ?? Number.NaN), 0), `${n} ${s}`).toBe(n);
      expect(s, String(n)).not.toMatch(/(^|[^ק-ת])(יה|יו)$|יה$|יו$/);
      expect(s).not.toMatch(/[׳״'"]/);
      expect(seen.has(s), s).toBe(false);
      seen.add(s);
    }
    expect(seen.size).toBe(999);
  });

  it("out of range stays a number", () => {
    expect(hebrewNumeral(0)).toBe("0");
    expect(hebrewNumeral(1000)).toBe("1000");
    expect(hebrewNumeral(2.5)).toBe("2.5");
  });
});

describe("the note asks for it in its frontmatter", () => {
  it("parsed frontmatter", () => {
    expect(listNumberingOf({ listNumbering: "hebrew" })).toBe("hebrew");
    expect(listNumberingOf({ "list-numbering": "עברית" })).toBe("hebrew");
    expect(listNumberingOf({ listNumbering: "decimal" })).toBe("decimal");
    expect(listNumberingOf(null)).toBe("decimal");
  });

  it("from the text (export paths)", () => {
    expect(listNumberingOfMarkdown("---\ntitle: x\nlistNumbering: hebrew\n---\n1. a\n")).toBe("hebrew");
    expect(listNumberingOfMarkdown('---\nlist-numbering: "hebrew" # א ב ג\n---\n')).toBe("hebrew");
    expect(listNumberingOfMarkdown("1. a\n\nlistNumbering: hebrew\n")).toBe("decimal");
    expect(listNumberingOfMarkdown("")).toBe("decimal");
  });
});

describe("the palette command edits only the frontmatter", () => {
  it("adds the key, keeping other keys and the 1. 2. 3. items", () => {
    const md = "---\ntitle: חוזה\n---\n1. ראשון\n2. שני\n";
    const on = toggleHebrewListNumbering(md);
    expect(on.on).toBe(true);
    expect(on.text).toBe("---\ntitle: חוזה\nlistNumbering: hebrew\n---\n1. ראשון\n2. שני\n");
    const off = toggleHebrewListNumbering(on.text);
    expect(off.on).toBe(false);
    expect(off.text).toBe(md);
  });

  it("creates a frontmatter when there is none, and removes it when it empties", () => {
    const md = "1. a\n";
    const on = toggleHebrewListNumbering(md);
    expect(on.text).toBe("---\nlistNumbering: hebrew\n---\n1. a\n");
    expect(toggleHebrewListNumbering(on.text).text).toBe(md);
  });

  it("is registered in the palette", () => {
    const src = readFileSync(join(ROOT, "src/commands/domains/edit.ts"), "utf8");
    expect(src).toMatch(/id: "edit\.hebrewListNumbering"/);
  });
});

describe("preview and PDF: CSS", () => {
  const css = hebrewListCss("html");

  it("a fixed counter style of the 999 markers, CSS's own `hebrew` past them", () => {
    const m = /symbols: ([^;]+);/.exec(css)!;
    const symbols = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(symbols).toHaveLength(999);
    expect(symbols[14]).toBe("טו");
    expect(symbols[269]).toBe("ער");
    expect(css).toMatch(new RegExp(`@counter-style ${COUNTER_STYLE} \\{ system: fixed 1;`));
    expect(css).toMatch(/suffix: "\. "; fallback: hebrew;/);
    expect(css).toMatch(/html ol \{ list-style-type: lumen-hebrew; \}/);
  });

  it("the preview root carries the note's choice, and the app's CSS has the no-JS fallback", () => {
    const preview = readFileSync(join(ROOT, "src/renderer/Preview.tsx"), "utf8");
    expect(preview).toMatch(/data-list-numbering=\{listNumbering === "hebrew" \? "hebrew" : undefined\}/);
    expect(preview).toMatch(/import\("\.\.\/lib\/hebrewListNumbering"\)\.then\(\(m\) => m\.ensureHebrewListStyle\(\)\)/);
    expect(readFileSync(join(ROOT, "src/index.css"), "utf8")).toMatch(/\[data-list-numbering="hebrew"\] ol \{ list-style-type: hebrew; \}/);
  });

  it("the print document adds the style for such a note", () => {
    expect(readFileSync(join(ROOT, "src/ui/PrintExport.tsx"), "utf8")).toMatch(/if \(listNumberingOf\(fm\) === "hebrew"\) styles\.push\(hebrewListCss\("html"\)\)/);
  });
});

describe("DOCX: Word's hebrew1", () => {
  const note = (fm: string) => `${fm}# רשימה\n\n1. ראשון\n2. שני\n\n- תבליט\n`;

  it("ordered lists use w:numFmt hebrew1 when the note asks, bullets stay bullets", () => {
    const parts = docxPartsForTest(note("---\nlistNumbering: hebrew\n---\n"));
    const numbering = parts["word/numbering.xml"];
    expect(numbering).toMatch(/<w:numFmt w:val="hebrew1"\/>/);
    expect(numbering).not.toMatch(/<w:numFmt w:val="decimal"\/>/);
    expect(numbering).toMatch(/<w:numFmt w:val="bullet"\/>/);
    // The items are still real Word list paragraphs (numbered by Word, not by text).
    expect(parts["word/document.xml"]).toMatch(/<w:numPr>/);
    expect(parts["word/document.xml"]).not.toMatch(/א\.\s*ראשון/);
  });

  it("decimal otherwise", () => {
    const numbering = docxPartsForTest(note(""))["word/numbering.xml"];
    expect(numbering).toMatch(/<w:numFmt w:val="decimal"\/>/);
    expect(numbering).not.toMatch(/hebrew1/);
  });
});
