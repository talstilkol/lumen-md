/**
 * W11.Q1 and W11.Q2 (research R5.5): the real-corpus vault generator
 * (scripts/perf/corpus-vault.mjs) and the large-vault harness
 * (scripts/perf/large-vault.ts).
 *
 * Inputs:
 * - fixtures/corpus-vault/*.xml: dump-format fixtures, origin synthetic (the
 *   article text was written for this test; see its SOURCES.md). They test
 *   the wikitext converter only.
 * - fixtures/benyehuda/: real Ben-Yehuda fragments (public domain).
 *
 * The real dumps are never in the repo; the 10k / 50k / 100k vaults are
 * built and measured on the Mac (W11.M8).
 */
import { describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildVault,
  checkPin,
  infobox,
  linkTargets,
  noteName,
  pickBenYehuda,
  pickQueries,
  readPages,
  split,
  wikitextToMarkdown,
} from "../../scripts/perf/corpus-vault.mjs";
import { measure, missedTargets, percentile, renderReport, TARGETS } from "../../scripts/perf/large-vault";

const FX = "src/__tests__/fixtures/corpus-vault";
const HE = `${FX}/hewiki-sample.xml`;
const EN = `${FX}/enwiki-sample.xml`;
const tmp = (p: string) => mkdtempSync(join(tmpdir(), `lumen-${p}-`));

/** A Ben-Yehuda checkout laid out like the dump, from the real fixture fragments. */
function benYehudaDir(): string {
  const d = tmp("by");
  mkdirSync(join(d, "txt_stripped", "p89"), { recursive: true });
  copyFileSync("src/__tests__/fixtures/benyehuda/pseudocatalogue.csv", join(d, "pseudocatalogue.csv"));
  for (const m of ["m3604", "m4387"]) copyFileSync(`src/__tests__/fixtures/benyehuda/${m}.txt`, join(d, "txt_stripped", "p89", `${m}.txt`));
  return d;
}

function frontmatter(md: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  expect(m, "note starts with a frontmatter block").not.toBeNull();
  const out: Record<string, unknown> = {};
  let list: string | null = null;
  for (const line of m![1].split("\n")) {
    const item = /^ {2}- (.*)$/.exec(line);
    if (item && list) {
      (out[list] as unknown[]).push(JSON.parse(item[1]));
      continue;
    }
    const kv = /^("(?:[^"\\]|\\.)*"|[^:]+):(?: (.*))?$/.exec(line);
    expect(kv, `frontmatter line is key: value — ${line}`).not.toBeNull();
    const key = kv![1].startsWith('"') ? JSON.parse(kv![1]) : kv![1];
    if (kv![2] === undefined) {
      out[key] = [];
      list = key;
    } else {
      list = null;
      const v = kv![2];
      // Every value the generator writes is plain (lang) or a JSON string, so YAML reads it as written.
      out[key] = /^[a-z]+$/.test(v) ? v : JSON.parse(v);
    }
  }
  return out;
}

describe("corpus-vault: the dump reader", () => {
  it("streams pages out of chunks split anywhere, with the namespace and redirect flag", async () => {
    const xml = readFileSync(HE, "utf8");
    async function* chunks() {
      for (let i = 0; i < xml.length; i += 97) yield xml.slice(i, i + 97);
    }
    const pages = [];
    for await (const p of readPages(chunks())) pages.push(p);
    expect(pages.map((p) => [p.title, p.ns, p.redirect])).toEqual([
      ["ירושלים", 0, false],
      ["ישראל", 0, false],
      ["ירושלם", 0, true],
      ["שיחה:ירושלים", 1, false],
      ["קצרמר", 0, false],
      ["בית המקדש", 0, false],
    ]);
    // XML entities are decoded: the fixture's `"` inside a field is &quot; in the file.
    expect(pages[0].text).toContain('125 קמ"ר');
    expect(pages[0].text).not.toContain("&quot;");
  });

  it("reads a file stream the same way", async () => {
    let n = 0;
    for await (const p of readPages(createReadStream(EN, { encoding: "utf8", highWaterMark: 64 }))) n += p.ns === 0 ? 1 : 0;
    expect(n).toBe(3);
  });
});

describe("corpus-vault: wikitext → Markdown", () => {
  const he = readFileSync(HE, "utf8");
  const jerusalem = /<text[^>]*>([\s\S]*?)<\/text>/.exec(he)![1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

  it("keeps links, turns categories into tags and the infobox into properties", () => {
    const { markdown, tags } = wikitextToMarkdown("ירושלים", jerusalem, "he");
    const fm = frontmatter(markdown);
    expect(fm.title).toBe("ירושלים");
    expect(fm.lang).toBe("he");
    expect(tags).toEqual(["ערים_בישראל", "ערי_בירה"]);
    expect(fm.tags).toEqual(tags);
    expect(fm.infobox).toBe("יישוב");
    expect(fm["מדינה"]).toBe("ישראל"); // the link inside the field is its text
    expect(fm["אוכלוסייה"]).toBe("1,000,000"); // the <ref> inside the field is gone
    expect(linkTargets(markdown)).toEqual(["הרי יהודה", "ישראל", "דוד המלך", "בית המקדש"]);
    expect(markdown).toContain("[[ישראל|מדינת ישראל]]");
    expect(markdown).toContain("[[בית המקדש#המקדש הראשון|המקדש]]");
  });

  it("drops templates, tables, references, comments, files and interlanguage links", () => {
    const { markdown } = wikitextToMarkdown("ירושלים", jerusalem, "he");
    for (const gone of ["{{", "}}", "{|", "|}", "<ref", "מקור כלשהו", "הערה נסתרת", "קובץ:", "Jerusalem.jpg", "העיר העתיקה", "en:Jerusalem", "קטגוריה:"]) expect(markdown).not.toContain(gone);
  });

  it("converts headings, lists, emphasis and external links", () => {
    const { markdown } = wikitextToMarkdown("ירושלים", jerusalem, "he");
    expect(markdown).toContain("\n# ירושלים\n");
    expect(markdown).toContain("\n## היסטוריה\n");
    expect(markdown).toContain("\n### העת העתיקה\n");
    expect(markdown).toContain("\n- [[דוד המלך]] כבש את העיר.\n");
    expect(markdown).toContain("\n  - תת-פריט עם");
    expect(markdown).toContain("\n1. פריט ממוספר\n");
    // Bold at the start of a line is not read as a list item.
    expect(markdown).toContain("\n**ירושלים** היא עיר");
    expect(markdown).toContain("[אתר חיצוני](https://example.org)");
    expect(markdown).toContain("*נטוי*");
  });

  it("spells link targets as the target note's file name, so links resolve", () => {
    expect(noteName("judaean Mountains", "en")).toBe("Judaean Mountains");
    expect(noteName("AC/DC: live?", "en")).toBe("AC_DC_ live_");
    const { markdown } = wikitextToMarkdown("X", "See [[judaean Mountains]] and [[AC/DC]].", "en");
    expect(linkTargets(markdown)).toEqual(["Judaean Mountains", "AC_DC"]);
    expect(markdown).toContain("[[Judaean Mountains|judaean Mountains]]");
  });

  it("finds an infobox by shape, not by name", () => {
    expect(infobox("{{cite|a=1}} text {{Infobox x\n|a=1\n|b=[[c|d]]\n|c={{flag|IL}} e\n}}")).toEqual({ template: "Infobox x", fields: [["a", "1"], ["b", "d"], ["c", "e"]] });
    expect(infobox("{{main|x}} {{small|a=1|b=2}}")).toBeNull();
  });
});

describe("corpus-vault: Ben-Yehuda", () => {
  const works = (sizes: number[], author = "א") => sizes.map((bytes, i) => ({ id: String(i + 1), path: `/p1/m${i + 1}`, title: `t${i + 1}`, authors: author, genre: "", file: "", bytes }));

  it("picks the longest works, and 1–2 MB notes from one work or one author's works", () => {
    const ws = [...works([1_500_000, 50_000, 40_000, 30_000]), ...works([600_000, 500_000, 300_000], "ב").map((w) => ({ ...w, id: `b${w.id}` }))];
    const r = pickBenYehuda(ws, { long: 2, huge: 2 });
    expect(r.huge.map((h) => h.parts.map((p) => p.id))).toEqual([["1"], ["b1", "b2"]]);
    expect(r.long.map((w) => w.id)).toEqual(["b3", "2"]);
    expect(r.shortfall).toEqual({ long: 0, huge: 0 });
  });

  it("reports a shortfall instead of padding when there is too little text", () => {
    const r = pickBenYehuda(works([900, 800]), { long: 200, huge: 5 });
    expect(r.long).toHaveLength(2);
    expect(r.huge).toHaveLength(0);
    expect(r.shortfall).toEqual({ long: 198, huge: 5 });
  });
});

describe("corpus-vault: the vault", () => {
  it("splits about two thirds Hebrew, Ben-Yehuda counted as Hebrew", () => {
    expect(split(10_000, 205)).toEqual({ heWiki: 6462, en: 3333, by: 205 });
    expect(split(100_000, 205)).toEqual({ heWiki: 66462, en: 33333, by: 205 });
  });

  it("builds a vault from the dump fixtures and real Ben-Yehuda text, with a manifest and real-title queries", async () => {
    const out = join(tmp("vault"), "v");
    const m = await buildVault({ hewiki: HE, enwiki: EN, benyehuda: benYehudaDir() }, { notes: 9, out });
    expect(m.origin).toBe("real");
    // 3 Hebrew articles pass (redirect, talk page and stub skipped), 2 Ben-Yehuda works, 3 English.
    expect(m.notes).toMatchObject({ total: 8, he: 5, en: 3, benyehudaLong: 2, benyehudaHuge: 0 });
    expect(m.shortfall).toEqual({ long: 198, huge: 5 });
    expect(readdirSync(join(out, "he")).sort()).toEqual(["בית המקדש.md", "ירושלים.md", "ישראל.md"]);
    const nfc = (xs: string[]) => xs.map((x) => x.normalize("NFC")).sort();
    expect(nfc(readdirSync(join(out, "benyehuda")))).toEqual(nfc(["בִּרְכַּת עָם (3604).md", "הַבְּרֵכָה (4387).md"]));
    // Links between articles in the vault resolve.
    expect(m.links.resolved).toBeGreaterThanOrEqual(6);
    for (const dir of ["he", "en", "benyehuda"])
      for (const f of readdirSync(join(out, dir))) {
        const md = readFileSync(join(out, dir, f), "utf8");
        frontmatter(md);
        expect(md).toMatch(/\n# .+\n/);
      }
    const byFile = readdirSync(join(out, "benyehuda")).find((f) => f.includes("(4387)"))!;
    const by = readFileSync(join(out, "benyehuda", byFile), "utf8");
    expect(by).toContain(readFileSync("src/__tests__/fixtures/benyehuda/m4387.txt", "utf8").trim().slice(0, 60));
    const q = JSON.parse(readFileSync(join(out, "queries.json"), "utf8"));
    expect(q.map((x: { q: string }) => x.q)).toEqual(["ירושלים", "ישראל", "בית המקדש", "Jerusalem", "Israel", "Judaean Mountains"]);
    expect(JSON.parse(readFileSync(join(out, "corpus-manifest.json"), "utf8")).sha256).toBe(m.sha256);
  });

  it("gives the same bytes for the same inputs", async () => {
    const a = await buildVault({ hewiki: HE, enwiki: EN }, { notes: 6, out: join(tmp("a"), "v") });
    const b = await buildVault({ hewiki: HE, enwiki: EN }, { notes: 6, out: join(tmp("b"), "v") });
    expect(a.sha256).toBe(b.sha256);
  });

  it("refuses to write over a vault", async () => {
    const out = tmp("full");
    writeFileSync(join(out, "x.md"), "x");
    await expect(buildVault({ hewiki: HE }, { notes: 3, out })).rejects.toThrow(/not empty/);
  });

  it("labels a vault made from docs derived-from-docs, not real", async () => {
    const out = join(tmp("docs"), "v");
    const m = await buildVault({ docs: "docs/src/content/docs" }, { notes: 20, out });
    expect(m.origin).toBe("derived-from-docs");
    expect(m.notes.he).toBe(20); // Hebrew pages first
  });

  it("checks the pinned sha256: refuses an unpinned or changed dump, records a pin only when asked", async () => {
    const dir = tmp("pins");
    const file = join(dir, "sources.json");
    writeFileSync(file, JSON.stringify({ sources: [{ id: "hewiki", url: "u", file: "f", sha256: null }] }));
    await expect(checkPin("hewiki", HE, { file })).rejects.toThrow(/no pinned sha256/);
    const got = await checkPin("hewiki", HE, { file, record: true });
    expect(JSON.parse(readFileSync(file, "utf8")).sources[0].sha256).toBe(got);
    await expect(checkPin("hewiki", HE, { file })).resolves.toBe(got);
    await expect(checkPin("hewiki", EN, { file })).rejects.toThrow(/Refusing a changed dump/);
  });

  it("the committed pins file has every source, its licence and attribution", () => {
    const { sources } = JSON.parse(readFileSync("scripts/perf/corpus-sources.json", "utf8"));
    expect(sources.map((s: { id: string }) => s.id)).toEqual(["hewiki", "enwiki", "benyehuda"]);
    for (const s of sources) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.license).toBeTruthy();
      expect(s.attribution).toBeTruthy();
    }
    expect(readFileSync("eval/golden/SOURCES.md", "utf8")).toMatch(/CC BY-SA 4\.0[\s\S]*Ben-Yehuda/);
  });

  it("picks queries two thirds Hebrew, spread over the vault", () => {
    const notes = Array.from({ length: 300 }, (_, i) => ({ kind: "wiki", lang: i < 200 ? "he" : "en", title: `t${i}`, path: `p${i}` }));
    const q = pickQueries(notes);
    expect(q).toHaveLength(50);
    expect(q.filter((x) => x.lang === "he")).toHaveLength(33);
    expect(new Set(q.map((x) => x.q)).size).toBe(50);
  });
});

describe("large-vault harness (W11.Q2)", () => {
  it("measures the seven metrics on a generated vault and renders the report", async () => {
    const out = join(tmp("bench"), "v");
    await buildVault({ hewiki: HE, enwiki: EN, benyehuda: benYehudaDir() }, { notes: 9, out });
    const r = await measure(out, { idleSeconds: 0.3, coldCache: "no" });
    expect(r.notes).toBe(8);
    expect(r.origin).toBe("real");
    expect(r.search.queries).toBe(6);
    expect(r.search.found).toBe(6); // every title query finds its own note
    expect(r.saveFound).toBe(true);
    expect(r.backlinks.hits).toBeGreaterThan(0); // ישראל and ירושלים link to each other
    for (const v of [r.coldOpenMs, r.warmOpenMs, r.search.p95Ms, r.saveToIndexMs, r.idle.cpuPct, r.peakRssMB]) expect(Number.isFinite(v)).toBe(true);
    expect(r.machine.cores).toBeGreaterThan(0);
    const md = renderReport([r]);
    expect(md).toContain("| real |");
    expect(md).toContain("large-vault-obsidian.md");
  });

  it("fails the run when a 100k target is missed, and the targets are the task's", () => {
    expect(TARGETS).toEqual({ warmOpenMs: 2000, coldOpenMs: 8000, searchP95Ms: 200, saveToIndexMs: 50, idleCpuPct: 2, idleMaxStallMs: 50, streamFirstP95Ms: 50, streamAllP95Ms: 1000 });
    const ok = { warmOpenMs: 100, coldOpenMs: 100, search: { p95Ms: 10 }, saveToIndexMs: 1, saveFound: true, idle: { cpuPct: 0.1, maxStallMs: 5 } };
    expect(missedTargets(ok as never)).toEqual([]);
    expect(missedTargets({ ...ok, search: { p95Ms: 201 }, idle: { cpuPct: 3, maxStallMs: 280 } } as never)).toEqual(["search p95 201 ms > 200", "idle CPU 3% > 2%", "idle stall 280 ms > 50"]);
    expect(missedTargets({ ...ok, saveFound: false } as never)[0]).toMatch(/edit not found/);
    // W13.V3: streamed search, first page p95 <= 50 ms and all results p95 <= 1 s.
    expect(missedTargets({ ...ok, stream: { firstP95Ms: 50, allP95Ms: 1000, results: 5000 } } as never)).toEqual([]);
    expect(missedTargets({ ...ok, stream: { firstP95Ms: 51, allP95Ms: 1001, results: 5000 } } as never)).toEqual(["streamed search first page p95 51 ms > 50", "streamed search, all 5000, p95 1001 ms > 1000"]);
  });

  it("takes nearest-rank percentiles", () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
    expect(percentile([], 95)).toBe(0);
  });
});
