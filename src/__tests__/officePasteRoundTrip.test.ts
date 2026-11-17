/**
 * W7.3 acceptance 2, automated: "a paste of a copy from Lumen into Word and
 * Google Docs keeps headings, bold and direction in 10/10 cases".
 *
 * Word and Google Docs cannot run here, so the check is split into the two
 * halves that can, over 10 cases (fixtures/office-paste/):
 *
 *  1. OUT: what Lumen puts on the clipboard (markdownToClipboardHtml) says
 *     each block's kind, direction and bold runs in the HTML that Word's and
 *     Docs' importers read: <h1>–<h6> (Word: Heading 1–6; Docs: Heading 1–6),
 *     <strong>/<b> or font-weight ≥ 600 (bold), and `dir` on the block or an
 *     ancestor (paragraph direction; neither reads Unicode's first-strong
 *     rule, so a Hebrew block without dir="rtl" lands LTR). `imported()`
 *     below reads an HTML fragment the way those importers do and nothing
 *     more: classes, fonts and other styling are ignored.
 *  2. BACK: the clipboard HTML Word and Docs give when the same text is
 *     copied out of them (*.word.html, *.gdocs.html) carries the same blocks,
 *     and pasting it into Lumen (pastedHtmlToMarkdown) gives the original
 *     Markdown back.
 *
 * The Word and Docs files are written for this set after the markup those
 * programs put on the clipboard (Word 16: MsoNormal / MsoListParagraph with
 * mso-list levels, `dir=RTL`, <b><span lang=HE>; Docs: the docs-internal-guid
 * wrapper, `dir` on every block, font-weight:700 spans, aria-level list
 * items), the same way as fixtures/paste/. They are not captures: the
 * owner's paste into the real programs stays a manual check (Mac pack
 * FC3-W7.3-office-paste).
 */
import { describe, expect, it } from "vitest";
import { markdownToClipboardHtml } from "../editor/copyHtml";
import { pastedHtmlToMarkdown } from "../paste/htmlPaste";

const md = import.meta.glob<string>("./fixtures/office-paste/*.md", { query: "?raw", import: "default", eager: true });
const word = import.meta.glob<string>("./fixtures/office-paste/*.word.html", { query: "?raw", import: "default", eager: true });
const gdocs = import.meta.glob<string>("./fixtures/office-paste/*.gdocs.html", { query: "?raw", import: "default", eager: true });
const spec = import.meta.glob<string>("./fixtures/office-paste/*.blocks.json", { query: "?raw", import: "default", eager: true });

type Run = [string, boolean?];
type SpecBlock = { t: "h"; n: number; runs: Run[] } | { t: "p"; runs: Run[] } | { t: "ul" | "ol"; items: Array<[number, Run[]]> };

/** What an office importer keeps of a block. */
interface Block {
  kind: string;
  dir: "rtl" | "ltr";
  text: string;
  bold: string[];
}

const HE = /[֐-׿]/;
const firstStrongRtl = (t: string) => {
  const m = /[A-Za-z]|[֐-׿]/.exec(t);
  return !!m && HE.test(m[0]);
};

/** The blocks a case must arrive as. */
function expected(blocks: SpecBlock[]): Block[] {
  const out: Block[] = [];
  const of = (kind: string, runs: Run[]): Block => {
    const text = runs.map(([s]) => s).join("");
    return { kind, dir: firstStrongRtl(text) ? "rtl" : "ltr", text, bold: runs.filter(([, b]) => b).map(([s]) => s) };
  };
  for (const b of blocks) {
    if (b.t === "h") out.push(of(`h${b.n}`, b.runs));
    else if (b.t === "p") out.push(of("p", b.runs));
    else for (const [lv, runs] of b.items) out.push(of(`${b.t === "ul" ? "bullet" : "number"}${lv}`, runs));
  }
  return out;
}

const norm = (s: string) => s.replace(/ /g, " ").replace(/\s+/g, " ").trim();

/** An element's own direction: `dir` or CSS direction on it or its nearest ancestor that says one. */
function dirOf(el: Element | null): "rtl" | "ltr" {
  for (let e = el; e; e = e.parentElement) {
    const d = e.getAttribute("dir")?.toLowerCase();
    if (d === "rtl" || d === "ltr") return d;
    const css = /direction\s*:\s*(rtl|ltr)/i.exec(e.getAttribute("style") ?? "");
    if (css) return css[1].toLowerCase() as "rtl" | "ltr";
  }
  return "ltr";
}

const isBold = (e: Element) => {
  const tag = e.tagName.toLowerCase();
  const w = /font-weight\s*:\s*(\w+)\s*;?\s*$/i.exec((e.getAttribute("style") ?? "").replace(/font-weight\s*:\s*\w+\s*;(?=.*font-weight)/gi, ""));
  // The last font-weight in a style wins (Docs writes 400 then 700).
  if (w) return w[1] === "bold" || Number(w[1]) >= 600;
  return tag === "b" || tag === "strong";
};

/** Text of a block, without nested lists and Word's list markers. */
function ownText(el: Element, bold: string[]): string {
  let text = "";
  let run = "";
  const walk = (n: Node, inBold: boolean) => {
    if (n.nodeType === 3) {
      text += n.textContent ?? "";
      if (inBold) run += n.textContent ?? "";
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const tag = e.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol" || /mso-list\s*:\s*ignore/i.test(e.getAttribute("style") ?? "")) return;
    const b = isBold(e);
    if (b && !inBold) run = "";
    for (const c of e.childNodes) walk(c, inBold || b);
    if (b && !inBold && norm(run)) bold.push(norm(run));
  };
  for (const c of el.childNodes) walk(c, false);
  return norm(text);
}

/** The blocks an office importer reads from clipboard HTML. */
function imported(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Docs wraps the whole fragment in <b style="font-weight:normal">: not bold.
  const out: Block[] = [];
  const walk = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const style = el.getAttribute("style") ?? "";
    const wordList = tag === "p" && /mso-list\s*:\s*l\d+\s+level(\d+)/i.exec(style);
    let kind: string | null = null;
    if (/^h[1-6]$/.test(tag)) kind = tag;
    else if (wordList) {
      const marker = el.querySelector('[style*="mso-list:Ignore"], [style*="mso-list: Ignore"]')?.textContent ?? "";
      kind = `${/^\s*[\d\w]+\./.test(marker) ? "number" : "bullet"}${wordList[1]}`;
    } else if (tag === "li") {
      let depth = Number(el.getAttribute("aria-level") ?? 0);
      if (!depth) for (let e = el.parentElement; e; e = e.parentElement) if (/^(ul|ol)$/i.test(e.tagName)) depth++;
      kind = `${el.parentElement?.tagName.toLowerCase() === "ol" ? "number" : "bullet"}${depth}`;
    } else if (tag === "p" && !el.closest("li")) kind = "p";
    if (kind) {
      const bold: string[] = [];
      const text = ownText(el, bold);
      if (text) out.push({ kind, dir: dirOf(el), text, bold });
      if (tag !== "li") return;
    }
    for (const c of el.children) walk(c);
  };
  walk(doc.body);
  return out;
}

const cases = Object.keys(md)
  .sort()
  .map((p) => {
    const base = p.replace(/\.md$/, "");
    return { name: base.split("/").pop()!, md: md[p], word: word[`${base}.word.html`], gdocs: gdocs[`${base}.gdocs.html`], want: expected(JSON.parse(spec[`${base}.blocks.json`]) as SpecBlock[]) };
  });

describe("copy from Lumen into Word and Google Docs (W7.3 acceptance 2)", () => {
  it("has 10 cases, each with its Word and Docs clipboard HTML, Hebrew and English", () => {
    expect(cases).toHaveLength(10);
    for (const c of cases) expect([c.name, !!c.word, !!c.gdocs]).toEqual([c.name, true, true]);
    expect(cases.some((c) => c.want.some((b) => b.dir === "rtl"))).toBe(true);
    expect(cases.some((c) => c.want.some((b) => b.dir === "ltr"))).toBe(true);
  });

  for (const c of cases) {
    it(`${c.name}: Lumen's clipboard HTML carries every heading, bold run and direction`, () => {
      expect(imported(markdownToClipboardHtml(c.md))).toEqual(c.want);
    });
  }

  it("headings, bold and direction survive in 10/10 cases: out of Lumen, and back from Word and from Docs", () => {
    const failed: string[] = [];
    for (const c of cases) {
      const out = JSON.stringify(imported(markdownToClipboardHtml(c.md))) === JSON.stringify(c.want);
      const w = JSON.stringify(imported(c.word)) === JSON.stringify(c.want);
      const g = JSON.stringify(imported(c.gdocs)) === JSON.stringify(c.want);
      const wBack = pastedHtmlToMarkdown(c.word) === c.md.trim();
      const gBack = pastedHtmlToMarkdown(c.gdocs) === c.md.trim();
      if (!(out && w && g && wBack && gBack)) failed.push(`${c.name}: out ${out} word ${w} docs ${g} word→Lumen ${wBack} docs→Lumen ${gBack}`);
    }
    expect(failed).toEqual([]);
  });

  it("the importer model is not fooled: a Hebrew block without dir lands LTR, and a styled span is not bold", () => {
    expect(imported('<h1>כותרת</h1><p>טקסט <span style="color:red">אדום</span></p>')).toEqual([
      { kind: "h1", dir: "ltr", text: "כותרת", bold: [] },
      { kind: "p", dir: "ltr", text: "טקסט אדום", bold: [] },
    ]);
    expect(imported('<b style="font-weight:normal;"><p dir="rtl"><span style="font-weight:400;font-weight:700;">חזק</span></p></b>')).toEqual([{ kind: "p", dir: "rtl", text: "חזק", bold: ["חזק"] }]);
  });
});
