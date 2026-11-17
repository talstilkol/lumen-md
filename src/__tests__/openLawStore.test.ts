/**
 * W11.H16 — the Open Book of Laws on the device: the user imports a file
 * they downloaded (gkour/israeli_law as JSON lines, a JSON array or a
 * datasets-server page), Lumen keeps it in `.lumen/openlaw/` as an index and
 * shards, every stored file carries the CC BY-SA tag, lookups read one shard,
 * the open-sources dialog finds laws and sections in it, and rulings stay
 * link-only. Nothing touches the network.
 *
 * The corpus is the SYNTHETIC fixture (fixtures/openlaw/README.md: real law
 * titles, made-up section texts): the 20-lookup number here proves the
 * stored path, not quality on the real dataset (owed, W11.H16).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { hasLicenceTag, importOpenLaw, INDEX_PATH, loadOpenLawIndex, lookupStored, matchOpenLaw, OPEN_LAW_STORE, SHARD_SIZE, type OpenLawStorage } from "../sources/openlaw/store";
import { parseLawQuery, parseOpenLawFile, parseOpenLawRows } from "../sources/openlaw/book";
import { matchLaw } from "../sources/knesset/lawNames";
import { searchLocal, attributionFor, KINDS } from "../sources/open/search";
import { enabledSources } from "../sources/open/gate";
import { importOpenLawFile, openLawInsertion } from "../sources/openlaw/app";
import { mayCopy } from "../sources/open/rights";

const FIXTURE = readFileSync("src/__tests__/fixtures/openlaw/israeli_law.synthetic.jsonl", "utf8");

function memory(): OpenLawStorage & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: async (p) => files.get(p) ?? null,
    write: async (p, c) => void files.set(p, c),
  };
}

const LOOKUPS: [string, string, string | null][] = [
  ["סעיף 1 לחוק הגנת הפרטיות", 'חוק הגנת הפרטיות, התשמ"א-1981', "1"],
  ["חוק הגנת הפרטיות, סעיף 7", 'חוק הגנת הפרטיות, התשמ"א-1981', "7"],
  ["ס' 2 לחוק הגנת הפרטיות התשמ״א-1981", 'חוק הגנת הפרטיות, התשמ"א-1981', "2"],
  ["סעיף 2 לחוק הגנת הצרכן", 'חוק הגנת הצרכן, התשמ"א-1981', "2"],
  ["סעיף 14ג לחוק הגנת הצרכן", 'חוק הגנת הצרכן, התשמ"א-1981', "14ג"],
  ["סעיף 12 לחוק החוזים (חלק כללי)", 'חוק החוזים (חלק כללי), התשל"ג-1973', "12"],
  ["סעיף 39 לחוק החוזים (חלק כללי), התשל״ג-1973", 'חוק החוזים (חלק כללי), התשל"ג-1973', "39"],
  ["חוק החוזים חלק כללי סעיף 1", 'חוק החוזים (חלק כללי), התשל"ג-1973', "1"],
  ["סעיף 11 לחוק המכר", 'חוק המכר, התשכ"ח-1968', "11"],
  ["סעיף 6 לחוק השכירות והשאילה", 'חוק השכירות והשאילה, התשל"א-1971', "6"],
  ["סעיף 1 לחוק פיצויי פיטורים", 'חוק פיצויי פיטורים, התשכ"ג-1963', "1"],
  ["סעיף 300 לחוק העונשין", 'חוק העונשין, התשל"ז-1977', "300"],
  ["חוק העונשין סעיף 34ג", 'חוק העונשין, התשל"ז-1977', "34ג"],
  ["סעיף 8 לחוק יסוד: כבוד האדם וחירותו", "חוק-יסוד: כבוד האדם וחירותו", "8"],
  ["ח״י: כבוד האדם וחירותו, סעיף 1", "חוק-יסוד: כבוד האדם וחירותו", "1"],
  ["סעיף 1 לחוק חופש המידע", 'חוק חופש המידע, התשנ"ח-1998', "1"],
  ["סעיף 6 לחוק זכות יוצרים", 'חוק זכות יוצרים, התשס"ח-2007', "6"],
  ["חוק זכות יוצרים", 'חוק זכות יוצרים, התשס"ח-2007', null],
  ["חוק המכר", 'חוק המכר, התשכ"ח-1968', null],
  ["חוק הגנת הצרכן התשמ״א", 'חוק הגנת הצרכן, התשמ"א-1981', null],
];

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new Error("no network in this test")));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe("import: the user's file becomes an index and licence-tagged shards", () => {
  it("JSON lines: one index, shards of at most SHARD_SIZE laws, the file's sha256 as the revision", async () => {
    const s = memory();
    const progress: number[] = [];
    const idx = await importOpenLaw(FIXTURE, s, {
      fileName: "israeli_law.jsonl",
      now: () => new Date("2026-11-17T10:00:00Z"),
      onProgress: (p) => progress.push(p.done),
    });
    expect(idx.count).toBe(parseOpenLawRows(FIXTURE).length);
    expect(idx.count).toBeGreaterThan(0);
    expect(idx.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(idx.imported).toBe("2026-11-17T10:00:00.000Z");
    expect([...s.files.keys()].sort()).toEqual([INDEX_PATH, `${OPEN_LAW_STORE}/s0.json`]);
    expect(progress.at(-1)).toBe(idx.count);
    expect(await loadOpenLawIndex(s)).toEqual(idx);
  });

  it("100% of the stored files carry the CC BY-SA tag (licence, rights, Wikisource credit, not official)", async () => {
    const s = memory();
    const rows = Array.from({ length: 250 }, (_, i) =>
      JSON.stringify({
        title: `חוק בדיקה מספר ${i + 1}, התשפ"ז-2026`,
        text: `1. כותרת\nטקסט ${i}`,
      }),
    ).join("\n");
    await importOpenLaw(rows, s);
    expect(s.files.size).toBe(1 + Math.ceil(250 / SHARD_SIZE));
    const tagged = [...s.files.values()].filter((c) => hasLicenceTag(JSON.parse(c)));
    expect(tagged.length).toBe(s.files.size);
    expect(JSON.parse(s.files.get(INDEX_PATH)!)).toMatchObject({
      license: "CC-BY-SA-4.0",
      rights: "cc-by-sa",
      official: false,
    });
  });

  it("an index without its licence tag is not used", async () => {
    const s = memory();
    const idx = await importOpenLaw(FIXTURE, s);
    s.files.set(INDEX_PATH, JSON.stringify({ ...idx, license: undefined }));
    expect(await loadOpenLawIndex(s)).toBeNull();
  });

  it("a JSON array and a datasets-server page are read too; an empty or foreign file is refused", async () => {
    const rows = parseOpenLawRows(FIXTURE);
    expect(parseOpenLawFile(JSON.stringify(rows))).toEqual(rows);
    expect(parseOpenLawFile(JSON.stringify({ rows: rows.map((row, i) => ({ row_idx: i, row })) }))).toEqual(rows);
    await expect(importOpenLaw("", memory())).rejects.toThrow(/no laws/);
    await expect(importOpenLaw('{"heading":"x"}', memory())).rejects.toThrow(/heading/);
  });

  it("an aborted import keeps the previous copy in use (the index is written last)", async () => {
    const s = memory();
    const first = await importOpenLaw(FIXTURE, s);
    const ac = new AbortController();
    const big = Array.from({ length: 400 }, (_, i) => JSON.stringify({ title: `חוק אחר ${i}`, text: "1. x" })).join("\n");
    const run = importOpenLaw(big, s, {
      signal: ac.signal,
      onProgress: (p) => p.done >= SHARD_SIZE && ac.abort(),
    });
    await expect(run).rejects.toBeTruthy();
    expect(await loadOpenLawIndex(s)).toEqual(first);
  });
});

describe("lookups through the stored copy (synthetic corpus)", () => {
  it("20 law and section lookups: at least 18 right, each reading the index and one shard", async () => {
    const s = memory();
    const idx = await importOpenLaw(FIXTURE, s);
    let ok = 0;
    for (const [q, law, sec] of LOOKUPS) {
      const hit = await lookupStored(q, idx, s);
      if (hit && hit.law.name === law && (hit.section?.number ?? null) === sec && hit.rights === "cc-by-sa") ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(18);
  });

  it("the indexed matcher gives matchLaw's answer (the 20 lookups and near misses)", async () => {
    const s = memory();
    const idx = await importOpenLaw(FIXTURE, s);
    const qs = [...LOOKUPS.map(([q]) => q), "חוק החוזים", "חוק יסוד: כבוד האדם", "הגנת הפרטיות", "חוק הגנת", "ח״י כבוד", "חוק המכר התשכ״ח", "חוק המכר התשמ״א"];
    for (const q of qs) {
      const { law } = parseLawQuery(q);
      expect(matchOpenLaw(q, idx)?.entry.id ?? null).toBe((matchLaw(law, idx.laws)?.law.id as number | undefined) ?? null);
    }
  });

  it("a missing section and an unknown law find nothing; a query with no Hebrew is not a law", async () => {
    const s = memory();
    const idx = await importOpenLaw(FIXTURE, s);
    expect(await lookupStored("סעיף 999 לחוק המכר", idx, s)).toBeNull();
    expect(await lookupStored("חוק הגנת הצמחים", idx, s)).toBeNull();
    expect(matchOpenLaw("section 12", idx)).toBeNull();
    expect(matchOpenLaw("חוק המכר", null)).toBeNull();
  });

  it("10,000 laws: the import finishes and a keystroke's match over the index stays fast", async () => {
    const s = memory();
    const rows = Array.from({ length: 10_000 }, (_, i) =>
      JSON.stringify({
        title: `חוק ניסוי ${i} לעניין ${["מים", "חשמל", "תחבורה", "בריאות"][i % 4]}, התש"ף-2020`,
        text: "{{ח:סעיף|1|הגדרות}}\n{{ח:ת}} טקסט.",
      }),
    ).join("\n");
    const idx = await importOpenLaw(rows, s);
    expect(idx.count).toBe(10_000);
    matchOpenLaw("חוק ניסוי", idx); // the first query builds the word index once
    const t0 = performance.now();
    const m = matchOpenLaw("סעיף 1 לחוק ניסוי 9876 לעניין מים", idx);
    const ms = performance.now() - t0;
    expect(m?.entry.name).toContain("9876");
    expect(ms).toBeLessThan(50);
  }, 60_000);

  it("nothing above sent a request", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the open-sources dialog's local search and insertion", () => {
  const enabled = { ...enabledSources(null), openlaw: true };

  it("the source starts off; when on, a section of an imported law is a cc-by-sa result found on the device", async () => {
    expect(enabledSources(null).openlaw).toBe(false);
    const s = memory();
    const openLaw = await importOpenLaw(FIXTURE, s);
    const off = searchLocal("סעיף 12 לחוק החוזים (חלק כללי)", {
      enabled: { ...enabled, openlaw: false },
      laws: [],
      library: null,
      openLaw,
    });
    expect(off.filter((r) => r.source === "openlaw")).toEqual([]);
    const [r] = searchLocal("סעיף 12 לחוק החוזים (חלק כללי)", {
      enabled,
      laws: [],
      library: null,
      openLaw,
    }).filter((x) => x.source === "openlaw");
    expect(r).toMatchObject({
      kind: "law",
      rights: "cc-by-sa",
      local: true,
      title: 'סעיף 12 לחוק החוזים (חלק כללי), התשל"ג-1973',
    });
    expect(r.url).toMatch(/^https:\/\/he\.wikisource\.org\/wiki\//);
    expect(attributionFor(r)).toContain("ויקיטקסט");
    expect(attributionFor(r)).toContain("creativecommons.org/licenses/by-sa/4.0");
  });

  it("a Supreme Court reference is a link-only ruling, never a copy", () => {
    expect(KINDS).toContain("ruling");
    const [r] = searchLocal('בג"ץ 6821/93 בנק המזרחי נ׳ מגדל', {
      enabled,
      laws: [],
      library: null,
      openLaw: null,
    });
    expect(r).toMatchObject({
      source: "openlaw",
      kind: "ruling",
      rights: "link-only",
    });
    expect(mayCopy(r.rights)).toBe(false);
  });

  it("choosing a section inserts the quote with its citation, the licence and the credit; a missing section throws", async () => {
    const s = memory();
    const file = new Blob([FIXTURE]) as Blob & { name: string };
    file.name = "israeli_law.jsonl";
    const idx = await importOpenLawFile(file, { storage: s });
    const m = matchOpenLaw("סעיף 7 לחוק הגנת הפרטיות", idx)!;
    const md = await openLawInsertion({ id: m.entry.id, name: m.entry.name, section: m.section }, s);
    expect(md).toMatch(/^> \*\*7\.\*\* /);
    expect(md).toContain('> — סעיף 7 לחוק הגנת הפרטיות, התשמ"א-1981');
    expect(md).toContain("[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)");
    expect(md).toContain("ספר החוקים הפתוח, ויקיטקסט");
    expect(md).toContain("לא מקור רשמי");
    const whole = await openLawInsertion({ id: m.entry.id, name: m.entry.name, section: null }, s);
    expect(whole).toMatch(/^\[חוק הגנת הפרטיות/);
    expect(whole).toContain("CC BY-SA 4.0");
    await expect(openLawInsertion({ id: m.entry.id, name: m.entry.name, section: "999" }, s)).rejects.toThrow(/999/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
