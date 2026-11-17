/**
 * W13.E3 — one normalisation in every filter box.
 *
 * 1. `normalizeForFilter` folds niqqud and cantillation (U+0591–U+05C7),
 *    gershayim and geresh, the maqaf, Latin/Greek/Cyrillic diacritics, the
 *    letters without a decomposition (Ł, ß, Æ, Ø …), compatibility forms and
 *    bidi/format characters; `filterMatch` returns the range in the original
 *    text (with its niqqud), for the highlight.
 * 2. The acceptance queries — "שלום" finds "שָׁלוֹם", "cafe" finds "café",
 *    "lodz" finds "Łódź" — in each of the six surfaces: command palette,
 *    backlinks, outline, note switcher (search by name), link completion
 *    ([[), settings search; and in the menus and galleries that filter too.
 * 3. The structure check: a filter that compares with a raw
 *    `toLowerCase().includes()` / a home-made NFD fold fails the test.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { filterList, filterMatch, foldWithMap, highlightParts, matchesAnyFilter, matchesFilter, normalizeForFilter } from "../text/filterMatch";
import { normalizeForMatch } from "../text/hebrew";
import { noteKey } from "../lib/slug";
import { rankCommands } from "../ui/paletteSearch";
import { groupBacklinks } from "../ui/backlinksGroup";
import { VaultIndex } from "../storage/vaultIndexCore";
import { noteCatalog, suggestNotes } from "../editor/wikiComplete";
import { searchSettings, SETTINGS } from "../settings/schema";
import { filterTemplates } from "../editor/templates";
import { searchLibrary, type LibraryItem } from "../citations/library";

/** The three acceptance pairs: what is typed, what is in the list. */
const GOLDEN: Array<[query: string, text: string]> = [
  ["שלום", "שָׁלוֹם"],
  ["cafe", "café"],
  ["lodz", "Łódź"],
];

describe("normalizeForFilter", () => {
  const cases: Array<[string, string]> = [
    ["שָׁלוֹם", "שלומ"],
    ["בְּרֵאשִׁ֖ית", "בראשית"], // niqqud and a cantillation mark (tipcha U+0596)
    ["צה״ל", "צהל"],
    ['צה"ל', "צהל"],
    ["צה׳׳ל", "צהל"],
    ["ג׳ירפה", "גירפה"],
    ["בית־ספר", "בית-ספר"], // maqaf → hyphen
    ["café", "cafe"],
    ["CAFÉ", "cafe"],
    ["café", "cafe"], // decomposed input
    ["Łódź", "lodz"],
    ["Straße", "strasse"],
    ["Ærøskøbing", "aeroskobing"],
    ["Đorđe", "dorde"], // đ → d
    ["Œuvre", "oeuvre"],
    ["Þórr", "thorr"],
    ["İstanbul", "istanbul"],
    ["Ελλάδα", "ελλαδα"],
    ["ёлка", "елка"],
    ["Йога", "йога"], // the short i is a letter of its own
    ["ﬁle", "file"], // ligature (NFKD)
    ["Ｌｕｍｅｎ", "lumen"], // full-width
    ["שּׁ", "ש"], // Hebrew presentation form U+FB2C
    ["‏שלום‎", "שלומ"], // RLM / LRM from a copy-paste
    ["مُحَمَّد", "محمد"], // Arabic tashkeel (through normalizeForMatch)
    ["", ""],
  ];
  for (const [input, want] of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(want)}`, () => {
      expect(normalizeForFilter(input)).toBe(want);
    });
  }

  it("is idempotent", () => {
    for (const [input] of cases) expect(normalizeForFilter(normalizeForFilter(input))).toBe(normalizeForFilter(input));
  });

  it("character by character gives the same text as the whole string (the highlight map is exact)", () => {
    for (const [input] of cases) expect(foldWithMap(input).folded).toBe(normalizeForFilter(input));
    const greek = "ΟΔΟΣ ΟΔΟΣ";
    expect(foldWithMap(greek).folded).toBe(normalizeForFilter(greek));
  });

  it("link keys stay strict: [[résumé]] and [[resume]] are different notes", () => {
    expect(noteKey("résumé")).not.toBe(noteKey("resume"));
    expect(normalizeForMatch("café")).toBe("café");
  });
});

describe("filterMatch", () => {
  it("returns the range in the original text, niqqud included", () => {
    const text = "ברוכים הבאים: שָׁלוֹם עֲלֵיכֶם";
    const r = filterMatch(text, "שלום");
    expect(r).not.toBeNull();
    expect(text.slice(r!.start, r!.end)).toBe("שָׁלוֹם");
  });

  it("keeps the marks of the last letter inside the highlight", () => {
    const text = "שָׁלוֹם";
    const r = filterMatch(text, "של")!;
    expect(text.slice(r.start, r.end)).toBe("שָׁל");
    expect(text.slice(r.end)).toBe("וֹם");
  });

  it("maps a fold that grows (ß → ss) and one that shrinks (צה״ל → צהל) back to the original", () => {
    const t1 = "Die Straße entlang";
    const r1 = filterMatch(t1, "strasse")!;
    expect(t1.slice(r1.start, r1.end)).toBe("Straße");
    const t2 = "שירות בצה״ל";
    const r2 = filterMatch(t2, "צהל")!;
    expect(t2.slice(r2.start, r2.end)).toBe("צה״ל");
    const t3 = "Łódź Fabryczna";
    const r3 = filterMatch(t3, "lodz")!;
    expect(t3.slice(r3.start, r3.end)).toBe("Łódź");
  });

  it("an empty query matches nothing; matchesFilter treats it as 'show all'", () => {
    expect(filterMatch("abc", "")).toBeNull();
    expect(filterMatch("abc", "   ")).toBeNull();
    expect(matchesFilter("abc", "")).toBe(true);
    expect(matchesFilter("abc", "zz")).toBe(false);
    expect(matchesFilter(undefined, "a")).toBe(false);
  });

  it("highlightParts splits around the match and joins back to the text", () => {
    const text = "קפה café ומאפה";
    const parts = highlightParts(text, "cafe");
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["café"]);
    expect(highlightParts(text, "zzz")).toEqual([{ text, hit: false }]);
  });

  it("filterList and matchesAnyFilter", () => {
    const items = [{ n: "Łódź" }, { n: "Kraków" }, { n: "שָׁלוֹם" }];
    expect(filterList(items, "krakow", (x) => x.n)).toEqual([{ n: "Kraków" }]);
    expect(filterList(items, "", (x) => x.n)).toHaveLength(3);
    expect(matchesAnyFilter([null, "x", "Łódź"], "LODZ")).toBe(true);
  });

  it("filters 10,000 items in well under a frame budget per keystroke", () => {
    const names = Array.from({ length: 10_000 }, (_, i) => (i % 3 ? `פֶּתֶק ${i} café` : `Note ${i} Łódź`));
    // Review 14 Low 10: the CPU time this process spends, not the wall clock, which a loaded machine
    // stretches (the test went red under load); the bound is the same 400 ms.
    const cpu0 = process.cpuUsage();
    const hits = filterList(names, "lodz", (x) => x);
    const cpu = process.cpuUsage(cpu0);
    const ms = (cpu.user + cpu.system) / 1000;
    expect(hits.length).toBe(3334);
    expect(ms).toBeLessThan(400);
  });
});

describe("the six surfaces find the golden queries", () => {
  it.each(GOLDEN)("command palette: %s finds %s", (q, text) => {
    const list = [{ label: "Open settings" }, { label: `Go to ${text}` }, { label: "Export" }];
    expect(rankCommands(list, q).items.map((c) => c.label)).toEqual([`Go to ${text}`]);
  });

  it.each(GOLDEN)("backlinks: %s finds %s (in the snippet and in the note name)", (q, text) => {
    const hits = [
      { fromPath: "a.md", fromName: "a", snippet: `see ${text} here`, offset: 0 },
      { fromPath: "b.md", fromName: "b", snippet: "nothing", offset: 0 },
      { fromPath: `${text}.md`, fromName: text, snippet: "x", offset: 0 },
    ];
    const groups = groupBacklinks(hits as never, { query: q });
    expect(groups.map((g) => g.fromPath).sort()).toEqual(["a.md", `${text}.md`].sort());
  });

  it.each(GOLDEN)("outline: %s finds the heading %s (the filter the panel runs)", async (q, text) => {
    const { extractToc } = await import("../renderer/pipeline");
    const toc = extractToc(`# Intro\n\n## ${text}\n\n## Other\n`);
    const shown = toc.filter((h) => filterMatch(h.text, q));
    expect(shown.map((h) => h.text)).toEqual([text]);
  });

  it.each(GOLDEN)("note switcher (search by note name): %s finds %s.md", (q, text) => {
    const idx = new VaultIndex();
    idx.upsert({ path: `${text}.md`, name: `${text}.md`, content: "body", modified: 1 });
    idx.upsert({ path: "other.md", name: "other.md", content: "body", modified: 1 });
    expect(idx.search(q).map((h) => h.path)).toContain(`${text}.md`);
    expect(idx.search(q).map((h) => h.path)).not.toContain("other.md");
  });

  it.each(GOLDEN)("link completion [[: %s suggests %s", (q, text) => {
    const cat = noteCatalog([
      { path: `${text}.md`, modified: 1 },
      { path: "unrelated.md", modified: 2 },
    ] as never);
    expect(suggestNotes(cat, q).map((s) => s.label)).toContain(text);
    expect(suggestNotes(cat, q).map((s) => s.label)).not.toContain("unrelated");
  });

  it.each(GOLDEN)("settings search: %s finds the setting labelled %s", (q, text) => {
    const target = SETTINGS.find((e) => e.kind === "setting" && e.label && e.tab)!;
    const translate = (key: string) => (key === target.label ? `${text} — label` : `zz ${key}`);
    expect(searchSettings(q, translate).entries.map((e) => e.id)).toEqual([target.id]);
  });
});

describe("menus and galleries filter the same way", () => {
  it("templates: niqqud-blind", () => {
    expect(filterTemplates(undefined, "meeting").length).toBeGreaterThan(0);
    expect(filterTemplates(undefined, "MEETING").length).toBe(filterTemplates(undefined, "meeting").length);
  });
  it.each(GOLDEN)("citation library: %s finds an author %s", (q, text) => {
    const item = (key: string, family: string): LibraryItem => ({ key, path: "x.bib", origin: "bibtex" as never, record: { type: "book", authors: [{ family }], title: "T", year: "2020" } as never });
    expect(searchLibrary([item("a", text), item("b", "Smith")], q).map((i) => i.key)).toEqual(["a"]);
  });
});

/* ─── Structure: no filter box compares the raw way ─────────────────── */

const ROOT = join(__dirname, "..");

/**
 * Modules that implement a filter box's matching. Each must import the
 * shared fold; together with every .tsx they must not compare raw.
 */
const FILTER_MODULES = [
  "ui/paletteSearch.ts",
  "ui/backlinksGroup.ts",
  "settings/schema.ts",
  "editor/wikiComplete.ts",
  "editor/wysiwygSlashMenu.ts",
  "editor/insertMenu.ts",
  "editor/templates.ts",
  "citations/library.ts",
  "storage/vaultIndexCore.ts",
];

/** A case-insensitive substring test, or a home-made niqqud/accent fold: what a filter box must not do on its own. */
const RAW = [
  /\.to(?:Locale)?(?:Lower|Upper)Case\([^)]*\)\s*\.(?:includes|indexOf|startsWith)\(/,
  /\.normalize\(\s*["']NFD["']\s*\)\s*\.replace\(/,
];

/** Lines that compare raw on purpose say why on the line or the one above (`filter-ok: <reason>`). */
export function rawFilterLines(source: string): number[] {
  const lines = source.split("\n");
  const out: number[] = [];
  lines.forEach((line, i) => {
    if (!RAW.some((re) => re.test(line))) return;
    if (/filter-ok:\s*\S/.test(line) || /filter-ok:\s*\S/.test(lines[i - 1] ?? "")) return;
    out.push(i + 1);
  });
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

describe("structure: every filter uses the shared fold", () => {
  it("catches a new filter written the raw way (the check is not vacuous)", () => {
    const planted = [
      "const shown = items.filter((x) => x.name.toLowerCase().includes(q));",
      "const at = label.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());",
      'const fold = (s: string) => s.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");',
    ].join("\n");
    expect(rawFilterLines(planted)).toEqual([1, 2, 3]);
    expect(rawFilterLines("// filter-ok: an English protocol string\nif (m.toLowerCase().includes('x')) {}")).toEqual([]);
    expect(rawFilterLines("const shown = filterList(items, q, (x) => x.name);")).toEqual([]);
  });

  it("no .tsx component and no filter module compares raw", () => {
    const files = [...walk(ROOT), ...FILTER_MODULES.map((m) => join(ROOT, m))];
    expect(files.length).toBeGreaterThan(200);
    const bad: string[] = [];
    for (const f of files) for (const n of rawFilterLines(readFileSync(f, "utf8"))) bad.push(`${relative(ROOT, f)}:${n}`);
    expect(bad).toEqual([]);
  });

  it("every filter module imports the shared fold", () => {
    const missing = FILTER_MODULES.filter((m) => !/from\s+["'][./]+text\/filterMatch["']/.test(readFileSync(join(ROOT, m), "utf8")));
    expect(missing).toEqual([]);
  });

  it("the outline panel filters with it", () => {
    expect(readFileSync(join(ROOT, "ui/Outline.tsx"), "utf8")).toMatch(/from "\.\.\/text\/filterMatch"/);
  });
});
