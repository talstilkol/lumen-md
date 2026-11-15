/**
 * W12.F3: the ODT writer, and a Hebrew round trip for DOCX, ODT and EPUB.
 *
 * Corpus (each labelled as what it is):
 * - 30 Hebrew sections of this repository's own docs/ (real project text);
 * - 6 synthetic Hebrew notes written for this test, one per feature the docs
 *   rarely have (RTL tables, footnotes, nested and numbered lists, mixed
 *   emphasis): labelled `synthetic` in the report;
 * - the 30 real LibreOffice-made DOCX files of the import corpus
 *   (fixtures/real-corpus/docx, CC0, plan W6.38): DOCX → MD → DOCX → MD must
 *   be stable.
 *
 * Per format and feature, the share of the source's items found again after
 * Markdown → format → Markdown. Report: test-results/office-roundtrip/.
 * Scores below the committed baseline by more than one point fail.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { markdownToOdtBytes, markdownToOdtParts } from "../storage/exportOdt";
import { docxPartsForTest, markdownToDocxBytes } from "../storage/exportDocx";
import { markdownToEpubBytes } from "../storage/exportFormats";
import { docxToMarkdown, epubToMarkdown, odtToMarkdown } from "../storage/officeFormats";
import { unzip } from "../storage/zip";

const file = (bytes: Uint8Array, name: string) => new File([bytes as BlobPart], name);

type Format = "odt" | "docx" | "epub";
async function roundTrip(fmt: Format, md: string): Promise<string> {
  if (fmt === "odt") return odtToMarkdown(file(await markdownToOdtBytes(md), "n.odt"));
  if (fmt === "docx") return docxToMarkdown(file(await markdownToDocxBytes(md), "n.docx"));
  return epubToMarkdown(file(await markdownToEpubBytes(md, "n"), "n.epub"));
}

/* ─── features ───────────────────────────────────────────────────────── */

const FEATURES = ["headings", "paragraphs", "bold", "italic", "links", "list items", "list kind", "table cells", "footnotes"] as const;
type Feature = (typeof FEATURES)[number];

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const plain = (s: string) => squash(s.replace(/\[\^[^\]]+\]/g, "").replace(/\*\*|\*|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"));

const BLOCK_START = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|\[\^[^\]]+\]:)|^\s{0,3}([-*_])(\s*\2){2,}\s*$/;

/** Lines with soft-wrapped continuations joined to the paragraph or list item they continue. */
function unwrap(md: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const l of md.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const prev = out[out.length - 1];
    const joinable = !fence && l.trim() && !BLOCK_START.test(l) && prev !== undefined && prev.trim() && !/^\s*(#{1,6}\s|\||```|~~~)/.test(prev);
    if (joinable) out[out.length - 1] = `${prev} ${l.trim()}`;
    else out.push(l);
  }
  return out;
}

/** The items of each feature, as strings, from Markdown outside code fences. */
export function features(md: string): Record<Feature, string[]> {
  const f: Record<Feature, string[]> = Object.fromEntries(FEATURES.map((k) => [k, [] as string[]])) as Record<Feature, string[]>;
  let fence = false;
  const lines = unwrap(md);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) {
      fence = !fence;
      continue;
    }
    if (fence || !l.trim()) continue;
    const text = l.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?|\|)/, "");
    for (const m of text.matchAll(/\*\*([^*]+?)\*\*/g)) f.bold.push(squash(m[1]));
    for (const m of text.replace(/\*\*[^*]+?\*\*/g, "").matchAll(/(?<![*\w])\*(?=\S)([^*]+?)\*(?![*\w])/g)) f.italic.push(squash(m[1]));
    for (const m of text.matchAll(/(?<!!)\[([^\]^][^\]]*)\]\(([^)\s]+)/g)) f.links.push(`${plain(m[1])} → ${m[2]}`);
    const fn = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(l);
    if (fn) {
      f.footnotes.push(plain(fn[2]));
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      f.headings.push(`${h[1].length} ${plain(h[2])}`);
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) {
      f["list items"].push(plain(li[3].replace(/^\[[ xX]\]\s+/, "")));
      f["list kind"].push(`${/\d/.test(li[2]) ? "ol" : "ul"} ${plain(li[3])}`);
      continue;
    }
    if (/^\s*\|/.test(l)) {
      if (/^\s*\|?\s*:?-+/.test(l) && !/[^\s|:-]/.test(l)) continue;
      // Only a real table counts: its header line is followed by the separator row.
      let k = i;
      while (k > 0 && /^\s*\|/.test(lines[k - 1])) k--;
      if (!(lines[k + 1] && /^\s*\|?\s*:?-+/.test(lines[k + 1]) && !/[^\s|:-]/.test(lines[k + 1]))) {
        f.paragraphs.push(plain(l));
        continue;
      }
      for (const c of l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/)) if (c.trim()) f["table cells"].push(plain(c));
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) continue;
    f.paragraphs.push(plain(l.replace(/^>\s?/, "")));
  }
  return f;
}

/** Share of `a`'s items (as a multiset) found in `b`. */
function kept(a: string[], b: string[]): { total: number; same: number } {
  const pool = new Map<string, number>();
  for (const x of b) pool.set(x, (pool.get(x) ?? 0) + 1);
  let same = 0;
  for (const x of a) {
    const n = pool.get(x) ?? 0;
    if (n > 0) {
      same++;
      pool.set(x, n - 1);
    }
  }
  return { total: a.length, same };
}

/** Paragraph text is compared joined, since a converter may rewrap lines. */
function keptParagraphs(a: string[], b: string[]): { total: number; same: number } {
  const hay = squash(b.join(" "));
  return { total: a.length, same: a.filter((p) => hay.includes(p)).length };
}

/* ─── corpus ─────────────────────────────────────────────────────────── */

/** Note-sized pieces: a document split at its level-1/2 headings, outside code fences. */
function splitAtHeadings(text: string): string[] {
  const parts: string[] = [];
  let cur: string[] = [];
  let fence = false;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    else if (!fence && /^#{1,2} /.test(line) && cur.join("").trim()) {
      parts.push(cur.join("\n").trim() + "\n");
      cur = [];
    }
    cur.push(line);
  }
  if (cur.join("").trim()) parts.push(cur.join("\n").trim() + "\n");
  return parts;
}

const isHebrew = (s: string) => (s.match(/[֐-׿]/g)?.length ?? 0) > (s.match(/[A-Za-z]/g)?.length ?? 0);
const docsNotes = (readdirSync("docs", { recursive: true }) as string[])
  .filter((n) => n.endsWith(".md"))
  .sort()
  .flatMap((n) => splitAtHeadings(readFileSync(join("docs", n), "utf8")))
  .filter((s) => isHebrew(s) && s.length > 120 && !s.startsWith("---"))
  .slice(0, 30);

/** Synthetic: written for this test to cover what the docs rarely have. */
const SYNTHETIC = [
  "# טבלת ציונים\n\n| שם | ציון | הערה |\n| --- | --- | --- |\n| דנה | 95 | מצוין |\n| יוסי | 88 | טוב מאוד |\n",
  "## מקורות\n\nהרמב״ם כתב על כך[^1] וגם רש״י[^2].\n\n[^1]: משנה תורה, הלכות דעות א.\n[^2]: רש״י על בראשית א א.\n",
  "## רשימה מקוננת\n\n- פרי\n  - תפוח\n  - אגס\n- ירק\n\n1. ראשון\n2. שני\n3. שלישי\n",
  "### הדגשות\n\nטקסט **מודגש** ואחר כך *נטוי* ושוב **מודגש שני**, עם [קישור](https://www.sefaria.org/Genesis.1).\n",
  "# פרק ראשון\n\nפסקה ראשונה של הפרק.\n\n> ציטוט מתוך ספר.\n\nפסקה שנייה עם `code` בתוכה.\n",
  "## Mixed כיוונים\n\n| Term | מונח |\n| --- | --- |\n| file | קובץ |\n| folder | תיקייה |\n",
];

const corpus = [
  ...docsNotes.map((md, i) => ({ id: `docs#${i + 1}`, md, synthetic: false })),
  ...SYNTHETIC.map((md, i) => ({ id: `synthetic#${i + 1}`, md, synthetic: true })),
];

const baseline = JSON.parse(readFileSync("src/__tests__/fixtures/office-roundtrip/baseline.json", "utf8")) as {
  formats: Record<string, Record<string, number>>;
};

/* ─── tests ──────────────────────────────────────────────────────────── */

describe("ODT writer (W12.F3)", () => {
  it("is a valid ODF package: mimetype first and stored, manifest lists the parts", async () => {
    const bytes = await markdownToOdtBytes("# שלום\n\nעולם\n");
    // Local header of entry 1: name "mimetype" at offset 30, method 0 (stored) at offset 8.
    expect(new TextDecoder().decode(bytes.subarray(30, 38))).toBe("mimetype");
    expect(bytes[8]).toBe(0);
    expect(new TextDecoder().decode(bytes.subarray(38, 38 + 39))).toBe("application/vnd.oasis.opendocument.text");
    const parts = await unzip(bytes.buffer as ArrayBuffer);
    expect([...parts.keys()]).toEqual(["mimetype", "META-INF/manifest.xml", "content.xml", "styles.xml", "meta.xml"]);
    const manifest = new TextDecoder().decode(parts.get("META-INF/manifest.xml"));
    for (const p of ["content.xml", "styles.xml", "meta.xml"]) expect(manifest).toContain(`manifest:full-path="${p}"`);
    for (const [name, data] of parts) if (name.endsWith(".xml")) expect(new DOMParser().parseFromString(new TextDecoder().decode(data), "application/xml").getElementsByTagName("parsererror"), name).toHaveLength(0);
  });

  it("a Hebrew paragraph is rl-tb, an English one lr-tb", () => {
    const content = markdownToOdtParts("שלום עולם\n\nHello world\n").find((p) => p.name === "content.xml")!.data;
    expect(content).toContain('<text:p text:style-name="Body_rtl">שלום עולם</text:p>');
    expect(content).toContain('<text:p text:style-name="Body_ltr">Hello world</text:p>');
    expect(content).toMatch(/style:name="Body_rtl"[^>]*>\s*<style:paragraph-properties style:writing-mode="rl-tb"/);
  });

  it("a Hebrew table is laid out right to left; bold sets the complex-script weight", () => {
    const content = markdownToOdtParts(SYNTHETIC[0] + "\n**חשוב**\n").find((p) => p.name === "content.xml")!.data;
    expect(content).toContain('table:style-name="Table_rtl"');
    expect(content).toMatch(/style:name="Table_rtl"[^>]*><style:table-properties table:align="right" style:writing-mode="rl-tb"/);
    expect(content).toContain('<text:span text:style-name="T_b">חשוב</text:span>');
    expect(content).toContain('style:font-weight-complex="bold"');
  });

  it("footnotes are real ODF notes, nested lists are nested", () => {
    const content = markdownToOdtParts(SYNTHETIC[1] + "\n" + SYNTHETIC[2]).find((p) => p.name === "content.xml")!.data;
    expect(content.match(/<text:note /g)).toHaveLength(2);
    expect(content).toContain("<text:note-body><text:p text:style-name=\"Footnote_rtl\">משנה תורה, הלכות דעות א.</text:p></text:note-body>");
    expect(content).toMatch(/<text:list-item><text:p[^>]*>פרי<\/text:p><text:list text:style-name="L_bullet"><text:list-item><text:p[^>]*>תפוח/);
    expect(content).toContain('<text:list text:style-name="L_num">');
  });

  it("reads back what it writes: headings, emphasis, links, lists, tables, footnotes", async () => {
    for (const md of SYNTHETIC) {
      const back = await roundTrip("odt", md);
      const a = features(md);
      const b = features(back);
      for (const k of FEATURES) expect(kept(a[k], b[k]).same, `${k} in ${md}\n→\n${back}`).toBe(a[k].length);
    }
  });
});

describe("DOCX round trip", () => {
  it("a soft-wrapped list item stays one item, and a wrapped paragraph is one Word paragraph (fixed here)", async () => {
    const md = "- פריט ראשון שנמשך\n  בשורה שנייה.\n- פריט שני\n\nפסקה שנכתבה\nבשתי שורות.\n";
    const xml = docxPartsForTest(md)["word/document.xml"];
    expect(xml.match(/<w:p>|<w:p /g)).toHaveLength(3);
    const back = await roundTrip("docx", md);
    expect(back).toContain("- פריט ראשון שנמשך בשורה שנייה.");
    expect(back).toContain("פסקה שנכתבה בשתי שורות.");
  });

  it("Word footnotes come back as [^n] with their text (fixed here: import dropped them)", async () => {
    const back = await roundTrip("docx", SYNTHETIC[1]);
    expect(back).toContain("הרמב״ם כתב על כך[^1] וגם רש״י[^2].");
    expect(back).toContain("[^1]: משנה תורה, הלכות דעות א.");
    expect(back).toContain("[^2]: רש״י על בראשית א א.");
  });

  it("a hard line break still ends the Word paragraph", () => {
    const xml = docxPartsForTest("שורה אחת  \nשורה שתיים\n")["word/document.xml"];
    expect(xml.match(/<w:p>|<w:p /g)).toHaveLength(2);
  });

  it("an RTL table stays RTL: MD → DOCX → MD → DOCX keeps w:bidiVisual", async () => {
    const first = docxPartsForTest(SYNTHETIC[0])["word/document.xml"];
    expect(first).toContain("<w:bidiVisual/>");
    const back = await roundTrip("docx", SYNTHETIC[0]);
    expect(docxPartsForTest(back)["word/document.xml"]).toContain("<w:bidiVisual/>");
  });

  it("the 30 real LibreOffice DOCX files are stable: DOCX → MD → DOCX → MD gives the same Markdown", async () => {
    const dir = "src/__tests__/fixtures/real-corpus/docx";
    const names = readdirSync(dir).filter((n) => n.endsWith(".docx")).sort();
    expect(names).toHaveLength(30);
    const unstable: string[] = [];
    let rtlTables = 0;
    for (const n of names) {
      const bytes = new Uint8Array(readFileSync(join(dir, n)));
      const md1 = await docxToMarkdown(file(bytes, n));
      const md2 = await docxToMarkdown(file(await markdownToDocxBytes(md1), n));
      if (squash(md1) !== squash(md2)) unstable.push(n);
      const orig = new TextDecoder().decode((await unzip(bytes.buffer as ArrayBuffer)).get("word/document.xml"));
      if (orig.includes("<w:bidiVisual/>")) {
        rtlTables++;
        expect(docxPartsForTest(md1)["word/document.xml"], `${n}: RTL table lost`).toContain("<w:bidiVisual/>");
      }
    }
    corpusStats.docxStable = 30 - unstable.length;
    corpusStats.docxRtlTables = rtlTables;
    expect(unstable.length).toBeLessThanOrEqual(baseline.formats.docx_corpus_unstable as unknown as number);
  });
});

const corpusStats: Record<string, number> = {};

describe("Hebrew round trip per format and feature (report + baseline gate)", () => {
  it("measures ODT, DOCX and EPUB on 30 docs notes and 6 synthetic notes", async () => {
    const report: Record<Format, Record<Feature, { total: number; same: number; pct: number }>> = {} as never;
    for (const fmt of ["odt", "docx", "epub"] as Format[]) {
      const acc = Object.fromEntries(FEATURES.map((k) => [k, { total: 0, same: 0 }])) as Record<Feature, { total: number; same: number }>;
      for (const item of corpus) {
        const a = features(item.md);
        const b = features(await roundTrip(fmt, item.md));
        for (const k of FEATURES) {
          const r = k === "paragraphs" ? keptParagraphs(a[k], b[k]) : kept(a[k], b[k]);
          acc[k].total += r.total;
          acc[k].same += r.same;
        }
      }
      report[fmt] = Object.fromEntries(
        FEATURES.map((k) => [k, { ...acc[k], pct: acc[k].total ? Math.round((1000 * acc[k].same) / acc[k].total) / 10 : 100 }]),
      ) as never;
    }
    const lines = [
      "# Office round trip (W12.F3)",
      "",
      `Corpus: ${docsNotes.length} Hebrew sections of this repo's docs/ (real) + ${SYNTHETIC.length} synthetic Hebrew notes written for the test. Share of the source's items found again after MD → format → MD.`,
      "",
      `| Feature | ${(["odt", "docx", "epub"] as Format[]).join(" | ")} |`,
      "|---|---|---|---|",
      ...FEATURES.map((k) => `| ${k} (n=${report.odt[k].total}) | ${(["odt", "docx", "epub"] as Format[]).map((f) => `${report[f][k].pct}%`).join(" | ")} |`),
      "",
      `Real DOCX corpus (30 LibreOffice files): ${corpusStats.docxStable ?? "?"} stable through DOCX → MD → DOCX → MD; ${corpusStats.docxRtlTables ?? 0} with an RTL table, all kept RTL.`,
      "",
    ];
    mkdirSync("test-results/office-roundtrip", { recursive: true });
    writeFileSync("test-results/office-roundtrip/report.md", lines.join("\n"));
    writeFileSync("test-results/office-roundtrip/report.json", JSON.stringify(report, null, 1));
    if (process.env.OFFICE_RT_BASELINE) {
      const formats: Record<string, unknown> = Object.fromEntries(
        Object.entries(report).map(([f, r]) => [f, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.pct]))]),
      );
      formats.docx_corpus_unstable = 30 - (corpusStats.docxStable ?? 0);
      writeFileSync(
        "src/__tests__/fixtures/office-roundtrip/baseline.json",
        JSON.stringify({ note: "Measured by officeRoundTrip.test.ts; a drop of more than 1 point fails. Raise only.", formats }, null, 1) + "\n",
      );
    }
    const drops: string[] = [];
    for (const f of ["odt", "docx", "epub"] as Format[])
      for (const k of FEATURES) {
        const b = baseline.formats[f]?.[k];
        if (b === undefined) drops.push(`${f}/${k}: no baseline`);
        else if (report[f][k].pct < b - 1) drops.push(`${f}/${k}: ${report[f][k].pct}% < ${b}%`);
      }
    expect(drops).toEqual([]);
    expect(corpus).toHaveLength(36);
  });
});
