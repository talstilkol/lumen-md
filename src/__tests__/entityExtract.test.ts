/**
 * W12.E2 — entity extraction: the deterministic rules (Hebrew and
 * Gregorian dates, laws with a Hebrew year, verses through the Sefaria
 * parser), the NEMO label map, incremental runs over changed paragraphs
 * only, and rules-only mode with zero network requests. The notes are
 * synthetic. F1 is measured in W12.E9 only, not here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dateHits, hebrewYear, lawHits, ruleHits, verseHits } from "../entities/extract/rules";
import { NEMO_TO_TYPE, NER_MODELS, typeOfLabel } from "../entities/extract/labels";
import { extractEntities, RULES_EXTRACTOR, type NerModel } from "../entities/extract/run";
import { entityId } from "../entities/model";

describe("W12.E2 date rules", () => {
  it("Hebrew-calendar dates convert through the Hebrew calendar", () => {
    expect(hebrewYear("התשפ״ו")).toBe(5786);
    expect(hebrewYear("תשמ\"ד")).toBe(5744);
    const [a] = dateHits("נפגשנו בט״ו בשבט התשפ״ו בבוקר");
    // Tu BiShvat 5786 = 2026-02-02
    expect(a).toMatchObject({ type: "event", when: "2026-02-02", rule: "date-hebrew" });
    expect(dateHits("א׳ בתשרי תשפ״ז")[0].when).toBe("2026-09-12");
    expect(dateHits("י״ד באדר ב׳ התשפ״ד")[0].when).toBe("2024-03-24");
    // Adar II in a common year is no date.
    expect(dateHits("י״ד באדר ב׳ התשפ״ה")).toHaveLength(0);
  });
  it("Gregorian dates in Hebrew, English and numbers; impossible days are skipped", () => {
    expect(dateHits("ב-15 בנובמבר 2026 הוחלט").map((h) => h.when)).toEqual(["2026-11-15"]);
    expect(dateHits("On November 15, 2026 and 3 May 1999").map((h) => h.when)).toEqual(["2026-11-15", "1999-05-03"]);
    expect(dateHits("15.11.2026 ו-2026-11-16").map((h) => h.when)).toEqual(["2026-11-15", "2026-11-16"]);
    expect(dateHits("31.02.2026 ו-30 בפברואר 2026")).toHaveLength(0);
  });
});

describe("W12.E2 law rules", () => {
  it("a law title with a Hebrew year that agrees with the Gregorian one", () => {
    const [h] = lawHits("לפי חוק הגנת הפרטיות, התשמ״א-1981 אסור");
    expect(h).toMatchObject({ type: "law", name: "חוק הגנת הפרטיות, התשמ״א-1981" });
    expect(lawHits("בפקודת הראיות [נוסח חדש], התשל״א-1971")[0].name).toBe("פקודת הראיות [נוסח חדש], התשל״א-1971");
    expect(lawHits("חוק חופש המידע, התשנ״ח-1998")[0].name).toBe("חוק חופש המידע, התשנ״ח-1998");
    expect(lawHits("חוק הבדיקה, התשמ״א-1990")).toHaveLength(0); // years disagree
    expect(lawHits("under the Freedom of Information Act 2000")[0].name).toBe("Freedom of Information Act 2000");
  });
});

describe("W12.E2 verse rules", () => {
  it("finds verses and folios in running text, with the Sefaria reference", () => {
    expect(verseHits("כתוב בבראשית א:א שבראשית ברא").map((h) => h.name)).toEqual(["Genesis 1:1"]);
    expect(verseHits("ראה שמות כ, ג ועוד").map((h) => h.name)).toEqual(["Exodus 20:3"]);
    expect(verseHits("Gen. 1:1-3 and Berakhot 2a").map((h) => h.name)).toEqual(["Genesis 1:1-3", "Berakhot 2a"]);
    expect(verseHits("שמות הילדים הם דן ורות")).toHaveLength(0);
  });
  it("overlaps keep the longer span", () => {
    const hs = ruleHits("ב-1.1.2026 נכנס לתוקף חוק חופש המידע, התשנ״ח-1998, וראו דברים ו:ד.");
    expect(hs.map((h) => h.type)).toEqual(["event", "law", "source"]);
  });
});

describe("W12.E2 labels", () => {
  it("maps every NEMO category onto a type, TTL and MISC to none", () => {
    for (const l of ["PER", "ORG", "GPE", "LOC", "FAC", "EVE", "WOA", "DUC", "ANG"]) expect(NEMO_TO_TYPE[l], l).toBeTruthy();
    expect(typeOfLabel("ttl")).toBeNull();
    expect(typeOfLabel("LOC", "conll")).toBe("place");
  });
  it("no model is registered without its sha256 (W12.M1 owes the export)", () => {
    for (const m of NER_MODELS) expect(m.sha256).toBeNull();
    expect(NER_MODELS.find((m) => m.id === "bert-base-ner")!.license).toBe("MIT");
  });
});

describe("W12.E2 incremental extraction", () => {
  const notes = [
    { path: "a.md", content: "# פגישה\n\nב-15 בנובמבר 2026 דנו בחוק חופש המידע, התשנ״ח-1998. ^p1\n\nפסקה שנייה על בראשית א:א" },
    { path: "b.md", content: "לפי חוק חופש המידע, התשנ״ח-1998 מותר." },
  ];
  let fetches = 0;
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    fetches = 0;
    globalThis.fetch = vi.fn(async () => {
      fetches++;
      throw new Error("no network in rules-only mode");
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("rules-only: proposals with mentions and paragraph hashes, zero network requests", async () => {
    const r = await extractEntities({ notes });
    expect(r.mode).toBe("rules-only");
    expect(fetches).toBe(0);
    const law = r.proposals.find((p) => p.type === "law")!;
    expect(law.name).toBe("חוק חופש המידע, התשנ״ח-1998");
    expect(law.mentions.map((m) => m.note)).toEqual(["a.md", "b.md"]);
    expect(law.mentions[0].anchor).toBe("p1");
    expect(law.mentions[0].paragraphHash).toMatch(/^sha256:/);
    expect(law.extractor).toBe(RULES_EXTRACTOR);
    expect(r.proposals.map((p) => p.type).sort()).toEqual(["event", "law", "source"]);
  });
  it("a second run scans only changed paragraphs", async () => {
    const first = await extractEntities({ notes });
    const changed = [{ ...notes[0], content: notes[0].content.replace("בראשית א:א", "בראשית א:ב") }, notes[1]];
    const second = await extractEntities({ notes: changed, seen: first.seen });
    expect(second.paragraphs.scanned).toBe(1);
    expect(second.proposals.map((p) => p.name)).toEqual(["Genesis 1:2"]);
  });
  it("with an NER model, its spans resolve against known entities; rule spans win overlaps", async () => {
    const ner: NerModel = {
      id: "test-ner",
      version: "1",
      scheme: "nemo",
      run: async (text) => {
        const out = [];
        for (const w of ["לירושלים", "דוד כהן", "חוק"]) {
          const at = text.indexOf(w);
          if (at >= 0) out.push({ start: at, end: at + w.length, text: w, label: w === "חוק" ? "MISC" : w === "דוד כהן" ? "PER" : "GPE", score: 0.9 });
        }
        return out;
      },
    };
    const known = [{ id: entityId("place", "ירושלים"), type: "place" as const, name: "ירושלים", aliases: [] }];
    const r = await extractEntities({ notes: [{ path: "c.md", content: "דוד כהן נסע לירושלים לדון בחוק חופש המידע, התשנ״ח-1998." }], known, ner });
    expect(r.mode).toBe("rules+ner");
    const jer = r.proposals.find((p) => p.type === "place")!;
    expect([jer.matches, jer.name]).toEqual([known[0].id, "ירושלים"]);
    expect(r.proposals.find((p) => p.type === "person")!.name).toBe("דוד כהן");
    expect(r.proposals.filter((p) => p.type === "law")).toHaveLength(1);
  });
  it("a 10,000-note synthetic vault runs, yielding between notes", async () => {
    const big = Array.from({ length: 10_000 }, (_, i) => ({ path: `n${i}.md`, content: `# פתק ${i}\n\nב-${(i % 28) + 1}.${(i % 12) + 1}.2026 נקבע לפי חוק חופש המידע, התשנ״ח-1998 ובראשית א:${(i % 30) + 1}.\n\nשורה רגילה בלי ישויות ${i}.` }));
    let ticks = 0;
    const t0 = performance.now();
    const r = await extractEntities({ notes: big, tick: () => void ticks++ });
    const ms = performance.now() - t0;
    expect(ticks).toBe(10_000);
    expect(r.paragraphs.scanned).toBe(30_000);
    expect(r.proposals.find((p) => p.type === "law")!.mentions).toHaveLength(10_000);
    // Per-note work bounds the worker's slice between yields (the main-thread long-task check is W12.M1 / e2e).
    expect(ms / 10_000).toBeLessThan(50);
  }, 600_000);
});
