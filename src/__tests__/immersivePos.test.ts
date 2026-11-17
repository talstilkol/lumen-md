/**
 * Plan W13.R5 — the immersive reader: parts of speech tagged on this device
 * (accuracy on held-out hand-tagged sets), English syllables, a word's
 * translation from the offline lexicon, line focus, no network, and the
 * note unchanged.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tagHebrew } from "../text/hebrewPos";
import { tagEnglish } from "../text/englishPos";
import { immersiveParagraphs, lexiconTranslation, syllables } from "../reading/immersive";

const MAP = { N: "noun", V: "verb", A: "adj", O: "other" } as const;

function score(file: string, tag: (s: string) => Array<{ pos: string }>): { ok: number; n: number; wrong: string[] } {
  let ok = 0;
  let n = 0;
  const wrong: string[] = [];
  for (const line of readFileSync(join(__dirname, "fixtures/pos", file), "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const gold = line
      .trim()
      .split(/\s+/)
      .map((x) => [x.slice(0, x.lastIndexOf("/")), MAP[x.slice(x.lastIndexOf("/") + 1) as keyof typeof MAP]] as const);
    const got = tag(gold.map((g) => g[0]).join(" "));
    expect(got.length, line).toBe(gold.length);
    gold.forEach(([w, p], i) => {
      n++;
      if (got[i].pos === p) ok++;
      else wrong.push(`${w}:${p}→${got[i].pos}`);
    });
  }
  return { ok, n, wrong };
}

describe("parts of speech on held-out sets (300+ hand-tagged words each, never used for tuning)", () => {
  it("English: ≥ 90%", () => {
    const r = score("heldout.en.txt", tagEnglish);
    expect(r.n).toBeGreaterThanOrEqual(300);
    // Measured once when the set was written: 302 / 324 = 93.2%.
    expect(r.ok / r.n).toBeGreaterThanOrEqual(0.9);
  });

  it("Hebrew: the rules of phase 1 reach 85.7% — under the 90% goal, which phase 2 (a local model) is for", () => {
    const r = score("heldout.he.txt", tagHebrew);
    expect(r.n).toBeGreaterThanOrEqual(300);
    // Measured once when the set was written: 282 / 329 = 85.7%. This floor keeps it from getting worse;
    // plan W13.R5 asks 90%, so the task stays partial until the model tagger lands (gate 0.10).
    expect(r.ok / r.n).toBeGreaterThanOrEqual(0.857);
  });

  it("the development sets stay right (the rules were tuned on them)", () => {
    for (const [f, tag] of [["dev.he.txt", tagHebrew], ["dev.en.txt", tagEnglish], ["dev2.he.txt", tagHebrew], ["dev2.en.txt", tagEnglish]] as const) {
      const r = score(f, tag);
      expect(r.ok / r.n, `${f}: ${r.wrong.join(" ")}`).toBeGreaterThanOrEqual(f.includes("he") && f.includes("2") ? 0.88 : 0.97);
    }
  });

  it("niqqud, prefixes and maqaf do not confuse it", () => {
    expect(tagHebrew("הַיֶּלֶד הַקָּטָן הָלַךְ").map((w) => w.pos)).toEqual(["noun", "adj", "verb"]);
    expect(tagHebrew("על־פני").map((w) => w.word)).toEqual(["על", "פני"]);
  });
});

describe("syllables (English)", () => {
  it("splits words into their beats", () => {
    expect(["reading", "syllable", "little", "table", "computer", "make", "words", "together", "interesting", "rabbit", "nature", "a", "government", "kindness"].map((w) => syllables(w).join("·"))).toEqual([
      "read·ing",
      "syl·la·ble",
      "lit·tle",
      "ta·ble",
      "com·pu·ter",
      "make",
      "words",
      // A rule, not a dictionary: "to·geth·er" and "in·ter·est·ing" in Merriam-Webster.
      "to·ge·ther",
      "in·te·rest·ing",
      "rab·bit",
      "na·ture",
      "a",
      "go·vern·ment",
      "kind·ness",
    ]);
  });
});

describe("no network", () => {
  it("paragraphs and lexicon lookups make no request", async () => {
    const calls: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = ((u: unknown) => (calls.push(String(u)), Promise.reject(new Error("no network")))) as typeof fetch;
    try {
      expect(immersiveParagraphs("one\n\n```\ncode\n```\n\ntwo").length).toBe(2);
      expect(await lexiconTranslation("ובספר")).toContain("book");
    } finally {
      globalThis.fetch = real;
    }
    expect(calls).toEqual([]);
  });
});
